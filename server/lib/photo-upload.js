import s3 from '#lib/s3.js';
import { dayMs, maxPhotoBytes, photoTypes, uploadRetentionDays } from '#lib/upload-policy.js';

export class PhotoUploadError extends Error {
  constructor (message, field) {
    super(message);
    this.validation = [{ params: { issue: { path: [field], message } } }];
  }
}

function imageType (bytes) {
  if (bytes.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff]))) return 'image/jpeg';
  if (bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return 'image/png';
  if (['GIF87a', 'GIF89a'].includes(bytes.subarray(0, 6).toString('ascii'))) return 'image/gif';
  if (bytes.subarray(0, 4).toString('ascii') === 'RIFF' && bytes.subarray(8, 12).toString('ascii') === 'WEBP') return 'image/webp';
  return null;
}

// A bounded range read checks the bytes, not just caller-supplied MIME metadata.
// Pin both this read and the copy to the HEAD's ETag so a repeated signed PUT
// cannot replace the validated source between checking and attaching it.
export async function validatePhotoUpload (filename, field) {
  const key = `_uploads/${filename}`;
  const object = await s3.headObject(key);
  const invalid = (message) => new PhotoUploadError(message, field);
  if (!object || object.LastModified <= new Date(Date.now() - uploadRetentionDays() * dayMs)) {
    throw invalid('This photo is missing or has expired. Reattach it or continue without a photo.');
  }
  if (!object.ContentLength || object.ContentLength > maxPhotoBytes) throw invalid('Choose a photo up to 10 MiB.');
  let header;
  try {
    header = await s3.readObjectHeader(key, object.ETag);
  } catch (error) {
    if (error.$metadata?.httpStatusCode === 412) throw invalid('The photo changed while saving. Reattach it and try again.');
    throw error;
  }
  const type = imageType(header);
  // Direct imports may lack MIME metadata, but their actual bytes must be an image.
  if (!type || !Object.hasOwn(photoTypes, type) || (object.ContentType && object.ContentType !== 'application/octet-stream' && object.ContentType !== type)) {
    throw invalid('Choose a JPEG, PNG, WebP or GIF photo.');
  }
  return object.ETag;
}
