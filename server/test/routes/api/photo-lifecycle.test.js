import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { GetBucketLifecycleConfigurationCommand, PutBucketLifecycleConfigurationCommand, PutBucketVersioningCommand, S3Client } from '@aws-sdk/client-s3';
import { assetExists, authenticate, build, upload } from '#test/helper.js';
import s3 from '#lib/s3.js';
import { lockCopyIntent, preparePlotPhotos, reconcilePhotoCopies } from '#lib/photo-lifecycle.js';
import { dayMs } from '#lib/upload-policy.js';
import { PrismaClient, PrismaPg } from '#prisma/client.js';

const due = () => new Date(Date.now() + 2 * 60 * 60 * 1000);
const exec = promisify(execFile);

test('finite photo copy cleanup and save recovery', async (t) => {
  const app = await build(t);
  const { prisma } = app;
  const headers = await authenticate(app, 'admin.user@test.com', 'test');
  const payload = (Photos) => ({ submissionId: randomUUID(), Latitude: 37.77, Longitude: -122.43, 'Location Description': 'Keep these details', Photos });
  const create = (body) => app.inject({ method: 'POST', url: '/api/plots', headers, payload: body });
  async function stage () {
    const filename = `${randomUUID()}.jpg`;
    await upload([['640x480.jpg', filename]]);
    return filename;
  }
  async function orphan () {
    const filename = await stage();
    const [id] = await preparePlotPhotos(prisma, [filename]);
    const key = `plot_photos/${id}/file/${filename}`;
    await s3.copyObject(`${process.env.AWS_S3_BUCKET}/_uploads/${filename}`, key);
    return { filename, key };
  }

  await t.test('confirmed saves leave the queue and are never rechecked', async () => {
    const saved = await create(payload([await stage()]));
    assert.equal(saved.statusCode, 201);
    const [intent] = await prisma.photoCopyIntent.findMany();
    assert.equal((await reconcilePhotoCopies(prisma, { dryRun: false, now: due() })).retained, 1);
    assert.equal(await prisma.photoCopyIntent.count(), 0);
    assert.ok(await assetExists(intent.key));
    assert.deepEqual(await reconcilePhotoCopies(prisma, { dryRun: false, now: due() }), { retained: 0, deleted: 0, skipped: 0, failed: 0 });
  });

  await t.test('deleted orphans leave no recurring record or scans of other assets', async (t) => {
    const { filename, key } = await orphan();
    const untracked = `plant_photos/${randomUUID()}/file/${filename}`;
    await s3.copyObject(`${process.env.AWS_S3_BUCKET}/_uploads/${filename}`, untracked);
    assert.equal((await reconcilePhotoCopies(prisma, { dryRun: false, now: due() })).deleted, 1);
    assert.equal(await prisma.photoCopyIntent.count(), 0);
    assert.equal(await assetExists(key), false);
    assert.ok(await assetExists(untracked));
    assert.ok(await assetExists(`_uploads/${filename}`), 'native expiration owns staging, preserving recent retry sources');
    const deletion = t.mock.method(s3, 'deleteObject');
    await reconcilePhotoCopies(prisma, { dryRun: false, now: due() });
    assert.equal(deletion.mock.calls.length, 0);
    await assert.rejects(prisma.$transaction((tx) => lockCopyIntent(tx, key)), /not available/, 'resolved keys cannot be reused by a delayed save');
  });

  await t.test('concurrent saves succeed with a single database connection', async () => {
    const files = [await stage(), await stage()];
    const pooled = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL, max: 1 }) });
    const original = app.prisma;
    app.prisma = new Proxy(pooled, {
      get (target, key) {
        if (key === '$transaction') return (callback) => target.$transaction(callback, { timeout: 1000 });
        return Reflect.get(target, key);
      },
    });
    try {
      const results = await Promise.all(files.map((file) => create(payload([file]))));
      assert.deepEqual(results.map(({ statusCode }) => statusCode), [201, 201]);
    } finally {
      app.prisma = original;
      await pooled.$disconnect();
    }
  });

  await t.test('expiry uses object age, and replay precedes all storage access', async (t) => {
    const now = Date.now();
    t.mock.method(Date, 'now', () => now);
    const head = s3.headObject;
    const old = await stage();
    t.mock.method(s3, 'headObject', async (key) => {
      const object = await head(key);
      return key === `_uploads/${old}` && object ? { ...object, LastModified: new Date(now - 7 * dayMs) } : object;
    });
    const body = payload([old]);
    for (const Photos of [[old], [`${randomUUID()}.jpg`]]) {
      const response = await create({ ...body, Photos });
      assert.equal(response.statusCode, 422);
      assert.equal(response.json().errors[0].path, 'Photos');
      assert.equal(await prisma.plot.count({ where: { submissionId: body.submissionId } }), 0);
    }
    const replacement = await stage();
    const saved = await create({ ...body, Photos: [replacement] });
    assert.equal(saved.statusCode, 201);
    assert.equal(await assetExists(`_uploads/${replacement}`), false);
    t.mock.method(s3, 'headObject', async () => { throw new Error('Replay must not read staging'); });
    const retry = await create({ ...body, Photos: [replacement] });
    assert.equal(retry.statusCode, 200);
    assert.deepEqual(retry.json(), saved.json());
  });

  await t.test('storage failures remain server errors and leave cleanup work retryable', async (t) => {
    const filename = await stage();
    t.mock.method(console, 'error', () => {});
    t.mock.method(s3, 'headObject', async () => { throw new Error('Storage unavailable'); });
    assert.equal((await create(payload([filename]))).statusCode, 500);
    assert.equal(await prisma.photoCopyIntent.count(), 1);
  });

  await t.test('partial copies and failed deletes retry, then leave the queue', async (t) => {
    const files = [await stage(), await stage()];
    const body = payload(files);
    const original = s3.copyObject;
    let copied = 0;
    t.mock.method(console, 'error', () => {});
    const copy = t.mock.method(s3, 'copyObject', async (...args) => {
      await original(...args);
      if (++copied === 2) throw new Error('Interrupted copy');
    });
    const deletion = t.mock.method(s3, 'deleteObject', async () => { throw new Error('Deletion unavailable'); });
    assert.equal((await create(body)).statusCode, 500);
    const intents = await prisma.photoCopyIntent.findMany();
    assert.equal(intents.length, 2);
    for (const { key } of intents) assert.ok(await assetExists(key));
    assert.equal((await reconcilePhotoCopies(prisma, { dryRun: false, now: due() })).failed, 2);
    assert.ok((await prisma.photoCopyIntent.findMany()).every(({ retired, lastError, checks }) => retired && lastError && checks === 1));
    deletion.mock.restore();
    assert.equal((await reconcilePhotoCopies(prisma, { dryRun: false, now: due() })).deleted, 2);
    assert.equal(await prisma.photoCopyIntent.count(), 0);
    for (const { key } of intents) assert.equal(await assetExists(key), false);
    for (const file of files) assert.ok(await assetExists(`_uploads/${file}`));
    copy.mock.restore();
    assert.equal((await create(body)).statusCode, 201);
  });

  await t.test('retirement commits before deletion and lost acknowledgments remain retryable', async (t) => {
    const { key } = await orphan();
    const original = s3.deleteObject;
    let fenced = false;
    const deletion = t.mock.method(s3, 'deleteObject', async (...args) => {
      fenced = (await prisma.photoCopyIntent.findUnique({ where: { key } })).retired;
      await original(...args);
      throw new Error('Lost delete acknowledgment');
    });
    assert.equal((await reconcilePhotoCopies(prisma, { dryRun: false, now: due() })).failed, 1);
    assert.equal(fenced, true);
    assert.ok((await prisma.photoCopyIntent.findUnique({ where: { key } })).lastError);
    assert.equal(await assetExists(key), false);
    deletion.mock.restore();
    assert.equal((await reconcilePhotoCopies(prisma, { dryRun: false, now: due() })).deleted, 1);
    assert.equal(await prisma.photoCopyIntent.count(), 0);
  });

  await t.test('active saves are skipped and committed copies retained', async (t) => {
    const file = await stage();
    const original = s3.copyObject;
    const started = Promise.withResolvers();
    const release = Promise.withResolvers();
    t.mock.method(s3, 'copyObject', async (...args) => { started.resolve(); await release.promise; return original(...args); });
    const saving = create(payload([file]));
    t.after(() => release.resolve());
    await started.promise;
    const [intent] = await prisma.photoCopyIntent.findMany();
    assert.equal((await reconcilePhotoCopies(prisma, { dryRun: false, now: due() })).skipped, 1);
    assert.ok(await assetExists(`_uploads/${file}`));
    release.resolve();
    assert.equal((await saving).statusCode, 201);
    assert.equal((await reconcilePhotoCopies(prisma, { dryRun: false, now: due() })).retained, 1);
    assert.ok(await assetExists(intent.key));
    assert.equal(await prisma.photoCopyIntent.count(), 0);
  });

  await t.test('dry-run is read-only and unavailable authoritative state retains copies', async () => {
    const { key } = await orphan();
    assert.equal((await reconcilePhotoCopies(prisma, { now: due() })).deleted, 1);
    assert.equal((await prisma.photoCopyIntent.findUnique({ where: { key } })).checks, 0);
    const unavailable = new Proxy(prisma, {
      get (target, property) {
        if (property === '$transaction') return async () => { throw new Error('Database unavailable'); };
        return Reflect.get(target, property);
      },
    });
    assert.equal((await reconcilePhotoCopies(unavailable, { dryRun: false, now: due() })).failed, 1);
    assert.ok(await assetExists(key));
    assert.equal(await prisma.photoCopyIntent.count(), 1);
    assert.equal((await reconcilePhotoCopies(prisma, { dryRun: false, now: due() })).deleted, 1);
  });

  await t.test('pagination resolves more than one batch even as records are removed', async () => {
    await prisma.photoCopyIntent.createMany({ data: Array.from({ length: 105 }, () => ({ key: `plot_photos/${randomUUID()}/file/${randomUUID()}.jpg` })) });
    assert.equal((await reconcilePhotoCopies(prisma)).deleted, 105);
    assert.equal((await reconcilePhotoCopies(prisma, { dryRun: false })).deleted, 105);
    assert.equal(await prisma.photoCopyIntent.count(), 0);
  });

  await t.test('operator command defaults to dry-run and staging is never swept by it', async () => {
    const { key, filename } = await orphan();
    await prisma.photoCopyIntent.update({ where: { key }, data: { nextCheckAt: new Date(0) } });
    const { stdout } = await exec(process.execPath, ['bin/reconcile-photos.js']);
    assert.match(stdout, /"dryRun":true/);
    assert.match(stdout, /"action":"delete"/);
    assert.ok(await assetExists(key));
    assert.ok(await assetExists(`_uploads/${filename}`));
    assert.equal(await prisma.photoCopyIntent.count(), 1);
  });

  await t.test('disposable storage accepts the native staging rule without covering permanent paths', async () => {
    const client = new S3Client({ endpoint: process.env.AWS_S3_ENDPOINT, region: process.env.AWS_S3_REGION, forcePathStyle: true, credentials: { accessKeyId: process.env.AWS_S3_ACCESS_KEY_ID, secretAccessKey: process.env.AWS_S3_SECRET_ACCESS_KEY } });
    try {
      const rule = { ID: 'pocket-gardens-staging-expiration', Status: 'Enabled', Filter: { Prefix: '_uploads/' }, Expiration: { Days: 7 } };
      await client.send(new PutBucketLifecycleConfigurationCommand({ Bucket: process.env.AWS_S3_BUCKET, LifecycleConfiguration: { Rules: [rule] } }));
      const { Rules } = await client.send(new GetBucketLifecycleConfigurationCommand({ Bucket: process.env.AWS_S3_BUCKET }));
      assert.deepEqual(Rules, [rule]);
    } finally {
      client.destroy();
    }
  });

  await t.test('operator command refuses versioned buckets before deleting anything', async () => {
    const { key } = await orphan();
    await prisma.photoCopyIntent.update({ where: { key }, data: { nextCheckAt: new Date(0) } });
    const client = new S3Client({ endpoint: process.env.AWS_S3_ENDPOINT, region: process.env.AWS_S3_REGION, forcePathStyle: true, credentials: { accessKeyId: process.env.AWS_S3_ACCESS_KEY_ID, secretAccessKey: process.env.AWS_S3_SECRET_ACCESS_KEY } });
    try {
      await client.send(new PutBucketVersioningCommand({ Bucket: process.env.AWS_S3_BUCKET, VersioningConfiguration: { Status: 'Enabled' } }));
      await assert.rejects(exec(process.execPath, ['bin/reconcile-photos.js', '--apply']), /requires an unversioned bucket/);
      assert.ok(await assetExists(key));
      assert.equal(await prisma.photoCopyIntent.count(), 1);
    } finally {
      client.destroy();
    }
  });
});
