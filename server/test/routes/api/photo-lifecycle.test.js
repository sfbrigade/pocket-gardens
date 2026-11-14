import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { PutBucketVersioningCommand, S3Client } from '@aws-sdk/client-s3';
import { assetExists, authenticate, build, upload } from '#test/helper.js';
import s3 from '#lib/s3.js';
import { expireStagingUploads, reconcilePhotoCopies } from '#lib/photo-lifecycle.js';
import { dayMs } from '#lib/upload-policy.js';
import { PrismaClient, PrismaPg } from '#prisma/client.js';

const later = (days) => new Date(Date.now() + days * dayMs);

test('durable photo lifecycle and reconciliation', async (t) => {
  const app = await build(t);
  const { prisma } = app;
  const headers = await authenticate(app, 'admin.user@test.com', 'test');
  const payload = (filenames) => ({ submissionId: randomUUID(), Latitude: 37.77, Longitude: -122.43, 'Location Description': 'Keep these details', Photos: filenames });
  const create = (body) => app.inject({ method: 'POST', url: '/api/plots', headers, payload: body });
  async function stage () {
    const response = await app.inject({ method: 'POST', url: '/api/assets', payload: { contentType: 'image/jpeg' } });
    assert.equal(response.statusCode, 200);
    const { filename, url, expiresAt } = response.json();
    assert.equal(new URL(url).searchParams.get('X-Amz-Expires'), '900');
    assert.equal((await prisma.assetUpload.findUnique({ where: { filename } })).expiresAt.toISOString(), expiresAt);
    await upload([['640x480.jpg', filename]]);
    return filename;
  }

  await t.test('concurrent photo saves succeed with a single database connection', async (t) => {
    const files = [await stage(), await stage()];
    const pooled = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL, max: 1 }) });
    const original = app.prisma;
    t.mock.method(console, 'error', () => {});
    app.prisma = new Proxy(pooled, {
      get (target, key) {
        if (key === '$transaction') return (callback) => target.$transaction(callback, { timeout: 1000 });
        return Reflect.get(target, key);
      },
    });
    try {
      const results = await Promise.all(files.map((file) => create(payload([file]))));
      assert.deepEqual(results.map(({ statusCode }) => statusCode), [201, 201]);
      for (const file of files) assert.equal(await assetExists(`_uploads/${file}`), false);
    } finally {
      app.prisma = original;
      await pooled.$disconnect();
    }
  });

  await t.test('missing and expired tokens return a photo field error; edits keep the submission identity', async () => {
    const filename = await stage();
    const body = payload([filename]);
    await prisma.assetUpload.update({ where: { filename }, data: { expiresAt: new Date(0) } });
    for (const photos of [[filename], [`${randomUUID()}.jpg`]]) {
      const result = await create({ ...body, Photos: photos });
      assert.equal(result.statusCode, 422);
      assert.equal(result.json().errors[0].path, 'Photos');
      assert.match(result.json().errors[0].message, /Reattach/);
      assert.equal(await prisma.plot.count({ where: { submissionId: body.submissionId } }), 0);
    }
    const replacement = await stage();
    const saved = await create({ ...body, Photos: [replacement] });
    assert.equal(saved.statusCode, 201);
    assert.equal((await prisma.plot.findUnique({ where: { submissionId: body.submissionId } })).locationDescription, body['Location Description']);
    assert.equal(await assetExists(`_uploads/${replacement}`), false);
    await prisma.assetUpload.update({ where: { filename: replacement }, data: { expiresAt: new Date(0) } });
    const retry = await create({ ...body, Photos: [replacement] });
    assert.equal(retry.statusCode, 200);
    assert.deepEqual(retry.json(), saved.json());
  });

  await t.test('storage authorization/outages are not misreported as an expired photo', async (t) => {
    const filename = await stage();
    t.mock.method(console, 'error', () => {});
    t.mock.method(s3, 'headObject', async () => { throw new Error('Storage unavailable'); });
    assert.equal((await create(payload([filename]))).statusCode, 500);
    assert.equal(await prisma.photoCopyIntent.count(), 1, 'preallocated intent survives failed validation without copying');
  });

  await t.test('partial copies survive rollback and cleanup failure, then reconcile idempotently', async (t) => {
    const files = [await stage(), await stage()];
    const original = s3.copyObject;
    let count = 0;
    t.mock.method(console, 'error', () => {});
    const copy = t.mock.method(s3, 'copyObject', async (...args) => {
      await original(...args);
      if (++count === 2) throw new Error('Interrupted copy');
    });
    const deletion = t.mock.method(s3, 'deleteObject', async () => { throw new Error('Deletion unavailable'); });
    assert.equal((await create(payload(files))).statusCode, 500);
    const intents = await prisma.photoCopyIntent.findMany();
    assert.equal(intents.length, 2);
    for (const { key } of intents) assert.ok(await assetExists(key));
    for (const file of files) assert.ok(await assetExists(`_uploads/${file}`));
    const options = { now: later(1), dryRun: false };
    const purge = t.mock.method(s3, 'purgeObject', async () => { throw new Error('Deletion unavailable'); });
    assert.equal((await reconcilePhotoCopies(prisma, options)).failed, 2);
    assert.ok((await prisma.photoCopyIntent.findMany()).every(({ lastError }) => lastError));
    deletion.mock.restore();
    purge.mock.restore();
    assert.equal((await reconcilePhotoCopies(prisma, options)).deleted, 2);
    for (const { key } of intents) assert.equal(await assetExists(key), false);
    assert.ok((await prisma.photoCopyIntent.findMany()).every(({ retired, lastError }) => retired && !lastError));
    await original(copy.mock.calls[0].arguments[0], intents[0].key);
    assert.equal((await reconcilePhotoCopies(prisma, { dryRun: false, now: later(3) })).deleted, 2);
    assert.equal(await assetExists(intents[0].key), false);
    copy.mock.restore();
    assert.equal((await create(payload(files))).statusCode, 201, 'recent staging survives a failed save');
  });

  await t.test('retirement commits before external deletion, including a lost deletion acknowledgment', async (t) => {
    const filename = await stage();
    const key = `plot_photos/${randomUUID()}/file/${filename}`;
    await prisma.photoCopyIntent.create({ data: { key, upload: filename } });
    await s3.copyObject(`${process.env.AWS_S3_BUCKET}/_uploads/${filename}`, key);
    const original = s3.purgeObject;
    let fenced = false;
    const purge = t.mock.method(s3, 'purgeObject', async (...args) => {
      fenced = (await prisma.photoCopyIntent.findUnique({ where: { key } })).retired;
      await original(...args);
      throw new Error('Lost deletion acknowledgment');
    });
    assert.equal((await reconcilePhotoCopies(prisma, { dryRun: false })).failed, 1);
    assert.equal(fenced, true, 'other connections must see retirement before storage deletion starts');
    assert.equal(await assetExists(key), false);
    assert.ok((await prisma.photoCopyIntent.findUnique({ where: { key } })).lastError);
    purge.mock.restore();
    assert.equal((await reconcilePhotoCopies(prisma, { dryRun: false })).deleted, 1);
  });

  await t.test('active saves are locked out of cleanup; committed references remain protected', async (t) => {
    const filename = await stage();
    const original = s3.copyObject;
    const started = Promise.withResolvers();
    const release = Promise.withResolvers();
    t.mock.method(s3, 'copyObject', async (...args) => {
      started.resolve();
      await release.promise;
      return original(...args);
    });
    const saving = create(payload([filename]));
    t.after(() => release.resolve());
    await started.promise;
    const [intent] = await prisma.photoCopyIntent.findMany();
    assert.ok(intent, 'intent is durable before the storage write');
    assert.equal((await reconcilePhotoCopies(prisma, { dryRun: false, now: later(1) })).skipped, 1);
    assert.ok((await expireStagingUploads(prisma, { dryRun: false, now: later(8) })).retained >= 1);
    assert.ok(await assetExists(`_uploads/${filename}`));
    release.resolve();
    assert.equal((await saving).statusCode, 201);
    const result = await reconcilePhotoCopies(prisma, { dryRun: false, now: later(2) });
    assert.equal(result.retained, 1);
    assert.ok(await assetExists(intent.key));
    assert.equal((await prisma.photoCopyIntent.findUnique({ where: { key: intent.key } })).retired, false);
  });

  await t.test('process death after recording intent is recoverable; unavailable DB state prevents deletion', async () => {
    const filename = await stage();
    const key = `plot_photos/${randomUUID()}/file/${filename}`;
    await prisma.photoCopyIntent.create({ data: { key, upload: filename } });
    await s3.copyObject(`${process.env.AWS_S3_BUCKET}/_uploads/${filename}`, key);
    const dry = await reconcilePhotoCopies(prisma);
    assert.equal(dry.deleted, 1);
    assert.ok(await assetExists(key));
    assert.equal((await prisma.photoCopyIntent.findUnique({ where: { key } })).checks, 0);
    const failing = new Proxy(prisma, {
      get (target, property) {
        if (property === '$transaction') return async () => { throw new Error('Authoritative database unavailable'); };
        return Reflect.get(target, property);
      },
    });
    assert.equal((await reconcilePhotoCopies(failing, { dryRun: false })).failed, 1);
    assert.ok(await assetExists(key));
    assert.equal((await reconcilePhotoCopies(prisma, { dryRun: false })).deleted, 1);
    assert.equal(await assetExists(key), false);
  });

  await t.test('abandoned and late uploads expire eventually; recent imports and permanent assets are outside cleanup', async () => {
    const abandoned = await stage();
    const imported = `${randomUUID()}.jpg`;
    const permanent = `plant_photos/${randomUUID()}/file/${randomUUID()}.jpg`;
    await upload([['640x480.jpg', imported]]);
    await s3.copyObject(`${process.env.AWS_S3_BUCKET}/_uploads/${imported}`, permanent);
    assert.equal((await expireStagingUploads(prisma, { dryRun: false })).deleted, 0);
    const dry = await expireStagingUploads(prisma, { now: later(8) });
    assert.ok(dry.deleted >= 2);
    assert.ok(await assetExists(`_uploads/${abandoned}`));
    await expireStagingUploads(prisma, { dryRun: false, now: later(8) });
    assert.equal(await assetExists(`_uploads/${abandoned}`), false);
    assert.ok(await assetExists(permanent));
    await upload([['640x480.jpg', abandoned]]);
    await expireStagingUploads(prisma, { dryRun: false, now: later(9) });
    assert.equal(await assetExists(`_uploads/${abandoned}`), false);
    assert.ok(await assetExists(permanent));
  });

  await t.test('operator command defaults to read-only inspection', async () => {
    const filename = await stage();
    const { stdout } = await promisify(execFile)(process.execPath, ['bin/reconcile-photos.js']);
    assert.match(stdout, /"dryRun":true/);
    assert.match(stdout, /"retentionDays":7/);
    assert.ok(await assetExists(`_uploads/${filename}`));
    const denied = await app.inject({ method: 'DELETE', url: `/api/assets/_uploads/${filename}` });
    assert.equal(denied.statusCode, 404, 'cleanup adds no arbitrary-key HTTP deletion surface');
  });

  await t.test('staging cutoff is inclusive, prefix scoped and retries transient deletions', async (t) => {
    const now = new Date();
    const cutoff = new Date(now.getTime() - 7 * dayMs);
    const items = [
      { Key: '_uploads/boundary.jpg', LastModified: cutoff },
      { Key: '_uploads/older.jpg', LastModified: new Date(cutoff.getTime() - 1) },
      { Key: '_uploads/recent.jpg', LastModified: new Date(cutoff.getTime() + 1) },
      { Key: 'plant_photos/keep.jpg', LastModified: cutoff },
      { Key: '_uploads/nested/keep.jpg', LastModified: cutoff },
    ];
    t.mock.method(s3, 'listObjects', async function * () { yield * items; });
    t.mock.method(s3, 'headObject', async (key) => items.find(({ Key }) => Key === key));
    const purge = t.mock.method(s3, 'purgeObject', async () => { throw new Error('Retry me'); });
    assert.equal((await expireStagingUploads(prisma, { dryRun: false, now })).failed, 2);
    purge.mock.restore();
    const deleted = t.mock.method(s3, 'purgeObject', async () => {});
    assert.equal((await expireStagingUploads(prisma, { dryRun: false, now })).deleted, 2);
    assert.deepEqual(deleted.mock.calls.map(({ arguments: args }) => args[0]), ['_uploads/boundary.jpg', '_uploads/older.jpg']);
  });

  await t.test('copy reconciliation paginates through more than one batch', async () => {
    await prisma.photoCopyIntent.createMany({ data: Array.from({ length: 105 }, () => ({ key: `plot_photos/${randomUUID()}/file/${randomUUID()}.jpg`, upload: 'interrupted-before-write.jpg' })) });
    assert.equal((await reconcilePhotoCopies(prisma)).deleted, 105);
    assert.equal((await reconcilePhotoCopies(prisma, { dryRun: false })).deleted, 105);
    assert.equal(await prisma.photoCopyIntent.count({ where: { retired: true, checks: 1 } }), 105);
  });

  await t.test('storage listing and expiry paginate beyond a full S3 page', async () => {
    const names = Array.from({ length: 1005 }, () => `${randomUUID()}.jpg`);
    for (let i = 0; i < names.length; i += 30) {
      await upload(names.slice(i, i + 30).map((name) => ['640x480.jpg', name]));
    }
    const listed = [];
    for await (const { Key } of s3.listObjects('_uploads/')) listed.push(Key);
    for (const name of names) assert.ok(listed.includes(`_uploads/${name}`));
    const result = await expireStagingUploads(prisma, { dryRun: false, now: later(8) });
    assert.ok(result.deleted >= 1005);
    assert.equal(result.failed, 0);
    for await (const { Key } of s3.listObjects('_uploads/')) assert.fail(`Staging key survived: ${Key}`);
  });

  await t.test('versioned staging cleanup purges noncurrent versions and delete markers', async () => {
    const client = new S3Client({ endpoint: process.env.AWS_S3_ENDPOINT, region: process.env.AWS_S3_REGION, forcePathStyle: true, credentials: { accessKeyId: process.env.AWS_S3_ACCESS_KEY_ID, secretAccessKey: process.env.AWS_S3_SECRET_ACCESS_KEY } });
    try {
      await client.send(new PutBucketVersioningCommand({ Bucket: process.env.AWS_S3_BUCKET, VersioningConfiguration: { Status: 'Enabled' } }));
      assert.equal(await s3.bucketIsVersioned(), true);
      const filename = await stage();
      await upload([['640x480.jpg', filename]]);
      await s3.deleteObject(`_uploads/${filename}`);
      const versions = [];
      for await (const version of s3.listVersions(`_uploads/${filename}`)) versions.push(version);
      assert.equal(versions.length, 3);
      assert.equal(await assetExists(`_uploads/${filename}`), false);
      // More than one page of versions for a single key exercises continuation
      // markers while cleanup is deleting objects from the listed namespace.
      for (let i = 0; i < 1002; i += 30) await upload(Array.from({ length: Math.min(30, 1002 - i) }, () => ['640x480.jpg', filename]));
      let versionCount = 0;
      for await (const version of s3.listVersions(`_uploads/${filename}`)) { assert.equal(version.Key, `_uploads/${filename}`); versionCount++; }
      assert.equal(versionCount, 1005);
      const result = await expireStagingUploads(prisma, { dryRun: false, now: later(8), versioned: true });
      assert.equal(result.failed, 0);
      for await (const version of s3.listVersions(`_uploads/${filename}`)) assert.fail(`Version survived: ${version.VersionId}`);
      // Unrelated keys sharing a filename prefix are never purged.
      await upload([['640x480.jpg', filename], ['640x480.jpg', `${filename}.other`]]);
      await s3.purgeObject(`_uploads/${filename}`, true);
      assert.ok(await assetExists(`_uploads/${filename}.other`));
      const savedPhoto = await stage();
      assert.equal((await create(payload([savedPhoto]))).statusCode, 201);
      const [kept] = await prisma.photoCopyIntent.findMany();
      const orphan = `plot_photos/${randomUUID()}/file/${savedPhoto}`;
      await prisma.photoCopyIntent.create({ data: { key: orphan, upload: savedPhoto } });
      await s3.copyObject(`${process.env.AWS_S3_BUCKET}/${kept.key}`, orphan);
      await s3.copyObject(`${process.env.AWS_S3_BUCKET}/${kept.key}`, orphan);
      const reconciled = await reconcilePhotoCopies(prisma, { dryRun: false, now: later(2), versioned: true });
      assert.equal(reconciled.retained, 1);
      assert.equal(reconciled.deleted, 1);
      assert.ok(await assetExists(kept.key));
      for await (const version of s3.listVersions(orphan)) assert.fail(`Orphan version survived: ${version.VersionId}`);
    } finally {
      client.destroy();
    }
  });
});
