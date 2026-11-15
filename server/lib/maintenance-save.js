import crypto from 'node:crypto';
import { findMaintenanceRecordById, formatMaintenanceRecord } from '#models/maintenance-record.js';

export function maintenanceFingerprint (body) {
  const stable = (value) => Array.isArray(value) ? value.map(stable) : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])])) : value;
  return crypto.createHash('sha256').update(JSON.stringify(stable(body))).digest('hex');
}

export async function replayMaintenanceCreate (prisma, body, reply) {
  const row = await prisma.maintenanceRecord.findUnique({ where: { submissionId: body.submissionId } });
  if (!row) return false;
  if (row.deletedAt) reply.code(410).send({ message: 'This update was deleted. It will not be recreated.' });
  else if (row.submissionFingerprint !== maintenanceFingerprint(body)) reply.code(409).send({ message: 'This draft was saved with different values. Review the garden history before starting another update.' });
  else reply.code(200).send(formatMaintenanceRecord(await findMaintenanceRecordById(prisma, row.id)));
  return true;
}
