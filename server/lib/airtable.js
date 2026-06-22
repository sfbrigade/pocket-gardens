import { StatusCodes } from 'http-status-codes';

export const TABLES = {
  plots: 'Plots',
  plants: 'Plants',
  people: 'People',
  partners: 'Partners',
  maintenance: 'Maintenance Records',
  neighborhoods: 'Neighborhoods',
  zipcodes: 'Zip Codes',
};

function config () {
  const apiKey = process.env.AIRTABLE_API_KEY;
  const baseId = process.env.AIRTABLE_BASE_ID;
  if (!apiKey || !baseId) {
    throw new Error('AIRTABLE_API_KEY and AIRTABLE_BASE_ID must be set');
  }
  return { apiKey, baseId };
}

function airtableError (statusCode, message) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

export async function airtable (table, path, { method = 'GET', body, searchParams } = {}) {
  const { apiKey, baseId } = config();
  const url = new URL(`https://api.airtable.com/v0/${baseId}/${table}${path}`);
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
    const data = await airtable(TABLES.plots, '', { searchParams: offset ? { offset } : undefined });
    records.push(...data.records);
    offset = data.offset;
  } while (offset);
  return records;
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
