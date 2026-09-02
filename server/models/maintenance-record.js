import { errorCodes } from 'fastify';
import { z } from 'zod';

import { runPhotoHandlers, syncPhotos } from '#lib/photos.js';
import MaintenanceRecordPhoto from '#models/maintenance-record-photo.js';

const DateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Invalid date').refine((value) => {
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}, 'Invalid date');

const UploadSchema = z.string().regex(
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.[a-z0-9]+$/i,
  'Invalid upload filename'
);
const NewPhotoSchema = z.strictObject({ upload: UploadSchema });
const ExistingPhotoSchema = z.strictObject({ id: z.string().uuid() });

const ActivitySchema = z.array(z.string().trim().min(1)).min(1).superRefine((activities, ctx) => {
  const seen = new Set();
  activities.forEach((activity, index) => {
    if (seen.has(activity)) {
      ctx.addIssue({ code: 'custom', message: 'Duplicate activity', path: [index] });
    }
    seen.add(activity);
  });
});

const PlantInputSchema = z.strictObject({
  plantId: z.string().uuid(),
  quantity: z.number().int().positive().optional(),
});

const PlantsInputSchema = z.array(PlantInputSchema).superRefine((plants, ctx) => {
  const seen = new Set();
  plants.forEach(({ plantId }, index) => {
    if (seen.has(plantId)) {
      ctx.addIssue({ code: 'custom', message: 'Duplicate plant', path: [index] });
    }
    seen.add(plantId);
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
  quantity: z.number().int().nullable(),
});

export const MaintenanceRecordSchema = z.strictObject({
  id: z.string().uuid(),
  date: z.string().nullable(),
  activity: z.array(z.string()),
  notes: z.string().nullable(),
  planting: z.string().nullable(),
  estNextVisit: z.string().nullable(),
  plotId: z.string().uuid().nullable(),
  volunteerId: z.string().uuid().nullable(),
  plants: z.array(MaintenanceRecordPlantSchema),
  photos: z.array(MaintenanceRecordPhotoSchema),
  createdAt: z.string(),
  updatedAt: z.string(),
});

const OptionalFields = {
  volunteerId: z.string().uuid().nullable().optional(),
  notes: z.string().nullable().optional(),
  planting: z.string().nullable().optional(),
  estNextVisit: DateSchema.nullable().optional(),
};

export const MaintenanceRecordCreateSchema = z.strictObject({
  date: DateSchema,
  activity: ActivitySchema,
  plotId: z.string().uuid(),
  ...OptionalFields,
  plants: PlantsInputSchema.optional(),
  photos: uniquePhotos(NewPhotoSchema).optional(),
});

export const MaintenanceRecordUpdateSchema = z.strictObject({
  date: DateSchema.optional(),
  activity: ActivitySchema.optional(),
  plotId: z.string().uuid().optional(),
  ...OptionalFields,
  plants: PlantsInputSchema.optional(),
  photos: uniquePhotos(z.union([ExistingPhotoSchema, NewPhotoSchema])).optional(),
}).refine((body) => Object.keys(body).length > 0, {
  message: 'At least one field is required',
  path: ['body'],
});

export const MaintenanceRecordListQuerySchema = z.strictObject({
  pageSize: z.coerce.number().int().min(1).max(100).optional(),
  offset: z.coerce.number().int().nonnegative().optional(),
  plotId: z.string().uuid().optional(),
  volunteerId: z.string().uuid().optional(),
  from: DateSchema.optional(),
  to: DateSchema.optional(),
}).refine(({ from, to }) => !from || !to || from <= to, {
  message: 'from must be on or before to',
  path: ['from'],
});

export const MAINTENANCE_RECORD_INCLUDE = {
  photos: { orderBy: { position: 'asc' } },
  plants: { orderBy: { slot: 'asc' } },
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
    date: formatDate(record.date),
    activity: record.activity,
    notes: record.notes,
    planting: record.planting,
    estNextVisit: formatDate(record.estNextVisit),
    plotId: record.plotId,
    volunteerId: record.volunteerId,
    plants: record.plants.map(({ plantId, quantity }) => ({ plantId, quantity })),
    photos: record.photos.flatMap((row) => {
      const url = new MaintenanceRecordPhoto(row).fileUrl;
      return url ? [{ id: row.id, url }] : [];
    }),
    createdAt: formatTimestamp(record.createdAt),
    updatedAt: formatTimestamp(record.updatedAt),
  };
}

export function findMaintenanceRecordById (prisma, id) {
  return prisma.maintenanceRecord.findUnique({
    where: { id },
    include: MAINTENANCE_RECORD_INCLUDE,
  });
}

export function maintenanceRecordFieldsFromBody (body) {
  const data = {};
  for (const field of ['activity', 'notes', 'planting', 'plotId', 'volunteerId']) {
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
  if (body.plotId !== undefined && !await tx.plot.findUnique({ where: { id: body.plotId } })) {
    throw invalidLink('plotId', 'Plot not found');
  }
  if (body.volunteerId && !await tx.person.findUnique({ where: { id: body.volunteerId } })) {
    throw invalidLink('volunteerId', 'Volunteer not found');
  }
  if (body.plants?.length && await tx.plant.count({
    where: { id: { in: body.plants.map(({ plantId }) => plantId) } },
  }) !== body.plants.length) {
    throw invalidLink('plants', 'Plant not found');
  }
  const photoIds = body.photos?.flatMap((photo) => photo.id ? [photo.id] : []) ?? [];
  if (photoIds.length && await tx.maintenanceRecordPhoto.count({
    where: { maintenanceRecordId: recordId, id: { in: photoIds } },
  }) !== photoIds.length) {
    throw invalidLink('photos', 'Photo does not belong to this maintenance record');
  }
}

export async function syncMaintenanceRecordPlants (tx, recordId, plants) {
  await tx.maintenanceRecordPlant.deleteMany({ where: { maintenanceRecordId: recordId } });
  if (plants.length) {
    await tx.maintenanceRecordPlant.createMany({
      data: plants.map(({ plantId, quantity }, index) => ({
        maintenanceRecordId: recordId,
        plantId,
        quantity,
        slot: index + 1,
      })),
    });
  }
}

export async function syncMaintenanceRecordPhotos (tx, recordId, photos) {
  const handlers = await syncPhotos({
    delegate: tx.maintenanceRecordPhoto,
    PhotoClass: MaintenanceRecordPhoto,
    parentFk: 'maintenanceRecordId',
    parentId: recordId,
    photos,
  });
  await runPhotoHandlers(handlers);
}
