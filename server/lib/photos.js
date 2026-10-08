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
 * @param {Array<{id: string}|{upload: string}>} options.photos desired explicit photo entries
 * @returns {Promise<Array<Function|undefined>>}
 */
export async function syncPhotos ({
  delegate,
  PhotoClass,
  parentFk,
  parentId,
  filenames,
  photos,
}) {
  const desired = (photos ?? filenames ?? []).filter((item) => (
    (typeof item === 'object' && item !== null) || (typeof item === 'string' && item.length > 0)
  ));
  const existing = await delegate.findMany({
    where: { [parentFk]: parentId },
    orderBy: { position: 'asc' },
  });

  const handlers = [];
  const keptIds = new Set();

  for (let i = 0; i < desired.length; i += 1) {
    const item = desired[i];
    const id = typeof item === 'object' ? item.id : undefined;
    const filename = typeof item === 'string' ? item : item.upload;
    const match = existing.find((row) => (
      !keptIds.has(row.id) && (id ? row.id === id : typeof item === 'string' && row.file === filename)
    ));
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
    if (id) {
      throw new Error(`Photo ${id} not found`);
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
