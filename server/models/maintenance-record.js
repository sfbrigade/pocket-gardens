import crypto from 'node:crypto';
import { PlantCreateFieldsSchema, plantFieldsFromBody } from '#models/plant.js';
import { activities, observations, today } from '#lib/maintenance-policy.js';
import { errorCodes } from 'fastify';
import { z } from 'zod';

import { runPhotoHandlers, syncPhotos } from '#lib/photos.js';
import MaintenanceRecordPhoto from '#models/maintenance-record-photo.js';

const DateSchema = z.iso.date({ error: 'Invalid date' });

const UploadSchema = z.string().regex(
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.[a-z0-9]+$/i,
  'Invalid upload filename'
);
const NewPhotoSchema = z.strictObject({ upload: UploadSchema });
const ExistingPhotoSchema = z.strictObject({ id: z.string().uuid() });

const PlantInputSchema = z.strictObject({
  plantId: z.string().uuid().optional(),
  newPlant: PlantCreateFieldsSchema.pick({ plantName: true, commonName: true, latinName: true }).optional(),
  quantity: z.number().int().positive().max(2147483647).optional(),
}).refine(({ plantId, newPlant }) => !!plantId !== !!newPlant, 'Select an existing plant or explicitly add a new plant');

const PlantsInputSchema = z.array(PlantInputSchema).superRefine((plants, ctx) => {
  const seen = new Set();
  plants.forEach((entry, index) => {
    const key = entry.plantId || JSON.stringify(entry.newPlant);
    if (seen.has(key)) {
      ctx.addIssue({ code: 'custom', message: 'Duplicate plant', path: [index] });
    }
    seen.add(key);
  });
});

function uniquePhotos (schema) {
  return z.array(schema).superRefine((photos, ctx) => {
    const seen = new Set();
    photos.forEach((photo, index) => {
      const key = photo.id ?? photo.upload;
      if (seen.has(key)) {
        ctx.addIssue({ code: 'custom', message: 'Duplicate photo', path: [index] });
      }
      seen.add(key);
    });
  });
}

export const MaintenanceRecordPhotoSchema = z.strictObject({
  id: z.string().uuid(),
  url: z.string(),
});

export const MaintenanceRecordPlantSchema = z.strictObject({
  plantId: z.string().uuid(),
  name: z.string().nullable(),
  quantity: z.number().int().nullable(),
});

export const MaintenanceRecordSchema = z.strictObject({
  id: z.string().uuid(),
  observations: z.array(z.string()),
  credit: z.string(),
  gardenId: z.string().nullable(),
  version: z.number().int(),
  editedAt: z.iso.datetime().nullable(),
  cleanupPending: z.boolean(),
  date: DateSchema.nullable(),
  activity: z.array(z.string()),
  notes: z.string().nullable(),
  planting: z.string().nullable(),
  estNextVisit: DateSchema.nullable(),
  plotId: z.string().uuid().nullable(),
  plotName: z.string().nullable(),
  plotStreetAddress: z.string().nullable(),
  volunteerId: z.string().uuid().nullable(),
  plants: z.array(MaintenanceRecordPlantSchema),
  photos: z.array(MaintenanceRecordPhotoSchema),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});

export const MaintenanceRecordCreateSchema = z.strictObject({
  submissionId: z.string().uuid(),
  date: DateSchema.refine((value) => value <= today(), 'Choose a date no later than today'),
  activity: z.array(z.enum(activities)).default([]),
  observations: z.array(z.enum(observations)).default([]),
  plotId: z.string().min(1).max(100),
  notes: z.string().nullable().optional(),
  planting: z.string().nullable().optional(),
  estNextVisit: DateSchema.nullable().optional(),
  plants: PlantsInputSchema.optional(),
  photos: uniquePhotos(NewPhotoSchema).max(4).optional(),
}).superRefine((body, ctx) => {
  for (const field of ['activity', 'observations']) {
    if (new Set(body[field]).size !== body[field].length) ctx.addIssue({ code: 'custom', path: [field], message: 'Choose each option once' });
  }
  if (body.observations.includes('Nothing stood out') && body.observations.length > 1) ctx.addIssue({ code: 'custom', path: ['observations'], message: 'Nothing stood out cannot be combined with other observations' });
  if (!hasMaintenanceContent(body)) ctx.addIssue({ code: 'custom', path: ['notes'], message: 'Add an activity, observation, photo, or note' });
});

