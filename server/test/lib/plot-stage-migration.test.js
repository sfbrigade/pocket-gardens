import assert from 'node:assert/strict';
import { test } from 'node:test';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { PostgreSqlContainer } from '@testcontainers/postgresql';

import { createClient } from '#prisma/client.js';
import { migratePlotStages } from '#lib/plot-stage-migration.js';

const migration = fileURLToPath(new URL('../../prisma/migrations/20261104000000_plot_stage_only/migration.sql', import.meta.url));
const serverDir = fileURLToPath(new URL('../../', import.meta.url));

test('stage-only upgrade preserves data and refuses unresolved lifecycle values', async (t) => {
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
      "airtableId" TEXT PRIMARY KEY, status TEXT, stage TEXT, "permissionStatus" TEXT, "originalPlantDate" TIMESTAMP
    )`);
    await prisma.$executeRawUnsafe('CREATE INDEX "Plot_status_idx" ON "Plot"(status)');
    await prisma.$executeRawUnsafe(`INSERT INTO "Plot" VALUES
      ('recActive', 'Planted', NULL, NULL, '2024-12-05'),
      ('recPreparing', 'Not Yet Planted', 'preparing', 'confirmed', NULL),
      ('recPotential', 'Not Yet Planted', NULL, NULL, NULL),
      ('recDeclined', 'Residents Declined', NULL, NULL, '2024-12-05'),
      ('recMissing', NULL, NULL, NULL, NULL)`);
    await prisma.$executeRawUnsafe('DROP TABLE IF EXISTS "PlotStageWrites"');
    await prisma.$executeRawUnsafe('CREATE TABLE "PlotStageWrites" ("airtableId" TEXT)');
    await prisma.$executeRawUnsafe(`CREATE OR REPLACE FUNCTION track_plot_stage_write() RETURNS trigger AS $$
      BEGIN INSERT INTO "PlotStageWrites" VALUES (NEW."airtableId"); RETURN NEW; END;
    $$ LANGUAGE plpgsql`);
    await prisma.$executeRawUnsafe(`CREATE TRIGGER track_plot_stage_write AFTER UPDATE ON "Plot"
      FOR EACH ROW EXECUTE FUNCTION track_plot_stage_write()`);
  });

  await t.test('preflight is read-only and apply refuses partial resolution', async () => {
    const report = await migratePlotStages(prisma);
    assert.equal(report.snapshot.length, 5);
    assert.deepEqual(report.unresolved.map(({ airtableId }) => airtableId), ['recDeclined']);
    await assert.rejects(migratePlotStages(prisma, { apply: true }), /Resolve every reported plot/);
    const [row] = await prisma.$queryRaw`SELECT stage FROM "Plot" WHERE "airtableId" = 'recActive'`;
    assert.equal(row.stage, null);
  });

  await t.test('failed migration rolls back even the automatic backfill and retains status', async () => {
    await assert.rejects(deploy(), /Unresolved plot lifecycle data/);
    const [row] = await prisma.$queryRaw`SELECT status, stage FROM "Plot" WHERE "airtableId" = 'recActive'`;
    assert.deepEqual(row, { status: 'Planted', stage: null });
  });

  await t.test('conversion updates only changed plots and repeated application writes nothing', async () => {
    const options = { apply: true, resolutions: { recDeclined: 'paused' } };
    await migratePlotStages(prisma, options);
    const writes = await prisma.$queryRaw`SELECT "airtableId" FROM "PlotStageWrites" ORDER BY "airtableId"`;
    assert.deepEqual(writes.map(({ airtableId }) => airtableId), ['recActive', 'recDeclined', 'recPotential']);
    await prisma.$executeRawUnsafe('TRUNCATE "PlotStageWrites"');
    await migratePlotStages(prisma, options);
    const repeated = await prisma.$queryRaw`SELECT * FROM "PlotStageWrites"`;
    assert.deepEqual(repeated, []);
  });

  await t.test('reviewed resolutions preserve stages, permissions, and dates before removing status', async () => {
    await migratePlotStages(prisma, { apply: true, resolutions: { recDeclined: 'paused' } });
    await deploy();
    const rows = await prisma.$queryRaw`SELECT * FROM "Plot" ORDER BY "airtableId"`;
    assert.ok(rows.every((row) => !Object.hasOwn(row, 'status')));
    const byId = new Map(rows.map((row) => [row.airtableId, row]));
    assert.equal(byId.get('recActive').stage, 'active');
    assert.equal(byId.get('recPotential').stage, 'potential');
    assert.equal(byId.get('recPreparing').stage, 'preparing');
    assert.equal(byId.get('recPreparing').permissionStatus, 'confirmed');
    assert.equal(byId.get('recDeclined').stage, 'paused');
    assert.equal(byId.get('recDeclined').permissionStatus, 'not_granted');
    assert.equal(byId.get('recDeclined').originalPlantDate.toISOString(), '2024-12-05T00:00:00.000Z');
    assert.equal(byId.get('recMissing').stage, null);
    assert.equal((await migratePlotStages(prisma)).alreadyMigrated, true);
  });

  await t.test('permission conflicts and unfamiliar statuses cannot be discarded by migration', async () => {
    await prisma.$executeRaw`UPDATE "Plot" SET stage = 'active', "permissionStatus" = 'confirmed' WHERE "airtableId" = 'recDeclined'`;
    const report = await migratePlotStages(prisma);
    assert.match(report.unresolved[0].message, /permission status/);
    await assert.rejects(deploy(), /Unresolved plot lifecycle data/);
    await prisma.$executeRaw`UPDATE "Plot" SET status = 'Unfamiliar', stage = NULL, "permissionStatus" = NULL WHERE "airtableId" = 'recDeclined'`;
    await assert.rejects(deploy(), /Unresolved plot lifecycle data/);
  });
});
