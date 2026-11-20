import assert from 'node:assert/strict';
import { test } from 'node:test';
import { interact, setupPlotTests, waitFor } from './helpers/plot-harness.js';

test('current location on the map', async (t) => {
  const { dom, Api, mount, readDraft } = await setupPlotTests(t);
  // Enable Leaflet's SVG renderer in jsdom, which has no SVG feature detection.
  dom.window.SVGSVGElement.prototype.createSVGRect = () => ({});
  const { Map, Marker, Circle, CircleMarker, latLngBounds } = await import('leaflet');
  const initialize = Map.prototype.initialize;
  let map;
  t.mock.method(Map.prototype, 'initialize', function (...args) {
    initialize.apply(this, args);
    map = this;
  });
  t.mock.method(Map.prototype, 'getBounds', () => latLngBounds([[37.76, -122.44], [37.80, -122.40]]));
  t.mock.method(Api.plots, 'index', async () => ({ data: [], headers: {} }));
  t.mock.method(globalThis, 'fetch', async () => ({ ok: true, json: async () => ({ features: [] }) }));

  let watchId = 0;
  const watchPosition = t.mock.fn(() => ++watchId);
  const clearWatch = t.mock.fn();
  Object.defineProperty(dom.window.navigator, 'geolocation', { configurable: true, value: { watchPosition, clearWatch } });
  const reportLocation = (latitude, longitude, accuracy) => interact(() => watchPosition.mock.calls.at(-1).arguments[0]({
    coords: { latitude, longitude, accuracy }, timestamp: Date.now(),
  }));
  const locationLayers = () => Object.values(map._layers).filter((layer) => layer instanceof CircleMarker);
  const dot = () => locationLayers().find((layer) => !(layer instanceof Circle));
  const halo = () => locationLayers().find((layer) => layer instanceof Circle);
  const assertLocation = (latitude, longitude, accuracy) => {
    assert.deepEqual([dot().getLatLng().lat, dot().getLatLng().lng], [latitude, longitude]);
    assert.deepEqual(halo().getLatLng(), dot().getLatLng());
    assert.equal(halo().getRadius(), accuracy, 'accuracy is a radius in metres');
  };

  await t.test('tracks the dot and accuracy without interrupting browsing, and cleans up watches', async (t) => {
    const count = watchPosition.mock.calls.length;
    const view = await mount(t, { initialEntry: '/', showHome: true });
    await waitFor(() => assert.ok(view.button('Use my location')));
    assert.equal(watchPosition.mock.calls.length, count, 'tracking starts only after the button is pressed');
    assert.equal(locationLayers().length, 0);
    const setView = t.mock.method(map, 'setView');
    await view.click('Use my location');
    const options = watchPosition.mock.calls.at(-1).arguments[2];
    assert.equal(options.watch, true);
    assert.equal(options.enableHighAccuracy, true);
    await reportLocation(37.775, -122.425, 25);
    assertLocation(37.775, -122.425, 25);
    assert.equal(setView.mock.calls.length, 1);
    assert.equal(dot().getRadius(), 8, 'the dot stays a fixed pixel size');
    assert.equal(dot().options.interactive, false);
    assert.equal(halo().options.interactive, false);
    assert.equal(dot().options.fillColor, '#4285f4');
    assert.equal(dot().options.color, '#fff');
    assert.equal(view.container.querySelectorAll('.leaflet-overlay-pane svg path').length, 2);
    const originalDot = dot();
    const originalHalo = halo();

    await reportLocation(37.776, -122.424, 10);
    assertLocation(37.776, -122.424, 10);
    assert.strictEqual(dot(), originalDot);
    assert.strictEqual(halo(), originalHalo);
    assert.equal(setView.mock.calls.length, 1, 'GPS updates must not recenter the map');

    const previousWatch = watchId;
    await view.click('Use my location');
    assert.ok(clearWatch.mock.calls.some(({ arguments: [id] }) => id === previousWatch));
    await reportLocation(37.777, -122.423, 12);
    assert.equal(setView.mock.calls.length, 2, 'pressing the button again recenters');
    const activeWatch = watchId;
    await view.unmount();
    assert.ok(clearWatch.mock.calls.some(({ arguments: [id] }) => id === activeWatch), 'unmount stops tracking');
  });

  await t.test('ongoing GPS updates preserve a manually adjusted garden pin', async (t) => {
    dom.window.sessionStorage.clear();
    const view = await mount(t);
    await view.click('Choose or adjust the map location');
    await waitFor(() => assert.ok(view.button('Use my location')));
    await view.click('Use my location');
    await reportLocation(37.775, -122.425, 25);
    await waitFor(() => assert.deepEqual(readDraft()?.position, { latitude: 37.775, longitude: -122.425, accuracy: 25 }));
    const gardenPin = () => Object.values(map._layers).find((layer) => layer instanceof Marker);
    await interact(() => {
      gardenPin().setLatLng([37.78, -122.42]);
      gardenPin().fire('dragend');
    });
    await waitFor(() => assert.deepEqual(readDraft()?.position, { latitude: 37.78, longitude: -122.42 }));
    const setView = t.mock.method(map, 'setView');
    await reportLocation(37.776, -122.424, 10);
    assertLocation(37.776, -122.424, 10);
    assert.deepEqual(readDraft().position, { latitude: 37.78, longitude: -122.42 });
    assert.equal(gardenPin().getLatLng().lat, 37.78);
    assert.equal(setView.mock.calls.length, 0);
  });

  await t.test('handles permission errors and out-of-coverage locations, and allows retry', async (t) => {
    const view = await mount(t, { initialEntry: '/', showHome: true });
    await waitFor(() => assert.ok(view.button('Use my location')));
    await view.click('Use my location');
    const deniedWatch = watchId;
    await interact(() => watchPosition.mock.calls.at(-1).arguments[1]({ code: 1 }));
    assert.match(view.container.textContent, /Could not use your location/);
    assert.equal(locationLayers().length, 0);
    assert.ok(clearWatch.mock.calls.some(({ arguments: [id] }) => id === deniedWatch));

    await view.click('Use my location');
    await reportLocation(37.775, -122.425, 25);
    assertLocation(37.775, -122.425, 25);
    const setView = t.mock.method(map, 'setView');
    await reportLocation(34.05, -118.24, 20);
    assert.match(view.container.textContent, /Your location is outside this map/);
    assert.equal(locationLayers().length, 0, 'do not retain an outdated dot inside the map');
    assert.equal(setView.mock.calls.length, 0);

    await reportLocation(37.776, -122.424, 10);
    assertLocation(37.776, -122.424, 10);
    await interact(() => watchPosition.mock.calls.at(-1).arguments[1]({ code: 2 }));
    assert.equal(locationLayers().length, 0, 'remove the dot when location updates fail');
    assert.match(view.container.textContent, /Could not use your location/);
  });
});
