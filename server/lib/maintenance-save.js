import crypto from 'node:crypto';
import { formatMaintenanceRecord, MAINTENANCE_RECORD_SELECT } from '#models/maintenance-record.js';

export function maintenanceFingerprint (body) {
  const serialized = JSON.stringify(body, (_key, value) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return value;
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, value[key]]));
  });
  return crypto.createHash('sha256').update(serialized).digest('hex');
}

export async function replayMaintenanceCreate (prisma, body, reply) {
  const row = await prisma.maintenanceRecord.findUnique({
    where: { submissionId: body.submissionId },
    select: { ...MAINTENANCE_RECORD_SELECT, deletedAt: true, submissionFingerprint: true },
  });
  if (!row) return false;
  if (row.deletedAt) reply.code(410).send({ message: 'This update was deleted. It will not be recreated.' });
  else if (row.submissionFingerprint !== maintenanceFingerprint(body)) reply.code(409).send({ message: 'This draft was saved with different values. Review the garden history before starting another update.' });
  else reply.code(200).send(formatMaintenanceRecord(row));
  return true;
}
