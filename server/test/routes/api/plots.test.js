import { test } from 'node:test';
import * as assert from 'node:assert';
import { StatusCodes } from 'http-status-codes';
import Fastify from 'fastify';
import {
  fastifyZodOpenApiPlugin,
  serializerCompiler,
  validatorCompiler,
} from 'fastify-zod-openapi';

import {
  buildListSearchParams,
  buildViewportFormula,
  DEFAULT_PAGE_SIZE,
} from '#lib/airtable.js';
import errorPlugin from '#plugins/error.js';
import plotsListRoute from '#routes/api/plots/list.js';

async function buildPlotsApp () {
  const app = Fastify();
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  await app.register(fastifyZodOpenApiPlugin);
  await app.register(errorPlugin);
  await app.register(plotsListRoute, { prefix: '/api/plots' });
  await app.ready();
  return app;
}

test('airtable viewport helpers', async (t) => {
  await t.test('buildViewportFormula produces an Airtable filter formula', () => {
    assert.strictEqual(
      buildViewportFormula({ north: 37.82, south: 37.75, east: -122.38, west: -122.45 }),
      'AND({Latitude}>=37.75,{Latitude}<=37.82,{Longitude}>=-122.45,{Longitude}<=-122.38)'
    );
  });

  await t.test('buildListSearchParams includes filterByFormula when provided', () => {
    const params = buildListSearchParams({
      pageSize: 50,
      offset: 'itrXXX',
      filterByFormula: 'AND({Latitude}>=1)',
      fields: ['Latitude', 'Longitude'],
    });
    assert.strictEqual(params.get('pageSize'), '50');
    assert.strictEqual(params.get('offset'), 'itrXXX');
    assert.strictEqual(params.get('filterByFormula'), 'AND({Latitude}>=1)');
    assert.deepStrictEqual(params.getAll('fields[]'), ['Latitude', 'Longitude']);
  });

  await t.test('buildListSearchParams defaults pageSize', () => {
    const params = buildListSearchParams({});
    assert.strictEqual(params.get('pageSize'), String(DEFAULT_PAGE_SIZE));
    assert.strictEqual(params.get('filterByFormula'), null);
  });
});

test('/api/plots', async (t) => {
  const originalFetch = globalThis.fetch;
  const originalApiKey = process.env.AIRTABLE_API_KEY;
  const originalBaseId = process.env.AIRTABLE_BASE_ID;

  t.before(() => {
    process.env.AIRTABLE_API_KEY = 'test-key';
    process.env.AIRTABLE_BASE_ID = 'test-base';
  });

  t.after(async () => {
    globalThis.fetch = originalFetch;
    if (originalApiKey === undefined) {
      delete process.env.AIRTABLE_API_KEY;
    } else {
      process.env.AIRTABLE_API_KEY = originalApiKey;
    }
    if (originalBaseId === undefined) {
      delete process.env.AIRTABLE_BASE_ID;
    } else {
      process.env.AIRTABLE_BASE_ID = originalBaseId;
    }
  });

  const app = await buildPlotsApp();
  t.after(() => app.close());

  await t.test('GET / with viewport params sends filterByFormula to Airtable', async () => {
    let capturedUrl;
    globalThis.fetch = async (url) => {
      capturedUrl = url;
      return {
        ok: true,
        json: async () => ({
          records: [{
            id: 'rec1',
            createdTime: '2023-01-01T12:00:00.000Z',
            fields: { Latitude: 37.78, Longitude: -122.42, Status: 'Planted' },
          }],
        }),
      };
    };

    const response = await app.inject({
      url: '/api/plots?north=37.82&south=37.75&east=-122.38&west=-122.45',
    });

    assert.strictEqual(response.statusCode, StatusCodes.OK);
    const data = JSON.parse(response.payload);
    assert.strictEqual(data.length, 1);
    assert.strictEqual(data[0].id, 'rec1');
    assert.strictEqual(data[0].Latitude, 37.78);
    assert.strictEqual(
      capturedUrl.searchParams.get('filterByFormula'),
      'AND({Latitude}>=37.75,{Latitude}<=37.82,{Longitude}>=-122.45,{Longitude}<=-122.38)'
    );
  });

  await t.test('GET / without viewport params does not send filterByFormula', async () => {
    let capturedUrl;
    globalThis.fetch = async (url) => {
      capturedUrl = url;
      return {
        ok: true,
        json: async () => ({
          records: [{
            id: 'rec2',
            createdTime: '2023-01-01T12:00:00.000Z',
            fields: { Status: 'Planted' },
          }],
        }),
      };
    };

    const response = await app.inject({
      url: '/api/plots',
    });

    assert.strictEqual(response.statusCode, StatusCodes.OK);
    assert.strictEqual(capturedUrl.searchParams.get('filterByFormula'), null);
    assert.strictEqual(capturedUrl.searchParams.get('pageSize'), String(DEFAULT_PAGE_SIZE));
  });

  await t.test('GET / rejects partial viewport params', async () => {
    globalThis.fetch = async () => {
      throw new Error('fetch should not be called');
    };

    const response = await app.inject({
      url: '/api/plots?north=37.82&south=37.75',
    });

    assert.strictEqual(response.statusCode, StatusCodes.UNPROCESSABLE_ENTITY);
  });

  await t.test('GET / rejects north less than south', async () => {
    globalThis.fetch = async () => {
      throw new Error('fetch should not be called');
    };

    const response = await app.inject({
      url: '/api/plots?north=37.75&south=37.82&east=-122.38&west=-122.45',
    });

    assert.strictEqual(response.statusCode, StatusCodes.UNPROCESSABLE_ENTITY);
  });
});
