import { pick } from 'es-toolkit';

/**
 * Replace-all photo gallery using setAsset (same deferred S3 copy as User.picture).
 *
 * Creates/updates/deletes photo rows on `delegate` immediately. Returns handlers
 * that copy or delete S3 objects; callers must `await runPhotoHandlers(handlers)`
 * inside the same Prisma `$transaction`.
 *
 * @param {object} options
 * @param {object} options.delegate Prisma delegate (e.g. tx.plotPhoto)
 * @param {new (data: object) => { setAsset: Function, changes: Set<string> }} options.PhotoClass
 * @param {string} options.parentFk 'plotId' | 'plantId' | 'maintenanceRecordId'
 * @param {string} options.parentId
 * @param {string[]} options.filenames desired filenames in gallery order
 * @returns {Promise<Array<Function|undefined>>}
 */
export async function syncPhotos ({
  delegate,
  PhotoClass,
  parentFk,
  parentId,
  filenames,
}) {
  const desired = (filenames ?? []).filter((name) => typeof name === 'string' && name.length > 0);
  const existing = await delegate.findMany({
    where: { [parentFk]: parentId },
    orderBy: { position: 'asc' },
  });

  const handlers = [];
  const keptIds = new Set();

  for (let i = 0; i < desired.length; i += 1) {
    const filename = desired[i];
    const match = existing.find((row) => row.file === filename && !keptIds.has(row.id));
    if (match) {
      keptIds.add(match.id);
      if (match.position !== i) {
        await delegate.update({
          where: { id: match.id },
          data: { position: i },
        });
      }
      continue;
    }

    const row = await delegate.create({
      data: { [parentFk]: parentId, position: i },
    });
    const photo = new PhotoClass(row);
    const handler = photo.setAsset('file', filename);
    await delegate.update({
      where: { id: row.id },
      data: pick(row, [...photo.changes]),
    });
    handlers.push(handler);
  }

  for (const row of existing) {
    if (keptIds.has(row.id)) continue;
    const photo = new PhotoClass(row);
    const handler = photo.setAsset('file', null);
    await delegate.delete({ where: { id: row.id } });
    handlers.push(handler);
  }

  return handlers;
}

/**
 * @param {Array<Function|undefined>} handlers
 */
export async function runPhotoHandlers (handlers) {
  for (const handler of handlers) {
    await handler?.();
  }
}
