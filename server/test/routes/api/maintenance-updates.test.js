import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { assetExists, authenticate, build, upload } from '#test/helper.js';
import s3 from '#lib/s3.js';
import { cleanupMaintenancePhotos } from '#lib/maintenance-photos.js';

const plotId = '11111111-1111-4111-8111-111111111111';
const draft = (extra = {}) => ({ submissionId: crypto.randomUUID(), plotId: 'recPlotAlpha', date: '2026-09-02', notes: 'A quiet visit', ...extra });

test('maintenance update workflows', async (t) => {
  const app = await build(t);
  let headers;
  t.beforeEach(async () => { headers = await authenticate(app, 'admin.user@test.com', 'test'); });
  const create = (payload) => app.inject({ method: 'POST', url: '/api/maintenance-records', headers, payload });
  const edit = (id, payload) => app.inject({ method: 'PATCH', url: `/api/maintenance-records/${id}`, headers, payload });

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

  await t.test('new plant names commit with the visit, replay once, and leave inventory unchanged', async () => {
    const payload = draft({ activity: ['Planted'], plants: [{ newPlant: { plantName: 'Visit-only native' }, quantity: 3 }] });
    const before = await app.prisma.plotPlant.count();
    const response = await create(payload);
    assert.equal(response.statusCode, 201, response.payload);
    assert.equal(response.json().plants[0].name, 'Visit-only native');
    assert.equal(response.json().plants[0].quantity, 3);
    assert.equal((await create(payload)).statusCode, 200);
    assert.equal(await app.prisma.plant.count({ where: { plantName: 'Visit-only native' } }), 1);
    assert.equal(await app.prisma.plotPlant.count(), before);
    const invalid = draft({ plants: [{ newPlant: { plantName: 'Should roll back' } }, { plantId: '00000000-0000-4000-8000-000000000000' }] });
    assert.equal((await create(invalid)).statusCode, 422);
    assert.equal(await app.prisma.plant.count({ where: { plantName: 'Should roll back' } }), 0);
  });

  await t.test('partial legacy corrections preserve missing data and untouched legacy plant rows', async () => {
    const legacy = 'c4444444-4444-4444-8444-444444444444';
    const response = await edit(legacy, { version: 1, mutationId: crypto.randomUUID(), notes: 'Clarified legacy note' });
    assert.equal(response.statusCode, 200, response.payload);
    assert.equal(response.json().date, null);
    assert.equal(response.json().plotId, null);
    assert.equal(response.json().version, 2);
    assert.ok(response.json().editedAt);
    assert.deepEqual(response.json().activity, []);
  });

  await t.test('plant edits preserve repeated imported rows and quantities that were not changed', async () => {
    const recordId = 'c1111111-1111-4111-8111-111111111111';
    const plantId = 'a1111111-1111-4111-8111-111111111111';
    const zero = await app.prisma.maintenanceRecordPlant.create({
      data: { maintenanceRecordId: recordId, plantId, slot: 3, quantity: 0 },
    });
    const before = (await app.inject({ url: `/api/maintenance-records/${recordId}` })).json();
    const retained = before.plants.map(({ id }) => ({ id }));
    const payload = { version: before.version, mutationId: crypto.randomUUID() };
    assert.equal((await edit(recordId, { ...payload, plants: [{ id: crypto.randomUUID() }] })).statusCode, 422);
    assert.equal((await edit(recordId, { ...payload, plants: [...retained, { plantId }] })).statusCode, 422);

    const response = await edit(recordId, { ...payload, plants: [...retained, { newPlant: { plantName: 'New legacy companion' } }] });
    assert.equal(response.statusCode, 200, response.payload);
    const saved = response.json();
    assert.deepEqual(saved.plants.slice(0, retained.length), before.plants);
    assert.equal(saved.plants.at(-1).name, 'New legacy companion');
    const changed = await edit(recordId, {
      version: saved.version,
      mutationId: crypto.randomUUID(),
      plants: saved.plants.map(({ id }) => id === zero.id ? { id, quantity: null } : { id }),
    });
    assert.equal(changed.statusCode, 200, changed.payload);
    assert.equal(changed.json().plants.find(({ id }) => id === zero.id).quantity, null);
  });

  await t.test('edits replay their own result and detect stale or concurrently superseded changes', async () => {
    const payload = draft();
    const saved = (await create(payload)).json();
    const body = { version: saved.version, mutationId: crypto.randomUUID(), notes: 'Corrected note' };
    const responses = await Promise.all([edit(saved.id, body), edit(saved.id, body)]);
    assert.ok(responses.every(({ statusCode }) => statusCode === 200));
    assert.equal(responses[0].json().version, 2);
    assert.equal(responses[0].json().cleanupPending, false);
    assert.equal((await edit(saved.id, { ...body, mutationId: crypto.randomUUID(), notes: 'Stale' })).statusCode, 409);
    const later = await edit(saved.id, { version: 2, mutationId: crypto.randomUUID(), observations: ['Nothing stood out'] });
    assert.equal(later.statusCode, 200);
    assert.equal((await edit(saved.id, body)).statusCode, 409);
    assert.equal((await edit(saved.id, { version: 3, mutationId: crypto.randomUUID(), plotId })).statusCode, 422);
    const replay = await create(payload);
    assert.equal(replay.statusCode, 200);
    assert.equal(replay.json().notes, 'Corrected note');
    assert.deepEqual(replay.json().observations, ['Nothing stood out']);
  });

  await t.test('photo removal commits before erasure and survives storage failure for command retry', async (t) => {
    const filename = `${crypto.randomUUID()}.jpg`;
    await upload([['640x480.jpg', filename]]);
    const saved = (await create(draft({ photos: [{ upload: filename }] }))).json();
    const photo = saved.photos[0];
    const key = photo.url.replace('/api/assets/', '');
    const remove = t.mock.method(s3, 'deleteObject', async () => { throw new Error('Simulated delete outage'); });
    const body = { version: 1, mutationId: crypto.randomUUID(), photos: [] };
    const response = await edit(saved.id, body);
    assert.equal(response.statusCode, 200, response.payload);
    assert.deepEqual(response.json().photos, []);
    assert.equal(response.json().cleanupPending, true);
    assert.equal(await assetExists(key), true);
    assert.ok((await app.prisma.maintenanceRecordPhoto.findUnique({ where: { id: photo.id } })).pendingRemovalAt);
    assert.equal((await app.inject({ url: photo.url })).statusCode, 404);
    remove.mock.restore();
    await app.prisma.maintenanceRecord.update({ where: { id: saved.id }, data: { deletedAt: new Date() } });
    const command = fileURLToPath(new URL('../../../bin/cleanup-maintenance-photos.js', import.meta.url));
    const { stdout } = await promisify(execFile)(process.execPath, [command]);
    assert.match(stdout, /Removed 1 photos; 0 pending/);
    assert.equal(await assetExists(key), false);
    assert.equal(await app.prisma.maintenanceRecordPhoto.count({ where: { id: photo.id } }), 0);
  });

  await t.test('a rejected replacement cannot erase old evidence or increment its version', async () => {
    const filename = `${crypto.randomUUID()}.jpg`;
    await upload([['640x480.jpg', filename]]);
    const saved = (await create(draft({ notes: undefined, photos: [{ upload: filename }] }))).json();
    const invalid = await edit(saved.id, { version: 1, mutationId: crypto.randomUUID(), photos: [{ upload: `${crypto.randomUUID()}.jpg` }] });
    assert.equal(invalid.statusCode, 422);
    assert.equal(await assetExists(saved.photos[0].url.replace('/api/assets/', '')), true);
    assert.equal((await app.prisma.maintenanceRecord.findUnique({ where: { id: saved.id } })).version, 1);
    assert.equal((await edit(saved.id, { version: 1, mutationId: crypto.randomUUID(), photos: [] })).statusCode, 422);
    assert.equal((await app.inject({ url: saved.photos[0].url })).statusCode, 302);
  });

  await t.test('cleanup continues past failed entries in an earlier batch', async (t) => {
    const firstId = '00000000-0000-4000-8000-000000000001';
    const secondId = '00000000-0000-4000-8000-000000000002';
    const saved = (await create(draft())).json();
    await app.prisma.maintenanceRecordPhoto.createMany({
      data: [firstId, secondId].map((id) => ({ id, maintenanceRecordId: saved.id, file: 'visit.jpg', pendingRemovalAt: new Date() })),
    });
    t.mock.method(s3, 'deleteObject', async (key) => {
      if (key.includes(firstId)) throw new Error('Simulated storage outage for first photo');
    });
    const removed = await cleanupMaintenancePhotos(app.prisma, { warn () {} }, { limit: 1 });
    assert.equal(removed, 1);
    assert.ok(await app.prisma.maintenanceRecordPhoto.findUnique({ where: { id: firstId } }));
    assert.equal(await app.prisma.maintenanceRecordPhoto.findUnique({ where: { id: secondId } }), null);
  });

  await t.test('a save superseded during cleanup returns conflict', async (t) => {
    const filename = `${crypto.randomUUID()}.jpg`;
    await upload([['640x480.jpg', filename]]);
    const saved = (await create(draft({ photos: [{ upload: filename }] }))).json();
    const cleaning = Promise.withResolvers();
    const release = Promise.withResolvers();
    const deleteObject = s3.deleteObject.bind(s3);
    let firstCleanup = true;
    t.mock.method(s3, 'deleteObject', async (key) => {
      if (firstCleanup) {
        firstCleanup = false;
        cleaning.resolve();
        await release.promise;
      }
      return deleteObject(key);
    });
    const earlier = edit(saved.id, { version: saved.version, mutationId: crypto.randomUUID(), photos: [] });
    try {
      await Promise.race([cleaning.promise, earlier.then(() => assert.fail('Edit completed before cleanup'))]);
      const newer = await edit(saved.id, { version: saved.version + 1, mutationId: crypto.randomUUID(), notes: 'Newer correction' });
      assert.equal(newer.statusCode, 200, newer.payload);
    } finally {
      release.resolve();
    }
    assert.equal((await earlier).statusCode, 409);
  });
});
