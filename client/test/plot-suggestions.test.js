import assert from 'node:assert/strict';
import { test } from 'node:test';
import { setImmediate, setTimeout as delay } from 'node:timers/promises';
import { defaultScheduler, focusManager, notifyManager } from '@tanstack/react-query';
import { createPlotDraft } from '../src/Plots/plot-form.js';
import { draftStorageKey, interact, setupPlotTests, waitFor } from './helpers/plot-harness.js';

test('garden suggestion requests', async (t) => {
  const { dom, Api, mount } = await setupPlotTests(t);

  await t.test('returning to the tab does not repeat a failed Photon lookup', async (t) => {
    // The query cache can settle before React renders its asynchronous notification.
    notifyManager.setScheduler((callback) => setTimeout(callback, 100));
    t.after(() => notifyManager.setScheduler(defaultScheduler));
    const position = { latitude: 37.77, longitude: -122.43 };
    dom.window.sessionStorage.setItem(draftStorageKey, JSON.stringify({ ...createPlotDraft(), position }));
    const lookup = t.mock.method(globalThis, 'fetch', async () => { throw new Error('Photon unavailable'); });
    const view = await mount(t);
    await waitFor(() => assert.match(view.container.textContent, /No nearby address could be suggested/));
    assert.equal(lookup.mock.calls.length, 1);

    t.after(() => focusManager.setFocused(undefined));
    await interact(async () => {
      focusManager.setFocused(false);
      focusManager.setFocused(true);
      await setImmediate();
    });
    assert.equal(lookup.mock.calls.length, 1);
    assert.match(view.container.textContent, /No nearby address could be suggested/);
  });

  await t.test('rapid pin changes check nearby gardens only for the settled location', async (t) => {
    dom.window.sessionStorage.removeItem(draftStorageKey);
    // Keep address lookup independent of the application's nearby-garden requests.
    t.mock.method(globalThis, 'fetch', async () => ({ ok: true, json: async () => ({ features: [] }) }));
    const { Map, latLng } = await import('leaflet');
    const positions = [37.77001, 37.77002, 37.77003].map((latitude) => latLng(latitude, -122.43));
    const finalPosition = positions.at(-1);
    const gardens = [150, 210].map((metres) => ({
      id: String(metres),
      'Pocket Garden Name': `${metres} m garden`,
      Latitude: finalPosition.lat + metres / 111320,
      Longitude: finalPosition.lng,
    }));
    const list = t.mock.method(Api.plots, 'index', async () => ({ data: gardens, headers: {} }));
    const initialize = Map.prototype.initialize;
    let map;
    t.mock.method(Map.prototype, 'initialize', function (...args) {
      initialize.apply(this, args);
      map = this;
    });
    const view = await mount(t);
    await view.click('Choose or adjust the map location');
    await waitFor(() => assert.ok(map));

    const areas = positions.map((position) => position.toBounds(440));
    const nearbyRequests = () => list.mock.calls.filter(({ arguments: [params] }) => areas.some((area) =>
      params.north === area.getNorth() && params.south === area.getSouth() &&
      params.east === area.getEast() && params.west === area.getWest()));
    for (const latlng of positions) {
      await interact(() => map.fire('click', { latlng }));
      await interact(() => delay(50));
    }
    assert.equal(nearbyRequests().length, 0);
    assert.match(view.container.ownerDocument.body.textContent, /Checking nearby gardens/);

    await waitFor(() => assert.equal(nearbyRequests().length, 1));
    const finalArea = positions.at(-1).toBounds(440);
    assert.equal(nearbyRequests()[0].arguments[0].north, finalArea.getNorth());
    assert.equal(nearbyRequests()[0].arguments[0].south, finalArea.getSouth());
    await waitFor(() => assert.match(view.container.ownerDocument.body.textContent, /1 garden within 200 m\. Nearest: 150 m garden, 150 m away\./));
  });
});
