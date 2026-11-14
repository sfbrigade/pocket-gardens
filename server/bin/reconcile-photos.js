#!/usr/bin/env node
import '../config.js';
import { createClient } from '#prisma/client.js';
import s3 from '#lib/s3.js';
import { reconcilePhotoCopies } from '#lib/photo-lifecycle.js';

const args = process.argv.slice(2);
if (args.some((arg) => !['--apply', '--dry-run'].includes(arg)) || (args.includes('--apply') && args.includes('--dry-run'))) {
  throw new Error('Usage: npm run photos:cleanup -w server -- [--dry-run | --apply]');
}
const dryRun = !args.includes('--apply');
const prisma = createClient(process.env.DATABASE_URL);
try {
  if (await s3.bucketIsVersioned()) throw new Error('Photo cleanup requires an unversioned bucket. Configure native _uploads/ expiration before enabling uploads.');
  const options = { dryRun, report: (event) => console.log(JSON.stringify(event)) };
  console.log(JSON.stringify({ dryRun, bucket: process.env.AWS_S3_BUCKET, endpoint: process.env.AWS_S3_ENDPOINT ?? 'AWS' }));
  const copies = await reconcilePhotoCopies(prisma, options);
  console.log(JSON.stringify({ copies }));
  if (copies.failed) process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}
