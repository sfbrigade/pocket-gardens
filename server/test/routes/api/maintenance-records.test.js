import { test } from 'node:test';
import * as assert from 'node:assert';
import path from 'path';
import { StatusCodes } from 'http-status-codes';

import { assetExists, build, upload } from '#test/helper.js';

const PLOT_ALPHA_ID = '11111111-1111-4111-8111-111111111111';
const PLOT_BETA_ID = '22222222-2222-4222-8222-222222222222';
const PERSON_ALPHA_ID = 'b1111111-1111-4111-8111-111111111111';
const PLANT_ALPHA_ID = 'a1111111-1111-4111-8111-111111111111';
const PLANT_BETA_ID = 'a2222222-2222-4222-8222-222222222222';
const RECORD_ALPHA_ID = 'c1111111-1111-4111-8111-111111111111';
const RECORD_BETA_ID = 'c2222222-2222-4222-8222-222222222222';

const validRecord = {
  date: '2026-09-02',
  activity: ['Watered'],
  plotId: PLOT_ALPHA_ID,
};

test('/api/maintenance-records', async (t) => {
  const app = await build(t);
  const { prisma } = app;

  await t.test('GET / returns stable camelCase records newest first', async () => {
    const response = await app.inject({ url: '/api/maintenance-records' });
    assert.strictEqual(response.statusCode, StatusCodes.OK);
    const data = JSON.parse(response.payload);
    assert.deepStrictEqual(data.map(({ id }) => id), [
      RECORD_ALPHA_ID,
      RECORD_BETA_ID,
      'c3333333-3333-4333-8333-333333333333',
      'c4444444-4444-4444-8444-444444444444',
    ]);
    assert.deepStrictEqual(data[0].plants, [
      { plantId: PLANT_ALPHA_ID, quantity: 4 },
      { plantId: PLANT_BETA_ID, quantity: 2 },
    ]);
    assert.deepStrictEqual(data[0].photos, []);
    assert.strictEqual(data[0].date, '2026-08-20');
    assert.strictEqual(data[0].estNextVisit, '2026-09-03');
    assert.strictEqual(data[0].createdTime, undefined);
    assert.strictEqual(data[0].airtableId, undefined);
    assert.strictEqual(data[3].date, null);
    assert.strictEqual(data[3].plotId, null);
  });

  await t.test('GET / paginates and filters by plot, volunteer, and inclusive dates', async () => {
    const page1 = await app.inject({ url: '/api/maintenance-records?pageSize=1' });
    assert.strictEqual(page1.statusCode, StatusCodes.OK);
    assert.strictEqual(JSON.parse(page1.payload).length, 1);
    assert.strictEqual(page1.headers['x-next-offset'], '1');

    const page2 = await app.inject({
      url: `/api/maintenance-records?pageSize=1&offset=${page1.headers['x-next-offset']}`,
    });
    assert.strictEqual(JSON.parse(page2.payload)[0].id, RECORD_BETA_ID);

    const plot = await app.inject({
      url: `/api/maintenance-records?plotId=${PLOT_BETA_ID}`,
    });
    assert.deepStrictEqual(JSON.parse(plot.payload).map(({ id }) => id), [
      'c3333333-3333-4333-8333-333333333333',
    ]);

    const volunteer = await app.inject({
      url: `/api/maintenance-records?volunteerId=${PERSON_ALPHA_ID}`,
    });
    assert.deepStrictEqual(JSON.parse(volunteer.payload).map(({ id }) => id), [RECORD_ALPHA_ID]);

    const dates = await app.inject({
      url: '/api/maintenance-records?from=2026-08-20&to=2026-08-20',
    });
    assert.deepStrictEqual(JSON.parse(dates.payload).map(({ id }) => id), [
      RECORD_ALPHA_ID,
      RECORD_BETA_ID,
    ]);
  });

  await t.test('GET / rejects invalid filters', async () => {
    for (const query of [
      'pageSize=1.5',
      'pageSize=0',
      'offset=-1',
      'offset=nope',
      'plotId=nope',
      'from=2026-02-30',
      'from=2026-09-02&to=2026-09-01',
      'unknown=true',
    ]) {
      const response = await app.inject({ url: `/api/maintenance-records?${query}` });
      assert.strictEqual(response.statusCode, StatusCodes.UNPROCESSABLE_ENTITY);
      assert.ok(JSON.parse(response.payload).errors.length);
    }
  });

  await t.test('GET /:id returns one record and validates the id', async () => {
    const photo = await prisma.maintenanceRecordPhoto.create({
      data: { maintenanceRecordId: RECORD_ALPHA_ID, file: 'visit.jpg', position: 0 },
    });
    const response = await app.inject({ url: `/api/maintenance-records/${RECORD_ALPHA_ID}` });
    assert.strictEqual(response.statusCode, StatusCodes.OK);
    const data = JSON.parse(response.payload);
    assert.deepStrictEqual(data.photos, [{
      id: photo.id,
      url: `/api/assets/maintenance_record_photos/${photo.id}/file/visit.jpg`,
    }]);

    const missing = await app.inject({
      url: '/api/maintenance-records/00000000-0000-4000-8000-000000000000',
    });
    assert.strictEqual(missing.statusCode, StatusCodes.NOT_FOUND);
    const invalid = await app.inject({ url: '/api/maintenance-records/not-a-uuid' });
    assert.strictEqual(invalid.statusCode, StatusCodes.UNPROCESSABLE_ENTITY);
  });

  await t.test('POST / creates scalar and related data without an Airtable id', async () => {
    const filename = '11111111-aaaa-4111-8111-111111111111.jpg';
    await upload([['640x480.jpg', filename]]);
    const response = await app.inject({
      method: 'POST',
      url: '/api/maintenance-records',
      payload: {
        ...validRecord,
        activity: ['Watered', 'Planted'],
        notes: 'New growth',
        estNextVisit: '2026-09-16',
        volunteerId: PERSON_ALPHA_ID,
        plants: [
          { plantId: PLANT_BETA_ID, quantity: 2 },
          { plantId: PLANT_ALPHA_ID },
        ],
        photos: [{ upload: filename }],
      },
    });
    assert.strictEqual(response.statusCode, StatusCodes.CREATED);
    const data = JSON.parse(response.payload);
    assert.strictEqual(data.date, '2026-09-02');
    assert.strictEqual(data.notes, 'New growth');
    assert.deepStrictEqual(data.plants, [
      { plantId: PLANT_BETA_ID, quantity: 2 },
      { plantId: PLANT_ALPHA_ID, quantity: null },
    ]);
    assert.strictEqual(data.photos.length, 1);

    const row = await prisma.maintenanceRecord.findUnique({
      where: { id: data.id },
      include: { plants: { orderBy: { slot: 'asc' } }, photos: true },
    });
    assert.strictEqual(row.airtableId, null);
    assert.deepStrictEqual(row.plants.map(({ slot }) => slot), [1, 2]);
    assert.ok(await assetExists(path.join(
      'maintenance_record_photos', row.photos[0].id, 'file', filename
    )));
  });

  await t.test('POST / rejects malformed bodies', async () => {
    const invalidPayloads = [
      {},
      { ...validRecord, date: '2026-02-30' },
      { ...validRecord, activity: [] },
      { ...validRecord, activity: ['Watered', 'Watered'] },
      { ...validRecord, unknown: true },
      { ...validRecord, plants: [{ plantId: PLANT_ALPHA_ID, quantity: 0 }] },
      {
        ...validRecord,
        plants: [{ plantId: PLANT_ALPHA_ID }, { plantId: PLANT_ALPHA_ID }],
      },
      { ...validRecord, photos: [{ id: RECORD_ALPHA_ID }] },
      { ...validRecord, photos: [{ upload: '../visit.jpg' }] },
    ];
    for (const payload of invalidPayloads) {
      const response = await app.inject({
        method: 'POST',
        url: '/api/maintenance-records',
        payload,
      });
      assert.strictEqual(response.statusCode, StatusCodes.UNPROCESSABLE_ENTITY);
      assert.ok(JSON.parse(response.payload).errors.length);
    }
  });

  await t.test('POST / validates relationships before creating anything', async () => {
    const before = await prisma.maintenanceRecord.count();
    for (const payload of [
      { ...validRecord, plotId: '00000000-0000-4000-8000-000000000000' },
      { ...validRecord, volunteerId: '00000000-0000-4000-8000-000000000000' },
      {
        ...validRecord,
        plants: [{ plantId: '00000000-0000-4000-8000-000000000000' }],
      },
    ]) {
      const response = await app.inject({
        method: 'POST',
        url: '/api/maintenance-records',
        payload,
      });
      assert.strictEqual(response.statusCode, StatusCodes.UNPROCESSABLE_ENTITY);
    }
    assert.strictEqual(await prisma.maintenanceRecord.count(), before);
  });

  await t.test('PATCH /:id updates scalars and replaces or clears plants', async () => {
    const response = await app.inject({
      method: 'PATCH',
      url: `/api/maintenance-records/${RECORD_ALPHA_ID}`,
      payload: {
        date: '2026-08-21',
        notes: null,
        estNextVisit: null,
        volunteerId: null,
        plants: [{ plantId: PLANT_BETA_ID, quantity: 5 }],
      },
    });
    assert.strictEqual(response.statusCode, StatusCodes.OK);
    const data = JSON.parse(response.payload);
    assert.strictEqual(data.date, '2026-08-21');
    assert.strictEqual(data.notes, null);
    assert.strictEqual(data.estNextVisit, null);
    assert.strictEqual(data.volunteerId, null);
    assert.deepStrictEqual(data.plants, [{ plantId: PLANT_BETA_ID, quantity: 5 }]);

    const cleared = await app.inject({
      method: 'PATCH',
      url: `/api/maintenance-records/${RECORD_ALPHA_ID}`,
      payload: { plants: [] },
    });
    assert.strictEqual(cleared.statusCode, StatusCodes.OK);
    assert.deepStrictEqual(JSON.parse(cleared.payload).plants, []);
  });

  await t.test('PATCH /:id rejects invalid changes and preserves the record', async () => {
    for (const payload of [
      {},
      { date: null },
      { activity: [] },
      { plotId: null },
      { unknown: true },
      { plants: [{ plantId: '00000000-0000-4000-8000-000000000000' }] },
    ]) {
      const response = await app.inject({
        method: 'PATCH',
        url: `/api/maintenance-records/${RECORD_BETA_ID}`,
        payload,
      });
      assert.strictEqual(response.statusCode, StatusCodes.UNPROCESSABLE_ENTITY);
    }
    const row = await prisma.maintenanceRecord.findUnique({ where: { id: RECORD_BETA_ID } });
    assert.strictEqual(row.date.toISOString(), '2026-08-20T00:00:00.000Z');
    assert.deepStrictEqual(row.activity, ['Mulched']);
  });

  await t.test('PATCH /:id retains, adds, reorders, and removes photos', async () => {
    const first = '22222222-aaaa-4222-8222-222222222222.jpg';
    const second = '33333333-aaaa-4333-8333-333333333333.jpg';
    const third = '44444444-aaaa-4444-8444-444444444444.jpg';
    await upload([
      ['640x480.jpg', first],
      ['640x480.jpg', second],
      ['640x480.jpg', third],
    ]);
    const created = await app.inject({
      method: 'POST',
      url: '/api/maintenance-records',
      payload: { ...validRecord, photos: [{ upload: first }, { upload: second }] },
    });
    const original = JSON.parse(created.payload);
    const response = await app.inject({
      method: 'PATCH',
      url: `/api/maintenance-records/${original.id}`,
      payload: { photos: [{ id: original.photos[1].id }, { upload: third }] },
    });
    assert.strictEqual(response.statusCode, StatusCodes.OK);
    const data = JSON.parse(response.payload);
    assert.strictEqual(data.photos[0].id, original.photos[1].id);
    assert.match(data.photos[1].url, new RegExp(`/file/${third}$`));
    assert.strictEqual(await assetExists(path.join(
      'maintenance_record_photos', original.photos[0].id, 'file', first
    )), false);

    const cleared = await app.inject({
      method: 'PATCH',
      url: `/api/maintenance-records/${original.id}`,
      payload: { photos: [] },
    });
    assert.deepStrictEqual(JSON.parse(cleared.payload).photos, []);
  });

  await t.test('PATCH /:id rejects photos owned by another record', async () => {
    const photo = await prisma.maintenanceRecordPhoto.create({
      data: { maintenanceRecordId: RECORD_ALPHA_ID, file: 'owned.jpg', position: 0 },
    });
    const response = await app.inject({
      method: 'PATCH',
      url: `/api/maintenance-records/${RECORD_BETA_ID}`,
      payload: { photos: [{ id: photo.id }] },
    });
    assert.strictEqual(response.statusCode, StatusCodes.UNPROCESSABLE_ENTITY);
    assert.deepStrictEqual(JSON.parse(response.payload).errors, [{
      path: 'photos',
      message: 'Photo does not belong to this maintenance record',
    }]);
  });

  await t.test('legacy imports can still upsert by a real Airtable id', async () => {
    const airtableId = 'recImportedMaintenance';
    await prisma.maintenanceRecord.upsert({
      where: { airtableId },
      create: { airtableId, activity: ['Imported'] },
      update: { activity: ['Imported'] },
    });
    const row = await prisma.maintenanceRecord.findUnique({ where: { airtableId } });
    assert.deepStrictEqual(row.activity, ['Imported']);
  });
});
