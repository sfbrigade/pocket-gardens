import { StatusCodes } from 'http-status-codes';
import { z } from 'zod';

export const TABLES = {
  plots: 'Plots',
  plants: 'Plants',
  people: 'People',
  partners: 'Partners',
  maintenance: 'Maintenance Records',
  neighborhoods: 'Neighborhoods',
  zipcodes: 'Zip Codes',
};

export const PlotSchema = z.object({ id: z.string(), createdTime: z.string() }).passthrough();
export const PlotFieldsSchema = z.record(z.string(), z.unknown());

export async function airtable (table, path, { method = 'GET', body, searchParams } = {}) {
  const apiKey = process.env.AIRTABLE_API_KEY;
  const baseId = process.env.AIRTABLE_BASE_ID;
  if (!apiKey || !baseId) {
    throw new Error('AIRTABLE_API_KEY and AIRTABLE_BASE_ID must be set');
  }
  const url = new URL(`https://api.airtable.com/v0/${baseId}/${table}${path}`);
  if (searchParams) {
    for (const [key, value] of searchParams) {
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
    const error = new Error(message);
    error.statusCode = statusCode;
    throw error;
  }
  return response.json();
}

export function formatPlot ({ id, createdTime, fields }) {
  return { id, createdTime, ...fields };
}

export const DEFAULT_PAGE_SIZE = 25;

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
  console.assert(String(DEFAULT_PAGE_SIZE) === '25');
  console.log('formatPlot ok');
}
