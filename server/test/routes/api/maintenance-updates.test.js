import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assetExists, authenticate, build, upload } from '#test/helper.js';
import s3 from '#lib/s3.js';

const plotId = '11111111-1111-4111-8111-111111111111';
const draft = (extra = {}) => ({ submissionId: crypto.randomUUID(), plotId: 'recPlotAlpha', date: '2026-09-02', notes: 'A quiet visit', ...extra });

test('maintenance update workflows', async (t) => {
  const app = await build(t);
  let headers;
  t.beforeEach(async () => { headers = await authenticate(app, 'admin.user@test.com', 'test'); });
  const create = (payload) => app.inject({ method: 'POST', url: '/api/maintenance-records', headers, payload });

  await t.test('each kind of contribution is valid independently and credits the administrator', async () => {
    for (const content of [{ notes: 'Visit note' }, { activity: ['Watered'] }, { observations: ['Nothing stood out'] }]) {
      const response = await create(draft({ notes: undefined, ...content }));
      assert.equal(response.statusCode, 201, response.payload);
      const saved = response.json();
      assert.equal(saved.credit, 'Pocket Gardens team');
      assert.equal(saved.createdById, undefined);
    }
  });

  await t.test('repeated and concurrent creates recover one record, while changed reuse conflicts', async () => {
    const payload = draft();
    const responses = await Promise.all([create(payload), create(payload)]);
    assert.deepEqual(responses.map(({ statusCode }) => statusCode).sort(), [200, 201]);
    assert.equal(responses[0].json().id, responses[1].json().id);
    assert.equal(await app.prisma.maintenanceRecord.count({ where: { submissionId: payload.submissionId } }), 1);
    assert.equal((await create({ ...payload, notes: 'Different' })).statusCode, 409);
    assert.equal((await create(draft())).statusCode, 201);
  });

  await t.test('retrying a soft-deleted visit leaves it deleted', async () => {
    const payload = draft();
    const created = await create(payload);
    assert.equal(created.statusCode, 201, created.payload);
    await app.prisma.maintenanceRecord.update({ where: { id: created.json().id }, data: { deletedAt: new Date() } });

    const replay = await create(payload);
    assert.equal(replay.statusCode, 410, replay.payload);
    assert.equal(await app.prisma.maintenanceRecord.count({ where: { submissionId: payload.submissionId } }), 1);
  });

  await t.test('validates quiet observation exclusivity, blank notes, future dates and untrusted identity', async () => {
    for (const changes of [
      { observations: ['Nothing stood out', 'Plants look dry'] },
      { notes: '   ' }, { date: '2999-01-01' }, { volunteerId: 'b1111111-1111-4111-8111-111111111111' },
    ]) assert.equal((await create(draft(changes))).statusCode, 422);
  });

  await t.test('stage restrictions apply to new visits, but not already-committed replays', async () => {
    const payload = draft();
    assert.equal((await create(payload)).statusCode, 201);
    await app.prisma.plot.update({ where: { id: plotId }, data: { stage: 'archived' } });
    assert.equal((await create(payload)).statusCode, 200);
    assert.equal((await create(draft())).statusCode, 422);
    await app.prisma.plot.update({ where: { id: plotId }, data: { stage: 'paused' } });
    assert.equal((await create(draft({ activity: ['Watered'] }))).statusCode, 422);
    assert.equal((await create(draft())).statusCode, 201);
  });

  await t.test('photo-only saves replay after staging cleanup and hidden assets cannot get links', async () => {
    const filename = `${crypto.randomUUID()}.jpg`;
    await upload([['640x480.jpg', filename]]);
    const payload = draft({ notes: undefined, photos: [{ upload: filename }] });
    const response = await create(payload);
    assert.equal(response.statusCode, 201, response.payload);
    const saved = response.json();
    assert.equal(saved.photos.length, 1);
    assert.equal(await assetExists(`_uploads/${filename}`), false);
    assert.equal((await create(payload)).statusCode, 200);
    const linked = await app.inject({ url: saved.photos[0].url });
    assert.equal(linked.statusCode, 302);
    assert.equal(linked.headers['cache-control'], 'private, no-store');
    assert.equal((await app.inject({ url: saved.photos[0].url.replace(filename, 'different.jpg') })).statusCode, 404);
    const importedFile = 'Spring visit.jpg';
    await app.prisma.maintenanceRecordPhoto.update({ where: { id: saved.photos[0].id }, data: { file: importedFile } });
    assert.equal((await app.inject({ url: saved.photos[0].url.replace(filename, encodeURIComponent(importedFile)) })).statusCode, 302);
    await app.prisma.maintenanceRecord.update({ where: { id: saved.id }, data: { deletedAt: new Date() } });
    assert.equal((await app.inject({ url: saved.photos[0].url })).statusCode, 404);
    assert.equal(await assetExists(saved.photos[0].url.replace('/api/assets/', '')), true);
  });

  await t.test('a garden stage change during photo copy rolls back new work', async (t) => {
    const filename = `${crypto.randomUUID()}.jpg`;
    await upload([['640x480.jpg', filename]]);
    const payload = draft({ activity: ['Watered'], photos: [{ upload: filename }] });
    const copy = s3.copyObject.bind(s3);
    t.mock.method(s3, 'copyObject', async (...args) => {
      await app.prisma.plot.update({ where: { id: plotId }, data: { stage: 'paused' } });
      return copy(...args);
    });
    assert.equal((await create(payload)).statusCode, 422);
    assert.equal(await app.prisma.maintenanceRecord.count({ where: { submissionId: payload.submissionId } }), 0);
    assert.equal(await assetExists(`_uploads/${filename}`), true);
  });

  await t.test('failed staging cleanup never exposes a retained copy through public asset reads', async (t) => {
    const filename = `${crypto.randomUUID()}.jpg`;
    await upload([['640x480.jpg', filename]]);
    const deletion = t.mock.method(s3, 'deleteObject', async () => { throw new Error('Simulated cleanup outage'); });
    const response = await create(draft({ photos: [{ upload: filename }] }));
    deletion.mock.restore();
    assert.equal(response.statusCode, 201, response.payload);
    const saved = response.json();
    assert.equal(await assetExists(`_uploads/${filename}`), true);
    assert.equal((await app.inject({ url: saved.photos[0].url })).statusCode, 302);
    await app.prisma.maintenanceRecord.update({ where: { id: saved.id }, data: { deletedAt: new Date() } });
    assert.equal((await app.inject({ url: saved.photos[0].url })).statusCode, 404);
    for (const path of [`_uploads/${filename}`, `%5Fuploads/${filename}`, `_uploads%2F${filename}`]) {
      const hidden = await app.inject({ url: `/api/assets/${path}` });
      assert.equal(hidden.statusCode, 404);
      assert.equal(hidden.headers.location, undefined);
    }
    assert.equal(await assetExists(`_uploads/${filename}`), true);
    assert.equal(await assetExists(saved.photos[0].url.replace('/api/assets/', '')), true);
  });

  await t.test('failed photo copies roll back the visit and retain staging for retry', async (t) => {
    const filename = `${crypto.randomUUID()}.jpg`;
    await upload([['640x480.jpg', filename]]);
    const payload = draft({ photos: [{ upload: filename }] });
    const copy = t.mock.method(s3, 'copyObject', async () => { throw new Error('Simulated storage outage'); });
    assert.equal((await create(payload)).statusCode, 500);
    assert.equal(await app.prisma.maintenanceRecord.count({ where: { submissionId: payload.submissionId } }), 0);
    assert.equal(await assetExists(`_uploads/${filename}`), true);
    copy.mock.restore();
    assert.equal((await create(payload)).statusCode, 201);
  });
});
