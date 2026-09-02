import { z } from 'zod';

import { runPhotoHandlers, syncPhotos } from '#lib/photos.js';
import PlantPhoto from '#models/plant-photo.js';

const NameSchema = z.string().trim().min(1);
const UploadSchema = z.string().regex(
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.[a-z0-9]+$/i,
  'Invalid upload filename'
);
const NewPhotoSchema = z.strictObject({ upload: UploadSchema });
const ExistingPhotoSchema = z.strictObject({ id: z.string().uuid() });

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

export const PlantPhotoSchema = z.strictObject({
  id: z.string().uuid(),
  url: z.string(),
});

export const PlantSchema = z.object({
  id: z.string().uuid(),
  createdTime: z.string(),
  'Plant Name': z.string().optional().nullable(),
  'Latin Name': z.string().optional().nullable(),
  'Common Name': z.string().optional().nullable(),
  Locations: z.string().optional().nullable(),
  'Number Planted': z.number().int().optional().nullable(),
  Photos: z.array(PlantPhotoSchema),
});

export const PlantCreateFieldsSchema = z.strictObject({
  'Plant Name': NameSchema,
  'Latin Name': NameSchema.optional(),
  'Common Name': NameSchema.optional(),
  Locations: NameSchema.optional(),
  'Number Planted': z.number().int().nonnegative().optional(),
  Photos: uniquePhotos(NewPhotoSchema).optional(),
});

export const PlantUpdateFieldsSchema = z.strictObject({
  'Plant Name': NameSchema.nullable().optional(),
  'Latin Name': NameSchema.nullable().optional(),
  'Common Name': NameSchema.nullable().optional(),
  Locations: NameSchema.nullable().optional(),
  'Number Planted': z.number().int().nonnegative().nullable().optional(),
  Photos: uniquePhotos(z.union([ExistingPhotoSchema, NewPhotoSchema])).optional(),
}).refine((body) => Object.keys(body).length > 0, {
  message: 'At least one field is required',
  path: ['body'],
});

/**
 * Format a Prisma Plant row for the public API.
 * Public `id` is the Postgres UUID.
 */
export function formatPlant (plant) {
  if (!plant) return plant;
  const createdTime = plant.createdAt instanceof Date
    ? plant.createdAt.toISOString()
    : (plant.createdTime || plant.createdAt);
  return {
    id: plant.id,
    createdTime,
    'Plant Name': plant.plantName ?? undefined,
    'Latin Name': plant.latinName ?? undefined,
    'Common Name': plant.commonName ?? undefined,
    Locations: plant.locations ?? undefined,
    'Number Planted': plant.numberPlanted ?? undefined,
    Photos: formatPlantPhotos(plant.photos),
  };
}

export const PLANT_PHOTOS_INCLUDE = {
  photos: { orderBy: { position: 'asc' } },
};

function formatPlantPhotos (photos) {
  if (!Array.isArray(photos)) return [];
  return photos.flatMap((row) => {
    const url = new PlantPhoto(row).fileUrl;
    return url ? [{ id: row.id, url }] : [];
  });
}

/**
 * Persist an ordered list of retained photo ids and new upload tokens.
 */
export async function syncPlantPhotos (tx, plantId, photos) {
  const handlers = await syncPhotos({
    delegate: tx.plantPhoto,
    PhotoClass: PlantPhoto,
    parentFk: 'plantId',
    parentId: plantId,
    photos,
  });
  await runPhotoHandlers(handlers);
}

/**
 * Look up a Plant by Postgres UUID.
 */
export function findPlantById (prisma, id) {
  return prisma.plant.findUnique({
    where: { id },
    include: PLANT_PHOTOS_INCLUDE,
  });
}

/**
 * Map request body fields onto Prisma Plant columns.
 */
export function plantFieldsFromBody (body = {}) {
  const data = {};
  if (body['Plant Name'] !== undefined) data.plantName = body['Plant Name'];
  if (body['Latin Name'] !== undefined) data.latinName = body['Latin Name'];
  if (body['Common Name'] !== undefined) data.commonName = body['Common Name'];
  if (body.Locations !== undefined) data.locations = body.Locations;
  if (body['Number Planted'] !== undefined) data.numberPlanted = body['Number Planted'];
  return data;
}
