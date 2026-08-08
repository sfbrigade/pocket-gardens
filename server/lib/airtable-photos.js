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

/**
 * @param {unknown} value
 * @returns {boolean}
 */
export function isMigratedAssetPaths (value) {
  return Array.isArray(value) &&
    value.length > 0 &&
    value.every((v) => typeof v === 'string' && v.startsWith('/api/assets/'));
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
 *
 * @param {object} options
 * @param {string} options.plotId - Postgres plot UUID
 * @param {'photo'|'photos'} options.attribute
 * @param {unknown} options.attachments - Airtable attachment array (or null)
 * @param {boolean} [options.dryRun=false]
 * @returns {Promise<{ paths: string[]|null, uploaded: number, errors: { filename?: string, message: string }[] }>}
 */
export async function uploadAirtableAttachments ({
  plotId,
  attribute,
  attachments,
  dryRun = false,
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
      return `/api/assets/plots/${plotId}/${attribute}/${filename}`;
    });
    return { paths, uploaded: paths.length, errors };
  }

  await fs.promises.mkdir(TMP_DIR, { recursive: true });

  const paths = [];
  for (const attachment of valid) {
    const filename = makeObjectFilename(attachment);
    const key = `plots/${plotId}/${attribute}/${filename}`;
    const tmpPath = path.join(TMP_DIR, filename);
    try {
      const response = await fetch(attachment.url);
      if (!response.ok) {
        throw new Error(`download failed: ${response.status} ${response.statusText}`);
      }
      const buffer = Buffer.from(await response.arrayBuffer());
      await fs.promises.writeFile(tmpPath, buffer);
      await s3.putObject(key, tmpPath, attachment.type || undefined);
      paths.push(`/api/assets/${key}`);
    } catch (err) {
      errors.push({
        filename: attachment.filename,
        message: err.message,
      });
    } finally {
      await fs.promises.unlink(tmpPath).catch(() => {});
    }
  }

  return {
    paths: paths.length ? paths : null,
    uploaded: paths.length,
    errors,
  };
}
