#!/usr/bin/env node
import '../config.js';
import prisma from '#prisma/client.js';
import { cleanupMaintenancePhotos } from '#lib/maintenance-photos.js';

try {
  const removed = await cleanupMaintenancePhotos(prisma, { warn: (details, message) => console.error(message, details.photoId) });
  const pending = await prisma.maintenanceRecordPhoto.count({ where: { pendingRemovalAt: { not: null } } });
  console.log(`Removed ${removed} photos; ${pending} pending.`);
  if (pending) process.exitCode = 1;
} finally { await prisma.$disconnect(); }
