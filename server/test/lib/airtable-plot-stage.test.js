import assert from 'node:assert/strict';
import { test } from 'node:test';

import { planPlotStageMigration, resolveImportedPlotLifecycle } from '#lib/airtable-plot-stage.js';

test('import converts recognized statuses and preserves an existing canonical stage', () => {
  assert.deepEqual(resolveImportedPlotLifecycle({ status: 'Planted' }), { stage: 'active', permissionStatus: null });
  assert.equal(resolveImportedPlotLifecycle({ status: ' Not Yet Planted ' }).stage, 'potential');
  assert.equal(resolveImportedPlotLifecycle({ status: 'Not Yet Planted', stage: 'preparing' }).stage, 'preparing');
  assert.equal(resolveImportedPlotLifecycle({ status: null }).stage, null);
  assert.equal(resolveImportedPlotLifecycle({ status: ' ', stage: 'paused' }).stage, 'paused');
});

test('declined plots need a chosen stage independently of planting history', () => {
  const row = { airtableId: 'recDeclined', status: 'Residents Declined', originalPlantDate: new Date() };
  assert.throws(() => resolveImportedPlotLifecycle(row), /Choose an explicit stage/);
  assert.deepEqual(resolveImportedPlotLifecycle(row, { recDeclined: 'active' }), {
    stage: 'active', permissionStatus: 'not_granted',
  });
  assert.throws(() => resolveImportedPlotLifecycle({ ...row, permissionStatus: 'confirmed' }, { recDeclined: 'archived' }), /permission status/);
});

test('import preflight reports every unresolved record without proposing guessed stages', () => {
  const rows = [
    { airtableId: 'recKnown', status: 'Planted' },
    { airtableId: 'recDeclined', status: 'Residents Declined' },
    { airtableId: 'recUnfamiliar', status: 'Needs a visit' },
  ];
  const plan = planPlotStageMigration(rows);
  assert.deepEqual(plan.updates.map(({ airtableId }) => airtableId), ['recKnown']);
  assert.deepEqual(plan.unresolved.map(({ airtableId }) => airtableId), ['recDeclined', 'recUnfamiliar']);
  assert.equal(planPlotStageMigration(rows, { recDeclined: 'potential', recUnfamiliar: 'paused' }).unresolved.length, 0);
});

test('resolutions cannot silently overwrite stages or target nonexistent records', () => {
  assert.throws(() => resolveImportedPlotLifecycle({ airtableId: 'recPlot', stage: 'preparing' }, { recPlot: 'active' }), /conflicts/);
  assert.throws(() => resolveImportedPlotLifecycle({ airtableId: 'recPlot' }, { recPlot: 'invalid' }), /Invalid stage/);
  assert.throws(() => resolveImportedPlotLifecycle({ stage: 'invalid' }), /Invalid existing stage/);
  assert.equal(planPlotStageMigration([], { recTypo: 'active' }).unresolved[0].airtableId, 'recTypo');
});
