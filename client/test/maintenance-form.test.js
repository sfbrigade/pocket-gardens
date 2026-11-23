import { test } from 'node:test';
import assert from 'node:assert/strict';
import { interact, setupPlotTests, waitFor } from './helpers/plot-harness.js';
import { draftKey } from '../src/Maintenance/maintenance-draft.js';

test('maintenance composer recovers interrupted saves', async (t) => {
  const { Api, dom, mount } = await setupPlotTests(t);
  await t.test('observations remain exclusive and another update starts with a fresh draft', async (t) => {
    const plot = { id: 'recPlotObservations', stage: 'active' };
    const create = t.mock.method(Api.maintenance, 'create', async (payload) => ({ data: { ...payload, id: 'saved-observations' } }));
    const view = await mount(t, { initialEntry: `/plots/${plot.id}/updates/new`, queryData: [[['plot', plot.id], plot]] });
    await waitFor(() => assert.equal(view.field('When did this happen?').value, '2026-11-15'));
    const quiet = view.field('Nothing stood out');
    const dry = view.field('Plants look dry');
    const canUnload = () => dom.window.dispatchEvent(new dom.window.Event('beforeunload', { cancelable: true }));

    assert.equal(canUnload(), true);
    await interact(() => dry.click());
    assert.equal(canUnload(), false);
    await interact(() => quiet.click());
    assert.equal(quiet.checked, true);
    assert.equal(dry.checked, false);
    await interact(() => dry.click());
    assert.equal(quiet.checked, false);
    assert.equal(dry.checked, true);
    await view.click('Add this update');
    await waitFor(() => assert.match(view.container.textContent, /Update saved/));
    assert.equal(canUnload(), true);
    const [first] = create.mock.calls[0].arguments;
    assert.deepEqual(first.observations, ['Plants look dry']);
    assert.equal(dom.window.sessionStorage.getItem(draftKey(plot.id)), null);

    await view.click('Add another update');
    assert.doesNotMatch(view.container.textContent, /Update saved/);
    assert.equal(view.field('Plants look dry').checked, false);
    await interact(() => view.field('Nothing stood out').click());
    await view.click('Add this update');
    await waitFor(() => assert.match(view.container.textContent, /Update saved/));
    const [second] = create.mock.calls[1].arguments;
    assert.deepEqual(second.observations, ['Nothing stood out']);
    assert.notEqual(second.submissionId, first.submissionId);
  });

  await t.test('same-tab restoration retries the original submitted payload', async (t) => {
    const plot = { id: 'recPlotAlpha', stage: 'active', 'Pocket Garden Name': 'Alpha' };
    const responses = [];
    const storedAttempts = [];
    const create = t.mock.method(Api.maintenance, 'create', async (payload) => {
      responses.push(payload);
      storedAttempts.push(JSON.parse(dom.window.sessionStorage.getItem(draftKey(plot.id)))?.attempt);
      if (responses.length === 1) throw new Error('Lost response');
      return { data: { id: 'saved', activity: payload.activity, observations: payload.observations, notes: payload.notes } };
    });
    const options = { initialEntry: '/plots/recPlotAlpha/updates/new', queryData: [[['plot', plot.id], plot]] };
    const first = await mount(t, options);
    await waitFor(() => assert.equal(first.field('When did this happen?').value, '2026-11-15'));
    await first.change('Anything to add?', 'No weeds today');
    await first.submit();
    await waitFor(() => assert.equal(create.mock.calls.length, 1));
    assert.deepEqual(storedAttempts[0], responses[0]);
    await waitFor(() => assert.match(first.container.textContent, /Unable to save/));
    assert.ok(JSON.parse(dom.window.sessionStorage.getItem(draftKey(plot.id))).attempt);
    await first.unmount();
    const second = await mount(t, {
      ...options,
      queryData: [[['plot', plot.id], { ...plot, stage: 'archived' }]],
    });
    await waitFor(() => assert.equal(second.field('Anything to add?').value, 'No weeds today'));
    assert.equal(second.button('Try again').disabled, false);
    await second.click('Try again');
    await waitFor(() => assert.match(second.container.textContent, /Update saved/));
    assert.deepEqual(responses[0], responses[1]);
    assert.equal(dom.window.sessionStorage.getItem(draftKey(plot.id)), null);
  });

  await t.test('a restored draft can remove activities after its garden is paused', async (t) => {
    const plot = { id: 'recPlotPaused', stage: 'active' };
    const create = t.mock.method(Api.maintenance, 'create', async (payload) => ({ data: { ...payload, id: 'saved-paused' } }));
    const options = {
      initialEntry: `/plots/${plot.id}/updates/new`,
      queryData: [[['plot', plot.id], plot]],
    };
    const first = await mount(t, options);
    await waitFor(() => assert.equal(first.field('When did this happen?').value, '2026-11-15'));
    await first.change('Anything to add?', 'A note for the paused garden');
    await interact(() => first.field('Watered').click());
    await first.unmount();

    const second = await mount(t, {
      ...options,
      queryData: [[['plot', plot.id], { ...plot, stage: 'paused' }]],
    });
    await waitFor(() => assert.equal(second.field('Anything to add?').value, 'A note for the paused garden'));
    assert.equal(second.button('Add this update').disabled, true);
    await second.click('Remove work selections');
    await second.click('Add this update');
    await waitFor(() => assert.match(second.container.textContent, /Update saved/));
    assert.deepEqual(create.mock.calls[0].arguments[0].activity, []);
    assert.equal(create.mock.calls[0].arguments[0].notes, 'A note for the paused garden');
  });

  await t.test('a save that finishes after leaving refreshes history and clears the submitted draft', async (t) => {
    const plot = { id: 'recPlotLateSave', stage: 'active', plants: [] };
    const internalId = '11111111-1111-4111-8111-111111111111';
    const capabilities = (await Api.maintenance.capabilities()).data;
    const pending = Promise.withResolvers();
    const create = t.mock.method(Api.maintenance, 'create', () => pending.promise);
    let records = [];
    t.mock.method(Api.maintenance, 'index', async () => ({ data: records, headers: {} }));
    t.mock.method(Api.plots, 'index', async () => ({ data: [], headers: {} }));
    const view = await mount(t, {
      initialEntry: `/plots/${internalId}/updates/new`,
      showHome: true,
      queryData: [[['plot', internalId], plot], [['plot', plot.id], plot], [['maintenance-capabilities'], { ...capabilities, canManage: false }]],
    });
    await waitFor(() => assert.equal(view.field('When did this happen?').value, '2026-11-15'));
    await view.change('Anything to add?', 'Watered before leaving');
    await view.click('Add this update');
    await waitFor(() => assert.equal(create.mock.calls.length, 1));

    await view.navigate(`/plots/${plot.id}?tab=updates`);
    await waitFor(() => assert.match(view.container.textContent, /No updates recorded yet/));
    assert.equal(view.button('Add an update').getAttribute('href'), `/plots/${plot.id}/updates/new`);
    assert.ok(JSON.parse(dom.window.sessionStorage.getItem(draftKey(internalId))).attempt);
    await interact(() => {
      const [payload] = create.mock.calls[0].arguments;
      const saved = { ...payload, id: 'saved-late', credit: 'Community contributor', createdAt: '2026-11-15T12:00:00Z' };
      records = [saved];
      pending.resolve({ data: saved });
    });
    await waitFor(() => assert.match(view.container.textContent, /Watered before leaving/));
    assert.equal(dom.window.sessionStorage.getItem(draftKey(internalId)), null);
  });
});
