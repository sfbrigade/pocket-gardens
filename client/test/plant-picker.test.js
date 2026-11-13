import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createPlotDraft } from '../src/Plots/plot-form.js';
import { draftStorageKey, interact, setupPlotTests, waitFor } from './helpers/plot-harness.js';

test('plant picker interactions in the garden form', async (t) => {
  const { dom, Api, mount, readDraft } = await setupPlotTests(t);
  t.beforeEach(() => dom.window.sessionStorage.setItem(draftStorageKey, JSON.stringify({
    ...createPlotDraft(), position: { latitude: 37.77, longitude: -122.43 }, locator: 'Near gate', stage: 'active', addressEdited: true,
  })));

  await t.test('selects a later search page and prevents selecting the same plant twice', async (t) => {
    const sage = { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', plantName: 'Sage' };
    const firstPage = Array.from({ length: 10 }, (_, index) => ({ id: `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`, plantName: `Lavender ${index}` }));
    const search = t.mock.method(Api.plants, 'index', async ({ offset }) => offset
      ? { data: [sage], headers: {} }
      : { data: firstPage, headers: { 'x-next-offset': '10' } });
    const create = t.mock.method(Api.plots, 'create', async () => ({ data: { id: 'pg_with-sage' } }));
    const view = await mount(t);
    await waitFor(() => assert.equal(view.field('What stage is this garden in?').value, 'Active'));
    await view.change('Find a plant', 'a');
    await waitFor(() => assert.ok([...dom.window.document.querySelectorAll('[role=option]')].some((option) => option.textContent === 'Show more matches')));
    assert.equal([...dom.window.document.querySelectorAll('[role=option]')].some((option) => option.textContent === 'Sage'), false);
    await view.selectPlantOption('Show more matches');
    await waitFor(() => assert.ok([...dom.window.document.querySelectorAll('[role=option]')].some((option) => option.textContent === 'Sage')));
    await view.selectPlantOption('Sage');
    assert.equal(readDraft().plants[0].plantId, sage.id);
    assert.deepEqual(search.mock.calls.map(({ arguments: [params] }) => params.offset), [0, '10']);

    await view.change('Find a plant', 'a');
    await waitFor(() => assert.ok([...dom.window.document.querySelectorAll('[role=option]')].some((option) => option.textContent === 'Sage')));
    await view.selectPlantOption('Sage');
    assert.equal(readDraft().plants.length, 1);
    await view.submit();
    await waitFor(() => assert.equal(view.path, '/plots/pg_with-sage'));
    assert.deepEqual(create.mock.calls[0].arguments[0].plants.map(({ plantId }) => plantId), [sage.id]);
  });

  await t.test('cancelling creates nothing and submitting the plant modal only adds a draft selection', async (t) => {
    t.mock.method(Api.plants, 'index', async () => ({ data: [], headers: {} }));
    const create = t.mock.method(Api.plots, 'create', async () => ({ data: { id: 'pg_with-yarrow' } }));
    const view = await mount(t);
    await waitFor(() => assert.equal(view.field('What stage is this garden in?').value, 'Active'));
    await view.change('Find a plant', 'Yarrow');
    const addOption = '+ Add a new plant: Yarrow';
    await waitFor(() => assert.ok([...dom.window.document.querySelectorAll('[role=option]')].some((option) => option.textContent === addOption)));
    await view.selectPlantOption(addOption);
    await waitFor(() => assert.equal(view.field('Plant name').value, 'Yarrow'));
    await view.click('Cancel');
    await waitFor(() => assert.equal(dom.window.document.querySelector('[role=dialog]'), null));
    assert.equal(readDraft().plants.length, 0);
    assert.equal(create.mock.calls.length, 0);

    await interact(() => view.field('Find a plant').click());
    await view.selectPlantOption(addOption);
    await waitFor(() => assert.equal(view.field('Plant name').value, 'Yarrow'));
    await interact(() => dom.window.document.querySelector('[role=dialog] form').dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true })));
    await waitFor(() => assert.equal(readDraft().plants.length, 1));
    assert.equal(create.mock.calls.length, 0);
    assert.deepEqual(readDraft().plants[0].newPlant, { plantName: 'Yarrow' });

    await view.submit();
    await waitFor(() => assert.equal(view.path, '/plots/pg_with-yarrow'));
    assert.equal(create.mock.calls.length, 1);
    assert.deepEqual(create.mock.calls[0].arguments[0].plants[0].newPlant, { plantName: 'Yarrow' });
  });
});
