import { test } from 'node:test';
import * as assert from 'node:assert';
import fs from 'node:fs';

import {
  buildJoinSyncPlan,
  buildPlantSlotSyncPlan,
} from '#lib/airtable-import-joins.js';
import {
  assetPathToKey,
  isMigratedAssetPaths,
  migratePlotPhotoAttribute,
  uploadAirtableAttachments,
} from '#lib/airtable-photos.js';

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

test('isMigratedAssetPaths and assetPathToKey', () => {
  assert.strictEqual(
    isMigratedAssetPaths(['/api/assets/plots/x/photo/a.jpg']),
    true
  );
  assert.strictEqual(isMigratedAssetPaths([]), false);
  assert.strictEqual(isMigratedAssetPaths([{ url: 'https://airtable.com/x' }]), false);
  assert.strictEqual(
    assetPathToKey('/api/assets/plots/x/photo/a.jpg'),
    'plots/x/photo/a.jpg'
  );
  assert.strictEqual(assetPathToKey('plots/x/photo/a.jpg'), null);
});

test('uploadAirtableAttachments cleans up partial uploads on failure', async () => {
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
    plotId: '11111111-1111-4111-8111-111111111111',
    attribute: 'photos',
    attachments: [
      { url: 'https://example.test/a.jpg', filename: 'a.jpg', type: 'image/jpeg' },
      { url: 'https://example.test/b.jpg', filename: 'b.jpg', type: 'image/jpeg' },
      { url: 'https://example.test/c.jpg', filename: 'c.jpg', type: 'image/jpeg' },
    ],
    dryRun: false,
    fetchImpl,
    s3Client,
  });

  assert.strictEqual(result.paths, null);
  assert.strictEqual(result.uploaded, 0);
  assert.strictEqual(result.errors.length, 1);
  // Mock pushes before throwing on the 2nd put; the 3rd still runs and succeeds.
  assert.strictEqual(putKeys.length, 3);
  // Only keys that completed putObject are cleaned up (1st and 3rd).
  assert.deepStrictEqual(deletedKeys, [putKeys[0], putKeys[2]]);
});

test('migratePlotPhotoAttribute skips migrated paths and reports stale assets on force', async () => {
  const deletedKeys = [];
  const s3Client = {
    async putObject () {},
    async deleteObject (key) {
      deletedKeys.push(key);
    },
  };
  const existing = [
    '/api/assets/plots/p1/photo/old.jpg',
  ];

  const skipped = await migratePlotPhotoAttribute({
    plotId: 'p1',
    attribute: 'photo',
    existing,
    attachments: [{ url: 'https://example.test/n.jpg', filename: 'n.jpg' }],
    dryRun: true,
    force: false,
    s3Client,
  });
  assert.strictEqual(skipped.action, 'skipped');

  const forced = await migratePlotPhotoAttribute({
    plotId: 'p1',
    attribute: 'photo',
    existing,
    attachments: [{ url: 'https://example.test/n.jpg', filename: 'n.jpg', type: 'image/jpeg' }],
    dryRun: false,
    force: true,
    fetchImpl: async () => ({
      ok: true,
      status: 200,
      statusText: 'OK',
      arrayBuffer: async () => Buffer.from('img'),
    }),
    s3Client,
  });
  assert.strictEqual(forced.action, 'updated');
  assert.strictEqual(forced.uploaded, 1);
  assert.deepStrictEqual(forced.stalePaths, existing);
  // Deletion is deferred to callers after DB update
  assert.deepStrictEqual(deletedKeys, []);
});

test('migratePlotPhotoAttribute dry-run counts uploads without DATABASE_URL', async () => {
  const result = await migratePlotPhotoAttribute({
    plotId: 'p1',
    attribute: 'photos',
    existing: null,
    attachments: [
      { url: 'https://example.test/a.jpg', filename: 'a.jpg' },
      { url: 'https://example.test/b.jpg', filename: 'b.jpg' },
    ],
    dryRun: true,
  });
  assert.strictEqual(result.action, 'updated');
  assert.strictEqual(result.uploaded, 2);
  assert.strictEqual(result.cleared, false);
});
