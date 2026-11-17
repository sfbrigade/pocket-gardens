import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createPlotDraft } from '../src/Plots/plot-form.js';
import { draftStorageKey, interact, setupPlotTests, waitFor } from './helpers/plot-harness.js';

test('garden saves respect navigation and newer drafts', async (t) => {
  const { dom, Api, mount, readDraft } = await setupPlotTests(t);
  for (const scenario of ['stay', 'leave', 'edit restored draft', 'start another draft']) {
    await t.test(scenario, async (t) => {
      const original = { ...createPlotDraft(), locator: 'Second tree well', position: { latitude: 37.77, longitude: -122.43 }, addressEdited: true };
      dom.window.sessionStorage.setItem(draftStorageKey, JSON.stringify(original));
      const saving = Promise.withResolvers();
      const create = t.mock.method(Api.plots, 'create', () => saving.promise);
      const view = await mount(t);
      const coverageKey = ['plots', { north: 37.8, south: 37.7, east: -122.4, west: -122.5 }];
      const nearbyKey = ['plots', { north: 37.771, south: 37.769, east: -122.429, west: -122.431 }];
      view.client.setQueryData(coverageKey, []);
      view.client.setQueryData(nearbyKey, []);
      await waitFor(() => assert.equal(view.field('Where exactly is it?').value, original.locator));
      await view.submit();
      await waitFor(() => assert.equal(create.mock.calls.length, 1));

      if (scenario !== 'stay') {
        await view.click('Back to map');
        await waitFor(() => assert.equal(view.path, '/'));
      }
      if (scenario === 'start another draft') {
        dom.window.sessionStorage.removeItem(draftStorageKey);
        dom.window.sessionStorage.setItem(draftStorageKey, JSON.stringify({ ...original, submissionId: crypto.randomUUID() }));
      }
      if (scenario === 'edit restored draft' || scenario === 'start another draft') {
        await view.navigate('/plots/new');
        await waitFor(() => assert.equal(view.field('Where exactly is it?').value, original.locator));
        await view.change('Where exactly is it?', 'Third tree well');
        await waitFor(() => assert.equal(readDraft().locator, 'Third tree well'));
      }
      const draftBeforeSuccess = dom.window.sessionStorage.getItem(draftStorageKey);
      const saved = { id: 'pg_saved-original' };
      await interact(() => saving.resolve({ data: saved }));
      await waitFor(() => assert.deepEqual(view.client.getQueryData(['plot', saved.id]), saved));
      // Assert absence of stale UI effects only after the mutation has settled.
      await waitFor(() => assert.equal(view.client.isMutating(), 0));
      assert.equal(view.client.getQueryState(coverageKey).isInvalidated, true);
      assert.equal(view.client.getQueryState(nearbyKey).isInvalidated, true);
      if (scenario === 'stay') {
        await waitFor(() => assert.equal(view.path, `/plots/${saved.id}`));
        assert.equal(dom.window.sessionStorage.getItem(draftStorageKey), null);
      } else {
        assert.equal(view.path, scenario === 'leave' ? '/' : '/plots/new');
        assert.equal(dom.window.sessionStorage.getItem(draftStorageKey), draftBeforeSuccess);
      }
    });
  }

  await t.test('a lost save response replays suggested fields after a fresh mount without the address cache', async (t) => {
    const draft = { ...createPlotDraft(), position: { latitude: 37.77, longitude: -122.43 } };
    dom.window.sessionStorage.setItem(draftStorageKey, JSON.stringify(draft));
    const pending = Promise.withResolvers();
    const create = t.mock.method(Api.plots, 'create', () => pending.promise);
    const lookup = t.mock.method(globalThis, 'fetch', async () => { throw new Error('Unexpected address lookup'); });
    const addressKey = ['nearby-address', '37.77000', '-122.43000'];
    const address = '440 5th Avenue, San Francisco';
    const title = '440 5th Avenue · Second tree well';
    const first = await mount(t, { queryData: [[addressKey, { position: draft.position, address }]] });
    await waitFor(() => assert.equal(first.field('Where exactly is it?').value, ''));
    await first.change('Where exactly is it?', 'Second tree well');
    await waitFor(() => assert.equal(first.field('Garden title').value, title));
    await first.submit();
    await waitFor(() => assert.equal(create.mock.calls.length, 1));
    const payload = create.mock.calls[0].arguments[0];
    assert.equal(payload.submissionId, draft.submissionId);
    await interact(() => pending.reject({ _form: 'Save response lost' }));
    await waitFor(() => assert.match(first.container.textContent, /Save response lost/));
    await first.unmount();

    const saved = { id: 'pg_recovered' };
    create.mock.mockImplementation(async () => ({ data: saved }));
    const refreshed = await mount(t);
    assert.notEqual(refreshed.client, first.client);
    await waitFor(() => assert.equal(refreshed.field('Garden title').value, title));
    assert.equal(refreshed.field('Address or cross street').value, address);
    assert.equal(refreshed.client.getQueryData(addressKey), undefined);
    assert.equal(readDraft().submissionId, draft.submissionId);
    await refreshed.submit();
    await waitFor(() => assert.equal(refreshed.path, '/plots/pg_recovered'));
    assert.deepEqual(create.mock.calls[1].arguments[0], payload);
    assert.equal(lookup.mock.calls.length, 0);
    assert.equal(dom.window.sessionStorage.getItem(draftStorageKey), null);
  });
});
