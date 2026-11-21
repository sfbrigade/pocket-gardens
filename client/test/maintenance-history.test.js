import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setupPlotTests, waitFor } from './helpers/plot-harness.js';

test('garden history loads on the Updates tab and preserves the selected garden', async (t) => {
  const { Api, mount } = await setupPlotTests(t);
  await t.test('tabs', async (t) => {
    const plot = { id: 'recPlotAlpha', 'Pocket Garden Name': 'Alpha Garden', stage: 'active', plants: [] };
    const load = t.mock.method(Api.maintenance, 'index', async () => ({ data: [], headers: {} }));
    const view = await mount(t, { initialEntry: { pathname: '/plots/recPlotAlpha', search: '?source=map', state: { created: true } }, showHome: true, queryData: [[['plot', plot.id], plot]] });
    assert.equal(view.container.querySelector('h2')?.textContent, 'Alpha Garden');
    assert.equal(load.mock.calls.length, 0);
    await view.click('Updates');
    await waitFor(() => assert.match(view.container.textContent, /No updates recorded yet/));
    assert.equal(view.container.querySelector('h2')?.textContent, 'Alpha Garden');
    assert.equal(load.mock.calls[0].arguments[0].plotId, plot.id);
    assert.equal(view.location.search, '?source=map&tab=updates');
    assert.match(view.container.textContent, /Garden created/);
    await view.click('Info');
    assert.equal(view.path, '/plots/recPlotAlpha');
    assert.equal(view.location.search, '?source=map');
  });

  await t.test('retrying a failed next page appends older updates', async (t) => {
    const plot = { id: 'recPlotAlpha', plants: [] };
    const record = {
      date: null,
      credit: 'Contributor',
      activity: [],
      observations: [],
      plants: [],
      photos: [],
      createdAt: '2026-09-02T12:00:00Z',
    };
    let nextPageAttempts = 0;
    t.mock.method(Api.maintenance, 'index', async ({ offset }) => {
      if (Number(offset) === 0) {
        return { data: [{ ...record, id: 'newer', notes: 'Newer visit' }], headers: { 'x-next-offset': '20' } };
      }
      assert.equal(Number(offset), 20);
      if (++nextPageAttempts === 1) throw new Error('Older updates unavailable');
      return { data: [{ ...record, id: 'older', notes: 'Older visit' }], headers: {} };
    });
    const view = await mount(t, {
      initialEntry: '/plots/recPlotAlpha?tab=updates',
      showHome: true,
      queryData: [[['plot', plot.id], plot]],
    });

    await waitFor(() => assert.match(view.container.textContent, /Newer visit/));
    await view.click('Load more updates');
    await waitFor(() => view.button('Try again'));
    assert.match(view.container.textContent, /Newer visit/);

    await view.click('Try again');
    await waitFor(() => assert.match(view.container.textContent, /Newer visit.*Older visit/s));
  });
});
