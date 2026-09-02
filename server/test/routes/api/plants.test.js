import { test } from 'node:test';
import * as assert from 'node:assert';
import { StatusCodes } from 'http-status-codes';
import path from 'path';

import { assetExists, build, upload } from '#test/helper.js';

const PLANT_ALPHA_ID = 'a1111111-1111-4111-8111-111111111111';
const PLANT_BETA_ID = 'a2222222-2222-4222-8222-222222222222';

test('/api/plants', async (t) => {
  const app = await build(t);
  const { prisma } = app;

  await t.test('GET / returns all plants', async () => {
    const response = await app.inject({ url: '/api/plants' });
    assert.strictEqual(response.statusCode, StatusCodes.OK);
    const data = JSON.parse(response.payload);
    assert.strictEqual(data.length, 3);
    assert.strictEqual(data[0].id, PLANT_ALPHA_ID);
    assert.strictEqual(data[0].plantName, 'California Poppy');
  });

  await t.test('GET / paginates with X-Next-Offset', async () => {
    const response = await app.inject({
      url: '/api/plants?pageSize=1',
    });
    assert.strictEqual(response.statusCode, StatusCodes.OK);
    const data = JSON.parse(response.payload);
    assert.strictEqual(data.length, 1);
    assert.ok(response.headers['x-next-offset']);

    const page2 = await app.inject({
      url: `/api/plants?pageSize=1&offset=${response.headers['x-next-offset']}`,
    });
    const data2 = JSON.parse(page2.payload);
    assert.strictEqual(data2.length, 1);
    assert.notStrictEqual(data2[0].id, data[0].id);
  });

  await t.test('GET / rejects invalid pagination', async () => {
    for (const query of ['pageSize=1.5', 'pageSize=-1', 'offset=-1', 'offset=nope']) {
      const response = await app.inject({ url: `/api/plants?${query}` });
      assert.strictEqual(response.statusCode, StatusCodes.UNPROCESSABLE_ENTITY);
      assert.ok(JSON.parse(response.payload).errors.length);
    }
  });

  await t.test('GET /:id returns a plant by id', async () => {
    const photo = await prisma.plantPhoto.create({
      data: {
        plantId: PLANT_ALPHA_ID,
        file: 'a.jpg',
        position: 0,
      },
    });
    const response = await app.inject({ url: `/api/plants/${PLANT_ALPHA_ID}` });
    assert.strictEqual(response.statusCode, StatusCodes.OK);
    const data = JSON.parse(response.payload);
    assert.strictEqual(data.id, PLANT_ALPHA_ID);
    assert.strictEqual(data.plantName, 'California Poppy');
    assert.strictEqual(data.locations, 'Bed A');
    assert.strictEqual(data.numberPlanted, 12);
    assert.deepStrictEqual(data.photos, [{
      id: photo.id,
      url: `/api/assets/plant_photos/${photo.id}/file/a.jpg`,
    }]);
  });

  await t.test('GET /:id returns 404 when missing', async () => {
    const response = await app.inject({
      url: '/api/plants/00000000-0000-4000-8000-000000000000',
    });
    assert.strictEqual(response.statusCode, StatusCodes.NOT_FOUND);
  });

  await t.test('GET /:id rejects non-UUID ids', async () => {
    const response = await app.inject({ url: '/api/plants/not-a-uuid' });
    assert.strictEqual(response.statusCode, StatusCodes.UNPROCESSABLE_ENTITY);
  });

  await t.test('POST / creates a plant', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/plants',
      payload: {
        plantName: 'Rosemary',
        latinName: 'Salvia rosmarinus',
        locations: 'Bed D',
        numberPlanted: 3,
      },
    });
    assert.strictEqual(response.statusCode, StatusCodes.CREATED);
    const data = JSON.parse(response.payload);
    assert.strictEqual(data.plantName, 'Rosemary');
    assert.strictEqual(data.locations, 'Bed D');
    assert.strictEqual(data.numberPlanted, 3);
    assert.deepStrictEqual(data.photos, []);

    const row = await prisma.plant.findUnique({ where: { id: data.id } });
    assert.ok(row);
    assert.strictEqual(row.plantName, 'Rosemary');
    assert.strictEqual(row.locations, 'Bed D');
  });

  await t.test('POST / rejects invalid plant bodies', async () => {
    const invalidPayloads = [
      {},
      { plantName: '   ' },
      { plantName: 'Rosemary', numberPlanted: -1 },
      { plantName: 'Rosemary', Unknown: true },
      { plantName: 'Rosemary', photos: [{ id: PLANT_ALPHA_ID }] },
      { plantName: 'Rosemary', photos: [{ upload: '../photo.jpg' }] },
      {
        plantName: 'Rosemary',
        photos: [
          { upload: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.jpg' },
          { upload: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.jpg' },
        ],
      },
    ];
    for (const payload of invalidPayloads) {
      const response = await app.inject({ method: 'POST', url: '/api/plants', payload });
      assert.strictEqual(response.statusCode, StatusCodes.UNPROCESSABLE_ENTITY);
      assert.ok(JSON.parse(response.payload).errors.length);
    }
  });

  await t.test('PATCH /:id updates locations and other fields', async () => {
    const response = await app.inject({
      method: 'PATCH',
      url: `/api/plants/${PLANT_BETA_ID}`,
      payload: {
        locations: 'Bed A, Bed B',
        commonName: 'True Lavender',
      },
    });
    assert.strictEqual(response.statusCode, StatusCodes.OK);
    const data = JSON.parse(response.payload);
    assert.strictEqual(data.id, PLANT_BETA_ID);
    assert.strictEqual(data.locations, 'Bed A, Bed B');
    assert.strictEqual(data.commonName, 'True Lavender');

    const row = await prisma.plant.findUnique({ where: { id: PLANT_BETA_ID } });
    assert.strictEqual(row.locations, 'Bed A, Bed B');
    assert.strictEqual(row.commonName, 'True Lavender');
  });

  await t.test('PATCH /:id clears nullable fields and rejects invalid bodies', async () => {
    const cleared = await app.inject({
      method: 'PATCH',
      url: `/api/plants/${PLANT_BETA_ID}`,
      payload: { commonName: null, numberPlanted: null },
    });
    assert.strictEqual(cleared.statusCode, StatusCodes.OK);
    const row = await prisma.plant.findUnique({ where: { id: PLANT_BETA_ID } });
    assert.strictEqual(row.commonName, null);
    assert.strictEqual(row.numberPlanted, null);

    for (const payload of [
      {},
      { Unknown: true },
      { numberPlanted: -1 },
      { photos: [{ id: PLANT_ALPHA_ID }, { id: PLANT_ALPHA_ID }] },
    ]) {
      const response = await app.inject({
        method: 'PATCH',
        url: `/api/plants/${PLANT_BETA_ID}`,
        payload,
      });
      assert.strictEqual(response.statusCode, StatusCodes.UNPROCESSABLE_ENTITY);
      assert.ok(JSON.parse(response.payload).errors.length);
    }
  });

  await t.test('POST / attaches uploaded photos via setAsset', async () => {
    const filename = '56826175-033e-4a89-8d51-8d7f602e01d9.jpg';
    await upload([['640x480.jpg', filename]]);
    const response = await app.inject({
      method: 'POST',
      url: '/api/plants',
      payload: {
        plantName: 'Photo Plant',
        photos: [{ upload: filename }],
      },
    });
    assert.strictEqual(response.statusCode, StatusCodes.CREATED);
    const data = JSON.parse(response.payload);
    assert.strictEqual(data.photos.length, 1);
    assert.match(data.photos[0].url, /^\/api\/assets\/plant_photos\/.+\/file\/56826175-033e-4a89-8d51-8d7f602e01d9\.jpg$/);

    const row = await prisma.plant.findUnique({
      where: { id: data.id },
      include: { photos: true },
    });
    assert.strictEqual(row.photos.length, 1);
    assert.strictEqual(row.photos[0].file, filename);
    assert.ok(await assetExists(path.join('plant_photos', row.photos[0].id, 'file', filename)));
  });

  await t.test('PATCH /:id attaches uploaded photos via setAsset', async () => {
    const filename = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb.jpg';
    await upload([['640x480.jpg', filename]]);
    const response = await app.inject({
      method: 'PATCH',
      url: `/api/plants/${PLANT_ALPHA_ID}`,
      payload: {
        photos: [{ upload: filename }],
      },
    });
    assert.strictEqual(response.statusCode, StatusCodes.OK);
    const data = JSON.parse(response.payload);
    assert.strictEqual(data.id, PLANT_ALPHA_ID);
    assert.strictEqual(data.photos.length, 1);
    assert.match(data.photos[0].url, new RegExp(`/file/${filename}$`));

    const row = await prisma.plant.findUnique({
      where: { id: PLANT_ALPHA_ID },
      include: { photos: true },
    });
    assert.strictEqual(row.photos.length, 1);
    assert.strictEqual(row.photos[0].file, filename);
    assert.ok(await assetExists(path.join('plant_photos', row.photos[0].id, 'file', filename)));
  });

  await t.test('PATCH /:id retains, adds, reorders, and removes photos', async () => {
    const first = '11111111-1111-4111-8111-111111111111.jpg';
    const second = '22222222-2222-4222-8222-222222222222.jpg';
    const third = '33333333-3333-4333-8333-333333333333.jpg';
    await upload([
      ['640x480.jpg', first],
      ['640x480.jpg', second],
      ['640x480.jpg', third],
    ]);
    const created = await app.inject({
      method: 'POST',
      url: '/api/plants',
      payload: {
        plantName: 'Gallery Plant',
        photos: [{ upload: first }, { upload: second }],
      },
    });
    assert.strictEqual(created.statusCode, StatusCodes.CREATED);
    const original = JSON.parse(created.payload);

    const response = await app.inject({
      method: 'PATCH',
      url: `/api/plants/${original.id}`,
      payload: {
        photos: [{ id: original.photos[1].id }, { upload: third }],
      },
    });
    assert.strictEqual(response.statusCode, StatusCodes.OK);
    const data = JSON.parse(response.payload);
    assert.strictEqual(data.photos[0].id, original.photos[1].id);
    assert.notStrictEqual(data.photos[1].id, original.photos[0].id);
    assert.notStrictEqual(data.photos[1].id, original.photos[1].id);
    assert.match(data.photos[1].url, new RegExp(`/file/${third}$`));
    assert.strictEqual(await assetExists(path.join(
      'plant_photos', original.photos[0].id, 'file', first
    )), false);
    assert.ok(await assetExists(path.join(
      'plant_photos', original.photos[1].id, 'file', second
    )));

    const cleared = await app.inject({
      method: 'PATCH',
      url: `/api/plants/${original.id}`,
      payload: { photos: [] },
    });
    assert.strictEqual(cleared.statusCode, StatusCodes.OK);
    assert.deepStrictEqual(JSON.parse(cleared.payload).photos, []);
  });

  await t.test('PATCH /:id rejects a photo owned by another plant', async () => {
    const photo = await prisma.plantPhoto.create({
      data: { plantId: PLANT_ALPHA_ID, file: 'owned.jpg', position: 0 },
    });
    const response = await app.inject({
      method: 'PATCH',
      url: `/api/plants/${PLANT_BETA_ID}`,
      payload: { photos: [{ id: photo.id }] },
    });
    assert.strictEqual(response.statusCode, StatusCodes.UNPROCESSABLE_ENTITY);
    assert.deepStrictEqual(JSON.parse(response.payload).errors, [{
      path: 'photos',
      message: 'Photo does not belong to this plant',
    }]);
  });
});
