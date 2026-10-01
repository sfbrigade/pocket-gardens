import assert from 'node:assert/strict';
import { test } from 'node:test';
import { setImmediate } from 'node:timers/promises';
import axios from 'axios';
import { QueryClient, QueryObserver } from '@tanstack/react-query';

const requests = [];
let respond;
axios.defaults.adapter = async (config) => {
  requests.push(config);
  return { config, status: 200, statusText: 'OK', headers: {}, data: [], ...await respond(config) };
};
const { hasCoordinates, plotsQueryOptions } = await import('../src/plots.js');

const bounds = { north: 37.82, south: 37.75, east: -122.38, west: -122.45 };
const garden = { id: 'garden', Latitude: 37.78, Longitude: -122.42 };

test('viewport plot queries', async (t) => {
  t.beforeEach(() => { requests.length = 0; });

  await t.test('loads all pages for the same bounds and skips invalid coordinates', async () => {
    const firstPage = Array.from({ length: 100 }, (_, id) => ({ ...garden, id: String(id) }));
    respond = async ({ params }) => params.offset
      ? { data: [garden, { id: 'missing' }, { ...garden, Latitude: null }], headers: {} }
      : { data: firstPage, headers: { 'x-next-offset': '100' } };
    const controller = new AbortController();
    const plots = await plotsQueryOptions(bounds).queryFn({ signal: controller.signal });
    assert.equal(plots.length, 101);
    assert.deepEqual(requests.map(({ params }) => params), [
      { ...bounds, offset: undefined, pageSize: 100 },
      { ...bounds, offset: '100', pageSize: 100 },
    ]);
    assert.ok(requests.every(({ signal }) => signal === controller.signal));
  });

  await t.test('accepts zero and coordinate limits but rejects missing, nonnumeric and out-of-range values', () => {
    assert.ok(hasCoordinates({ Latitude: 0, Longitude: 0 }));
    assert.ok(hasCoordinates({ Latitude: -90, Longitude: 180 }));
    for (const invalid of [undefined, null, '', '37.78', NaN, Infinity, 91, -91]) {
      assert.equal(hasCoordinates({ ...garden, Latitude: invalid }), false);
    }
    for (const invalid of [undefined, null, '', '-122.42', NaN, Infinity, 181, -181]) {
      assert.equal(hasCoordinates({ ...garden, Longitude: invalid }), false);
    }
  });

  await t.test('an empty area finishes after one page', async () => {
    respond = async () => ({ data: [] });
    assert.deepEqual(await plotsQueryOptions(bounds).queryFn({}), []);
    assert.equal(requests.length, 1);
  });

  await t.test('keeps markers mounted during a bounds refresh, then replaces them with current results', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
    const observer = new QueryObserver(client, plotsQueryOptions(bounds));
    respond = async () => ({ data: [garden] });
    const unsubscribe = observer.subscribe(() => {});
    t.after(() => { unsubscribe(); client.clear(); });
    await setImmediate();

    const nextPage = Promise.withResolvers();
    respond = async () => nextPage.promise;
    observer.setOptions(plotsQueryOptions({ ...bounds, west: -122.44 }));
    assert.strictEqual(observer.getCurrentResult().data[0], garden);
    assert.equal(observer.getCurrentResult().isPlaceholderData, true);

    nextPage.resolve({ data: [{ ...garden, id: 'current-area' }] });
    await setImmediate();
    assert.equal(observer.getCurrentResult().data[0].id, 'current-area');
    assert.equal(observer.getCurrentResult().isPlaceholderData, false);
  });

  await t.test('preserves HTTP and network errors instead of returning partial plots', async () => {
    for (const response of [undefined, { status: 503 }]) {
      const error = new axios.AxiosError('Unable to load gardens', 'ERR_NETWORK', undefined, undefined, response);
      respond = async ({ params }) => {
        if (params.offset) throw error;
        return { data: [garden], headers: { 'x-next-offset': '100' } };
      };
      await assert.rejects(plotsQueryOptions(bounds).queryFn({}), (caught) => caught === error);
    }
  });

  await t.test('waits for bounds, cancels obsolete requests and keeps late results out of the new viewport', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
    const observer = new QueryObserver(client, plotsQueryOptions(null));
    const unsubscribe = observer.subscribe(() => {});
    t.after(() => { unsubscribe(); client.clear(); });
    await setImmediate();
    assert.equal(requests.length, 0);

    const oldPage = Promise.withResolvers();
    const newBounds = { ...bounds, west: -122.44 };
    respond = async ({ params }) => params.west === bounds.west
      ? oldPage.promise
      : { data: [{ ...garden, id: 'new-area' }] };
    observer.setOptions(plotsQueryOptions(bounds));
    await setImmediate();
    const oldSignal = requests[0].signal;
    observer.setOptions(plotsQueryOptions(newBounds));
    await setImmediate();
    assert.equal(oldSignal.aborted, true);
    assert.equal(observer.getCurrentResult().data[0].id, 'new-area');

    oldPage.resolve({ data: [{ ...garden, id: 'old-area' }], headers: { 'x-next-offset': '100' } });
    await setImmediate();
    assert.equal(requests.length, 2);
    assert.equal(observer.getCurrentResult().data[0].id, 'new-area');
    assert.equal(client.getQueryData(['plots', bounds]), undefined);
  });
});
