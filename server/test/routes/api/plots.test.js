import { test } from 'node:test';
import * as assert from 'node:assert';
import { StatusCodes } from 'http-status-codes';
import path from 'path';

import { assetExists, build, upload } from '#test/helper.js';

test('/api/plots', async (t) => {
  const app = await build(t);
  const { prisma } = app;

  await t.test('GET / returns plots and supports viewport filtering', async () => {
    const response = await app.inject({
      url: '/api/plots?north=37.82&south=37.75&east=-122.38&west=-122.45',
    });
    assert.strictEqual(response.statusCode, StatusCodes.OK);
    const data = JSON.parse(response.payload);
    assert.strictEqual(data.length, 2);
    assert.ok(data.every((p) => p.Latitude >= 37.75 && p.Latitude <= 37.82));
    assert.ok(data.some((p) => p.id === 'recPlotAlpha'));
    assert.ok(!data.some((p) => p.id === 'recPlotOutside'));
  });

  await t.test('GET / without viewport returns all plots', async () => {
    const response = await app.inject({ url: '/api/plots' });
    assert.strictEqual(response.statusCode, StatusCodes.OK);
    const data = JSON.parse(response.payload);
    assert.strictEqual(data.length, 3);
    assert.strictEqual(data[0].id, 'recPlotAlpha');
  });

  await t.test('GET / rejects partial viewport params', async () => {
    const response = await app.inject({
      url: '/api/plots?north=37.82&south=37.75',
    });
    assert.strictEqual(response.statusCode, StatusCodes.UNPROCESSABLE_ENTITY);
  });

  await t.test('GET / rejects north less than south', async () => {
    const response = await app.inject({
      url: '/api/plots?north=37.75&south=37.82&east=-122.38&west=-122.45',
    });
    assert.strictEqual(response.statusCode, StatusCodes.UNPROCESSABLE_ENTITY);
  });

  await t.test('GET / paginates with X-Next-Offset', async () => {
    const response = await app.inject({
      url: '/api/plots?pageSize=1',
    });
    assert.strictEqual(response.statusCode, StatusCodes.OK);
    const data = JSON.parse(response.payload);
    assert.strictEqual(data.length, 1);
    assert.ok(response.headers['x-next-offset']);

    const page2 = await app.inject({
      url: `/api/plots?pageSize=1&offset=${response.headers['x-next-offset']}`,
    });
    const data2 = JSON.parse(page2.payload);
    assert.strictEqual(data2.length, 1);
    assert.notStrictEqual(data2[0].id, data[0].id);
  });

  await t.test('GET / rejects invalid pagination', async () => {
    for (const query of ['pageSize=1.5', 'pageSize=-1', 'offset=-1', 'offset=nope']) {
      const response = await app.inject({ url: `/api/plots?${query}` });
      assert.strictEqual(response.statusCode, StatusCodes.UNPROCESSABLE_ENTITY);
      assert.ok(JSON.parse(response.payload).errors.length > 0);
    }
  });

  await t.test('GET /:id returns a plot by airtable id', async () => {
    const plot = await prisma.plot.findUnique({ where: { airtableId: 'recPlotAlpha' } });
    const photo = await prisma.plotPhoto.create({
      data: {
        plotId: plot.id,
        file: 'a.jpg',
        position: 0,
      },
    });
    const response = await app.inject({ url: '/api/plots/recPlotAlpha' });
    assert.strictEqual(response.statusCode, StatusCodes.OK);
    const data = JSON.parse(response.payload);
    assert.strictEqual(data.id, 'recPlotAlpha');
    assert.strictEqual(data.Status, 'Planted');
    assert.strictEqual(data.Latitude, 37.78);
    assert.strictEqual(data.Photo, undefined);
    assert.deepStrictEqual(data.Photos, [
      `/api/assets/plot_photos/${photo.id}/file/a.jpg`,
    ]);
  });

  await t.test('GET /:id returns 404 when missing', async () => {
    const response = await app.inject({ url: '/api/plots/recMissing' });
    assert.strictEqual(response.statusCode, StatusCodes.NOT_FOUND);
  });

  await t.test('GET /:id returns 404 for non-UUID 36-char strings', async () => {
    const response = await app.inject({
      url: '/api/plots/xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx',
    });
    assert.strictEqual(response.statusCode, StatusCodes.NOT_FOUND);
  });

  await t.test('GET /:id returns a plot by internal UUID', async () => {
    const row = await prisma.plot.findUnique({ where: { airtableId: 'recPlotAlpha' } });
    const response = await app.inject({ url: `/api/plots/${row.id}` });
    assert.strictEqual(response.statusCode, StatusCodes.OK);
    const data = JSON.parse(response.payload);
    assert.strictEqual(data.id, 'recPlotAlpha');
  });

  await t.test('POST / creates a plot', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/plots',
      payload: {
        Status: 'Planted',
        'Bed Type': 'Tree Well',
        'Map Coordinates': '37.77, -122.43',
      },
    });
    assert.strictEqual(response.statusCode, StatusCodes.CREATED);
    const data = JSON.parse(response.payload);
    assert.ok(data.id.startsWith('pg_'));
    assert.strictEqual(data.Latitude, 37.77);
    assert.strictEqual(data.Longitude, -122.43);

    const row = await prisma.plot.findUnique({ where: { airtableId: data.id } });
    assert.ok(row);
    assert.strictEqual(row.latitude, 37.77);
  });

  await t.test('PATCH /:id updates a plot', async () => {
    const response = await app.inject({
      method: 'PATCH',
      url: '/api/plots/recPlotBeta',
      payload: {
        Status: 'Planted',
        Latitude: 37.761,
        Longitude: -122.441,
      },
    });
    assert.strictEqual(response.statusCode, StatusCodes.OK);
    const data = JSON.parse(response.payload);
    assert.strictEqual(data.id, 'recPlotBeta');
    assert.strictEqual(data.Status, 'Planted');
    assert.strictEqual(data.Latitude, 37.761);

    const row = await prisma.plot.findUnique({ where: { airtableId: 'recPlotBeta' } });
    assert.strictEqual(row.status, 'Planted');
    assert.strictEqual(row.latitude, 37.761);
  });

  await t.test('PATCH /:id does not clear lat/lng on bad Map Coordinates', async () => {
    const before = await prisma.plot.findUnique({ where: { airtableId: 'recPlotAlpha' } });
    const response = await app.inject({
      method: 'PATCH',
      url: '/api/plots/recPlotAlpha',
      payload: {
        'Map Coordinates': 'garbage',
      },
    });
    assert.strictEqual(response.statusCode, StatusCodes.OK);
    const data = JSON.parse(response.payload);
    assert.strictEqual(data['Map Coordinates'], 'garbage');
    assert.strictEqual(data.Latitude, before.latitude);
    assert.strictEqual(data.Longitude, before.longitude);

    const after = await prisma.plot.findUnique({ where: { airtableId: 'recPlotAlpha' } });
    assert.strictEqual(after.latitude, before.latitude);
    assert.strictEqual(after.longitude, before.longitude);
    assert.strictEqual(after.mapCoordinates, 'garbage');
  });

  await t.test('POST / attaches uploaded photos via setAsset', async () => {
    const filename = '56826175-033e-4a89-8d51-8d7f602e01d9.jpg';
    await upload([['640x480.jpg', filename]]);
    const response = await app.inject({
      method: 'POST',
      url: '/api/plots',
      payload: {
        Status: 'Planted',
        Photos: [filename],
      },
    });
    assert.strictEqual(response.statusCode, StatusCodes.CREATED);
    const data = JSON.parse(response.payload);
    assert.strictEqual(data.Photos.length, 1);
    assert.match(data.Photos[0], /^\/api\/assets\/plot_photos\/.+\/file\/56826175-033e-4a89-8d51-8d7f602e01d9\.jpg$/);

    const row = await prisma.plot.findUnique({
      where: { airtableId: data.id },
      include: { photos: true },
    });
    assert.strictEqual(row.photos.length, 1);
    assert.strictEqual(row.photos[0].file, filename);
    assert.ok(await assetExists(path.join('plot_photos', row.photos[0].id, 'file', filename)));
  });

  await t.test('PATCH /:id attaches uploaded photos via setAsset', async () => {
    const filename = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.jpg';
    await upload([['640x480.jpg', filename]]);
    const response = await app.inject({
      method: 'PATCH',
      url: '/api/plots/recPlotAlpha',
      payload: {
        Photos: [filename],
      },
    });
    assert.strictEqual(response.statusCode, StatusCodes.OK);
    const data = JSON.parse(response.payload);
    assert.strictEqual(data.id, 'recPlotAlpha');
    assert.strictEqual(data.Photos.length, 1);
    assert.match(data.Photos[0], new RegExp(`/file/${filename}$`));

    const row = await prisma.plot.findUnique({
      where: { airtableId: 'recPlotAlpha' },
      include: { photos: true },
    });
    assert.strictEqual(row.photos.length, 1);
    assert.strictEqual(row.photos[0].file, filename);
    assert.ok(await assetExists(path.join('plot_photos', row.photos[0].id, 'file', filename)));
  });
});