export function hasMaintenanceContent (body) {
  return !!(body.activity?.length || body.observations?.length || body.photos?.length || body.notes?.trim());
}

export const MaintenanceRecordUpdateSchema = z.strictObject({
  version: z.number().int().positive(),
  mutationId: z.string().uuid(),
  date: DateSchema.refine((value) => value <= today(), 'Choose a date no later than today').optional(),
  activity: z.array(z.string().trim().min(1)).optional(),
  observations: z.array(z.enum(observations)).optional(),
  notes: z.string().nullable().optional(),
  planting: z.string().nullable().optional(),
  estNextVisit: DateSchema.nullable().optional(),
  plants: PlantsInputSchema.optional(),
  photos: uniquePhotos(z.union([ExistingPhotoSchema, NewPhotoSchema])).optional(),
}).refine((body) => Object.keys(body).some((key) => !['version', 'mutationId'].includes(key)), {
  message: 'At least one changed field is required', path: ['body'],
});

export const MaintenanceRecordListQuerySchema = z.strictObject({
  pageSize: z.coerce.number().int().min(1).max(100).optional(),
  offset: z.coerce.number().int().nonnegative().optional(),
  plotId: z.union([z.string().uuid(), z.string().regex(/^rec[A-Za-z0-9]+$/i), z.templateLiteral(['pg_', z.uuid()])]).optional(),
  volunteerId: z.string().uuid().optional(),
  from: DateSchema.optional(),
  to: DateSchema.optional(),
}).refine(({ from, to }) => !from || !to || from <= to, {
  message: 'from must be on or before to',
  path: ['from'],
});

export const MAINTENANCE_RECORD_SELECT = {
  id: true,
  observations: true,
  creditKind: true,
  version: true,
  editedAt: true,
  volunteer: { select: { name: true, firstName: true, lastName: true } },
  date: true,
  activity: true,
  notes: true,
  planting: true,
  estNextVisit: true,
  plotId: true,
  plot: {
    select: {
      airtableId: true,
      name: true,
      streetAddress: true,
    },
  },
  volunteerId: true,
  createdAt: true,
  updatedAt: true,
  photos: {
    orderBy: { position: 'asc' },
    select: { id: true, file: true, pendingRemovalAt: true },
  },
  plants: {
    orderBy: { slot: 'asc' },
    select: { plantId: true, quantity: true, plant: { select: { plantName: true, commonName: true, latinName: true } } },
  },
};

function formatDate (date) {
  return date ? new Date(date).toISOString().slice(0, 10) : null;
}

function formatTimestamp (date) {
  return date instanceof Date ? date.toISOString() : date;
}

export function formatMaintenanceRecord (record) {
  if (!record) return record;
  return {
    id: record.id,
    observations: record.observations,
    gardenId: record.plot?.airtableId || null,
    credit: record.creditKind === 'admin' ? 'Pocket Gardens team' : record.creditKind === 'anonymous' ? 'Anonymous' : (record.volunteer?.name || [record.volunteer?.firstName, record.volunteer?.lastName].filter(Boolean).join(' ') || 'Contributor'),
    version: record.version,
    editedAt: record.editedAt ? formatTimestamp(record.editedAt) : null,
    cleanupPending: record.photos.some((photo) => photo.pendingRemovalAt),
    date: formatDate(record.date),
    activity: record.activity,
    notes: record.notes,
    planting: record.planting,
    estNextVisit: formatDate(record.estNextVisit),
    plotId: record.plotId,
    plotName: record.plot?.name ?? null,
    plotStreetAddress: record.plot?.streetAddress ?? null,
    volunteerId: record.volunteerId,
    plants: record.plants.map(({ plantId, quantity, plant }) => ({ plantId, quantity, name: plant?.plantName || plant?.commonName || plant?.latinName || null })),
    photos: record.photos.flatMap((row) => {
      if (row.pendingRemovalAt) return [];
      const url = new MaintenanceRecordPhoto(row).fileUrl;
      return url ? [{ id: row.id, url }] : [];
    }),
    createdAt: formatTimestamp(record.createdAt),
    updatedAt: formatTimestamp(record.updatedAt),
  };
}

