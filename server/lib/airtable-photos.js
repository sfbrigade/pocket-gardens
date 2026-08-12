/**
 * Download Airtable attachments and upload them to S3 as plot assets.
 * Stored DB values are arrays of `/api/assets/plots/{id}/{attribute}/{file}` paths.
 */

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import mime from 'mime-types';

import s3 from '#lib/s3.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TMP_DIR = path.resolve(__dirname, '../tmp/downloads');
const ASSET_PREFIX = '/api/assets/';

/**
 * @param {unknown} value
 * @returns {boolean}
 */
export function isMigratedAssetPaths (value) {
  return Array.isArray(value) &&
    value.length > 0 &&
    value.every((v) => typeof v === 'string' && v.startsWith(ASSET_PREFIX));
}

/**
 * @param {string} assetPath
 * @returns {string|null}
 */
export function assetPathToKey (assetPath) {
  if (typeof assetPath !== 'string' || !assetPath.startsWith(ASSET_PREFIX)) return null;
  return assetPath.slice(ASSET_PREFIX.length);
}

/**
 * @param {unknown} paths
 * @param {{ deleteObject?: (key: string) => Promise<unknown> }} [s3Client]
 */
export async function deleteAssetPaths (paths, s3Client = s3) {
  if (!Array.isArray(paths)) return;
  for (const assetPath of paths) {
    const key = assetPathToKey(assetPath);
    if (!key) continue;
    await s3Client.deleteObject(key).catch(() => {});
  }
}

/**
 * @param {{ filename?: string, type?: string }} attachment
 * @returns {string}
 */
function extensionFor (attachment) {
  if (attachment.filename) {
    const ext = path.extname(attachment.filename).replace(/^\./, '').toLowerCase();
    if (ext) return ext;
  }
  if (attachment.type) {
    const ext = mime.extension(attachment.type);
    if (ext) return ext;
  }
  return 'bin';
}

/**
 * @param {{ filename?: string, type?: string }} attachment
 * @returns {string}
 */
function makeObjectFilename (attachment) {
  return `${crypto.randomUUID()}.${extensionFor(attachment)}`;
}

/**
 * Download Airtable attachments and upload to S3 under plots/{plotId}/{attribute}/.
 * On any failure, deletes keys uploaded during this call so retries do not orphan objects.
 *
 * @param {object} options
 * @param {string} options.plotId - Postgres plot UUID
 * @param {'photo'|'photos'} options.attribute
 * @param {unknown} options.attachments - Airtable attachment array (or null)
 * @param {boolean} [options.dryRun=false]
 * @param {typeof fetch} [options.fetchImpl]
 * @param {{ putObject: Function, deleteObject: Function }} [options.s3Client]
 * @returns {Promise<{ paths: string[]|null, uploaded: number, errors: { filename?: string, message: string }[] }>}
 */
export async function uploadAirtableAttachments ({
  plotId,
  attribute,
  attachments,
  dryRun = false,
  fetchImpl = fetch,
  s3Client = s3,
}) {
  const errors = [];

  if (!Array.isArray(attachments) || attachments.length === 0) {
    return { paths: null, uploaded: 0, errors };
  }

  const valid = attachments.filter((a) => a && typeof a.url === 'string' && a.url);
  if (!valid.length) {
    return { paths: null, uploaded: 0, errors };
  }

  if (dryRun) {
    const paths = valid.map((a) => {
      const filename = makeObjectFilename(a);
      return `${ASSET_PREFIX}plots/${plotId}/${attribute}/${filename}`;
    });
    return { paths, uploaded: paths.length, errors };
  }

  await fs.promises.mkdir(TMP_DIR, { recursive: true });

  const paths = [];
  const uploadedKeys = [];
  for (const attachment of valid) {
    const filename = makeObjectFilename(attachment);
    const key = `plots/${plotId}/${attribute}/${filename}`;
    const tmpPath = path.join(TMP_DIR, filename);
    try {
      const response = await fetchImpl(attachment.url);
      if (!response.ok) {
        throw new Error(`download failed: ${response.status} ${response.statusText}`);
      }
      const buffer = Buffer.from(await response.arrayBuffer());
      await fs.promises.writeFile(tmpPath, buffer);
      await s3Client.putObject(key, tmpPath, attachment.type || undefined);
      uploadedKeys.push(key);
      paths.push(`${ASSET_PREFIX}${key}`);
    } catch (err) {
      errors.push({
        filename: attachment.filename,
        message: err.message,
      });
    } finally {
      await fs.promises.unlink(tmpPath).catch(() => {});
    }
  }

  if (errors.length) {
    for (const key of uploadedKeys) {
      await s3Client.deleteObject(key).catch(() => {});
    }
    return { paths: null, uploaded: 0, errors };
  }

  return {
    paths: paths.length ? paths : null,
    uploaded: paths.length,
    errors,
  };
}

/**
 * Migrate one Plot photo attribute (skip / upload / clear) with orphan cleanup.
 *
 * @param {object} options
 * @param {string} options.plotId
 * @param {'photo'|'photos'} options.attribute
 * @param {unknown} options.existing - current DB JSON value
 * @param {unknown} options.attachments - Airtable attachments
 * @param {boolean} [options.dryRun=false]
 * @param {boolean} [options.force=false]
 * @param {typeof fetch} [options.fetchImpl]
 * @param {{ putObject: Function, deleteObject: Function }} [options.s3Client]
 * @returns {Promise<{
 *   action: 'skipped'|'updated'|'unchanged',
 *   paths?: string[]|null,
 *   uploaded?: number,
 *   cleared?: boolean,
 *   stalePaths?: string[],
 *   errors?: { filename?: string, message: string }[],
 * }>}
 */
export async function migratePlotPhotoAttribute ({
  plotId,
  attribute,
  existing,
  attachments,
  dryRun = false,
  force = false,
  fetchImpl = fetch,
  s3Client = s3,
}) {
  if (!force && isMigratedAssetPaths(existing)) {
    return { action: 'skipped' };
  }

  const result = await uploadAirtableAttachments({
    plotId,
    attribute,
    attachments,
    dryRun,
    fetchImpl,
    s3Client,
  });

  if (result.errors.length) {
    return { action: 'unchanged', errors: result.errors };
  }

  const stalePaths = isMigratedAssetPaths(existing)
    ? existing.filter((p) => !(result.paths || []).includes(p))
    : [];

  return {
    action: 'updated',
    paths: result.paths,
    uploaded: result.uploaded,
    cleared: !result.uploaded,
    stalePaths,
  };
}
