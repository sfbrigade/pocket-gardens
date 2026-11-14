import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';

import { assetExists, authenticate, build, upload } from '#test/helper.js';
import s3 from '#lib/s3.js';
import { createPlotDraft } from '../../../../client/src/Plots/plot-form.js';
import { preparePlotSubmission } from '../../../../client/src/Plots/plot-submission.js';

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

  await t.test('a refreshed client draft replays suggested fields and still rejects intentional edits', async () => {
    const values = {
      ...createPlotDraft(),
      position: { latitude: 37.77, longitude: -122.43 },
      locator: 'Second tree well',
      stage: 'active',
      plants: [{ newPlant: { plantName: 'Yarrow' }, quantity: 2, notes: '' }],
    };
    const result = { position: values.position, address: '440 5th Avenue, San Francisco' };
    const attempt = preparePlotSubmission(values, result);
    const first = await create(attempt.payload);
    assert.equal(first.statusCode, 201);
    const restored = JSON.parse(JSON.stringify({ ...values, submissionAttempt: attempt }));
    for (const suggestion of [undefined, { ...result, address: 'Different address' }]) {
      const retry = await create(preparePlotSubmission(restored, suggestion).payload);
      assert.equal(retry.statusCode, 200);
      assert.deepEqual(retry.json(), first.json());
    }
    const changed = preparePlotSubmission({ ...restored, locator: 'Third tree well' }, result);
    const conflict = await create(changed.payload);
    assert.equal(conflict.statusCode, 409);
    assert.equal(conflict.json().plotId, first.json().id);
    assert.equal(await prisma.plot.count(), 4);
    assert.equal(await prisma.plant.count(), 4);
  });

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

  for (const keyed of [true, false]) {
    await t.test(`a lost commit acknowledgment preserves saved photos ${keyed ? 'with' : 'without'} a submission ID`, async (t) => {
      const filename = `${randomUUID()}.jpg`;
      await upload([['640x480.jpg', filename]]);
      const payload = { ...draft(), Photos: [filename] };
      if (!keyed) delete payload.submissionId;
      const copied = t.mock.method(s3, 'copyObject');
      t.mock.method(console, 'error', () => {});
      const original = app.prisma;
      app.prisma = new Proxy(original, {
        get (target, property) {
          if (property === '$transaction') {
            return async (callback) => {
              await original.$transaction(callback);
              throw new Error('Simulated lost commit acknowledgment');
            };
          }
          return Reflect.get(target, property);
        },
      });
      let response;
      try {
        response = await create(payload);
      } finally {
        app.prisma = original;
      }
      assert.equal(response.statusCode, 201);
      assert.ok(await assetExists(copied.mock.calls[0].arguments[1]));
      assert.equal(await assetExists(`_uploads/${filename}`), false);
      assert.equal(await prisma.plot.count(), 4);
      assert.equal(await prisma.plant.count(), 4);
      if (keyed) {
        const retry = await create(payload);
        assert.equal(retry.statusCode, 200);
        assert.deepEqual(retry.json(), response.json());
        assert.equal(copied.mock.calls.length, 1);
      }
    });
  }

  for (const committed of [true, false]) {
    await t.test(`an uncertain commit retains photos when recovery ${committed ? 'is unavailable' : 'finds no row'}`, async (t) => {
      const filename = `${randomUUID()}.jpg`;
      await upload([['640x480.jpg', filename]]);
      const payload = { ...draft(), Photos: [filename] };
      const copied = t.mock.method(s3, 'copyObject');
      t.mock.method(console, 'error', () => {});
      const original = app.prisma;
      app.prisma = new Proxy(original, {
        get (target, property) {
          if (property === '$transaction') {
            return async (callback) => {
              await original.$transaction(async (tx) => {
                const record = await callback(tx);
                if (!committed) throw new Error('Simulated transaction failure after callback completed');
                return record;
              });
              throw new Error('Simulated lost commit acknowledgment');
            };
          }
          if (property === 'plot' && committed) {
            return new Proxy(target.plot, {
              get (delegate, method) {
                if (method === 'findFirst') return async () => { throw new Error('Database unavailable during recovery'); };
                return Reflect.get(delegate, method);
              },
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
      assert.ok(await assetExists(copied.mock.calls[0].arguments[1]));
      assert.ok(await assetExists(`_uploads/${filename}`));
      assert.equal((await create(payload)).statusCode, committed ? 200 : 201);
      assert.ok(await assetExists(copied.mock.calls[0].arguments[1]), 'uncertain copies are retained even after retry');
      assert.equal(await prisma.plot.count(), 4);
      assert.equal(await prisma.plant.count(), 4);
      assert.equal(copied.mock.calls.length, committed ? 1 : 2);
    });
  }

  await t.test('a failed detail reload rolls back, cleans the destination, and retains the upload for retry', async (t) => {
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
            return callback(new Proxy(tx, {
              get (transaction, key) {
                if (key === 'plot') {
                  return new Proxy(transaction.plot, {
                    get (delegate, method) {
                      if (method === 'findUnique') return async () => { throw new Error('Simulated detail reload failure'); };
                      return Reflect.get(delegate, method);
                    },
                  });
                }
                return Reflect.get(transaction, key);
              },
            }));
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
