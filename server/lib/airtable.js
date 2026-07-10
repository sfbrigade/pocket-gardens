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

export function preparePlotFieldsForWrite (fields) {
  if (fields[PLOT_LATITUDE_FIELD] !== undefined || fields[PLOT_LONGITUDE_FIELD] !== undefined) {
    throw coordinateValidationError('Latitude and Longitude are derived from Map Coordinates');
  }
  if (fields[PLOT_COORDINATES_FIELD] !== undefined) {
    parseMapCoordinates(fields[PLOT_COORDINATES_FIELD]);
  }
  return { ...fields };
}

export function isInViewport ({ latitude, longitude }, { north, south, east, west }) {
  return latitude >= south && latitude <= north && longitude >= west && longitude <= east;
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
  const {
    [PLOT_LATITUDE_FIELD]: _latitude,
    [PLOT_LONGITUDE_FIELD]: _longitude,
    ...safeFields
  } = fields;
  const plot = { id, createdTime, ...safeFields };
  const parsed = parseMapCoordinates(fields[PLOT_COORDINATES_FIELD]);
  if (parsed) {
    plot[PLOT_LATITUDE_FIELD] = parsed[PLOT_LATITUDE_FIELD];
    plot[PLOT_LONGITUDE_FIELD] = parsed[PLOT_LONGITUDE_FIELD];
  }
  return plot;
}

export const DEFAULT_PAGE_SIZE = 25;

export function buildListSearchParams (options = {}) {
  const pageSize = Math.min(Math.max(1, Number(options.pageSize) || DEFAULT_PAGE_SIZE), 100);
  const params = new URLSearchParams();
  params.set('pageSize', String(pageSize));
  if (options.offset) params.set('offset', options.offset);
  for (const field of options.fields ?? []) {
    params.append('fields[]', field);
  }
  return params;
}
