import { test } from 'node:test';
import * as assert from 'node:assert';

import { runPhotoHandlers, syncPhotos } from '#lib/photos.js';
import PlotPhoto from '#models/plot-photo.js';

function mockDelegate (existing = []) {
  const rows = existing.map((row) => ({ ...row }));
  const ops = { created: [], updated: [], deleted: [] };
  let nextId = 1;
  return {
    ops,
    rows,
    async findMany () {
      return rows.map((row) => ({ ...row }));
    },
    async create ({ data }) {
      const row = { id: `new-${nextId++}`, file: null, ...data };
      rows.push(row);
      ops.created.push({ ...row });
      return row;
    },
    async update ({ where, data }) {
      const row = rows.find((r) => r.id === where.id);
      Object.assign(row, data);
      ops.updated.push({ id: where.id, ...data });
      return row;
    },
    async delete ({ where }) {
      const index = rows.findIndex((r) => r.id === where.id);
      const [removed] = rows.splice(index, 1);
      ops.deleted.push(where.id);
      return removed;
    },
  };
}

test('syncPhotos creates rows for new filenames and deletes missing ones', async () => {
  const delegate = mockDelegate([
    { id: 'keep', plotId: 'plot-1', file: 'keep.jpg', position: 0 },
    { id: 'gone', plotId: 'plot-1', file: 'gone.jpg', position: 1 },
  ]);

  const handlers = await syncPhotos({
    delegate,
    PhotoClass: PlotPhoto,
    parentFk: 'plotId',
    parentId: 'plot-1',
    filenames: ['keep.jpg', 'fresh.jpg'],
  });

  assert.strictEqual(delegate.ops.created.length, 1);
  assert.strictEqual(delegate.ops.created[0].file, null);
  assert.strictEqual(delegate.ops.created[0].position, 1);
  assert.ok(delegate.ops.updated.some((u) => u.file === 'fresh.jpg'));
  assert.deepStrictEqual(delegate.ops.deleted, ['gone']);
  assert.strictEqual(handlers.filter(Boolean).length, 2);

  const keep = delegate.rows.find((r) => r.id === 'keep');
  assert.strictEqual(keep.position, 0);
  assert.strictEqual(keep.file, 'keep.jpg');
});

test('syncPhotos with an empty list clears the gallery', async () => {
  const delegate = mockDelegate([
    { id: 'a', plotId: 'plot-1', file: 'a.jpg', position: 0 },
  ]);
  const handlers = await syncPhotos({
    delegate,
    PhotoClass: PlotPhoto,
    parentFk: 'plotId',
    parentId: 'plot-1',
    filenames: [],
  });
  assert.deepStrictEqual(delegate.ops.deleted, ['a']);
  assert.strictEqual(handlers.length, 1);
});

test('runPhotoHandlers invokes deferred setAsset callbacks', async () => {
  const calls = [];
  await runPhotoHandlers([
    undefined,
    async () => { calls.push(1); },
    async () => { calls.push(2); },
  ]);
  assert.deepStrictEqual(calls, [1, 2]);
});
