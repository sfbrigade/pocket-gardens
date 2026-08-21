#!/usr/bin/env node

/**
 * Download Plot / Plant / Maintenance photos from Airtable, stage them in
 * `_uploads/`, and attach via setAsset onto the photo tables.
 *
 * Usage:
 *   bin/migrate-plot-photos.js [--dry-run] [--limit=N] [--force]
 *
 * Env: AIRTABLE_API_KEY, AIRTABLE_BASE_ID, DATABASE_URL
 *      AWS_S3_ACCESS_KEY_ID, AWS_S3_SECRET_ACCESS_KEY, AWS_S3_BUCKET,
 *      AWS_S3_REGION (required unless --dry-run)
 *      AWS_S3_ENDPOINT (optional; MinIO / path-style)
 */

import '../config.js';
import { listAllRecords } from '#lib/airtable-fetch.js';
import { migrateParentPhotos, PHOTO_TARGETS } from '#lib/airtable-photos.js';

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const force = args.includes('--force');
const limitArg = args.find((a) => a.startsWith('--limit='));
const limit = limitArg ? Number(limitArg.slice('--limit='.length)) : null;

const report = {
  dryRun,
  force,
  limit,
  startedAt: new Date().toISOString(),
  photos: {
    Plot: { fetched: 0, processed: 0, uploaded: 0, skipped: 0, cleared: 0 },
    Plant: { fetched: 0, processed: 0, uploaded: 0, skipped: 0, cleared: 0 },
    MaintenanceRecord: { fetched: 0, processed: 0, uploaded: 0, skipped: 0, cleared: 0 },
  },
  errors: [],
};

let prisma;

function requireEnv () {
  const required = ['AIRTABLE_API_KEY', 'AIRTABLE_BASE_ID', 'DATABASE_URL'];
  if (!dryRun) {
    required.push(
      'AWS_S3_ACCESS_KEY_ID',
      'AWS_S3_SECRET_ACCESS_KEY',
      'AWS_S3_BUCKET',
      'AWS_S3_REGION'
    );
  }
  for (const key of required) {
    if (!process.env[key]) throw new Error(`${key} must be set`);
  }
  return {
    apiKey: process.env.AIRTABLE_API_KEY,
    baseId: process.env.AIRTABLE_BASE_ID,
  };
}

function recordResult (label, parentId, airtableId, result) {
  const stats = report.photos[label];
  if (result.action === 'skipped') {
    stats.skipped += 1;
    return;
  }
  for (const err of result.errors || []) {
    report.errors.push({
      table: label,
      parentId,
      airtableId,
      filename: err.filename,
      message: err.message,
    });
  }
  if (result.action !== 'updated') return;
  if (result.uploaded) {
    stats.uploaded += result.uploaded;
  } else {
    stats.cleared += 1;
  }
}

async function migrateTarget (target, apiKey, baseId) {
  const stats = report.photos[target.label];
  console.error(`Fetching ${target.airtableTable} from Airtable…`);
  const airtableRecords = await listAllRecords(apiKey, baseId, target.airtableTable);
  stats.fetched = airtableRecords.length;
  const byAirtableId = new Map(airtableRecords.map((r) => [r.id, r]));

  let dbRows = await prisma[target.prismaModel].findMany({
    select: {
      id: true,
      airtableId: true,
      _count: { select: { photos: true } },
    },
    orderBy: { airtableId: 'asc' },
  });

  if (limit != null && Number.isFinite(limit)) {
    dbRows = dbRows.slice(0, limit);
  }

  for (const row of dbRows) {
    const rec = byAirtableId.get(row.airtableId);
    if (!rec) {
      report.errors.push({
        table: target.label,
        parentId: row.id,
        airtableId: row.airtableId,
        message: `no matching Airtable ${target.airtableTable} record`,
      });
      continue;
    }

    stats.processed += 1;
    const result = await migrateParentPhotos({
      prisma,
      delegateName: target.delegateName,
      PhotoClass: target.PhotoClass,
      parentFk: target.parentFk,
      parentId: row.id,
      attachments: target.attachmentsFrom(rec.fields),
      existingCount: row._count.photos,
      dryRun,
      force,
    });
    recordResult(target.label, row.id, rec.id, result);
  }
}

async function main () {
  const { apiKey, baseId } = requireEnv();
  ({ default: prisma } = await import('#prisma/client.js'));

  for (const target of PHOTO_TARGETS) {
    await migrateTarget(target, apiKey, baseId);
  }

  report.finishedAt = new Date().toISOString();
  console.log(JSON.stringify(report, null, 2));
  if (prisma) await prisma.$disconnect();
  if (report.errors.length) process.exitCode = 1;
}

main().catch(async (err) => {
  console.error(err);
  if (prisma) await prisma.$disconnect().catch(() => {});
  process.exit(1);
});