export function findMaintenanceRecordById (prisma, id) {
  return prisma.maintenanceRecord.findFirst({
    where: { id, deletedAt: null },
    select: MAINTENANCE_RECORD_SELECT,
  });
}

export function maintenanceRecordFieldsFromBody (body) {
  const data = {};
  for (const field of ['activity', 'observations', 'notes', 'planting', 'plotId', 'volunteerId']) {
    if (body[field] !== undefined) data[field] = body[field];
  }
  if (body.date !== undefined) data.date = new Date(`${body.date}T00:00:00.000Z`);
  if (body.estNextVisit !== undefined) {
    data.estNextVisit = body.estNextVisit === null
      ? null
      : new Date(`${body.estNextVisit}T00:00:00.000Z`);
  }
  return data;
}

function invalidLink (path, message) {
  const error = errorCodes.FST_ERR_VALIDATION();
  error.validation = [{ params: { issue: { path: [path], message } } }];
  return error;
}

export async function validateMaintenanceRecordLinks (tx, body, recordId) {
  if (body.plotId !== undefined && !await tx.plot.findUnique({
    where: { id: body.plotId },
    select: { id: true },
  })) {
    throw invalidLink('plotId', 'Plot not found');
  }
  if (body.volunteerId && !await tx.person.findUnique({
    where: { id: body.volunteerId },
    select: { id: true },
  })) {
    throw invalidLink('volunteerId', 'Volunteer not found');
  }
  const plantIds = body.plants?.flatMap(({ plantId }) => plantId ? [plantId] : []) ?? [];
  if (plantIds.length && await tx.plant.count({
    where: { id: { in: plantIds } },
  }) !== plantIds.length) {
    throw invalidLink('plants', 'Plant not found');
  }
  const photoIds = body.photos?.flatMap((photo) => photo.id ? [photo.id] : []) ?? [];
  if (photoIds.length && await tx.maintenanceRecordPhoto.count({
    where: { maintenanceRecordId: recordId, pendingRemovalAt: null, id: { in: photoIds } },
  }) !== photoIds.length) {
    throw invalidLink('photos', 'Photo does not belong to this maintenance record');
  }
}

export async function syncMaintenanceRecordPlants (tx, recordId, plants) {
  await tx.maintenanceRecordPlant.deleteMany({ where: { maintenanceRecordId: recordId } });
  const rows = [];
  for (const [index, entry] of plants.entries()) {
    const plantId = entry.plantId || (await tx.plant.create({ data: { airtableId: `pg_${crypto.randomUUID()}`, ...plantFieldsFromBody(entry.newPlant) } })).id;
    rows.push({ maintenanceRecordId: recordId, plantId, quantity: entry.quantity, slot: index + 1 });
  }
  if (rows.length) await tx.maintenanceRecordPlant.createMany({ data: rows });
}

export async function syncMaintenanceRecordPhotos (tx, recordId, photos, assetOptions) {
  const handlers = await syncPhotos({
    delegate: tx.maintenanceRecordPhoto,
    PhotoClass: MaintenanceRecordPhoto,
    parentFk: 'maintenanceRecordId',
    parentId: recordId,
    photos,
    assetOptions,
  });
  await runPhotoHandlers(handlers);
}
