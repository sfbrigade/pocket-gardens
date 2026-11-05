#!/usr/bin/env node
import '../config.js';
import { parseArgs } from 'node:util';
import { readStageResolutions } from '#lib/airtable-plot-stage.js';
import { migratePlotStages } from '#lib/plot-stage-migration.js';

const { values } = parseArgs({
  options: { apply: { type: 'boolean', default: false }, resolutions: { type: 'string' } },
});
let prisma;
try {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL must be set');
  const resolutions = await readStageResolutions(values.resolutions);
  ({ default: prisma } = await import('#prisma/client.js'));
  const result = await migratePlotStages(prisma, { apply: values.apply, resolutions });
  console.log(JSON.stringify({ applied: values.apply && !result.alreadyMigrated, ...result }, null, 2));
  if (result.unresolved.length) process.exitCode = 1;
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
} finally {
  await prisma?.$disconnect();
}
