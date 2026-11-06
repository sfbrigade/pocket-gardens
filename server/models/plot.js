import { errorCodes } from 'fastify';
import { z } from 'zod';

import { parseMapCoordinates } from '#lib/airtable-schema.js';
import { firstPlantedIssue, PLOT_STAGES } from '#lib/plot-lifecycle.js';
import { runPhotoHandlers, syncPhotos } from '#lib/photos.js';
import PlotPhoto from '#models/plot-photo.js';

export const PlotStageSchema = z.enum(PLOT_STAGES);
export const PermissionStatusSchema = z.enum(['unknown', 'needed', 'progress', 'confirmed', 'not_required', 'not_granted']);
const SunExposureSchema = z.enum(['Full sun', 'Partial sun', 'Shade', 'Unknown']);

export const PlotSchema = z.strictObject({
  id: z.string(),
  createdTime: z.string(),
  Latitude: z.number().optional().nullable(),
  Longitude: z.number().optional().nullable(),
  stage: PlotStageSchema.optional().nullable(),
  'Bed Type': z.string().optional().nullable(),
  'Pocket Garden Name': z.string().optional().nullable(),
  'Street Address': z.string().optional().nullable(),
  'Map Coordinates': z.string().optional().nullable(),
  Photos: z.array(z.string()).optional(),
});

export const PlotDetailSchema = PlotSchema.extend({
  'Street City Address (for Maps)': z.string().optional(),
  'Soil Type': z.string().optional(),
  'Bed ID': z.string().optional(),
  'Visit Interval (Days)': z.number().optional(),
  'Est. Area (Sq. Ft)': z.number().optional(),
  'Location Description': z.string().optional(),
  permissionStatus: PermissionStatusSchema.nullable(),
  sunExposure: SunExposureSchema.nullable(),
  environmentalNotes: z.string().nullable(),
  firstPlanted: z.iso.date().nullable(),
  Alert: z.string().optional(),
  'Next Visit': z.string().optional(),
  assignedVolunteers: z.array(z.strictObject({ id: z.string().uuid(), displayName: z.string() })),
});

export const PlotFieldsSchema = z.strictObject({
  Latitude: z.number().min(-90).max(90).optional(),
  Longitude: z.number().min(-180).max(180).optional(),
  stage: PlotStageSchema.optional(),
  permissionStatus: PermissionStatusSchema.optional(),
  sunExposure: SunExposureSchema.optional(),
  environmentalNotes: z.string().trim().optional(),
  firstPlanted: z.iso.date().nullable().optional(),
  'Bed Type': z.string().optional(),
  'Pocket Garden Name': z.string().trim().optional(),
  'Street Address': z.string().trim().optional(),
  'Street City Address (for Maps)': z.string().trim().optional(),
  'Map Coordinates': z.string().optional(),
  'Soil Type': z.string().optional(),
  'Bed ID': z.string().optional(),
  'Visit Interval (Days)': z.number().int().optional(),
  'Est. Area (Sq. Ft)': z.number().nonnegative().optional(),
  'Location Description': z.string().trim().optional(),
  "Seth's Notes": z.string().optional(),
  Photos: z.array(z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.[a-z0-9]+$/i, 'Invalid upload filename')).optional(),
});

export const PlotCreateSchema = PlotFieldsSchema.extend({
  stage: z.enum(['potential', 'preparing', 'active']).default('potential'),
  permissionStatus: PermissionStatusSchema.default('unknown'),
  'Location Description': z.string().trim().min(1, 'Describe exactly where the plot is'),
}).superRefine((body, ctx) => {
  const parsed = parseMapCoordinates(body['Map Coordinates']);
  const latitude = body.Latitude ?? parsed.latitude;
  const longitude = body.Longitude ?? parsed.longitude;
  if (!Number.isFinite(latitude) || Math.abs(latitude) > 90) {
    ctx.addIssue({ code: 'custom', path: ['Latitude'], message: 'Set a valid map latitude' });
  }
  if (!Number.isFinite(longitude) || Math.abs(longitude) > 180) {
    ctx.addIssue({ code: 'custom', path: ['Longitude'], message: 'Set a valid map longitude' });
  }
  const issue = firstPlantedIssue(body.stage, body.firstPlanted);
  if (issue) ctx.addIssue(issue);
});

export const PlotUpdateSchema = PlotFieldsSchema.refine((body) => Object.keys(body).length > 0, {
  message: 'At least one field is required',
  path: ['body'],
});

export function allowsAnonymousPlotCreation (env = process.env) {
  return env.NODE_ENV === 'development' && env.ALLOW_ANONYMOUS_PLOT_SUBMISSION === 'true';
}

