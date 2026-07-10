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
  normalizePlotFields,
  parseMapCoordinates,
  preparePlotCoordinateBackfill,
  PLOT_COORDINATES_FIELD,
  PLOT_LATITUDE_FIELD,
  PLOT_LONGITUDE_FIELD,
} from '#lib/airtable.js';
import errorPlugin from '#plugins/error.js';
import plotsCreateRoute from '#routes/api/plots/create.js';
import plotsListRoute from '#routes/api/plots/list.js';
import plotsPatchRoute from '#routes/api/plots/patch.js';

async function buildPlotsApp () {
  const app = Fastify();
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  await app.register(fastifyZodOpenApiPlugin);
  await app.register(errorPlugin);
  await app.register(plotsListRoute, { prefix: '/api/plots' });
  await app.register(plotsCreateRoute, { prefix: '/api/plots' });
  await app.register(plotsPatchRoute, { prefix: '/api/plots' });
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

  await t.test('POST / sends derived Latitude and Longitude to Airtable', async () => {
    let capturedBody;
    globalThis.fetch = async (url, options) => {
      capturedBody = JSON.parse(options.body);
      return {
        ok: true,
        json: async () => ({
          id: 'recNew',
          createdTime: '2023-01-01T12:00:00.000Z',
          fields: {
            [PLOT_COORDINATES_FIELD]: '37.78, -122.42',
            [PLOT_LATITUDE_FIELD]: 37.78,
            [PLOT_LONGITUDE_FIELD]: -122.42,
          },
        }),
      };
    };

    const response = await app.inject({
      method: 'POST',
      url: '/api/plots',
      payload: {
        [PLOT_COORDINATES_FIELD]: '37.78, -122.42',
        Status: 'Planted',
      },
    });

    assert.strictEqual(response.statusCode, StatusCodes.CREATED);
    assert.strictEqual(capturedBody.fields[PLOT_LATITUDE_FIELD], 37.78);
    assert.strictEqual(capturedBody.fields[PLOT_LONGITUDE_FIELD], -122.42);
    assert.strictEqual(capturedBody.fields[PLOT_COORDINATES_FIELD], '37.78, -122.42');
    assert.strictEqual(capturedBody.fields.Status, 'Planted');
  });

  await t.test('PATCH / sends derived Latitude and Longitude to Airtable', async () => {
    let capturedBody;
    globalThis.fetch = async (url, options) => {
      capturedBody = JSON.parse(options.body);
      return {
        ok: true,
        json: async () => ({
          id: 'recPatch',
          createdTime: '2023-01-01T12:00:00.000Z',
          fields: {
            [PLOT_COORDINATES_FIELD]: '37.78, -122.42',
            [PLOT_LATITUDE_FIELD]: 37.78,
            [PLOT_LONGITUDE_FIELD]: -122.42,
          },
        }),
      };
    };

    const response = await app.inject({
      method: 'PATCH',
      url: '/api/plots/recPatch',
      payload: {
        [PLOT_COORDINATES_FIELD]: '37.78, -122.42',
      },
    });

    assert.strictEqual(response.statusCode, StatusCodes.OK);
    assert.strictEqual(capturedBody.fields[PLOT_LATITUDE_FIELD], 37.78);
    assert.strictEqual(capturedBody.fields[PLOT_LONGITUDE_FIELD], -122.42);
  });

  await t.test('POST / preserves explicit Latitude and Longitude', async () => {
    let capturedBody;
    globalThis.fetch = async (url, options) => {
      capturedBody = JSON.parse(options.body);
      return {
        ok: true,
        json: async () => ({
          id: 'recExplicit',
          createdTime: '2023-01-01T12:00:00.000Z',
          fields: {
            [PLOT_LATITUDE_FIELD]: 1,
            [PLOT_LONGITUDE_FIELD]: 2,
          },
        }),
      };
    };

    const response = await app.inject({
      method: 'POST',
      url: '/api/plots',
      payload: {
        [PLOT_COORDINATES_FIELD]: '37.78, -122.42',
        [PLOT_LATITUDE_FIELD]: 1,
        [PLOT_LONGITUDE_FIELD]: 2,
      },
    });

    assert.strictEqual(response.statusCode, StatusCodes.CREATED);
    assert.strictEqual(capturedBody.fields[PLOT_LATITUDE_FIELD], 1);
    assert.strictEqual(capturedBody.fields[PLOT_LONGITUDE_FIELD], 2);
  });

  await t.test('POST / returns 422 for invalid Map Coordinates', async () => {
    globalThis.fetch = async () => {
      throw new Error('fetch should not be called');
    };

    const response = await app.inject({
      method: 'POST',
      url: '/api/plots',
      payload: {
        [PLOT_COORDINATES_FIELD]: 'not coordinates',
      },
    });

    assert.strictEqual(response.statusCode, StatusCodes.UNPROCESSABLE_ENTITY);
  });

  await t.test('PATCH / returns 422 for invalid Map Coordinates', async () => {
    globalThis.fetch = async () => {
      throw new Error('fetch should not be called');
    };

    const response = await app.inject({
      method: 'PATCH',
      url: '/api/plots/recBad',
      payload: {
        [PLOT_COORDINATES_FIELD]: 'not coordinates',
      },
    });

    assert.strictEqual(response.statusCode, StatusCodes.UNPROCESSABLE_ENTITY);
  });
});

