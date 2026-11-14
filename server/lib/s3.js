import {
  S3Client,
  CopyObjectCommand,
  CreateBucketCommand,
  DeleteObjectCommand,
  DeleteObjectsCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  ListObjectVersionsCommand,
  GetBucketVersioningCommand,
  PutObjectCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl as getSignedS3Url } from '@aws-sdk/s3-request-presigner';
import { getSignedUrl as getSignedCloudFrontUrl } from '@aws-sdk/cloudfront-signer';
import { uploadUrlSeconds } from './upload-policy.js';
import fs from 'fs';
import { DateTime } from 'luxon';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

let client;
let signerClient;

function init () {
  if (!client) {
    const options = {
      credentials: {
        accessKeyId: process.env.AWS_S3_ACCESS_KEY_ID,
        secretAccessKey: process.env.AWS_S3_SECRET_ACCESS_KEY,
      },
      endpoint: process.env.AWS_S3_ENDPOINT,
      region: process.env.AWS_S3_REGION,
      forcePathStyle: true,
    };
    client = new S3Client(options);
    if (process.env.AWS_S3_SIGNER_ENDPOINT) {
      signerClient = new S3Client({
        ...options,
        endpoint: process.env.AWS_S3_SIGNER_ENDPOINT,
      });
    }
  }
}

function copyObject (CopySource, Key, CopySourceIfMatch) {
  init();
  return client.send(
    new CopyObjectCommand({
      Bucket: process.env.AWS_S3_BUCKET,
      CopySource,
      CopySourceIfMatch,
      Key,
    })
  );
}

function createBucket (Bucket) {
  init();
  return client.send(
    new CreateBucketCommand({
      Bucket,
    })
  );
}

function deleteObject (Key, VersionId) {
  init();
  return client.send(
    new DeleteObjectCommand({
      VersionId,
      Bucket: process.env.AWS_S3_BUCKET,
      Key,
    })
  );
}

async function deleteObjects (Prefix) {
  init();
  const response = await client.send(
    new ListObjectsV2Command({
      Bucket: process.env.AWS_S3_BUCKET,
      Prefix,
    })
  );
  if (response.Contents) {
    return client.send(
      new DeleteObjectsCommand({
        Bucket: process.env.AWS_S3_BUCKET,
        Delete: {
          Objects: response.Contents.map((obj) => ({ Key: obj.Key })),
        },
      })
    );
  }
  return Promise.resolve();
}

async function getObject (Key) {
  init();
  const response = await client.send(
    new GetObjectCommand({
      Bucket: process.env.AWS_S3_BUCKET,
      Key,
    })
  );
  const filePath = path.resolve(__dirname, '../tmp/downloads', Key);
  const dirPath = filePath.substring(0, filePath.lastIndexOf('/'));
  await fs.promises.mkdir(dirPath, { recursive: true });
  await fs.promises.writeFile(filePath, response.Body);
  return filePath;
}

function getSignedAssetUrl (Key, expiresIn = 60) {
  init();
  if (process.env.AWS_CLOUDFRONT_DOMAIN) {
    const url = `https://${process.env.AWS_CLOUDFRONT_DOMAIN}/${Key}`;
    const keyPairId = process.env.AWS_CLOUDFRONT_KEYPAIR_ID;
    const privateKey = process.env.AWS_CLOUDFRONT_PRIVATE_KEY.replace(/\\n/g, '\n');
    const dateLessThan = DateTime.now().plus({ seconds: expiresIn }).toISO();
    return getSignedCloudFrontUrl({ url, keyPairId, privateKey, dateLessThan });
  }
  return getSignedS3Url(
    signerClient ?? client,
    new GetObjectCommand({
      Bucket: process.env.AWS_S3_BUCKET,
      Key,
    }),
    { expiresIn }
  );
}

function getSignedUploadUrl (ContentType, Key, ContentLength) {
  init();
  return getSignedS3Url(
    signerClient ?? client,
    new PutObjectCommand({
      Bucket: process.env.AWS_S3_BUCKET,
      ContentType,
      ContentLength,
      Key,
    }),
    { expiresIn: uploadUrlSeconds, signableHeaders: new Set(['content-type', 'content-length']) }
  );
}

async function headObject (Key) {
  init();
  try {
    const response = await client.send(
      new HeadObjectCommand({
        Bucket: process.env.AWS_S3_BUCKET,
        Key,
      })
    );
    return response;
  } catch (err) {
    if (err.$metadata?.httpStatusCode === 404 || ['NotFound', 'NoSuchKey'].includes(err.name)) return null;
    throw err;
  }
}

async function readObjectHeader (Key, IfMatch) {
  init();
  const { Body } = await client.send(new GetObjectCommand({ Bucket: process.env.AWS_S3_BUCKET, Key, Range: 'bytes=0-15', IfMatch }));
  return Buffer.from(await Body.transformToByteArray());
}

async function objectExists (Key) {
  return !!(await headObject(Key));
}

async function * listObjects (Prefix) {
  init();
  let ContinuationToken;
  do {
    const page = await client.send(new ListObjectsV2Command({ Bucket: process.env.AWS_S3_BUCKET, Prefix, ContinuationToken }));
    yield * (page.Contents ?? []);
    ContinuationToken = page.IsTruncated ? page.NextContinuationToken : undefined;
    if (page.IsTruncated && !ContinuationToken) throw new Error('Storage omitted continuation token');
  } while (ContinuationToken);
}

async function * listVersions (Prefix) {
  init();
  let KeyMarker;
  let VersionIdMarker;
  do {
    const page = await client.send(new ListObjectVersionsCommand({ Bucket: process.env.AWS_S3_BUCKET, Prefix, KeyMarker, VersionIdMarker }));
    // Keep each key's entries together across version and marker arrays.
    yield * [...(page.Versions ?? []), ...(page.DeleteMarkers ?? [])].sort((a, b) => a.Key < b.Key ? -1 : a.Key > b.Key ? 1 : 0);
    KeyMarker = page.IsTruncated ? page.NextKeyMarker : undefined;
    VersionIdMarker = page.NextVersionIdMarker;
    if (page.IsTruncated && !KeyMarker) throw new Error('Storage omitted version continuation marker');
  } while (KeyMarker);
}

async function bucketIsVersioned () {
  init();
  const { Status } = await client.send(new GetBucketVersioningCommand({ Bucket: process.env.AWS_S3_BUCKET }));
  return Status === 'Enabled' || Status === 'Suspended';
}

async function purgeObject (key, versioned = false) {
  if (!versioned) return deleteObject(key);
  // Keep delete markers until contents are removed so hidden keys stay hidden
  // on a partial failure. Repeat runs also catch late PUT/copy completions.
  const versions = [];
  for await (const version of listVersions(key)) {
    if (version.Key === key) versions.push(version);
  }
  versions.sort((a, b) => Number(!Object.hasOwn(a, 'Size')) - Number(!Object.hasOwn(b, 'Size')));
  for (const version of versions) await deleteObject(key, version.VersionId);
}

function putObject (Key, filePath, ContentType) {
  init();
  const params = {
    Bucket: process.env.AWS_S3_BUCKET,
    Key,
    Body: fs.createReadStream(filePath),
  };
  if (ContentType) {
    params.ContentType = ContentType;
  }
  return client.send(new PutObjectCommand(params));
}

export default {
  copyObject,
  createBucket,
  deleteObject,
  deleteObjects,
  getObject,
  getSignedAssetUrl,
  getSignedUploadUrl,
  objectExists,
  headObject,
  readObjectHeader,
  listObjects,
  listVersions,
  bucketIsVersioned,
  purgeObject,
  putObject,
};
