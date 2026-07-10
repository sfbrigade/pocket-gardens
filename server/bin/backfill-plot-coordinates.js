#!/usr/bin/env node

import '../config.js';
import {
  airtable,
  buildListSearchParams,
  preparePlotCoordinateBackfill,
  TABLES,
} from '#lib/airtable.js';

const writeMode = process.argv.includes('--write');

async function fetchAllPlotRecords () {
  const records = [];
  let offset;
  do {
    const searchParams = buildListSearchParams({ pageSize: 100, offset });
    const page = await airtable(TABLES.plots, '', { searchParams });
    records.push(...page.records);
    offset = page.offset;
  } while (offset);
  return records;
}

const records = await fetchAllPlotRecords();
const updates = [];
const skipped = [];

for (const record of records) {
  const result = preparePlotCoordinateBackfill(record);
  if (!result) {
    continue;
  }
  if (result.invalidValue !== undefined) {
    skipped.push(result);
    continue;
  }
  updates.push(result);
}

console.log(`Scanned ${records.length} plot record(s).`);
console.log(`${updates.length} record(s) ready to backfill.`);

for (const { id, update } of updates) {
  console.log(`${writeMode ? 'Updating' : 'Would update'} ${id}:`, update);
}

for (const { id, invalidValue } of skipped) {
  console.log(`Skipping ${id}: invalid Map Coordinates "${invalidValue}"`);
}

if (writeMode) {
  for (const { id, update } of updates) {
    await airtable(TABLES.plots, `/${id}`, {
      method: 'PATCH',
      body: { fields: update },
    });
  }
  console.log(`Updated ${updates.length} record(s).`);
} else if (updates.length > 0) {
  console.log('Dry run only. Re-run with --write to patch Airtable.');
}
