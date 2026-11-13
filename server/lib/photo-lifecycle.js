import s3 from '#lib/s3.js';
import { dayMs, PhotoUnavailable, uploadExpiresAt, uploadRetentionDays } from '#lib/upload-policy.js';

// Lock upload tokens in deterministic order for the entire save transaction.
// Imports stage directly, so an untracked filename is admitted only while its
// actual object is recent. No shared asset consumer has to change its contract.
export async function lockPlotUploads (prisma, tx, filenames) {
  for (const filename of [...new Set(filenames)].sort()) {
    await prisma.assetUpload.upsert({ where: { filename }, create: { filename, expiresAt: uploadExpiresAt() }, update: {} });
    const [upload] = await tx.$queryRaw`SELECT * FROM "AssetUpload" WHERE "filename" = ${filename} FOR UPDATE`;
    const object = await s3.headObject(`_uploads/${filename}`);
    if (upload.expiresAt <= new Date() || !object || object.LastModified <= new Date(Date.now() - uploadRetentionDays() * dayMs)) {
      throw new PhotoUnavailable();
    }
  }
}

export async function recordCopyIntent (prisma, tx, key) {
  const upload = key.split('/').at(-1);
  await prisma.photoCopyIntent.create({ data: { key, upload, nextCheckAt: new Date(Date.now() + 60 * 60 * 1000) } });
  const [intent] = await tx.$queryRaw`SELECT * FROM "PhotoCopyIntent" WHERE "key" = ${key} FOR UPDATE`;
  if (intent.retired) throw new Error('Photo copy was retired before saving');
}

// Only this narrow namespace is tracked. Never infer ownership by scanning
// permanent storage: legacy/imported objects without intents are untouched.
async function referenced (tx, key) {
  const match = /^plot_photos\/([0-9a-f-]+)\/file\/([^/]+)$/i.exec(key);
  if (!match) throw new Error(`Unrecognized copy intent: ${key}`);
  return !!(await tx.plotPhoto.findFirst({ where: { id: match[1], file: match[2] } }));
}

export async function reconcilePhotoCopies (prisma, { dryRun = true, now = new Date(), versioned = false, report = () => {} } = {}) {
  const summary = { retained: 0, deleted: 0, skipped: 0, failed: 0 };
  // Keyset pagination bounds memory and includes failed/retired work on later runs.
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
          if (!dryRun && !keep) await tx.photoCopyIntent.update({ where: { key: intent.key }, data: { retired: true } });
          return keep ? 'retain' : 'delete';
        });
        if (action === 'skip') { summary.skipped++; continue; }
        report({ key: intent.key, action, dryRun });
        if (!dryRun) {
          if (action === 'delete') await s3.purgeObject(intent.key, versioned);
          await prisma.photoCopyIntent.update({ where: { key: intent.key }, data: { checks: { increment: 1 }, lastError: null, nextCheckAt: new Date(now.getTime() + dayMs) } });
        }
        summary[action === 'retain' ? 'retained' : 'deleted']++;
      } catch (error) {
        summary.failed++;
        report({ key: intent.key, action: 'retry', error: error.message });
        // If this write also fails, exit nonzero. The original intent survives.
        if (!dryRun) await prisma.photoCopyIntent.update({ where: { key: intent.key }, data: { lastError: error.message, checks: { increment: 1 } } });
      }
    }
    cursor = intents.at(-1).key;
  }
  return summary;
}

async function * stagingCandidates (versioned) {
  if (!versioned) { yield * s3.listObjects('_uploads/'); return; }
  // Finish listing every version of a key before deleting any of them. Deleting
  // the version used as a continuation marker before fetching the next page can
  // invalidate provider pagination. Grouping also checks each key only once.
  let candidate;
  for await (const object of s3.listVersions('_uploads/')) {
    if (candidate && object.Key !== candidate.Key) { yield candidate; candidate = undefined; }
    if (!candidate || object.LastModified < candidate.LastModified) candidate = object;
  }
  if (candidate) yield candidate;
}

export async function expireStagingUploads (prisma, { dryRun = true, now = new Date(), versioned = false, report = () => {} } = {}) {
  const cutoff = new Date(now.getTime() - uploadRetentionDays() * dayMs);
  const summary = { deleted: 0, retained: 0, failed: 0 };
  // Version listing also finds keys whose only current entry is a delete marker.
  const objects = stagingCandidates(versioned);
  for await (const object of objects) {
    const key = object.Key;
    if (!key?.startsWith('_uploads/') || key.slice(9).includes('/') || !object.LastModified || object.LastModified > cutoff) continue;
    try {
      await prisma.$transaction(async (tx) => {
        const filename = key.slice(9);
        const [upload] = await tx.$queryRaw`SELECT * FROM "AssetUpload" WHERE "filename" = ${filename} FOR UPDATE SKIP LOCKED`;
        // Distinguish a locked token from an untracked import.
        if (!upload && await tx.assetUpload.findUnique({ where: { filename } })) { summary.retained++; return; }
        const current = await s3.headObject(key);
        if ((upload && upload.expiresAt > now) || (current?.LastModified > cutoff)) { summary.retained++; return; }
        report({ key, action: 'expire', dryRun });
        if (!dryRun) await s3.purgeObject(key, versioned);
        summary.deleted++;
      }, { timeout: 60000 });
    } catch (error) {
      summary.failed++;
      report({ key, action: 'retry', error: error.message });
    }
  }
  return summary;
}
