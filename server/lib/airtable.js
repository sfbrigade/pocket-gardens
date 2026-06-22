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
    const entries = searchParams instanceof URLSearchParams
      ? searchParams
      : new URLSearchParams(Object.entries(searchParams));
    for (const [key, value] of entries) {
      url.searchParams.append(key, value);
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

export const DEFAULT_PAGE_SIZE = 25;

function buildListSearchParams (options = {}) {
  const pageSize = Math.min(Math.max(1, Number(options.pageSize) || DEFAULT_PAGE_SIZE), 100);
  const params = new URLSearchParams();
  params.set('pageSize', String(pageSize));
  if (options.offset) params.set('offset', options.offset);
  if (options.maxRecords) params.set('maxRecords', String(options.maxRecords));
  if (options.view) params.set('view', options.view);
  if (options.filterByFormula) params.set('filterByFormula', options.filterByFormula);
  for (const field of options.fields ?? []) {
    params.append('fields[]', field);
  }
  for (const [i, { field, direction = 'asc' }] of (options.sort ?? []).entries()) {
    params.set(`sort[${i}][field]`, field);
    params.set(`sort[${i}][direction]`, direction);
  }
  return params;
}

export async function listPlots (options = {}) {
  const data = await airtable(TABLES.plots, '', { searchParams: buildListSearchParams(options) });
  return { records: data.records, offset: data.offset };
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
  const params = buildListSearchParams({});
  console.assert(params.get('pageSize') === '10');
  console.log('formatPlot ok');
}
