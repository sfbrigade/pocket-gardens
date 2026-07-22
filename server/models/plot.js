import { z } from 'zod';

import { parseMapCoordinates } from '#lib/airtable-schema.js';

export const DEFAULT_PAGE_SIZE = 25;

export const PlotSchema = z.object({
  id: z.string(),
  createdTime: z.string(),
  Latitude: z.number().optional().nullable(),
  Longitude: z.number().optional().nullable(),
  Status: z.string().optional().nullable(),
  'Bed Type': z.string().optional().nullable(),
  'Pocket Garden Name': z.string().optional().nullable(),
  'Street Address': z.string().optional().nullable(),
  'Map Coordinates': z.string().optional().nullable(),
}).passthrough();

export const PlotFieldsSchema = z.object({
  Latitude: z.number().min(-90).max(90).optional(),
  Longitude: z.number().min(-180).max(180).optional(),
  Status: z.string().optional(),
  'Bed Type': z.string().optional(),
  'Pocket Garden Name': z.string().optional(),
  'Street Address': z.string().optional(),
  'Street City Address (for Maps)': z.string().optional(),
  'Map Coordinates': z.string().optional(),
  'Soil Type': z.string().optional(),
  'Bed ID': z.string().optional(),
  'Visit Interval (Days)': z.number().int().optional(),
  'Est. Area (Sq. Ft)': z.number().optional(),
  'Location Description': z.string().optional(),
  "Seth's Notes": z.string().optional(),
}).passthrough();

/**
 * Format a Prisma Plot row for the public API.
 * `id` remains the Airtable record id for transition compatibility.
 */
export function formatPlot (plot) {
  if (!plot) return plot;
  const createdTime = plot.createdAt instanceof Date
    ? plot.createdAt.toISOString()
    : (plot.createdTime || plot.createdAt);
  return {
    id: plot.airtableId || plot.id,
    createdTime,
    Latitude: plot.latitude ?? undefined,
    Longitude: plot.longitude ?? undefined,
    Status: plot.status ?? undefined,
    'Bed Type': plot.bedType ?? undefined,
    'Pocket Garden Name': plot.name ?? undefined,
    'Street Address': plot.streetAddress ?? undefined,
    'Street City Address (for Maps)': plot.streetCityAddress ?? undefined,
    'Map Coordinates': plot.mapCoordinates ?? undefined,
    'Soil Type': plot.soilType ?? undefined,
    'Bed ID': plot.bedId ?? undefined,
    'Visit Interval (Days)': plot.visitIntervalDays ?? undefined,
    'Est. Area (Sq. Ft)': plot.estAreaSqFt ?? undefined,
    'Location Description': plot.locationDescription ?? undefined,
    "Seth's Notes": plot.sethsNotes ?? undefined,
    Alert: plot.alert ?? undefined,
    'Next Visit': plot.nextVisit ?? undefined,
  };
}

/**
 * Map Airtable-shaped request body fields onto Prisma Plot columns.
 */
export function plotFieldsFromBody (body = {}) {
  const data = {};
  if (body.Status !== undefined) data.status = body.Status;
  if (body['Bed Type'] !== undefined) data.bedType = body['Bed Type'];
  if (body['Pocket Garden Name'] !== undefined) data.name = body['Pocket Garden Name'];
  if (body['Street Address'] !== undefined) data.streetAddress = body['Street Address'];
  if (body['Street City Address (for Maps)'] !== undefined) {
    data.streetCityAddress = body['Street City Address (for Maps)'];
  }
  if (body['Map Coordinates'] !== undefined) data.mapCoordinates = body['Map Coordinates'];
  if (body['Soil Type'] !== undefined) data.soilType = body['Soil Type'];
  if (body['Bed ID'] !== undefined) data.bedId = body['Bed ID'];
  if (body['Visit Interval (Days)'] !== undefined) data.visitIntervalDays = body['Visit Interval (Days)'];
  if (body['Est. Area (Sq. Ft)'] !== undefined) data.estAreaSqFt = body['Est. Area (Sq. Ft)'];
  if (body['Location Description'] !== undefined) data.locationDescription = body['Location Description'];
  if (body["Seth's Notes"] !== undefined) data.sethsNotes = body["Seth's Notes"];

  let latitude = body.Latitude;
  let longitude = body.Longitude;
  if ((latitude === undefined || longitude === undefined) && body['Map Coordinates']) {
    const parsed = parseMapCoordinates(body['Map Coordinates']);
    if (latitude === undefined) latitude = parsed.latitude;
    if (longitude === undefined) longitude = parsed.longitude;
  }
  if (latitude !== undefined) data.latitude = latitude;
  if (longitude !== undefined) data.longitude = longitude;

  if (data.mapCoordinates == null && latitude != null && longitude != null) {
    data.mapCoordinates = `${latitude}, ${longitude}`;
  }

  return data;
}

export function buildViewportWhere ({ north, south, east, west }) {
  return {
    latitude: { gte: south, lte: north },
    longitude: { gte: west, lte: east },
  };
}

export function encodeListOffset (skip) {
  return String(skip);
}

export function decodeListOffset (offset) {
  if (!offset) return 0;
  if (!/^\d+$/.test(offset)) return 0;
  return Number(offset);
}

export default {
  PlotSchema,
  PlotFieldsSchema,
  formatPlot,
  plotFieldsFromBody,
  buildViewportWhere,
  encodeListOffset,
  decodeListOffset,
  DEFAULT_PAGE_SIZE,
};
