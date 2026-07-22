import { test } from 'node:test';
import * as assert from 'node:assert';
import { StatusCodes } from 'http-status-codes';

import { build } from '#test/helper.js';
import { DEFAULT_PAGE_SIZE } from '#models/plot.js';

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
    assert.ok(DEFAULT_PAGE_SIZE >= 1);
  });

  await t.test('GET /:id returns a plot by airtable id', async () => {
    const response = await app.inject({ url: '/api/plots/recPlotAlpha' });
    assert.strictEqual(response.statusCode, StatusCodes.OK);
    const data = JSON.parse(response.payload);
    assert.strictEqual(data.id, 'recPlotAlpha');
    assert.strictEqual(data.Status, 'Planted');
    assert.strictEqual(data.Latitude, 37.78);
  });

  await t.test('GET /:id returns 404 when missing', async () => {
    const response = await app.inject({ url: '/api/plots/recMissing' });
    assert.strictEqual(response.statusCode, StatusCodes.NOT_FOUND);
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
});
