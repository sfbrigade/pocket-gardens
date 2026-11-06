import assert from 'node:assert/strict';
import { test } from 'node:test';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { PostgreSqlContainer } from '@testcontainers/postgresql';

import { createClient } from '#prisma/client.js';

const migration = fileURLToPath(new URL('../../prisma/migrations/20261024000000_plot_submission_fields/migration.sql', import.meta.url));
const serverDir = fileURLToPath(new URL('../../', import.meta.url));
const declinedIds = [
  'rec87crQlQLX2wSdC',
  'recfTnZp3A2pPPV8G',
  'recgqSd4PpKQSjP2W',
  'rectjw1tcU6XdF7NK',
  'recVhA0CGGBh4bG1i',
  'recyxppURE0mZZdpf',
];

test('plot submission upgrade converts legacy data atomically', async (t) => {
  const container = await new PostgreSqlContainer('postgres:18.3').start();
  t.after(() => container.stop());
  const databaseUrl = container.getConnectionUri();
  const prisma = createClient(databaseUrl);
  t.after(() => prisma.$disconnect());
  const deploy = () => promisify(execFile)('npx', ['prisma', 'db', 'execute', '--file', migration], {
    cwd: serverDir, env: { ...process.env, DATABASE_URL: databaseUrl },
  });
  t.beforeEach(async () => {
    await prisma.$executeRawUnsafe('DROP TABLE IF EXISTS "Plot"');
    await prisma.$executeRawUnsafe(`CREATE TABLE "Plot" (
      "airtableId" TEXT PRIMARY KEY, status TEXT, "originalPlantDate" TIMESTAMP
    )`);
    await prisma.$executeRawUnsafe('CREATE INDEX "Plot_status_idx" ON "Plot"(status)');
    await prisma.$executeRawUnsafe(`INSERT INTO "Plot" VALUES
      ('recActive', ' Planted ', '2024-12-05'),
      ('recPotential', 'Not Yet Planted', NULL),
      ('recMissing', NULL, NULL),
      ('recBlank', ' ', NULL)`);
    for (const id of declinedIds) {
      await prisma.$executeRaw`INSERT INTO "Plot" VALUES (${id}, 'Residents Declined', '2024-12-05')`;
    }
  });

  await t.test('one migration adds fields, resolves all six plots, and removes status', async () => {
    await deploy();
    const rows = await prisma.$queryRaw`SELECT * FROM "Plot" ORDER BY "airtableId"`;
    assert.equal(rows.length, 10);
    assert.ok(rows.every((row) => !Object.hasOwn(row, 'status')));
    assert.ok(rows.every((row) => row.sunExposure === null && row.environmentalNotes === null));
    const byId = new Map(rows.map((row) => [row.airtableId, row]));
    assert.equal(byId.get('recActive').stage, 'active');
    assert.equal(byId.get('recActive').permissionStatus, null);
    assert.equal(byId.get('recActive').originalPlantDate.toISOString(), '2024-12-05T00:00:00.000Z');
    assert.equal(byId.get('recPotential').stage, 'potential');
    assert.equal(byId.get('recMissing').stage, null);
    assert.equal(byId.get('recBlank').stage, null);
    for (const id of declinedIds) {
      assert.equal(byId.get(id).stage, 'paused');
      assert.equal(byId.get(id).permissionStatus, 'not_granted');
      assert.equal(byId.get(id).originalPlantDate.toISOString(), '2024-12-05T00:00:00.000Z');
    }
    const indexes = await prisma.$queryRaw`SELECT indexname FROM pg_indexes WHERE tablename = 'Plot'`;
    assert.ok(indexes.some(({ indexname }) => indexname === 'Plot_stage_idx'));
    assert.ok(indexes.every(({ indexname }) => indexname !== 'Plot_status_idx'));
  });

  await t.test('unknown and unreviewed declined statuses roll back schema and data changes', async () => {
    for (const status of ['Unfamiliar', 'Residents Declined']) {
      await prisma.$executeRaw`INSERT INTO "Plot" VALUES ('recUnresolved', ${status}, NULL)`;
      await assert.rejects(deploy(), /Unresolved plot lifecycle data/);
      const [active] = await prisma.$queryRaw`SELECT * FROM "Plot" WHERE "airtableId" = 'recActive'`;
      assert.deepEqual(active, {
        airtableId: 'recActive', status: ' Planted ', originalPlantDate: new Date('2024-12-05T00:00:00.000Z'),
      });
      const [declined] = await prisma.$queryRaw`SELECT * FROM "Plot" WHERE "airtableId" = ${declinedIds[0]}`;
      assert.equal(declined.status, 'Residents Declined');
      assert.equal(Object.hasOwn(declined, 'stage'), false);
      const indexes = await prisma.$queryRaw`SELECT indexname FROM pg_indexes WHERE tablename = 'Plot'`;
      assert.ok(indexes.some(({ indexname }) => indexname === 'Plot_status_idx'));
      assert.ok(indexes.every(({ indexname }) => indexname !== 'Plot_stage_idx'));
      await prisma.$executeRaw`DELETE FROM "Plot" WHERE "airtableId" = 'recUnresolved'`;
    }
    await deploy();
  });

  await t.test('reviewed IDs do not assign a stage when their source status is unfamiliar', async () => {
    await prisma.$executeRaw`UPDATE "Plot" SET status = 'Needs a visit' WHERE "airtableId" = ${declinedIds[0]}`;
    await assert.rejects(deploy(), /Unresolved plot lifecycle data/);
  });
});
