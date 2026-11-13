export const uploadUrlSeconds = 15 * 60;
export const dayMs = 24 * 60 * 60 * 1000;

export function uploadRetentionDays () {
  const days = Number(process.env.PHOTO_UPLOAD_RETENTION_DAYS ?? 7);
  if (!Number.isInteger(days) || days < 1 || days > 365) throw new Error('PHOTO_UPLOAD_RETENTION_DAYS must be an integer from 1 to 365');
  return days;
}

export function uploadExpiresAt (issuedAt = new Date()) {
  return new Date(issuedAt.getTime() + uploadRetentionDays() * dayMs);
}

export class PhotoUnavailable extends Error {
  constructor () {
    super('This photo is missing or has expired. Reattach it or continue without a photo.');
  }
}
