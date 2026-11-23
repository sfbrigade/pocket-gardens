import { z } from 'zod';

export const photoTypes = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif' };
export const maxPhotoBytes = 10 * 1024 * 1024;
export const uploadsPerHour = 30;

export const uploadUrlSeconds = 15 * 60;

export const uploadFilenamePattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.[a-z0-9]+$/i;
export const UploadFilenameSchema = z.string().regex(uploadFilenamePattern, 'Invalid upload filename');
export const NewPhotoSchema = z.strictObject({ upload: UploadFilenameSchema });
export const ExistingPhotoSchema = z.strictObject({ id: z.string().uuid() });

export function uniquePhotos (schema) {
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
