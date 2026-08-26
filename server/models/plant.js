import { z } from 'zod';

import { runPhotoHandlers, syncPhotos } from '#lib/photos.js';
import PlantPhoto from '#models/plant-photo.js';
import {
  decodeListOffset,
  DEFAULT_PAGE_SIZE,
  encodeListOffset,
  isUuid,
} from '#models/plot.js';

export { decodeListOffset, DEFAULT_PAGE_SIZE, encodeListOffset, isUuid };

export const PlantSchema = z.object({
  id: z.string().uuid(),
  createdTime: z.string(),
  'Plant Name': z.string().optional().nullable(),
  'Latin Name': z.string().optional().nullable(),
  'Common Name': z.string().optional().nullable(),
  Locations: z.string().optional().nullable(),
  'Number Planted': z.number().int().optional().nullable(),
  Photos: z.array(z.string()).optional(),
}).passthrough();

export const PlantFieldsSchema = z.object({
  'Plant Name': z.string().optional(),
  'Latin Name': z.string().optional(),
  'Common Name': z.string().optional(),
  Locations: z.string().optional(),
  'Number Planted': z.number().int().optional(),
  Photos: z.array(z.string()).optional(),
}).passthrough();

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
  if (!Array.isArray(photos) || photos.length === 0) return undefined;
  const urls = photos.map((row) => new PlantPhoto(row).fileUrl).filter(Boolean);
  return urls.length ? urls : undefined;
}

/**
 * Persist a Photos filename list with setAsset, then reload the plant with photos.
 */
export async function syncPlantPhotos (tx, plantId, filenames) {
  const handlers = await syncPhotos({
    delegate: tx.plantPhoto,
    PhotoClass: PlantPhoto,
    parentFk: 'plantId',
    parentId: plantId,
    filenames,
  });
  await runPhotoHandlers(handlers);
}

export function reloadPlantWithPhotos (tx, id) {
  return tx.plant.findUnique({
    where: { id },
    include: PLANT_PHOTOS_INCLUDE,
  });
}

/**
 * Look up a Plant by Postgres UUID.
 */
export function findPlantById (prisma, id) {
  if (!isUuid(id)) return null;
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

export default {
  PlantSchema,
  PlantFieldsSchema,
  formatPlant,
  findPlantById,
  plantFieldsFromBody,
  PLANT_PHOTOS_INCLUDE,
  syncPlantPhotos,
  reloadPlantWithPhotos,
  DEFAULT_PAGE_SIZE,
  encodeListOffset,
  decodeListOffset,
  isUuid,
};
