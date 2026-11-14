import { randomUUID } from 'node:crypto';
import s3 from '#lib/s3.js';

// All durable preparation finishes before acquiring the save connection. No
// outer-client query may run while that transaction holds a pooled connection.
export async function preparePlotPhotos (prisma, filenames) {
  const photos = filenames.map((upload) => {
    const id = randomUUID();
    return { id, key: `plot_photos/${id}/file/${upload}` };
  });
  if (photos.length) {
    await prisma.photoCopyIntent.createMany({ data: photos.map(({ key }) => ({ key, nextCheckAt: new Date(Date.now() + 60 * 60 * 1000) })) });
  }
  return photos.map(({ id }) => id);
}

export async function lockCopyIntent (tx, key) {
  const [intent] = await tx.$queryRaw`SELECT * FROM "PhotoCopyIntent" WHERE "key" = ${key} FOR UPDATE`;
  if (!intent || intent.retired) throw new Error('Photo copy is not available for saving');
}

// Only this narrow namespace is tracked. Never infer ownership by scanning
// permanent storage: legacy/imported objects without intents are untouched.
async function referenced (tx, key) {
  const match = /^plot_photos\/([0-9a-f-]+)\/file\/([^/]+)$/i.exec(key);
  if (!match) throw new Error(`Unrecognized copy intent: ${key}`);
  return !!(await tx.plotPhoto.findFirst({ where: { id: match[1], file: match[2] } }));
}

export async function reconcilePhotoCopies (prisma, { dryRun = true, now = new Date(), report = () => {} } = {}) {
  const summary = { retained: 0, deleted: 0, skipped: 0, failed: 0 };
  // Resolved records leave the queue; keyset pagination also works after deletion.
  let cursor;
  while (true) {
    const intents = await prisma.photoCopyIntent.findMany({ where: { nextCheckAt: { lte: now }, ...(cursor ? { key: { gt: cursor } } : {}) }, orderBy: { key: 'asc' }, take: 100 });
    if (!intents.length) break;
    for (const intent of intents) {
      try {
        const action = await prisma.$transaction(async (tx) => {
          const [locked] = await tx.$queryRaw`SELECT * FROM "PhotoCopyIntent" WHERE "key" = ${intent.key} FOR UPDATE SKIP LOCKED`;
          if (!locked) return 'skip';
          // A locking read cannot pass an active save's COMMIT. A database
          // outage aborts cleanup. Fence future copies durably before issuing
          // a delete that could outlive this database connection.
          const keep = await referenced(tx, intent.key);
          if (!dryRun) {
            if (keep) await tx.photoCopyIntent.delete({ where: { key: intent.key } });
            else await tx.photoCopyIntent.update({ where: { key: intent.key }, data: { retired: true } });
          }
          return keep ? 'retain' : 'delete';
        });
        if (action === 'skip') { summary.skipped++; continue; }
        report({ key: intent.key, action, dryRun });
        if (!dryRun && action === 'delete') {
          await s3.deleteObject(intent.key);
          await prisma.photoCopyIntent.deleteMany({ where: { key: intent.key } });
        }
        summary[action === 'retain' ? 'retained' : 'deleted']++;
      } catch (error) {
        summary.failed++;
        report({ key: intent.key, action: 'retry', error: error.message });
        // If this write also fails, exit nonzero. The original intent survives.
        if (!dryRun) await prisma.photoCopyIntent.updateMany({ where: { key: intent.key }, data: { lastError: error.message, checks: { increment: 1 } } });
      }
    }
    cursor = intents.at(-1).key;
  }
  return summary;
}
