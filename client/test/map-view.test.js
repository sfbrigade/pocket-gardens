import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readExploreView, saveExploreView } from '../src/map-view.js';

test('returning from a garden form restores the selected garden viewport', () => {
  let stored;
  const storage = { getItem: () => stored, setItem: (key, value) => { stored = value; } };
  assert.equal(readExploreView('recGarden', storage), null);
  const view = { center: [37.78, -122.43], zoom: 16, plotId: 'recGarden' };
  saveExploreView(view, storage);
  assert.deepEqual(readExploreView('recGarden', storage), view);
  assert.equal(readExploreView('recOtherGarden', storage), null);
  assert.equal(readExploreView(undefined, storage), null);
});

test('invalid or unavailable browser storage does not break map startup', () => {
  assert.equal(readExploreView('recGarden', { getItem: () => '{broken' }), null);
  assert.equal(readExploreView('recGarden', { getItem: () => JSON.stringify({ plotId: 'recGarden', center: [null, 200], zoom: 99 }) }), null);
  assert.doesNotThrow(() => saveExploreView({}, { setItem: () => { throw new Error('Storage disabled'); } }));
});
