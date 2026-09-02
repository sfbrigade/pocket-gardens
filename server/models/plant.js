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
  airtableId: z.string(),
  createdAt: z.string(),
  plantName: z.string().optional().nullable(),
  latinName: z.string().optional().nullable(),
  commonName: z.string().optional().nullable(),
  locations: z.string().optional().nullable(),
  numberPlanted: z.number().int().optional().nullable(),
  photos: z.array(PlantPhotoSchema),
});

export const PlantCreateFieldsSchema = z.strictObject({
  plantName: NameSchema,
  latinName: NameSchema.optional(),
  commonName: NameSchema.optional(),
  locations: NameSchema.optional(),
  numberPlanted: z.number().int().nonnegative().optional(),
  photos: uniquePhotos(NewPhotoSchema).optional(),
});

export const PlantUpdateFieldsSchema = z.strictObject({
  plantName: NameSchema.nullable().optional(),
  latinName: NameSchema.nullable().optional(),
  commonName: NameSchema.nullable().optional(),
  locations: NameSchema.nullable().optional(),
  numberPlanted: z.number().int().nonnegative().nullable().optional(),
  photos: uniquePhotos(z.union([ExistingPhotoSchema, NewPhotoSchema])).optional(),
}).refine((body) => Object.keys(body).length > 0, {
  message: 'At least one field is required',
  path: ['body'],
});

const PLANT_BODY_FIELDS = [
  'plantName',
  'latinName',
  'commonName',
  'locations',
  'numberPlanted',
];

function isoDate (value) {
  if (value instanceof Date) return value.toISOString();
  return value ?? undefined;
}

/**
 * Format a Prisma Plant row for the public API.
 * Omits internal FKs/cache fields and turns photo rows into asset URLs.
 */
export function formatPlant (plant) {
  if (!plant) return plant;
  return {
    id: plant.id,
    airtableId: plant.airtableId,
    createdAt: isoDate(plant.createdAt),
    plantName: plant.plantName,
    latinName: plant.latinName,
    commonName: plant.commonName,
    locations: plant.locations,
    numberPlanted: plant.numberPlanted,
    photos: formatPlantPhotos(plant.photos),
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
 * Pick writable Plant columns from a request body.
 */
export function plantFieldsFromBody (body = {}) {
  const data = {};
  for (const key of PLANT_BODY_FIELDS) {
    if (body[key] !== undefined) data[key] = body[key];
  }
  return data;
}
