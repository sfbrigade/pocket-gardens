import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { GetBucketLifecycleConfigurationCommand, PutBucketLifecycleConfigurationCommand, S3Client } from '@aws-sdk/client-s3';
import { assetExists, authenticate, build, upload } from '#test/helper.js';
import s3 from '#lib/s3.js';
import { dayMs } from '#lib/upload-policy.js';
import { PrismaClient, PrismaPg } from '#prisma/client.js';

test('photo upload recovery and immediate cleanup', async (t) => {
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

  await t.test('storage failures leave recent staging available for retry', async (t) => {
    const filename = await stage();
    const body = payload([filename]);
    t.mock.method(console, 'error', () => {});
    const head = t.mock.method(s3, 'headObject', async () => { throw new Error('Storage unavailable'); });
    assert.equal((await create(body)).statusCode, 500);
    head.mock.restore();
    assert.ok(await assetExists(`_uploads/${filename}`));
    assert.equal(await prisma.plot.count({ where: { submissionId: body.submissionId } }), 0);
    assert.equal((await create(body)).statusCode, 201);
  });

  await t.test('partial copies are deleted after rollback and staging survives for retry', async (t) => {
    const files = [await stage(), await stage()];
    const body = payload(files);
    const original = s3.copyObject;
    const targets = [];
    t.mock.method(console, 'error', () => {});
    const copy = t.mock.method(s3, 'copyObject', async (...args) => {
      targets.push(args[1]);
      await original(...args);
      if (targets.length === 2) throw new Error('Lost copy acknowledgment');
    });
    assert.equal((await create(body)).statusCode, 500);
    assert.equal(targets.length, 2);
    for (const key of targets) assert.equal(await assetExists(key), false);
    for (const filename of files) assert.ok(await assetExists(`_uploads/${filename}`));
    assert.equal(await prisma.plot.count({ where: { submissionId: body.submissionId } }), 0);
    copy.mock.restore();
    const saved = await create(body);
    assert.equal(saved.statusCode, 201);
    for (const filename of files) assert.equal(await assetExists(`_uploads/${filename}`), false);
    assert.deepEqual((await create(body)).json(), saved.json());
  });

  await t.test('failed rollback cleanup does not block a later save or delete unrelated assets', async (t) => {
    const filename = await stage();
    const body = payload([filename]);
    const unrelated = `plant_photos/${randomUUID()}/file/${filename}`;
    await s3.copyObject(`${process.env.AWS_S3_BUCKET}/_uploads/${filename}`, unrelated);
    const original = s3.copyObject;
    let orphan;
    t.mock.method(console, 'error', () => {});
    const copy = t.mock.method(s3, 'copyObject', async (...args) => {
      orphan = args[1];
      await original(...args);
      throw new Error('Lost copy acknowledgment');
    });
    const deletion = t.mock.method(s3, 'deleteObject', async () => { throw new Error('Deletion unavailable'); });
    assert.equal((await create(body)).statusCode, 500);
    assert.equal(await prisma.plot.count({ where: { submissionId: body.submissionId } }), 0);
    assert.ok(await assetExists(orphan));
    assert.ok(await assetExists(`_uploads/${filename}`));
    copy.mock.restore();
    deletion.mock.restore();
    assert.equal((await create(body)).statusCode, 201);
    assert.ok(await assetExists(orphan), 'failed cleanup is best effort; no recurring worker removes it');
    assert.ok(await assetExists(unrelated));
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
});
