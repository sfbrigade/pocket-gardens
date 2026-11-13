import crypto from 'node:crypto';
import s3 from '#lib/s3.js';
import { PLOT_DETAIL_INCLUDE } from '#models/plot.js';

export function submissionFingerprint (body, fields) {
  const normalized = {
    ...body,
    Latitude: fields.latitude,
    Longitude: fields.longitude,
    'Map Coordinates': fields.mapCoordinates,
    stage: fields.stage,
    permissionStatus: fields.permissionStatus,
  };
  delete normalized.submissionId;
  return crypto.createHash('sha256').update(JSON.stringify(Object.fromEntries(Object.entries(normalized).sort()))).digest('hex');
}

export function findSubmission (prisma, submissionId) {
  if (!submissionId) return null;
  return prisma.plot.findUnique({ where: { submissionId }, include: PLOT_DETAIL_INCLUDE });
}

export async function cleanupSubmissionObjects (keys, log) {
  const results = await Promise.allSettled(keys.map((key) => s3.deleteObject(key)));
  for (const result of results) {
    if (result.status === 'rejected') log.warn({ err: result.reason }, 'Plot storage cleanup could not complete');
  }
}
