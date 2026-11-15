#!/usr/bin/env node
import '../config.js';
import prisma from '#prisma/client.js';
import { cleanupMaintenancePhotos } from '#lib/maintenance-photos.js';

try {
  const result = await cleanupMaintenancePhotos(prisma, { warn: (details, message) => console.error(message, details.photoId) });
  console.log(`Removed ${result.removed} photos; ${result.pending} pending.`);
  if (result.pending) process.exitCode = 1;
} finally { await prisma.$disconnect(); }
