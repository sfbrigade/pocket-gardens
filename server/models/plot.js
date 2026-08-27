import { z } from 'zod';

import { parseMapCoordinates } from '#lib/airtable-schema.js';
import { runPhotoHandlers, syncPhotos } from '#lib/photos.js';
import PlotPhoto from '#models/plot-photo.js';

export const DEFAULT_PAGE_SIZE = 25;

export const PlotSchema = z.object({
  id: z.string().uuid(),
  airtableId: z.string(),
  createdAt: z.string(),
  name: z.string().optional().nullable(),
  status: z.string().optional().nullable(),
  streetAddress: z.string().optional().nullable(),
  streetCityAddress: z.string().optional().nullable(),
  mapCoordinates: z.string().optional().nullable(),
  latitude: z.number().optional().nullable(),
  longitude: z.number().optional().nullable(),
  bedType: z.string().optional().nullable(),
  bedId: z.string().optional().nullable(),
  soilType: z.string().optional().nullable(),
  visitIntervalDays: z.number().int().optional().nullable(),
  estAreaSqFt: z.number().optional().nullable(),
  locationDescription: z.string().optional().nullable(),
  sethsNotes: z.string().optional().nullable(),
  alert: z.string().optional().nullable(),
  nextVisit: z.string().optional().nullable(),
  photos: z.array(z.string()).optional(),
});

export const PlotFieldsSchema = z.object({
  name: z.string().optional(),
  status: z.string().optional(),
  streetAddress: z.string().optional(),
  streetCityAddress: z.string().optional(),
  mapCoordinates: z.string().optional(),
  latitude: z.number().min(-90).max(90).optional(),
  longitude: z.number().min(-180).max(180).optional(),
  bedType: z.string().optional(),
  bedId: z.string().optional(),
  soilType: z.string().optional(),
  visitIntervalDays: z.number().int().optional(),
  estAreaSqFt: z.number().optional(),
  locationDescription: z.string().optional(),
  sethsNotes: z.string().optional(),
  photos: z.array(z.string()).optional(),
});

const PLOT_BODY_FIELDS = [
  'name',
  'status',
  'streetAddress',
  'streetCityAddress',
  'mapCoordinates',
  'latitude',
  'longitude',
  'bedType',
  'bedId',
  'soilType',
  'visitIntervalDays',
  'estAreaSqFt',
  'locationDescription',
  'sethsNotes',
];

function isoDate (value) {
  if (value instanceof Date) return value.toISOString();
  return value ?? undefined;
}

/**
 * Format a Prisma Plot row for the public API.
 * Omits internal FKs/cache fields and turns photo rows into asset URLs.
 */
export function formatPlot (plot) {
  if (!plot) return plot;
  return {
    id: plot.id,
    airtableId: plot.airtableId,
    createdAt: isoDate(plot.createdAt),
    name: plot.name,
    status: plot.status,
    streetAddress: plot.streetAddress,
    streetCityAddress: plot.streetCityAddress,
    mapCoordinates: plot.mapCoordinates,
    latitude: plot.latitude,
    longitude: plot.longitude,
    bedType: plot.bedType,
    bedId: plot.bedId,
    soilType: plot.soilType,
    visitIntervalDays: plot.visitIntervalDays,
    estAreaSqFt: plot.estAreaSqFt,
    locationDescription: plot.locationDescription,
    sethsNotes: plot.sethsNotes,
    alert: plot.alert,
    nextVisit: plot.nextVisit,
    photos: formatPlotPhotos(plot.photos),
  };
}

export const PLOT_PHOTOS_INCLUDE = {
  photos: { orderBy: { position: 'asc' } },
};

function formatPlotPhotos (photos) {
  if (!Array.isArray(photos) || photos.length === 0) return undefined;
  const urls = photos.map((row) => new PlotPhoto(row).fileUrl).filter(Boolean);
  return urls.length ? urls : undefined;
}

/**
 * Persist a Photos filename list with setAsset, then reload the plot with photos.
 */
export async function syncPlotPhotos (tx, plotId, filenames) {
  const handlers = await syncPhotos({
    delegate: tx.plotPhoto,
    PhotoClass: PlotPhoto,
    parentFk: 'plotId',
    parentId: plotId,
    filenames,
  });
  await runPhotoHandlers(handlers);
}

export function reloadPlotWithPhotos (tx, id) {
  return tx.plot.findUnique({
    where: { id },
    include: PLOT_PHOTOS_INCLUDE,
  });
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid (value) {
  return typeof value === 'string' && UUID_RE.test(value);
}

/**
 * Look up a Plot by public id (UUID or legacy Airtable record id).
 */
export function findPlotByPublicId (prisma, id) {
  return prisma.plot.findFirst({
    where: {
      OR: [
        { airtableId: id },
        ...(isUuid(id) ? [{ id }] : []),
      ],
    },
    include: PLOT_PHOTOS_INCLUDE,
  });
}

/**
 * Pick writable Plot columns from a request body.
 * Derives lat/lng from mapCoordinates (and the reverse) when only one side is sent.
 */
export function plotFieldsFromBody (body = {}) {
  const data = {};
  for (const key of PLOT_BODY_FIELDS) {
    if (body[key] !== undefined) data[key] = body[key];
  }

  let latitude = data.latitude;
  let longitude = data.longitude;
  if ((latitude === undefined || longitude === undefined) && data.mapCoordinates) {
    const parsed = parseMapCoordinates(data.mapCoordinates);
    // Only apply parsed coords when both parse successfully; never write null from a bad string.
    if (parsed.latitude != null && parsed.longitude != null) {
      if (latitude === undefined) latitude = parsed.latitude;
      if (longitude === undefined) longitude = parsed.longitude;
    }
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
  findPlotByPublicId,
  isUuid,
  plotFieldsFromBody,
  buildViewportWhere,
  encodeListOffset,
  decodeListOffset,
  PLOT_PHOTOS_INCLUDE,
  syncPlotPhotos,
  reloadPlotWithPhotos,
  DEFAULT_PAGE_SIZE,
};
