import { preparePhotoAttachment } from '#lib/photos.js';
import { uploadFilenamePattern } from '#lib/upload-policy.js';
import MaintenanceRecordPhoto from '#models/maintenance-record-photo.js';
import s3 from '#lib/s3.js';

export async function changeMaintenancePhotos (tx, recordId, photos, assetOptions) {
  const delegate = tx.maintenanceRecordPhoto;
  const existing = await delegate.findMany({ where: { maintenanceRecordId: recordId, pendingRemovalAt: null } });
  const kept = [];
  for (const [position, entry] of photos.entries()) {
    if (entry.id) {
      kept.push(entry.id);
      await delegate.update({ where: { id: entry.id }, data: { position } });
    } else {
      const copy = await preparePhotoAttachment({
        delegate,
        PhotoClass: MaintenanceRecordPhoto,
        data: { maintenanceRecordId: recordId, position },
        filename: entry.upload,
        assetOptions,
      });
      await copy?.();
    }
  }
  await delegate.updateMany({
    where: { id: { in: existing.filter(({ id }) => !kept.includes(id)).map(({ id }) => id) } },
    data: { pendingRemovalAt: new Date() },
  });
}

// Pending photo rows are the retry queue. Never remove them until S3 confirms
// deletion; an already-missing object is also a successful, idempotent delete.
export async function cleanupMaintenancePhotos (prisma, log, { recordId, limit = 100 } = {}) {
  const where = { pendingRemovalAt: { not: null }, ...(recordId && { maintenanceRecordId: recordId }) };
  let removed = 0;
  let after;
  // Walk past failures during scheduled cleanup. A request only processes one batch.
  while (true) {
    const rows = await prisma.maintenanceRecordPhoto.findMany({
      where: { ...where, ...(after && { id: { gt: after } }) },
      select: { id: true, file: true },
      orderBy: { id: 'asc' },
      take: limit,
    });
    for (const row of rows) {
      try {
        if (row.file) await s3.deleteObject(`maintenance_record_photos/${row.id}/file/${row.file}`);
        // API uploads use a unique UUID filename. Finish cleanup of its known
        // staging copy as well if an earlier post-save cleanup was interrupted.
        if (uploadFilenamePattern.test(row.file || '')) await s3.deleteObject(`_uploads/${row.file}`);
        const result = await prisma.maintenanceRecordPhoto.deleteMany({ where: { id: row.id, pendingRemovalAt: { not: null } } });
        removed += result.count;
      } catch (error) { log.warn({ err: error, photoId: row.id }, 'Maintenance photo erasure is pending; retry cleanup'); }
    }
    if (recordId || rows.length < limit) break;
    after = rows.at(-1).id;
  }
  return removed;
}
