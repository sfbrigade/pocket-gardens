import fs from 'node:fs/promises';
import { z } from 'zod';

import { PLOT_STAGES } from '#lib/plot-lifecycle.js';

const stagesByStatus = new Map([['Planted', 'active'], ['Not Yet Planted', 'potential']]);
const ResolutionsSchema = z.record(z.string().min(1), z.enum(PLOT_STAGES));

export async function readStageResolutions (filename) {
  return filename ? ResolutionsSchema.parse(JSON.parse(await fs.readFile(filename, 'utf8'))) : {};
}

// Translation belongs at the migration/import boundary, never in the plot API.
export function resolveImportedPlotLifecycle (row, resolutions = {}) {
  const status = row.status?.trim() || null;
  const resolution = Object.hasOwn(resolutions, row.airtableId) ? resolutions[row.airtableId] : undefined;
  if (row.stage != null && !PLOT_STAGES.includes(row.stage)) throw new Error('Invalid existing stage');
  if (resolution !== undefined && !PLOT_STAGES.includes(resolution)) throw new Error('Invalid stage resolution');
  if (row.stage != null && resolution !== undefined && resolution !== row.stage) {
    throw new Error('Resolution conflicts with the existing stage');
  }
  const stage = row.stage ?? resolution ?? stagesByStatus.get(status) ?? null;
  if (status && !stage) throw new Error(`Choose an explicit stage for status ${JSON.stringify(status)}`);
  let permissionStatus = row.permissionStatus ?? null;
  if (status === 'Residents Declined') {
    if (permissionStatus !== null && permissionStatus !== 'not_granted') {
      throw new Error('Residents Declined conflicts with the existing permission status');
    }
    permissionStatus = 'not_granted';
  }
  return { stage, permissionStatus };
}

export function planPlotStageMigration (rows, resolutions = {}) {
  const updates = [];
  const unresolved = [];
  for (const row of rows) {
    try {
      updates.push({ airtableId: row.airtableId, ...resolveImportedPlotLifecycle(row, resolutions) });
    } catch (error) {
      unresolved.push({ airtableId: row.airtableId, status: row.status, message: error.message });
    }
  }
  const ids = new Set(rows.map(({ airtableId }) => airtableId));
  for (const airtableId of Object.keys(resolutions)) {
    if (!ids.has(airtableId)) unresolved.push({ airtableId, message: 'Resolution does not match a plot in this batch' });
  }
  return { updates, unresolved };
}
