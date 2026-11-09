import assert from 'node:assert/strict';
import { test } from 'node:test';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { build } from '#test/helper.js';

test('Airtable plot import validates dry-runs and writes before changing data', async (t) => {
  const app = await build(t);
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'plot-import-test-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const mockFetch = path.join(directory, 'fetch.mjs');
  await fs.writeFile(mockFetch, `
    globalThis.fetch = async (url) => {
      if (new URL(url).hostname !== 'api.airtable.com') throw new Error('Unexpected outbound request');
      return new Response(JSON.stringify({ records: JSON.parse(process.env.TEST_PLOT_RECORDS) }));
    };
  `);
  const run = (records, args = []) => promisify(execFile)(process.execPath, [
    '--import', mockFetch, 'bin/airtable-import.js', '--tables=Plots', ...args,
  ], {
    cwd: fileURLToPath(new URL('../../', import.meta.url)),
    env: { ...process.env, AIRTABLE_API_KEY: 'test', AIRTABLE_BASE_ID: 'test', TEST_PLOT_RECORDS: JSON.stringify(records) },
  });
  const record = (id, status) => ({ id, createdTime: '2024-12-05T00:00:00.000Z', fields: { Status: status } });

  await t.test('both modes reject an unresolved batch without inserting even its valid records', async () => {
    const before = await app.prisma.plot.count();
    for (const args of [[], ['--dry-run']]) {
      await assert.rejects(run([record('recNewKnown', 'Planted'), record('recUnknown', 'Residents Declined')], args), (error) => {
        assert.equal(error.code, 1);
        assert.match(error.stdout, /recUnknown/);
        assert.match(error.stdout, /Choose an explicit stage/);
        return true;
      });
      assert.equal(await app.prisma.plot.count(), before);
    }
  });

  await t.test('write and repeated import preserve canonical stages while mapping new plots', async () => {
    await app.prisma.plot.update({ where: { airtableId: 'recPlotBeta' }, data: { stage: 'preparing' } });
    const records = [record('recPlotBeta', 'Not Yet Planted'), record('recNewKnown', 'Planted')];
    await run(records, ['--dry-run']);
    assert.equal(await app.prisma.plot.count({ where: { airtableId: 'recNewKnown' } }), 0);
    await run(records);
    await run(records);
    assert.equal((await app.prisma.plot.findUnique({ where: { airtableId: 'recPlotBeta' } })).stage, 'preparing');
    assert.equal((await app.prisma.plot.findUnique({ where: { airtableId: 'recNewKnown' } })).stage, 'active');
    assert.equal(await app.prisma.plot.count(), 4);
  });

  await t.test('explicit declined resolution writes permission and preserves the source planting date', async () => {
    const resolutions = path.join(directory, 'resolutions.json');
    await fs.writeFile(resolutions, JSON.stringify({ recDeclinedSynthetic: 'paused' }));
    const row = record('recDeclinedSynthetic', 'Residents Declined');
    row.fields['Original Plant Date'] = '2024-12-05';
    const args = [`--plot-stage-resolutions=${resolutions}`];
    await run([row], ['--dry-run', ...args]);
    assert.equal(await app.prisma.plot.count({ where: { airtableId: row.id } }), 0);
    await run([row], args);
    const saved = await app.prisma.plot.findUnique({ where: { airtableId: row.id } });
    assert.equal(saved.stage, 'paused');
    assert.equal(saved.permissionStatus, 'not_granted');
    assert.equal(saved.originalPlantDate.toISOString(), '2024-12-05T00:00:00.000Z');
  });
});
