#!/usr/bin/env node

/**
 * Download Plot Photo/Photos from Airtable and upload to S3.
 * Replaces Plot.photo / Plot.photos JSONB with `/api/assets/...` path arrays.
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
import {
  isMigratedAssetPaths,
  uploadAirtableAttachments,
} from '#lib/airtable-photos.js';

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
  plotsFetched: 0,
  plotsProcessed: 0,
  photo: { uploaded: 0, skipped: 0, cleared: 0 },
  photos: { uploaded: 0, skipped: 0, cleared: 0 },
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
      'AWS_S3_REGION',
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

async function listAllRecords (apiKey, baseId, tableName) {
  const records = [];
  let offset;
  do {
    const url = new URL(`https://api.airtable.com/v0/${baseId}/${encodeURIComponent(tableName)}`);
    url.searchParams.set('pageSize', '100');
    if (offset) url.searchParams.set('offset', offset);
    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      const err = new Error(data.error?.message || response.statusText);
      err.status = response.status;
      throw err;
    }
    records.push(...(data.records || []));
    offset = data.offset;
  } while (offset);
  return records;
}

/**
 * @param {'photo'|'photos'} attribute
 * @param {string} plotId
 * @param {unknown} existing
 * @param {unknown} attachments
 */
async function migrateAttribute (attribute, plotId, existing, attachments) {
  const stats = report[attribute];
  if (!force && isMigratedAssetPaths(existing)) {
    stats.skipped += 1;
    return undefined;
  }

  const result = await uploadAirtableAttachments({
    plotId,
    attribute,
    attachments,
    dryRun,
  });

  for (const err of result.errors) {
    report.errors.push({
      plotId,
      attribute,
      filename: err.filename,
      message: err.message,
    });
  }

  if (result.errors.length) {
    // Leave existing DB value alone if any download/upload failed
    return undefined;
  }

  if (result.uploaded) {
    stats.uploaded += result.uploaded;
  } else {
    stats.cleared += 1;
  }

  return result.paths;
}

async function main () {
  const { apiKey, baseId } = requireEnv();
  ({ default: prisma } = await import('#prisma/client.js'));

  console.error('Fetching Plots from Airtable…');
  const airtablePlots = await listAllRecords(apiKey, baseId, 'Plots');
  report.plotsFetched = airtablePlots.length;

  const byAirtableId = new Map(airtablePlots.map((r) => [r.id, r]));

  let dbPlots = await prisma.plot.findMany({
    select: { id: true, airtableId: true, photo: true, photos: true },
    orderBy: { airtableId: 'asc' },
  });

  if (limit != null && Number.isFinite(limit)) {
    dbPlots = dbPlots.slice(0, limit);
  }

  for (const plot of dbPlots) {
    const rec = byAirtableId.get(plot.airtableId);
    if (!rec) {
      report.errors.push({
        plotId: plot.id,
        airtableId: plot.airtableId,
        message: 'no matching Airtable Plots record',
      });
      continue;
    }

    report.plotsProcessed += 1;
    const f = rec.fields;
    const photoPaths = await migrateAttribute('photo', plot.id, plot.photo, f.Photo);
    const photosPaths = await migrateAttribute('photos', plot.id, plot.photos, f.Photos);

    if (dryRun) continue;

    const data = {};
    if (photoPaths !== undefined) data.photo = photoPaths;
    if (photosPaths !== undefined) data.photos = photosPaths;
    if (Object.keys(data).length) {
      await prisma.plot.update({
        where: { id: plot.id },
        data,
      });
    }
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
