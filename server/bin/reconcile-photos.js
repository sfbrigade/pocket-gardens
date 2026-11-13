#!/usr/bin/env node
import '../config.js';
import { createClient } from '#prisma/client.js';
import s3 from '#lib/s3.js';
import { expireStagingUploads, reconcilePhotoCopies } from '#lib/photo-lifecycle.js';
import { uploadRetentionDays } from '#lib/upload-policy.js';

const args = process.argv.slice(2);
if (args.some((arg) => !['--apply', '--dry-run'].includes(arg)) || (args.includes('--apply') && args.includes('--dry-run'))) {
  throw new Error('Usage: npm run photos:cleanup -w server -- [--dry-run | --apply]');
}
const dryRun = !args.includes('--apply');
const prisma = createClient(process.env.DATABASE_URL);
try {
  const versioned = await s3.bucketIsVersioned();
  const options = { dryRun, versioned, report: (event) => console.log(JSON.stringify(event)) };
  console.log(JSON.stringify({ dryRun, bucket: process.env.AWS_S3_BUCKET, endpoint: process.env.AWS_S3_ENDPOINT ?? 'AWS', versioned, retentionDays: uploadRetentionDays() }));
  const copies = await reconcilePhotoCopies(prisma, options);
  const staging = await expireStagingUploads(prisma, options);
  console.log(JSON.stringify({ copies, staging }));
  if (copies.failed || staging.failed) process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}
