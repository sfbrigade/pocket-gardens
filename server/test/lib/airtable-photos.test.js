import { test } from 'node:test';
import * as assert from 'node:assert';
import fs from 'node:fs';

import {
  buildJoinSyncPlan,
  buildPlantSlotSyncPlan,
} from '#lib/airtable-import-joins.js';
import {
  concatAttachments,
  migrateParentPhotos,
  uploadAirtableAttachments,
} from '#lib/airtable-photos.js';
import PlotPhoto from '#models/plot-photo.js';

test('buildJoinSyncPlan upserts resolved ids and skips deletes when unresolved', () => {
  const map = new Map([
    ['recA', 'uuid-a'],
    ['recB', 'uuid-b'],
  ]);
  const withUnresolved = buildJoinSyncPlan(['recA', 'recMissing', 'recB'], (id) => map.get(id));
  assert.deepStrictEqual(withUnresolved.desiredIds, ['uuid-a', 'uuid-b']);
  assert.strictEqual(withUnresolved.shouldDeleteMissing, false);
  assert.deepStrictEqual(withUnresolved.unresolvedIds, ['recMissing']);

  const allResolved = buildJoinSyncPlan(['recA', 'recB'], (id) => map.get(id));
  assert.strictEqual(allResolved.shouldDeleteMissing, true);
  assert.deepStrictEqual(allResolved.desiredIds, ['uuid-a', 'uuid-b']);

  const cleared = buildJoinSyncPlan([], (id) => map.get(id));
  assert.strictEqual(cleared.shouldDeleteMissing, true);
  assert.deepStrictEqual(cleared.desiredIds, []);
});

test('buildPlantSlotSyncPlan preserves unresolved slots and drops cleared ones', () => {
  const plan = buildPlantSlotSyncPlan([
    { slot: 1, plantAirtableId: 'recPlant1', plantId: 'uuid-1' },
    { slot: 2, plantAirtableId: 'recMissing', plantId: null },
    { slot: 3, plantAirtableId: null, plantId: null },
    { slot: 4, plantAirtableId: 'recPlant4', plantId: 'uuid-4' },
  ]);
  assert.deepStrictEqual(plan.keptSlots, [1, 2, 4]);
  assert.deepStrictEqual(plan.upserts, [
    { slot: 1, plantId: 'uuid-1' },
    { slot: 4, plantId: 'uuid-4' },
  ]);
});

test('concatAttachments flattens Photo and Photos attachment groups', () => {
  const merged = concatAttachments(
    [{ url: 'https://example.test/a.jpg', filename: 'a.jpg' }],
    [{ url: 'https://example.test/b.jpg', filename: 'b.jpg' }, { filename: 'skip-me' }],
    null
  );
  assert.deepStrictEqual(merged.map((a) => a.filename), ['a.jpg', 'b.jpg']);
  assert.deepStrictEqual(concatAttachments(null, undefined, []), []);
});

test('uploadAirtableAttachments stages files in _uploads and cleans up partial uploads on failure', async () => {
  const putKeys = [];
  const deletedKeys = [];
  const s3Client = {
    async putObject (key, filePath) {
      putKeys.push(key);
      await fs.promises.access(filePath);
      if (putKeys.length === 2) {
        throw new Error('upload failed');
      }
    },
    async deleteObject (key) {
      deletedKeys.push(key);
    },
  };

  const fetchImpl = async (url) => ({
    ok: true,
    status: 200,
    statusText: 'OK',
    arrayBuffer: async () => Buffer.from(`body:${url}`),
  });

  const result = await uploadAirtableAttachments({
    attachments: [
      { url: 'https://example.test/a.jpg', filename: 'a.jpg', type: 'image/jpeg' },
      { url: 'https://example.test/b.jpg', filename: 'b.jpg', type: 'image/jpeg' },
      { url: 'https://example.test/c.jpg', filename: 'c.jpg', type: 'image/jpeg' },
    ],
    dryRun: false,
    fetchImpl,
    s3Client,
  });

  assert.deepStrictEqual(result.filenames, []);
  assert.strictEqual(result.uploaded, 0);
  assert.strictEqual(result.errors.length, 1);
  // Mock pushes before throwing on the 2nd put; the 3rd still runs and succeeds.
  assert.strictEqual(putKeys.length, 3);
  assert.ok(putKeys.every((key) => key.startsWith('_uploads/')));
  // Only keys that completed putObject are cleaned up (1st and 3rd).
  assert.deepStrictEqual(deletedKeys, [putKeys[0], putKeys[2]]);
});

test('migrateParentPhotos skips when photo rows already exist', async () => {
  const skipped = await migrateParentPhotos({
    delegateName: 'plotPhoto',
    PhotoClass: PlotPhoto,
    parentFk: 'plotId',
    parentId: 'p1',
    attachments: [{ url: 'https://example.test/n.jpg', filename: 'n.jpg' }],
    existingCount: 1,
    dryRun: true,
    force: false,
  });
  assert.strictEqual(skipped.action, 'skipped');

  const forced = await migrateParentPhotos({
    delegateName: 'plotPhoto',
    PhotoClass: PlotPhoto,
    parentFk: 'plotId',
    parentId: 'p1',
    attachments: [{ url: 'https://example.test/n.jpg', filename: 'n.jpg', type: 'image/jpeg' }],
    existingCount: 1,
    dryRun: true,
    force: true,
  });
  assert.strictEqual(forced.action, 'updated');
  assert.strictEqual(forced.uploaded, 1);
});

test('migrateParentPhotos dry-run counts uploads without DATABASE_URL', async () => {
  const result = await migrateParentPhotos({
    delegateName: 'plotPhoto',
    PhotoClass: PlotPhoto,
    parentFk: 'plotId',
    parentId: 'p1',
    attachments: [
      { url: 'https://example.test/a.jpg', filename: 'a.jpg' },
      { url: 'https://example.test/b.jpg', filename: 'b.jpg' },
    ],
    existingCount: 0,
    dryRun: true,
  });
  assert.strictEqual(result.action, 'updated');
  assert.strictEqual(result.uploaded, 2);
  assert.strictEqual(result.cleared, false);
});