test('parseMapCoordinates', async (t) => {
  await t.test('accepts lat, lng string', () => {
    assert.deepStrictEqual(parseMapCoordinates('37.78, -122.42'), {
      [PLOT_LATITUDE_FIELD]: 37.78,
      [PLOT_LONGITUDE_FIELD]: -122.42,
    });
  });

  await t.test('accepts extra whitespace', () => {
    assert.deepStrictEqual(parseMapCoordinates('  37.78  ,   -122.42  '), {
      [PLOT_LATITUDE_FIELD]: 37.78,
      [PLOT_LONGITUDE_FIELD]: -122.42,
    });
  });

  await t.test('returns undefined for empty values', () => {
    assert.strictEqual(parseMapCoordinates(''), undefined);
    assert.strictEqual(parseMapCoordinates('   '), undefined);
    assert.strictEqual(parseMapCoordinates(undefined), undefined);
    assert.strictEqual(parseMapCoordinates(null), undefined);
  });

  await t.test('rejects invalid text', () => {
    assert.throws(
      () => parseMapCoordinates('not coordinates'),
      /Invalid Map Coordinates/
    );
  });

  await t.test('rejects missing latitude', () => {
    assert.throws(
      () => parseMapCoordinates('37.78,'),
      /Invalid Map Coordinates/
    );
  });

  await t.test('rejects missing longitude', () => {
    assert.throws(
      () => parseMapCoordinates(', -122.42'),
      /Invalid Map Coordinates/
    );
  });

  await t.test('rejects whitespace-only longitude', () => {
    assert.throws(
      () => parseMapCoordinates('37.78,   '),
      /Invalid Map Coordinates/
    );
  });

  await t.test('rejects out-of-range latitude', () => {
    assert.throws(
      () => parseMapCoordinates('91, -122.42'),
      /Latitude must be between -90 and 90/
    );
  });

  await t.test('rejects out-of-range longitude', () => {
    assert.throws(
      () => parseMapCoordinates('37.78, 181'),
      /Longitude must be between -180 and 180/
    );
  });
});

test('normalizePlotFields and backfill helpers', async (t) => {
  await t.test('normalizePlotFields derives missing split fields', () => {
    assert.deepStrictEqual(
      normalizePlotFields({ [PLOT_COORDINATES_FIELD]: '37.78, -122.42' }),
      {
        [PLOT_COORDINATES_FIELD]: '37.78, -122.42',
        [PLOT_LATITUDE_FIELD]: 37.78,
        [PLOT_LONGITUDE_FIELD]: -122.42,
      }
    );
  });

  await t.test('normalizePlotFields preserves explicit split fields', () => {
    assert.deepStrictEqual(
      normalizePlotFields({
        [PLOT_COORDINATES_FIELD]: '37.78, -122.42',
        [PLOT_LATITUDE_FIELD]: 1,
        [PLOT_LONGITUDE_FIELD]: 2,
      }),
      {
        [PLOT_COORDINATES_FIELD]: '37.78, -122.42',
        [PLOT_LATITUDE_FIELD]: 1,
        [PLOT_LONGITUDE_FIELD]: 2,
      }
    );
  });

  await t.test('preparePlotCoordinateBackfill skips records with both split fields', () => {
    assert.strictEqual(
      preparePlotCoordinateBackfill({
        id: 'recComplete',
        fields: { [PLOT_LATITUDE_FIELD]: 1, [PLOT_LONGITUDE_FIELD]: 2 },
      }),
      null
    );
  });

  await t.test('preparePlotCoordinateBackfill prepares missing split fields', () => {
    assert.deepStrictEqual(
      preparePlotCoordinateBackfill({
        id: 'recMissing',
        fields: { [PLOT_COORDINATES_FIELD]: '37.78, -122.42' },
      }),
      {
        id: 'recMissing',
        update: {
          [PLOT_LATITUDE_FIELD]: 37.78,
          [PLOT_LONGITUDE_FIELD]: -122.42,
        },
      }
    );
  });

  await t.test('preparePlotCoordinateBackfill does not overwrite existing split fields', () => {
    assert.deepStrictEqual(
      preparePlotCoordinateBackfill({
        id: 'recPartial',
        fields: {
          [PLOT_COORDINATES_FIELD]: '37.78, -122.42',
          [PLOT_LATITUDE_FIELD]: 1,
        },
      }),
      {
        id: 'recPartial',
        update: {
          [PLOT_LONGITUDE_FIELD]: -122.42,
        },
      }
    );
  });

  await t.test('preparePlotCoordinateBackfill flags invalid Map Coordinates', () => {
    assert.deepStrictEqual(
      preparePlotCoordinateBackfill({
        id: 'recInvalid',
        fields: { [PLOT_COORDINATES_FIELD]: 'bad value' },
      }),
      {
        id: 'recInvalid',
        invalidValue: 'bad value',
      }
    );
  });
});
