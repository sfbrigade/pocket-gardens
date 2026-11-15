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

  await t.test('a blocked attempt write prevents the save and leaves the draft editable', async (t) => {
    const plot = { id: 'recPlotStorageFailure', stage: 'active' };
    const key = draftKey(plot.id);
    const storage = Object.getPrototypeOf(dom.window.sessionStorage);
    const write = storage.setItem;
    let blockAttempt = true;
    t.mock.method(storage, 'setItem', function (name, value) {
      if (blockAttempt && name === key && JSON.parse(value).attempt) throw new dom.window.DOMException('Full', 'QuotaExceededError');
      write.call(this, name, value);
    });
    const create = t.mock.method(Api.maintenance, 'create', async (payload) => {
      assert.deepEqual(JSON.parse(dom.window.sessionStorage.getItem(key)).attempt, payload);
      return { data: { ...payload, id: 'saved-after-storage-recovery' } };
    });
    const view = await mount(t, { initialEntry: `/plots/${plot.id}/updates/new`, queryData: [[['plot', plot.id], plot]] });
    await waitFor(() => assert.ok(view.field('Anything to add?')));
    await view.change('Anything to add?', 'A draft that must survive refresh');
    await view.click('Add this update');
    await waitFor(() => assert.match(view.container.textContent, /could not store your draft/));
    assert.equal(create.mock.calls.length, 0);
    assert.equal(view.field('Anything to add?').disabled, false);
    assert.equal(JSON.parse(dom.window.sessionStorage.getItem(key)).attempt, null);
    blockAttempt = false;
    await view.click('Add this update');
    await waitFor(() => assert.match(view.container.textContent, /Update saved/));
    assert.equal(create.mock.calls.length, 1);
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

  await t.test('an internal garden link resumes a legacy draft through the public history link', async (t) => {
    const internalId = '11111111-1111-4111-8111-111111111111';
    const plot = { id: 'recPlotAlias', stage: 'active' };
    const legacyKey = draftKey(internalId);
    const attempt = { submissionId: 'existing-draft', plotId: internalId, notes: 'Keep this note' };
    const draft = { ...attempt, date: '2026-11-15', activity: [], observations: [], plants: [], photos: [], attempt };
    dom.window.sessionStorage.setItem(legacyKey, JSON.stringify(draft));
    const queryData = [[['plot', internalId], plot], [['plot', plot.id], plot]];
    const view = await mount(t, { initialEntry: `/plots/${internalId}/updates/new`, queryData });
    await waitFor(() => assert.equal(view.field('Anything to add?').value, 'Keep this note'));
    await view.navigate(`/plots/${plot.id}/updates/new`);
    await waitFor(() => assert.equal(view.field('Anything to add?').value, 'Keep this note'));
    assert.equal(dom.window.sessionStorage.getItem(legacyKey), null);
    assert.deepEqual(JSON.parse(dom.window.sessionStorage.getItem(draftKey(plot.id))).attempt, attempt);
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
    assert.ok(JSON.parse(dom.window.sessionStorage.getItem(draftKey(plot.id))).attempt);
    await interact(() => {
      const [payload] = create.mock.calls[0].arguments;
      const saved = { ...payload, id: 'saved-late', credit: 'Community contributor', createdAt: '2026-11-15T12:00:00Z' };
      records = [saved];
      pending.resolve({ data: saved });
    });
    await waitFor(() => assert.match(view.container.textContent, /Watered before leaving/));
    assert.equal(dom.window.sessionStorage.getItem(draftKey(plot.id)), null);
  });

  await t.test('quick photo saves one photo and can expand into the same detailed draft', async (t) => {
    const plot = { id: 'recPlotPhoto', stage: 'active', 'Pocket Garden Name': 'Photo garden' };
    t.mock.method(Api.assets, 'create', async () => ({ data: { filename: '55555555-aaaa-4555-8555-555555555555.jpg', url: '/upload', headers: {} } }));
    t.mock.method(Api.assets, 'upload', async () => ({}));
    const create = t.mock.method(Api.maintenance, 'create', async (payload) => ({ data: { id: 'photo-save', ...payload } }));
    const view = await mount(t, { initialEntry: '/plots/recPlotPhoto/updates/new?quick=photo', queryData: [[['plot', plot.id], plot]] });
    await waitFor(() => assert.match(view.container.textContent, /Take or choose photos/));
    await view.upload();
    await waitFor(() => assert.match(view.container.textContent, /Ready to save/));
    await view.click('Add more details');
    await waitFor(() => assert.equal(view.field('Anything to add?').value, ''));
    await view.change('Anything to add?', 'New growth');
    await view.submit();
    await waitFor(() => assert.match(view.container.textContent, /Update saved/));
    assert.deepEqual(create.mock.calls[0].arguments[0].photos, [{ upload: '55555555-aaaa-4555-8555-555555555555.jpg' }]);
    assert.equal(create.mock.calls[0].arguments[0].notes, 'New growth');
  });

  await t.test('the photo shortcut shows recovered details before submitting', async (t) => {
    const plot = { id: 'recPlotQuickDraft', stage: 'active' };
    const options = {
      initialEntry: `/plots/${plot.id}/updates/new`,
      queryData: [[['plot', plot.id], plot]],
    };
    const first = await mount(t, options);
    await waitFor(() => first.field('Anything to add?'));
    await first.change('Anything to add?', 'Keep this note visible');
    await first.unmount();
    const quick = await mount(t, { ...options, initialEntry: `${options.initialEntry}?quick=photo` });
    await waitFor(() => assert.equal(quick.field('Anything to add?').value, 'Keep this note visible'));
    assert.doesNotMatch(quick.container.textContent, /Add more details/);
  });

  await t.test('a failed photo must be retried or removed before saving', async (t) => {
    const plot = { id: 'recPlotFailedPhoto', stage: 'active' };
    t.mock.method(Api.assets, 'create', async () => ({ data: { filename: 'visit.jpg', url: '/upload', headers: {} } }));
    t.mock.method(Api.assets, 'upload', async () => { throw new Error('Unavailable'); });
    const create = t.mock.method(Api.maintenance, 'create', async (payload) => ({ data: { id: 'saved', ...payload } }));
    const view = await mount(t, { initialEntry: `/plots/${plot.id}/updates/new`, queryData: [[['plot', plot.id], plot]] });
    await waitFor(() => assert.equal(view.field('Anything to add?').value, ''));
    await view.change('Anything to add?', 'A note to save');
    await view.upload();
    await waitFor(() => assert.match(view.container.textContent, /Upload failed/));
    assert.equal(view.button('Add this update').disabled, true);
    await view.submit();
    assert.equal(create.mock.calls.length, 0);
    await view.click('Remove selected photo');
    await view.click('Add this update');
    await waitFor(() => assert.match(view.container.textContent, /Update saved/));
  });

  await t.test('editing a note as a photo finishes keeps both changes', async (t) => {
    const plot = { id: 'recPlotUploadRace', stage: 'active' };
    const filename = 'visit.jpg';
    const pending = Promise.withResolvers();
    t.mock.method(Api.assets, 'create', async () => ({ data: { filename, url: '/upload', headers: {} } }));
    const upload = t.mock.method(Api.assets, 'upload', () => pending.promise);
    const create = t.mock.method(Api.maintenance, 'create', async (payload) => ({ data: { id: 'saved', ...payload } }));
    const view = await mount(t, { initialEntry: `/plots/${plot.id}/updates/new`, queryData: [[['plot', plot.id], plot]] });
    await waitFor(() => assert.equal(view.field('Anything to add?').value, ''));
    await view.upload();
    await waitFor(() => assert.equal(upload.mock.calls.length, 1));
    await interact(async () => {
      pending.resolve({});
      await new Promise((resolve) => setImmediate(resolve));
      await view.change('Anything to add?', 'Typed during the upload');
    });
    await view.click('Add this update');
    await waitFor(() => assert.match(view.container.textContent, /Update saved/));
    assert.deepEqual(create.mock.calls[0].arguments[0].photos, [{ upload: filename }]);
    assert.equal(create.mock.calls[0].arguments[0].notes, 'Typed during the upload');
  });

  await t.test('failed photo uploads still ask for reattachment after repeated refreshes', async (t) => {
    const plot = { id: 'recPlotInterruptedPhoto', stage: 'active' };
    const options = {
      initialEntry: `/plots/${plot.id}/updates/new?quick=photo`,
      queryData: [[['plot', plot.id], plot]],
    };
    t.mock.method(Api.assets, 'create', async () => ({ data: { filename: 'photo.jpg', url: '/upload', headers: {} } }));
    t.mock.method(Api.assets, 'upload', async () => { throw new Error('Unavailable'); });
    const first = await mount(t, options);
    await waitFor(() => assert.match(first.container.textContent, /Take or choose photos/));
    await first.upload();
    await waitFor(() => assert.match(first.container.textContent, /Upload failed/));
    await first.unmount();

    for (let refresh = 0; refresh < 2; refresh += 1) {
      const restored = await mount(t, options);
      await waitFor(() => assert.match(restored.container.textContent, /Reattach unfinished photos/));
      await restored.unmount();
    }
  });

  await t.test('selected catalogue plants and quantities are attached to the visit', async (t) => {
    const plot = { id: 'recPlotPlants', stage: 'active' };
    const plantId = 'a1111111-1111-4111-8111-111111111111';
    t.mock.method(Api.plants, 'index', async () => ({ data: [{ id: plantId, plantName: 'Golden yarrow' }], headers: {} }));
    const create = t.mock.method(Api.maintenance, 'create', async (payload) => ({ data: { id: 'plant-save', ...payload } }));
    const view = await mount(t, { initialEntry: '/plots/recPlotPlants/updates/new', queryData: [[['plot', plot.id], plot]] });
    await waitFor(() => assert.ok(view.field('Planted')));
    await interact(() => view.field('Planted').click());
    await view.change('Find a plant', 'Golden');
    await waitFor(() => assert.match(dom.window.document.body.textContent, /Golden yarrow/));
    await view.selectPlantOption('Golden yarrow');
    await view.change('Quantity for Golden yarrow', '2');
    await view.submit();
    await waitFor(() => assert.match(view.container.textContent, /Update saved/));
    assert.deepEqual(create.mock.calls[0].arguments[0].plants, [{ plantId, quantity: 2 }]);
  });
});
