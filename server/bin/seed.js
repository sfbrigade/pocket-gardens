#!/usr/bin/env node

/**
 * Populate the local development database with existing test fixtures.
 *
 * Loads sample data for users, people, plants, plots, maintenance records,
 * and invitations. Skips seeding if any of the other listed models already
 * contain data.
 *
 * Usage:
 *   bin/seed.js
 *
 * Env: DATABASE_URL, ALLOW_DB_SEED=true (required)
 */

import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  Builder,
  fixturesIterator,
  Loader,
  Parser,
  Resolver
} from '@sfcivictech/prisma-fixtures';

import '../config.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let prisma;

async function main () {
  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL must be set');
  }

  const databaseUrl = new URL(process.env.DATABASE_URL);

  if (
    process.env.NODE_ENV === 'production' ||
    !['db', 'localhost', '127.0.0.1'].includes(databaseUrl.hostname) ||
    process.env.ALLOW_DB_SEED !== 'true'
  ) {
    throw new Error('Database seeding requires a local database and ALLOW_DB_SEED=true');
  }

  ({ default: prisma } = await import('#prisma/client.js'));

  const existingRecords = await Promise.all([
    prisma.person.count(),
    prisma.plant.count(),
    prisma.plot.count(),
    prisma.maintenanceRecord.count(),
    prisma.maintenanceRecordPlant.count(),
    prisma.invite.count()
  ]);

  if (existingRecords.some(count => count > 0)) {
    console.log('Database already contains data. Skipping seeding.');
    await prisma.$disconnect();
    return;
  }

  const loader = new Loader();
  const resolver = new Resolver();
  loader.load(path.resolve(__dirname, '../test/fixtures/db'));
  const fixtures = resolver.resolve(loader.fixtureConfigs);

  await prisma.$transaction(async (tx) => {
    const builder = new Builder(tx, new Parser());

    for (const fixture of fixturesIterator(fixtures)) {
      await builder.build(fixture);
    }
  }, { timeout: 30000 });

  console.log('Database seeded successfully.');
  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error(err);
  if (prisma) await prisma.$disconnect().catch(() => {});
  process.exitCode = 1;
});
