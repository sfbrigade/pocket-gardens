import { test } from 'node:test';
import assert from 'node:assert/strict';
import { interact, setupPlotTests, waitFor } from './helpers/plot-harness.js';

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

  await t.test('soft deletion needs confirmation and refreshes the active history', async (t) => {
    const plot = { id: 'recPlotDelete', stage: 'active', plants: [] };
    const record = { id: 'record-delete', version: 3, date: '2026-09-02', credit: 'Pocket Gardens team', activity: [], observations: [], notes: 'A visit to remove', plants: [], photos: [], createdAt: '2026-09-02T12:00:00Z' };
    let deleted = false;
    t.mock.method(Api.maintenance, 'index', async () => ({ data: deleted ? [] : [record], headers: {} }));
    const remove = t.mock.method(Api.maintenance, 'remove', async () => { deleted = true; return {}; });
    const view = await mount(t, { initialEntry: '/plots/recPlotDelete?tab=updates', showHome: true, queryData: [[['plot', plot.id], plot]] });
    await waitFor(() => assert.match(view.container.textContent, /A visit to remove/));
    await view.click('Delete update');
    await view.click('Keep update');
    assert.equal(remove.mock.calls.length, 0);
    await view.click('Delete update');
    await view.click('Delete this update');
    await waitFor(() => assert.match(view.container.textContent, /No updates recorded yet/));
    assert.deepEqual(remove.mock.calls[0].arguments, [record.id, 3]);
  });

  await t.test('conflict refresh and successful deletion preserve previously loaded pages', async (t) => {
    const plot = { id: 'recPlotPagedDelete', stage: 'active' };
    const record = { version: 1, date: null, credit: 'Contributor', activity: [], observations: [], plants: [], photos: [], createdAt: '2026-09-02T12:00:00Z' };
    const later = { ...record, id: 'later', notes: 'Later visit' };
    const earlier = { ...record, id: 'earlier', notes: 'Earlier visit' };
    const removed = { ...record, id: 'remove', notes: 'Remove this visit' };
    const refresh = Promise.withResolvers();
    let conflicted = false;
    let deleted = false;
    const load = t.mock.method(Api.maintenance, 'index', async ({ offset }) => {
      if (deleted) await refresh.promise;
      if (Number(offset) === 0) return { data: [later], headers: { 'x-next-offset': '20' } };
      return { data: deleted ? [earlier] : [earlier, { ...removed, version: conflicted ? 2 : 1 }], headers: {} };
    });
    const remove = t.mock.method(Api.maintenance, 'remove', async (_id, version) => {
      if (version === 1) {
        conflicted = true;
        throw Object.assign(new Error('Conflict'), { response: { status: 409 } });
      }
      deleted = true;
    });
    const view = await mount(t, {
      initialEntry: `/plots/${plot.id}?tab=updates`, showHome: true, queryData: [[['plot', plot.id], plot]],
    });
    await waitFor(() => assert.ok(view.button('Load more updates')));
    await view.click('Load more updates');
    await waitFor(() => assert.match(view.container.textContent, /Remove this visit/));
    const openDelete = () => interact(() => (
      [...view.container.querySelectorAll('article')]
        .find((card) => card.textContent.includes('Remove this visit'))
        .querySelector('button').click()
    ));
    await openDelete();
    await view.click('Delete this update');
    await waitFor(() => assert.ok(view.button('Refresh history to review')));
    await view.click('Refresh history to review');
    await waitFor(() => assert.equal(load.mock.calls.length, 4));
    assert.match(view.container.textContent, /Later visit.*Earlier visit.*Remove this visit/s);
    await openDelete();
    await view.click('Delete this update');
    await waitFor(() => assert.doesNotMatch(view.container.textContent, /Remove this visit/));
    assert.match(view.container.textContent, /Later visit.*Earlier visit/s);
    assert.deepEqual(remove.mock.calls.map(({ arguments: args }) => args), [['remove', 1], ['remove', 2]]);
    await interact(() => refresh.resolve());
    await waitFor(() => assert.equal(load.mock.calls.length, 6));
  });
});
