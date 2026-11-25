import crypto from 'node:crypto';
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
  if (body.carerUserIds?.length) normalized.carerUserIds = [...body.carerUserIds].sort();
  else delete normalized.carerUserIds;
  return crypto.createHash('sha256').update(JSON.stringify(Object.fromEntries(Object.entries(normalized).sort()))).digest('hex');
}

export function findSubmission (prisma, submissionId) {
  if (!submissionId) return null;
  return prisma.plot.findUnique({ where: { submissionId }, include: PLOT_DETAIL_INCLUDE });
}
