import { StatusCodes } from 'http-status-codes';

// ponytail: native fetch, no airtable npm package

function config () {
  const apiKey = process.env.AIRTABLE_API_KEY;
  const baseId = process.env.AIRTABLE_BASE_ID;
  const table = process.env.AIRTABLE_PLOTS_TABLE || 'Plots';
  if (!apiKey || !baseId) {
    throw new Error('AIRTABLE_API_KEY and AIRTABLE_BASE_ID must be set');
  }
  return { apiKey, base: `https://api.airtable.com/v0/${baseId}/${table}` };
}

function airtableError (statusCode, message) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

async function airtable (path, { method = 'GET', body, searchParams } = {}) {
  const { apiKey, base } = config();
  const url = new URL(`${base}${path}`);
  if (searchParams) {
    for (const [key, value] of Object.entries(searchParams)) {
      url.searchParams.set(key, value);
    }
  }
  const response = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    const message = data.error?.message || response.statusText;
    const statusCode = response.status === 404
      ? StatusCodes.NOT_FOUND
      : response.status === 422
        ? StatusCodes.UNPROCESSABLE_ENTITY
        : StatusCodes.BAD_GATEWAY;
    throw airtableError(statusCode, message);
  }
  return response.json();
}

export function formatPlot ({ id, createdTime, fields }) {
  return { id, createdTime, ...fields };
}

export async function listPlots () {
  const records = [];
  let offset;
  do {
    const data = await airtable('', { searchParams: offset ? { offset } : undefined });
    records.push(...data.records);
    offset = data.offset;
  } while (offset);
  return records;
}

export function getPlot (id) {
  return airtable(`/${id}`);
}

export function createPlot (fields) {
  return airtable('', { method: 'POST', body: { fields }, searchParams: { typecast: 'true' } });
}

export function updatePlot (id, fields) {
  return airtable(`/${id}`, { method: 'PATCH', body: { fields }, searchParams: { typecast: 'true' } });
}

// ponytail: assert formatPlot shape; upgrade to route tests when auth lands
if (import.meta.url === `file://${process.argv[1]}`) {
  const plot = formatPlot({
    id: 'rec123',
    createdTime: '2023-01-01T12:00:00.000Z',
    fields: { Status: 'Planted', 'Bed Type': 'Tree Well' },
  });
  console.assert(plot.id === 'rec123');
  console.assert(plot.Status === 'Planted');
  console.assert(plot['Bed Type'] === 'Tree Well');
  console.log('formatPlot ok');
}
