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

export const PLOT_COORDINATES_FIELD = 'Map Coordinates';
export const PLOT_LATITUDE_FIELD = 'Latitude';
export const PLOT_LONGITUDE_FIELD = 'Longitude';

export const PlotSchema = z.object({
  id: z.string(),
  createdTime: z.string(),
  Latitude: z.number().optional(),
  Longitude: z.number().optional(),
  [PLOT_COORDINATES_FIELD]: z.string().optional(),
  Status: z.string().optional(),
  'Bed Type': z.string().optional(),
}).passthrough();

export const PlotFieldsSchema = z.object({
  Latitude: z.number().min(-90).max(90).optional(),
  Longitude: z.number().min(-180).max(180).optional(),
  [PLOT_COORDINATES_FIELD]: z.string().optional(),
}).passthrough();

function coordinateValidationError (message) {
  const error = new Error(message);
  error.statusCode = StatusCodes.UNPROCESSABLE_ENTITY;
  return error;
}

export function parseMapCoordinates (value) {
  if (value === undefined || value === null) {
    return undefined;
  }
  if (typeof value !== 'string') {
    throw coordinateValidationError('Map Coordinates must be a string');
  }
  const trimmed = value.trim();
  if (trimmed === '') {
    return undefined;
  }
  const parts = trimmed.split(',');
  if (parts.length !== 2) {
    throw coordinateValidationError(`Invalid Map Coordinates: "${value}"`);
  }
  const latPart = parts[0].trim();
  const lngPart = parts[1].trim();
  if (latPart === '' || lngPart === '') {
    throw coordinateValidationError(`Invalid Map Coordinates: "${value}"`);
  }
  const latitude = Number(latPart);
  const longitude = Number(lngPart);
  if (Number.isNaN(latitude) || Number.isNaN(longitude)) {
    throw coordinateValidationError(`Invalid Map Coordinates: "${value}"`);
  }
  if (latitude < -90 || latitude > 90) {
    throw coordinateValidationError(`Latitude must be between -90 and 90, got ${latitude}`);
  }
  if (longitude < -180 || longitude > 180) {
    throw coordinateValidationError(`Longitude must be between -180 and 180, got ${longitude}`);
  }
  return {
    [PLOT_LATITUDE_FIELD]: latitude,
    [PLOT_LONGITUDE_FIELD]: longitude,
  };
}

export function normalizePlotFields (fields) {
  const normalized = { ...fields };
  const needsLatitude = normalized[PLOT_LATITUDE_FIELD] === undefined;
  const needsLongitude = normalized[PLOT_LONGITUDE_FIELD] === undefined;
  if ((needsLatitude || needsLongitude) && normalized[PLOT_COORDINATES_FIELD] !== undefined) {
    const parsed = parseMapCoordinates(normalized[PLOT_COORDINATES_FIELD]);
    if (parsed) {
      if (needsLatitude) {
        normalized[PLOT_LATITUDE_FIELD] = parsed[PLOT_LATITUDE_FIELD];
      }
      if (needsLongitude) {
        normalized[PLOT_LONGITUDE_FIELD] = parsed[PLOT_LONGITUDE_FIELD];
      }
    }
  }
  return normalized;
}

export function preparePlotCoordinateBackfill ({ id, fields }) {
  const hasLatitude = fields[PLOT_LATITUDE_FIELD] != null;
  const hasLongitude = fields[PLOT_LONGITUDE_FIELD] != null;
  if (hasLatitude && hasLongitude) {
    return null;
  }
  const mapCoordinates = fields[PLOT_COORDINATES_FIELD];
  if (mapCoordinates == null || (typeof mapCoordinates === 'string' && mapCoordinates.trim() === '')) {
    return null;
  }
  try {
    const parsed = parseMapCoordinates(mapCoordinates);
    if (!parsed) {
      return null;
    }
    const update = {};
    if (!hasLatitude) {
      update[PLOT_LATITUDE_FIELD] = parsed[PLOT_LATITUDE_FIELD];
    }
    if (!hasLongitude) {
      update[PLOT_LONGITUDE_FIELD] = parsed[PLOT_LONGITUDE_FIELD];
    }
    if (Object.keys(update).length === 0) {
      return null;
    }
    return { id, update };
  } catch {
    return { id, invalidValue: mapCoordinates };
  }
}

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

export function buildViewportFormula ({ north, south, east, west }) {
  return `AND({${PLOT_LATITUDE_FIELD}}>=${south},{${PLOT_LATITUDE_FIELD}}<=${north},{${PLOT_LONGITUDE_FIELD}}>=${west},{${PLOT_LONGITUDE_FIELD}}<=${east})`;
}

export function buildListSearchParams (options = {}) {
  const pageSize = Math.min(Math.max(1, Number(options.pageSize) || DEFAULT_PAGE_SIZE), 100);
  const params = new URLSearchParams();
  params.set('pageSize', String(pageSize));
  if (options.offset) params.set('offset', options.offset);
  if (options.filterByFormula) params.set('filterByFormula', options.filterByFormula);
  for (const field of options.fields ?? []) {
    params.append('fields[]', field);
  }
  return params;
}

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
  console.assert(
    buildViewportFormula({ north: 37.82, south: 37.75, east: -122.38, west: -122.45 }) ===
    'AND({Latitude}>=37.75,{Latitude}<=37.82,{Longitude}>=-122.45,{Longitude}<=-122.38)'
  );
  console.log('formatPlot ok');
}
