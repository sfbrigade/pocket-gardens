import assert from 'node:assert/strict';
import { test } from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { interact, setupPlotTests, waitFor } from './helpers/plot-harness.js';

test('map viewport interactions', async (t) => {
  const { dom, Api, mount, readDraft } = await setupPlotTests(t);
  const { Map, Marker, latLngBounds } = await import('leaflet');
  const initialize = Map.prototype.initialize;
  let map;
  t.mock.method(Map.prototype, 'initialize', function (...args) {
    initialize.apply(this, args);
    map = this;
  });
  // jsdom has no map layout. Supply geographic bounds at the real map seam.
  t.mock.method(Map.prototype, 'getBounds', () => latLngBounds([[37.76, -122.44], [37.80, -122.40]]));

  for (const startEvent of ['movestart', 'zoomstart']) {
    await t.test(`pauses pending viewport work during ${startEvent}, including resize`, async (t) => {
      let visible = latLngBounds([[37.77, -122.43], [37.78, -122.42]]);
      t.mock.method(Map.prototype, 'getBounds', () => visible);
      const garden = { id: 'garden', Latitude: 37.775, Longitude: -122.425 };
      const list = t.mock.method(Api.plots, 'index', async () => ({ data: [garden], headers: {} }));
      const view = await mount(t, { initialEntry: '/', showHome: true });
      await waitFor(() => assert.equal(list.mock.calls.length, 1));
      const markers = () => Object.values(map._layers).filter((layer) => layer instanceof Marker);
      await waitFor(() => assert.equal(markers().length, 1));
      const originalMarker = markers()[0];

      visible = latLngBounds([[37.79, -122.41], [37.80, -122.40]]);
      await interact(() => map.fire('moveend'));
      await interact(() => delay(50));
      // A new interaction begins before the previous debounce expires.
      visible = latLngBounds([[37.80, -122.40], [37.81, -122.39]]);
      await interact(() => map.fire(startEvent));
      await interact(() => delay(300));
      assert.equal(list.mock.calls.length, 1, 'do not fetch intermediate bounds during an active interaction');
      assert.deepEqual(markers(), [originalMarker], 'do not cull markers mid-interaction');

      await interact(() => map.fire('resize'));
      await interact(() => delay(300));
      assert.equal(list.mock.calls.length, 1, 'resize must not restart work while the interaction is active');
      assert.deepEqual(markers(), [originalMarker]);

      visible = latLngBounds([[37.81, -122.39], [37.82, -122.38]]);
      await interact(() => map.fire('zoomend').fire('moveend'));
      await waitFor(() => assert.equal(list.mock.calls.length, 2));
      const bounds = list.mock.calls.at(-1).arguments[0];
      assert.ok(bounds.north >= visible.getNorth() && bounds.south <= visible.getSouth());
      assert.ok(bounds.east >= visible.getEast() && bounds.west <= visible.getWest());
      await interact(() => map.fire('resize'));
      await interact(() => delay(300));
      assert.equal(list.mock.calls.length, 2, 'settled covered bounds still reuse the fetched data');
      await view.unmount();
    });
  }

  await t.test('unloads offscreen markers and restores cached pins without requests or recreating retained markers', async (t) => {
    const center = { id: 'center', Latitude: 37.78, Longitude: -122.42 };
    const edge = { id: 'edge', Latitude: 37.781, Longitude: -122.428 };
    const margin = { id: 'margin', Latitude: 37.78, Longitude: -122.4255 };
    const buffered = { id: 'buffered', Latitude: 37.78, Longitude: -122.448 };
    const list = t.mock.method(Api.plots, 'index', async () => ({ data: [center, edge, margin, buffered], headers: {} }));
    const view = await mount(t, { initialEntry: '/', showHome: true });
    const markers = () => Object.values(map._layers).filter((layer) => layer instanceof Marker);
    const markerAt = (plot) => markers().find((marker) => marker.getLatLng().lat === plot.Latitude && marker.getLatLng().lng === plot.Longitude);
    await waitFor(() => assert.equal(list.mock.calls.length, 1));
    await waitFor(() => assert.equal(markers().length, 3, 'data in the fetch buffer should not all become markers'));
    const originalCenter = markerAt(center);
    const originalEdge = markerAt(edge);
    const positionUpdates = t.mock.method(originalCenter, 'setLatLng');

    let visible = latLngBounds([[37.775, -122.425], [37.785, -122.415]]);
    t.mock.method(map, 'getBounds', () => visible);
    await interact(() => map.fire('zoomend').fire('moveend'));
    await waitFor(() => assert.equal(markers().length, 2, 'zooming in should unload distant markers'));
    assert.ok(markerAt(margin), 'keep a small margin of offscreen pins to avoid churn near the screen edge');
    assert.strictEqual(markerAt(center), originalCenter);
    assert.equal(markerAt(edge), undefined);
    assert.equal(list.mock.calls.length, 1);

    for (const delta of [0.00001, -0.00001]) {
      visible = latLngBounds([[37.775 + delta, -122.425], [37.785 + delta, -122.415]]);
      await interact(() => map.fire('moveend'));
      await interact(() => delay(300));
      assert.strictEqual(markerAt(center), originalCenter);
      assert.equal(positionUpdates.mock.calls.length, 0, 'retained markers should not receive redundant position updates');
    }

    visible = latLngBounds([[37.775, -122.43], [37.785, -122.42]]);
    await interact(() => map.fire('moveend'));
    await waitFor(() => assert.ok(markerAt(edge)));
    assert.notStrictEqual(markerAt(edge), originalEdge, 'an unloaded marker is recreated from cached data');
    assert.strictEqual(markerAt(center), originalCenter);
    assert.equal(list.mock.calls.length, 1);

    // Keep an open popup mounted even when the viewport moves away from it.
    const edgeMarker = markerAt(edge);
    await interact(() => edgeMarker.openPopup());
    visible = latLngBounds([[37.775, -122.425], [37.785, -122.415]]);
    await interact(() => map.fire('moveend'));
    await interact(() => delay(300));
    assert.strictEqual(markerAt(edge), edgeMarker);
    assert.equal(edgeMarker.isPopupOpen(), true);
    await interact(() => edgeMarker.closePopup());
    await waitFor(() => assert.equal(markerAt(edge), undefined));

    visible = latLngBounds([[37.76, -122.449], [37.80, -122.409]]);
    await interact(() => map.fire('moveend'));
    await waitFor(() => assert.ok(markerAt(buffered), 'panning into the fetch buffer should use cached data'));
    assert.equal(list.mock.calls.length, 1);
    assert.equal(positionUpdates.mock.calls.length, 0);
    assert.equal(view.client.getQueryCache().findAll({ queryKey: ['plots'] }).find(({ queryKey }) => typeof queryKey[1] === 'object').state.data.length, 4);

    const bufferedMarker = markerAt(buffered);
    await interact(() => bufferedMarker.openPopup());
    list.mock.mockImplementation(async () => ({ data: [], headers: {} }));
    visible = latLngBounds([[37.81, -122.40], [37.82, -122.39]]);
    await interact(() => map.fire('moveend'));
    await waitFor(() => assert.equal(list.mock.calls.length, 2));
    await waitFor(() => assert.equal(markers().length, 1));
    assert.strictEqual(markerAt(buffered), bufferedMarker, 'the open popup survives replacement fetch coverage');
    assert.equal(bufferedMarker.isPopupOpen(), true);
    await interact(() => bufferedMarker.closePopup());
    await waitFor(() => assert.equal(markers().length, 0));
  });

  await t.test('retains the selected garden outside rendering and fetched coverage without duplicates', async (t) => {
    const selected = { id: 'selected', Latitude: 37.78, Longitude: -122.428 };
    const list = t.mock.method(Api.plots, 'index', async () => ({ data: [selected], headers: {} }));
    const view = await mount(t, { initialEntry: '/plots/selected', showHome: true, queryData: [[['plot', selected.id], selected]] });
    await waitFor(() => assert.equal(list.mock.calls.length, 1));
    const markers = () => Object.values(map._layers).filter((layer) => layer instanceof Marker);
    await waitFor(() => assert.equal(markers().length, 1));
    const original = markers()[0];
    let visible = latLngBounds([[37.775, -122.425], [37.785, -122.415]]);
    t.mock.method(map, 'getBounds', () => visible);
    await interact(() => map.fire('moveend'));
    await interact(() => delay(300));
    assert.deepEqual(markers(), [original]);
    assert.equal(list.mock.calls.length, 1);

    list.mock.mockImplementation(async () => ({ data: [], headers: {} }));
    visible = latLngBounds([[37.81, -122.40], [37.82, -122.39]]);
    await interact(() => map.fire('moveend'));
    await waitFor(() => assert.equal(list.mock.calls.length, 2));
    await waitFor(() => assert.equal(view.client.isFetching(), 0));
    assert.deepEqual(markers(), [original]);
  });

  await t.test('batches viewport changes and reuses buffered coverage', async (t) => {
    t.mock.method(Map.prototype, 'getBounds', () => latLngBounds([[37.785, -122.435], [37.795, -122.425]]));
    const garden = { id: 'garden', Latitude: 37.79, Longitude: -122.43 };
    const list = t.mock.method(Api.plots, 'index', async () => ({ data: [garden], headers: {} }));
    const view = await mount(t, { initialEntry: '/', showHome: true });
    await waitFor(() => assert.ok(map));
    await waitFor(() => assert.equal(list.mock.calls.length, 1));
    const marker = () => Object.values(map._layers).find((layer) => layer instanceof Marker);
    await waitFor(() => assert.ok(marker()));
    const originalMarker = marker();
    list.mock.resetCalls();

    // Use the real Leaflet event subscription with deterministic geographic viewports.
    let visible = latLngBounds([[37.76, -122.44], [37.78, -122.42]]);
    t.mock.method(map, 'getBounds', () => visible);
    for (const delta of [0, 0.01, 0.02]) {
      visible = latLngBounds([[37.76 + delta, -122.44], [37.78 + delta, -122.42]]);
      await interact(() => map.fire('moveend'));
      await interact(() => delay(30));
    }
    await interact(() => delay(350));
    assert.equal(list.mock.calls.length, 1, 'rapid viewport changes should issue one settled request');
    assert.strictEqual(marker(), originalMarker);

    const coverage = list.mock.calls[0].arguments[0];
    assert.ok(coverage.north > visible.getNorth());
    assert.ok(coverage.south < visible.getSouth());
    assert.ok(coverage.east > visible.getEast());
    assert.ok(coverage.west < visible.getWest());
    for (const area of [
      [[37.781, -122.439], [37.801, -122.419]], // small pan
      [[37.788, -122.433], [37.792, -122.427]], // zoom in
      [[37.788001, -122.433001], [37.792001, -122.427001]],
    ]) {
      visible = latLngBounds(area);
      await interact(() => map.fire('moveend').fire('resize'));
      await interact(() => delay(300));
      assert.equal(list.mock.calls.length, 1, 'covered movement should reuse results');
    }
    await interact(() => view.client.invalidateQueries({ queryKey: ['plots'] }));
    assert.equal(list.mock.calls.length, 2, 'save invalidation must refresh unchanged coverage');
    assert.strictEqual(marker(), originalMarker);

    const coverageKey = ['plots', { north: coverage.north, south: coverage.south, east: coverage.east, west: coverage.west }];
    await interact(() => view.client.setQueryData(coverageKey, [garden], { updatedAt: Date.now() - 31_000 }));
    await waitFor(() => assert.equal(view.client.getQueryCache().find({ queryKey: coverageKey }).isStale(), true));
    await interact(() => map.fire('moveend'));
    await waitFor(() => assert.equal(list.mock.calls.length, 3, 'expired coverage refreshes on movement'));

    const pending = Promise.withResolvers();
    list.mock.mockImplementation(() => pending.promise);
    visible = latLngBounds([[37.81, -122.40], [37.82, -122.39]]);
    await interact(() => map.fire('moveend'));
    await waitFor(() => assert.equal(list.mock.calls.length, 4));
    assert.equal(marker(), undefined, 'offscreen markers unload while replacement coverage loads');
    const obsoleteSignal = list.mock.calls.at(-1).arguments[1];
    list.mock.mockImplementation(async () => ({ data: [garden], headers: {} }));
    visible = latLngBounds([[37.74, -122.49], [37.75, -122.48]]);
    await interact(() => map.fire('moveend'));
    await waitFor(() => assert.equal(list.mock.calls.length, 5));
    assert.equal(obsoleteSignal.aborted, true);
    await interact(() => pending.resolve({ data: [{ ...garden, id: 'obsolete' }], headers: {} }));
    await interact(() => delay(30));
    assert.equal(marker(), undefined, 'neither cached offscreen plots nor obsolete results should render');
    await waitFor(() => assert.equal(view.client.getQueryCache().findAll({ queryKey: ['plots'] }).filter(({ queryKey }) => typeof queryKey[1] === 'object' && queryKey[1] !== null).length, 1));

    list.mock.mockImplementation(async () => { throw new Error('Offline'); });
    visible = latLngBounds([[37.72, -122.47], [37.73, -122.46]]);
    await interact(() => map.fire('moveend'));
    await waitFor(() => assert.match(view.container.textContent, /Unable to load gardens/));
    list.mock.mockImplementation(async () => ({ data: [{ ...garden, Latitude: 37.725, Longitude: -122.465 }], headers: {} }));
    await interact(() => map.fire('moveend'));
    await waitFor(() => assert.ok(marker()));
    assert.doesNotMatch(view.container.textContent, /Unable to load gardens/);

    // A scheduled viewport change must not outlive the map.
    const count = list.mock.calls.length;
    await interact(() => map.fire('resize'));
    await view.unmount();
    await interact(() => delay(300));
    assert.equal(list.mock.calls.length, count);
  });

  await t.test('loads every page of buffered coverage with valid bounds before showing results', async (t) => {
    const lastPage = Promise.withResolvers();
    const gardens = [{ id: 'first', Latitude: 37.77, Longitude: -122.43 }, { id: 'last', Latitude: 37.78, Longitude: -122.42 }];
    const list = t.mock.method(Api.plots, 'index', async ({ offset }) => offset
      ? lastPage.promise
      : { data: [gardens[0]], headers: { 'x-next-offset': '100' } });
    const view = await mount(t, { initialEntry: '/', showHome: true });
    await waitFor(() => assert.equal(list.mock.calls.length, 2));
    assert.equal(view.container.querySelectorAll('.leaflet-marker-icon').length, 0);
    const [first, last] = list.mock.calls.map(({ arguments: [params] }) => params);
    for (const key of ['north', 'south', 'east', 'west']) {
      assert.ok(Number.isFinite(first[key]));
      assert.equal(first[key], last[key]);
    }
    assert.ok(first.north <= 90 && first.south >= -90 && first.north >= first.south);
    assert.ok(first.east <= 180 && first.west >= -180 && first.east >= first.west);
    assert.equal(last.offset, '100');
    assert.equal(first.pageSize, 100);
    assert.strictEqual(list.mock.calls[0].arguments[1], list.mock.calls[1].arguments[1]);
    await interact(() => lastPage.resolve({ data: [gardens[1], { id: 'invalid', Latitude: null, Longitude: -122.42 }], headers: {} }));
    await waitFor(() => assert.equal(view.container.querySelectorAll('.leaflet-marker-icon').length, 2));
  });

  await t.test('creation shortcut respects permissions, bounds, markers and controls, then prefills the form', async (t) => {
    dom.window.sessionStorage.clear();
    t.mock.method(globalThis, 'fetch', async () => ({ ok: true, json: async () => ({ features: [] }) }));
    t.mock.method(Api.plots, 'index', async () => ({ data: [{ id: 'garden', Latitude: 37.775, Longitude: -122.42 }], headers: {} }));
    const create = t.mock.method(Api.plots, 'create', async () => { throw new Error('Unexpected save'); });
    const view = await mount(t, { initialEntry: '/', showHome: true, canCreatePlot: false });
    await waitFor(() => assert.ok(view.container.querySelector('.leaflet-container')));
    assert.equal(map.doubleClickZoom.enabled(), true);
    await interact(() => map.getContainer().dispatchEvent(new dom.window.MouseEvent('dblclick', { bubbles: true, cancelable: true })));
    assert.equal(view.path, '/');
    assert.doesNotMatch(view.container.textContent, /Create a garden/);

    await interact(() => view.client.setQueryData(['plots', 'capabilities'], { canCreatePlot: true }));
    await waitFor(() => assert.equal(map.doubleClickZoom.enabled(), false));
    assert.ok(view.button('Create a garden'));
    for (const [lat, lng] of [[37.70799, -122.43], [37.83301, -122.43], [37.77, -122.51501], [37.77, -122.35499]]) {
      await interact(() => map.fire('dblclick', { latlng: { lat, lng } }));
      assert.equal(view.path, '/');
    }
    await waitFor(() => assert.ok(view.container.querySelector('.leaflet-marker-icon')));
    for (const target of [view.container.querySelector('.leaflet-marker-icon'), view.container.querySelector('.leaflet-control-zoom-in'), view.button('Use my location')]) {
      await interact(() => target.dispatchEvent(new dom.window.MouseEvent('dblclick', { bubbles: true, cancelable: true })));
      assert.equal(view.path, '/', 'marker and control double-clicks must not create a garden');
    }
    const point = map.latLngToContainerPoint([37.77, -122.43]);
    await interact(() => map.getContainer().dispatchEvent(new dom.window.MouseEvent('dblclick', { bubbles: true, cancelable: true, clientX: point.x, clientY: point.y })));
    await waitFor(() => assert.equal(view.path, '/plots/new'));
    await waitFor(() => assert.ok(readDraft()?.position));
    assert.ok(Math.abs(readDraft().position.latitude - 37.77) < 0.0001);
    assert.ok(Math.abs(readDraft().position.longitude + 122.43) < 0.0001);
    assert.match(view.container.textContent, /Location set/);
    assert.equal(create.mock.calls.length, 0);
  });

  await t.test('normal creation button still opens the form without a pin', async (t) => {
    dom.window.sessionStorage.clear();
    t.mock.method(Api.plots, 'index', async () => ({ data: [], headers: {} }));
    const view = await mount(t, { initialEntry: '/', showHome: true });
    await view.click('Create a garden');
    await waitFor(() => assert.equal(view.path, '/plots/new'));
    assert.match(view.container.textContent, /A map pin is required/);
  });
});
