/**
 * Download Airtable attachments into `_uploads/`, then attach via setAsset.
 */

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import mime from 'mime-types';

import s3 from '#lib/s3.js';
import { runPhotoHandlers, syncPhotos } from '#lib/photos.js';
import MaintenanceRecordPhoto from '#models/maintenance-record-photo.js';
import PlantPhoto from '#models/plant-photo.js';
import PlotPhoto from '#models/plot-photo.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TMP_DIR = path.resolve(__dirname, '../tmp/downloads');

export const PHOTO_TARGETS = [
  {
    label: 'Plot',
    airtableTable: 'Plots',
    prismaModel: 'plot',
    delegateName: 'plotPhoto',
    PhotoClass: PlotPhoto,
    parentFk: 'plotId',
    attachmentsFrom: (fields) => concatAttachments(fields.Photo, fields.Photos),
  },
  {
    label: 'Plant',
    airtableTable: 'Plants',
    prismaModel: 'plant',
    delegateName: 'plantPhoto',
    PhotoClass: PlantPhoto,
    parentFk: 'plantId',
    attachmentsFrom: (fields) => concatAttachments(fields.Photo),
  },
  {
    label: 'MaintenanceRecord',
    airtableTable: 'Maintenance Records',
    prismaModel: 'maintenanceRecord',
    delegateName: 'maintenanceRecordPhoto',
    PhotoClass: MaintenanceRecordPhoto,
    parentFk: 'maintenanceRecordId',
    attachmentsFrom: (fields) => concatAttachments(fields['Volunteer Photos']),
  },
];

/**
 * @param {...unknown} groups
 * @returns {object[]}
 */
export function concatAttachments (...groups) {
  const out = [];
  for (const group of groups) {
    if (!Array.isArray(group)) continue;
    for (const attachment of group) {
      if (attachment && typeof attachment.url === 'string' && attachment.url) {
        out.push(attachment);
      }
    }
  }
  return out;
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
 * Download Airtable attachments and upload to `_uploads/{filename}`.
 * On any failure, deletes keys uploaded during this call so retries do not orphan objects.
 *
 * @param {object} options
 * @param {unknown} options.attachments
 * @param {boolean} [options.dryRun=false]
 * @param {typeof fetch} [options.fetchImpl]
 * @param {{ putObject: Function, deleteObject: Function }} [options.s3Client]
 * @returns {Promise<{ filenames: string[], uploaded: number, errors: { filename?: string, message: string }[] }>}
 */
export async function uploadAirtableAttachments ({
  attachments,
  dryRun = false,
  fetchImpl = fetch,
  s3Client = s3,
}) {
  const errors = [];
  const valid = concatAttachments(attachments);

  if (!valid.length) {
    return { filenames: [], uploaded: 0, errors };
  }

  if (dryRun) {
    const filenames = valid.map((a) => makeObjectFilename(a));
    return { filenames, uploaded: filenames.length, errors };
  }

  await fs.promises.mkdir(TMP_DIR, { recursive: true });

  const filenames = [];
  const uploadedKeys = [];
  for (const attachment of valid) {
    const filename = makeObjectFilename(attachment);
    const key = path.join('_uploads', filename);
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
      filenames.push(filename);
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
    return { filenames: [], uploaded: 0, errors };
  }

  return {
    filenames,
    uploaded: filenames.length,
    errors,
  };
}

/**
 * Migrate Airtable attachments onto a photo table via `_uploads` + setAsset.
 *
 * @param {object} options
 * @param {object} [options.prisma]
 * @param {string} options.delegateName
 * @param {new (data: object) => object} options.PhotoClass
 * @param {string} options.parentFk
 * @param {string} options.parentId
 * @param {unknown} options.attachments
 * @param {number} [options.existingCount=0]
 * @param {boolean} [options.dryRun=false]
 * @param {boolean} [options.force=false]
 * @param {typeof fetch} [options.fetchImpl]
 * @param {{ putObject: Function, deleteObject: Function }} [options.s3Client]
 */
export async function migrateParentPhotos ({
  prisma,
  delegateName,
  PhotoClass,
  parentFk,
  parentId,
  attachments,
  existingCount = 0,
  dryRun = false,
  force = false,
  fetchImpl = fetch,
  s3Client = s3,
}) {
  if (!force && existingCount > 0) {
    return { action: 'skipped' };
  }

  const result = await uploadAirtableAttachments({
    attachments,
    dryRun,
    fetchImpl,
    s3Client,
  });

  if (result.errors.length) {
    return { action: 'unchanged', errors: result.errors };
  }

  if (dryRun) {
    return {
      action: 'updated',
      filenames: result.filenames,
      uploaded: result.uploaded,
      cleared: result.uploaded === 0,
    };
  }

  await prisma.$transaction(async (tx) => {
    const handlers = await syncPhotos({
      delegate: tx[delegateName],
      PhotoClass,
      parentFk,
      parentId,
      filenames: result.filenames,
    });
    await runPhotoHandlers(handlers);
  });

  return {
    action: 'updated',
    filenames: result.filenames,
    uploaded: result.uploaded,
    cleared: result.uploaded === 0,
  };
}