/**
 * Format a Prisma Plot row for the public API.
 * `id` remains the Airtable record id for transition compatibility.
 * API-created plots use a synthetic `pg_<uuid>` airtableId.
 */
export function formatPlotSummary (plot) {
  if (!plot) return plot;
  const createdTime = plot.createdAt instanceof Date
    ? plot.createdAt.toISOString()
    : (plot.createdTime || plot.createdAt);
  return {
    id: plot.airtableId || plot.id,
    createdTime,
    Latitude: plot.latitude ?? undefined,
    Longitude: plot.longitude ?? undefined,
    stage: plot.stage ?? null,
    'Bed Type': plot.bedType ?? undefined,
    'Pocket Garden Name': plot.name ?? undefined,
    'Street Address': plot.streetAddress ?? undefined,
    'Map Coordinates': plot.mapCoordinates ?? undefined,
    Photos: formatPlotPhotos(plot.photos),
  };
}

export function formatPlot (plot) {
  if (!plot) return plot;
  return {
    ...formatPlotSummary(plot),
    'Street City Address (for Maps)': plot.streetCityAddress ?? undefined,
    'Soil Type': plot.soilType ?? undefined,
    'Bed ID': plot.bedId ?? undefined,
    'Visit Interval (Days)': plot.visitIntervalDays ?? undefined,
    'Est. Area (Sq. Ft)': plot.estAreaSqFt ?? undefined,
    'Location Description': plot.locationDescription ?? undefined,
    permissionStatus: plot.permissionStatus ?? null,
    sunExposure: plot.sunExposure ?? null,
    environmentalNotes: plot.environmentalNotes ?? null,
    firstPlanted: plot.originalPlantDate ? new Date(plot.originalPlantDate).toISOString().slice(0, 10) : null,
    Alert: plot.alert ?? undefined,
    'Next Visit': plot.nextVisit ?? undefined,
    assignedVolunteers: (plot.assignedVolunteers ?? []).map(({ person }) => ({
      id: person.id,
      displayName: person.name || [person.firstName, person.lastName].filter(Boolean).join(' ') || 'Volunteer',
    })),
  };
}

export const PLOT_PHOTOS_INCLUDE = {
  photos: { orderBy: { position: 'asc' } },
};

export const PLOT_DETAIL_INCLUDE = {
  ...PLOT_PHOTOS_INCLUDE,
  assignedVolunteers: {
    orderBy: { personId: 'asc' },
    include: { person: { select: { id: true, name: true, firstName: true, lastName: true } } },
  },
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
    include: PLOT_DETAIL_INCLUDE,
  });
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid (value) {
  return typeof value === 'string' && UUID_RE.test(value);
}

/**
 * Look up a Plot by public id (Airtable record id or internal UUID).
 */
export function findPlotByPublicId (prisma, id, { select } = {}) {
  return prisma.plot.findFirst({
    where: {
      OR: [
        { airtableId: id },
        ...(isUuid(id) ? [{ id }] : []),
      ],
    },
    ...(select ? { select } : { include: PLOT_DETAIL_INCLUDE }),
  });
}

/**
 * Map Airtable-shaped request body fields onto Prisma Plot columns.
 */
export function plotFieldsFromBody (body = {}, existing) {
  const data = {};
  if (body.stage !== undefined) data.stage = body.stage;
  if (body.permissionStatus !== undefined) data.permissionStatus = body.permissionStatus;
  if (body.sunExposure !== undefined) data.sunExposure = body.sunExposure;
  if (body.environmentalNotes !== undefined) data.environmentalNotes = body.environmentalNotes;
  if (body.firstPlanted !== undefined) {
    const issue = firstPlantedIssue(body.stage ?? existing?.stage, body.firstPlanted);
    if (issue) throw invalidPlotField(issue.path[0], issue.message);
    data.originalPlantDate = body.firstPlanted ? new Date(`${body.firstPlanted}T00:00:00.000Z`) : null;
  }
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

function invalidPlotField (path, message) {
  const error = errorCodes.FST_ERR_VALIDATION();
  error.validation = [{ params: { issue: { path: [path], message } } }];
  return error;
}

export function buildViewportWhere ({ north, south, east, west }) {
  return {
    latitude: { gte: south, lte: north },
    longitude: { gte: west, lte: east },
  };
}

export default {
  PlotSchema,
  PlotFieldsSchema,
  formatPlot,
  formatPlotSummary,
  findPlotByPublicId,
  isUuid,
  plotFieldsFromBody,
  buildViewportWhere,
  PLOT_PHOTOS_INCLUDE,
  syncPlotPhotos,
  reloadPlotWithPhotos,
};
