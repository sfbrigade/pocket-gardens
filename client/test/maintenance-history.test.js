import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setupPlotTests, waitFor } from './helpers/plot-harness.js';

test('garden history loads on the Updates tab and preserves the selected garden', async (t) => {
  const { Api, mount } = await setupPlotTests(t);
  await t.test('tabs', async (t) => {
    const plot = { id: 'recPlotAlpha', stage: 'active', plants: [] };
    const load = t.mock.method(Api.maintenance, 'index', async () => ({ data: [], headers: {} }));
    const view = await mount(t, { initialEntry: { pathname: '/plots/recPlotAlpha', search: '?source=map', state: { created: true } }, showHome: true, queryData: [[['plot', plot.id], plot]] });
    assert.equal(load.mock.calls.length, 0);
    await view.click('Updates');
    await waitFor(() => assert.match(view.container.textContent, /No updates recorded yet/));
    assert.equal(load.mock.calls[0].arguments[0].plotId, plot.id);
    assert.equal(view.location.search, '?source=map&tab=updates');
    assert.match(view.container.textContent, /Garden created/);
    await view.click('Info');
    assert.equal(view.path, '/plots/recPlotAlpha');
    assert.equal(view.location.search, '?source=map');
  });
});
