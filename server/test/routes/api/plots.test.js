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
  DEFAULT_PAGE_SIZE,
  formatPlot,
  isInViewport,
  preparePlotFieldsForWrite,
  parseMapCoordinates,
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

test('airtable list helpers', async (t) => {
  await t.test('isInViewport matches coordinates inside bounds', () => {
    assert.strictEqual(
      isInViewport(
        { latitude: 37.78, longitude: -122.42 },
        { north: 37.82, south: 37.75, east: -122.38, west: -122.45 }
      ),
      true
    );
  });

  await t.test('isInViewport rejects coordinates outside bounds', () => {
    assert.strictEqual(
      isInViewport(
        { latitude: 37.70, longitude: -122.42 },
        { north: 37.82, south: 37.75, east: -122.38, west: -122.45 }
      ),
      false
    );
  });

  await t.test('buildListSearchParams includes pagination options', () => {
    const params = buildListSearchParams({
      pageSize: 50,
      offset: 'itrXXX',
      fields: ['Status', PLOT_COORDINATES_FIELD],
    });
    assert.strictEqual(params.get('pageSize'), '50');
    assert.strictEqual(params.get('offset'), 'itrXXX');
    assert.deepStrictEqual(params.getAll('fields[]'), ['Status', PLOT_COORDINATES_FIELD]);
  });

  await t.test('buildListSearchParams defaults pageSize', () => {
    const params = buildListSearchParams({});
    assert.strictEqual(params.get('pageSize'), String(DEFAULT_PAGE_SIZE));
    assert.strictEqual(params.get('offset'), null);
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

  await t.test('GET / with viewport params filters records in API without Airtable formula', async () => {
    const fetchCalls = [];
    globalThis.fetch = async (url) => {
      fetchCalls.push(url);
      const offset = url.searchParams.get('offset');
      if (!offset) {
        return {
          ok: true,
          json: async () => ({
            records: [
              {
                id: 'recInside',
                createdTime: '2023-01-01T12:00:00.000Z',
                fields: {
                  [PLOT_COORDINATES_FIELD]: '37.78, -122.42',
                  Status: 'Planted',
                },
              },
              {
                id: 'recOutside',
                createdTime: '2023-01-01T12:00:00.000Z',
                fields: {
                  [PLOT_COORDINATES_FIELD]: '37.70, -122.42',
                  Status: 'Planted',
                },
              },
            ],
            offset: 'page2',
          }),
        };
      }
      return {
        ok: true,
        json: async () => ({
          records: [
            {
              id: 'recInvalid',
              createdTime: '2023-01-01T12:00:00.000Z',
              fields: {
                [PLOT_COORDINATES_FIELD]: 'bad value',
                Status: 'Planted',
              },
            },
            {
              id: 'recMissing',
              createdTime: '2023-01-01T12:00:00.000Z',
              fields: { Status: 'Planted' },
            },
          ],
        }),
      };
    };

    const response = await app.inject({
      url: '/api/plots?north=37.82&south=37.75&east=-122.38&west=-122.45',
    });

    assert.strictEqual(response.statusCode, StatusCodes.OK);
    assert.strictEqual(fetchCalls.length, 2);
    assert.strictEqual(fetchCalls[0].searchParams.get('filterByFormula'), null);
    assert.strictEqual(fetchCalls[1].searchParams.get('offset'), 'page2');
    assert.strictEqual(response.headers['x-next-offset'], undefined);
    const data = JSON.parse(response.payload);
    assert.strictEqual(data.length, 1);
    assert.strictEqual(data[0].id, 'recInside');
    assert.strictEqual(data[0].Latitude, 37.78);
    assert.strictEqual(data[0].Longitude, -122.42);
  });

  await t.test('GET / without viewport params preserves pagination behavior', async () => {
    let capturedUrl;
    globalThis.fetch = async (url) => {
      capturedUrl = url;
      return {
        ok: true,
        json: async () => ({
          records: [{
            id: 'rec2',
            createdTime: '2023-01-01T12:00:00.000Z',
            fields: {
              Status: 'Planted',
              [PLOT_COORDINATES_FIELD]: '37.78, -122.42',
            },
          }],
          offset: 'nextPage',
        }),
      };
    };

    const response = await app.inject({
      url: '/api/plots',
    });

    assert.strictEqual(response.statusCode, StatusCodes.OK);
    assert.strictEqual(capturedUrl.searchParams.get('filterByFormula'), null);
    assert.strictEqual(capturedUrl.searchParams.get('pageSize'), String(DEFAULT_PAGE_SIZE));
    assert.strictEqual(response.headers['x-next-offset'], 'nextPage');
    const data = JSON.parse(response.payload);
    assert.strictEqual(data[0].Latitude, 37.78);
    assert.strictEqual(data[0].Longitude, -122.42);
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

  await t.test('POST / sends Map Coordinates to Airtable without Latitude or Longitude', async () => {
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
    assert.strictEqual(capturedBody.fields[PLOT_COORDINATES_FIELD], '37.78, -122.42');
    assert.strictEqual(capturedBody.fields.Status, 'Planted');
    assert.strictEqual(capturedBody.fields[PLOT_LATITUDE_FIELD], undefined);
    assert.strictEqual(capturedBody.fields[PLOT_LONGITUDE_FIELD], undefined);
  });

  await t.test('PATCH / sends Map Coordinates to Airtable without Latitude or Longitude', async () => {
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
    assert.strictEqual(capturedBody.fields[PLOT_COORDINATES_FIELD], '37.78, -122.42');
    assert.strictEqual(capturedBody.fields[PLOT_LATITUDE_FIELD], undefined);
    assert.strictEqual(capturedBody.fields[PLOT_LONGITUDE_FIELD], undefined);
  });

  await t.test('POST / returns 422 for Latitude or Longitude in request body', async () => {
    globalThis.fetch = async () => {
      throw new Error('fetch should not be called');
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

    assert.strictEqual(response.statusCode, StatusCodes.UNPROCESSABLE_ENTITY);
  });

  await t.test('PATCH / returns 422 for Latitude or Longitude in request body', async () => {
    globalThis.fetch = async () => {
      throw new Error('fetch should not be called');
    };

    const response = await app.inject({
      method: 'PATCH',
      url: '/api/plots/recExplicit',
      payload: {
        [PLOT_LATITUDE_FIELD]: 1,
      },
    });

    assert.strictEqual(response.statusCode, StatusCodes.UNPROCESSABLE_ENTITY);
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

test('formatPlot', async (t) => {
  await t.test('derives Latitude and Longitude from valid Map Coordinates', () => {
    const plot = formatPlot({
      id: 'rec1',
      createdTime: '2023-01-01T12:00:00.000Z',
      fields: {
        [PLOT_COORDINATES_FIELD]: '37.78044, -122.45991',
        Status: 'Planted',
      },
    });
    assert.strictEqual(plot.Latitude, 37.78044);
    assert.strictEqual(plot.Longitude, -122.45991);
    assert.strictEqual(plot.Status, 'Planted');
  });

  await t.test('overwrites stale Airtable coordinates from valid Map Coordinates', () => {
    const plot = formatPlot({
      id: 'rec1',
      createdTime: '2023-01-01T12:00:00.000Z',
      fields: {
        [PLOT_COORDINATES_FIELD]: '37.78044, -122.45991',
        [PLOT_LATITUDE_FIELD]: 1,
        [PLOT_LONGITUDE_FIELD]: 2,
      },
    });
    assert.strictEqual(plot.Latitude, 37.78044);
    assert.strictEqual(plot.Longitude, -122.45991);
  });

  await t.test('omits derived coordinates when Map Coordinates is missing', () => {
    const plot = formatPlot({
      id: 'rec2',
      createdTime: '2023-01-01T12:00:00.000Z',
      fields: {
        Status: 'Planted',
        [PLOT_LATITUDE_FIELD]: 1,
        [PLOT_LONGITUDE_FIELD]: 2,
      },
    });
    assert.strictEqual(plot.Latitude, undefined);
    assert.strictEqual(plot.Longitude, undefined);
  });

  await t.test('omits derived coordinates when Map Coordinates is invalid', () => {
    const plot = formatPlot({
      id: 'rec3',
      createdTime: '2023-01-01T12:00:00.000Z',
      fields: {
        [PLOT_COORDINATES_FIELD]: 'bad value',
        [PLOT_LATITUDE_FIELD]: 1,
        [PLOT_LONGITUDE_FIELD]: 2,
        Status: 'Planted',
      },
    });
    assert.strictEqual(plot.Latitude, undefined);
    assert.strictEqual(plot.Longitude, undefined);
    assert.strictEqual(plot[PLOT_COORDINATES_FIELD], 'bad value');
  });
});

test('parseMapCoordinates', async (t) => {
  await t.test('accepts precise coordinates', () => {
    assert.deepStrictEqual(parseMapCoordinates('37.78044, -122.45991'), {
      [PLOT_LATITUDE_FIELD]: 37.78044,
      [PLOT_LONGITUDE_FIELD]: -122.45991,
    });
  });

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

test('preparePlotFieldsForWrite', async (t) => {
  await t.test('validates Map Coordinates when present', () => {
    assert.throws(
      () => preparePlotFieldsForWrite({ [PLOT_COORDINATES_FIELD]: 'not coordinates' }),
      /Invalid Map Coordinates/
    );
  });

  await t.test('passes Map Coordinates through', () => {
    assert.deepStrictEqual(
      preparePlotFieldsForWrite({
        [PLOT_COORDINATES_FIELD]: '37.78, -122.42',
        Status: 'Planted',
      }),
      {
        [PLOT_COORDINATES_FIELD]: '37.78, -122.42',
        Status: 'Planted',
      }
    );
  });

  await t.test('rejects Latitude and Longitude when provided in request', () => {
    assert.throws(
      () => preparePlotFieldsForWrite({
        [PLOT_COORDINATES_FIELD]: '37.78, -122.42',
        [PLOT_LATITUDE_FIELD]: 1,
        [PLOT_LONGITUDE_FIELD]: 2,
      }),
      /Latitude and Longitude are derived/
    );
  });

  await t.test('passes through fields without Map Coordinates unchanged', () => {
    assert.deepStrictEqual(
      preparePlotFieldsForWrite({ Status: 'Planted' }),
      { Status: 'Planted' }
    );
  });
});
