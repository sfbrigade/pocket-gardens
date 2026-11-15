import MaintenanceRecordPhoto from '#models/maintenance-record-photo.js';
import s3 from '#lib/s3.js';

export async function changeMaintenancePhotos (tx, recordId, photos, assetOptions) {
  const existing = await tx.maintenanceRecordPhoto.findMany({ where: { maintenanceRecordId: recordId, pendingRemovalAt: null } });
  const kept = [];
  for (const [position, entry] of photos.entries()) {
    if (entry.id) {
      kept.push(entry.id);
      await tx.maintenanceRecordPhoto.update({ where: { id: entry.id }, data: { position } });
    } else {
      const row = await tx.maintenanceRecordPhoto.create({ data: { maintenanceRecordId: recordId, position } });
      const photo = new MaintenanceRecordPhoto(row);
      const copy = photo.setAsset('file', entry.upload, assetOptions);
      await tx.maintenanceRecordPhoto.update({ where: { id: row.id }, data: { file: row.file } });
      await copy?.();
    }
  }
  await tx.maintenanceRecordPhoto.updateMany({
    where: { id: { in: existing.filter(({ id }) => !kept.includes(id)).map(({ id }) => id) } },
    data: { pendingRemovalAt: new Date() },
  });
}

// Pending photo rows are the retry queue. Never remove them until S3 confirms
// deletion; an already-missing object is also a successful, idempotent delete.
export async function cleanupMaintenancePhotos (prisma, log, { recordId, limit = 100 } = {}) {
  const rows = await prisma.maintenanceRecordPhoto.findMany({
    where: { pendingRemovalAt: { not: null }, ...(recordId && { maintenanceRecordId: recordId }) },
    orderBy: [{ pendingRemovalAt: 'asc' }, { id: 'asc' }],
    take: limit,
  });
  let removed = 0;
  for (const row of rows) {
    try {
      if (row.file) await s3.deleteObject(`maintenance_record_photos/${row.id}/file/${row.file}`);
      // API uploads use a unique UUID filename. Finish cleanup of its known
      // staging copy as well if an earlier post-save cleanup was interrupted.
      if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.[a-z0-9]+$/i.test(row.file || '')) await s3.deleteObject(`_uploads/${row.file}`);
      await prisma.maintenanceRecordPhoto.deleteMany({ where: { id: row.id, pendingRemovalAt: { not: null } } });
      removed += 1;
    } catch (error) { log.warn({ err: error, photoId: row.id }, 'Maintenance photo erasure is pending; retry cleanup'); }
  }
  return { removed, pending: await prisma.maintenanceRecordPhoto.count({ where: { pendingRemovalAt: { not: null }, ...(recordId && { maintenanceRecordId: recordId }) } }) };
}
