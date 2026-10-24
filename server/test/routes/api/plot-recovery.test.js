import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';

import { assetExists, authenticate, build, upload } from '#test/helper.js';
import s3 from '#lib/s3.js';

test('plot submission recovery', async (t) => {
  const app = await build(t);
  const { prisma } = app;
  const headers = await authenticate(app, 'admin.user@test.com', 'test');
  const draft = () => ({
    submissionId: randomUUID(),
    Latitude: 37.77,
    Longitude: -122.43,
    'Location Description': 'Second tree well',
    stage: 'active',
    plants: [{ newPlant: { plantName: 'Yarrow' }, quantity: 2 }],
  });
  const create = (payload) => app.inject({ method: 'POST', url: '/api/plots', headers, payload });

  await t.test('replays a saved draft without duplicating plots or directory plants', async () => {
    const payload = draft();
    const first = await create(payload);
    const retry = await create(payload);
    assert.equal(first.statusCode, 201);
    assert.equal(retry.statusCode, 200);
    assert.deepEqual(retry.json(), first.json());
    assert.equal(await prisma.plot.count(), 4);
    assert.equal(await prisma.plant.count(), 4);
    assert.equal(retry.json().submissionId, undefined);
    assert.equal(retry.json().submissionFingerprint, undefined);
  });

  await t.test('concurrent retries recover one winner', async () => {
    const payload = draft();
    const responses = await Promise.all([create(payload), create(payload), create(payload)]);
    assert.deepEqual(responses.map(({ statusCode }) => statusCode).sort(), [200, 200, 201]);
    assert.equal(new Set(responses.map((response) => response.json().id)).size, 1);
    assert.equal(await prisma.plot.count(), 4);
    assert.equal(await prisma.plant.count(), 4);
  });

  await t.test('changed input returns the saved plot ID; distinct drafts at one location remain distinct', async () => {
    const payload = draft();
    const first = await create(payload);
    const conflict = await create({ ...payload, 'Location Description': 'Changed after uncertain save' });
    assert.equal(conflict.statusCode, 409);
    assert.equal(conflict.json().plotId, first.json().id);
    const other = await create({ ...payload, submissionId: randomUUID() });
    assert.equal(other.statusCode, 201);
    assert.notEqual(other.json().id, first.json().id);
  });

  await t.test('a rollback after copying retains the upload, cleans the destination, and allows retry', async (t) => {
    const filename = `${randomUUID()}.jpg`;
    await upload([['640x480.jpg', filename]]);
    const payload = { ...draft(), Photos: [filename] };
    const copied = t.mock.method(s3, 'copyObject');
    t.mock.method(console, 'error', () => {});
    const original = app.prisma;
    app.prisma = new Proxy(original, {
      get (target, property) {
        if (property === '$transaction') {
          return (callback) => original.$transaction(async (tx) => {
            await callback(tx);
            throw new Error('Simulated database failure after attachment copy');
          });
        }
        return Reflect.get(target, property);
      },
    });
    try {
      assert.equal((await create(payload)).statusCode, 500);
    } finally {
      app.prisma = original;
    }
    assert.ok(await assetExists(`_uploads/${filename}`));
    assert.equal(await assetExists(copied.mock.calls[0].arguments[1]), false);
    assert.equal(await prisma.plot.count(), 3);
    assert.equal(await prisma.plant.count(), 3);
    const retry = await create(payload);
    assert.equal(retry.statusCode, 201);
    assert.equal(await assetExists(`_uploads/${filename}`), false);
    const responseAgain = await create(payload);
    assert.equal(responseAgain.statusCode, 200);
    assert.equal(copied.mock.calls.length, 2);
  });

  await t.test('post-commit staging cleanup failure does not report a failed save', async (t) => {
    const filename = `${randomUUID()}.jpg`;
    await upload([['640x480.jpg', filename]]);
    t.mock.method(s3, 'deleteObject', async () => { throw new Error('Simulated cleanup outage'); });
    const payload = { ...draft(), Photos: [filename] };
    const response = await create(payload);
    assert.equal(response.statusCode, 201);
    assert.ok(await prisma.plot.findUnique({ where: { airtableId: response.json().id } }));
    assert.equal((await create(payload)).statusCode, 200);
  });
});
