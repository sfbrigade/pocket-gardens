import { test } from 'node:test';
import assert from 'node:assert/strict';
import { interact, setupPlotTests, waitFor } from './helpers/plot-harness.js';
import { draftKey } from '../src/Maintenance/maintenance-draft.js';

test('maintenance composer recovers interrupted saves', async (t) => {
  const { Api, dom, mount } = await setupPlotTests(t);
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

  await t.test('a save that finishes after leaving refreshes the open garden history', async (t) => {
    const plot = { id: 'recPlotLateSave', stage: 'active', plants: [] };
    const internalId = '11111111-1111-4111-8111-111111111111';
    const pending = Promise.withResolvers();
    const create = t.mock.method(Api.maintenance, 'create', () => pending.promise);
    let records = [];
    t.mock.method(Api.maintenance, 'index', async () => ({ data: records, headers: {} }));
    t.mock.method(Api.plots, 'index', async () => ({ data: [], headers: {} }));
    const view = await mount(t, {
      initialEntry: `/plots/${internalId}/updates/new`,
      showHome: true,
      queryData: [[['plot', internalId], plot], [['plot', plot.id], plot]],
    });
    await waitFor(() => assert.equal(view.field('When did this happen?').value, '2026-11-15'));
    await view.change('Anything to add?', 'Watered before leaving');
    await view.click('Add this update');
    await waitFor(() => assert.equal(create.mock.calls.length, 1));

    await view.navigate(`/plots/${plot.id}?tab=updates`);
    await waitFor(() => assert.match(view.container.textContent, /No updates recorded yet/));
    await interact(() => {
      const [payload] = create.mock.calls[0].arguments;
      const saved = { ...payload, id: 'saved-late', credit: 'Pocket Gardens team', createdAt: '2026-11-15T12:00:00Z' };
      records = [saved];
      pending.resolve({ data: saved });
    });
    await waitFor(() => assert.match(view.container.textContent, /Watered before leaving/));
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

  await t.test('legacy edits submit only changed fields and preserve the undated record', async (t) => {
    const plot = { id: 'recPlotLegacy', stage: 'archived' };
    const record = { id: 'legacy', gardenId: plot.id, version: 1, date: null, notes: null, activity: [], observations: [], photos: [], plants: [] };
    const update = t.mock.method(Api.maintenance, 'update', async (id, payload) => ({ data: { ...record, ...payload, id, version: 2 } }));
    const view = await mount(t, { initialEntry: '/plots/recPlotLegacy/updates/legacy/edit', queryData: [[['plot', plot.id], plot], [['maintenance-record', record.id], record]] });
    await waitFor(() => assert.equal(view.field('When did this happen?').value, ''));
    await view.change('Anything to add?', 'Clarified historical note');
    await view.submit();
    await waitFor(() => assert.match(view.container.textContent, /Update corrected/));
    const payload = update.mock.calls[0].arguments[1];
    assert.equal(payload.notes, 'Clarified historical note');
    assert.equal(payload.version, 1);
    assert.ok(payload.mutationId);
    assert.equal(payload.date, undefined);
    assert.equal(payload.activity, undefined);
    assert.equal(payload.plants, undefined);
  });

  await t.test('an unchanged imported future date permits a note-only correction through native validation', async (t) => {
    const plot = { id: 'recPlotFutureLegacy', stage: 'active' };
    const record = { id: 'future-legacy', gardenId: plot.id, version: 1, date: '2998-01-01', notes: 'Imported note', activity: [], observations: [], photos: [], plants: [] };
    const update = t.mock.method(Api.maintenance, 'update', async (id, payload) => ({ data: { ...record, ...payload, id, version: 2 } }));
    const view = await mount(t, { initialEntry: `/plots/${plot.id}/updates/${record.id}/edit`, queryData: [[['plot', plot.id], plot], [['maintenance-record', record.id], record]] });
    await waitFor(() => assert.equal(view.field('When did this happen?').value, record.date));
    await view.change('Anything to add?', 'Clarified imported note');
    const form = view.container.querySelector('form');
    assert.equal(form.checkValidity(), true);
    await interact(() => form.requestSubmit());
    await waitFor(() => assert.match(view.container.textContent, /Update corrected/));
    const payload = update.mock.calls[0].arguments[1];
    assert.equal(payload.notes, 'Clarified imported note');
    assert.equal(payload.date, undefined);
  });

  await t.test('changing an imported date still rejects future dates and permits a valid correction', async (t) => {
    const plot = { id: 'recPlotCorrectDate', stage: 'active' };
    const record = { id: 'correct-date', gardenId: plot.id, version: 1, date: '2998-01-01', notes: 'Imported note', activity: [], observations: [], photos: [], plants: [] };
    const update = t.mock.method(Api.maintenance, 'update', async (id, payload) => ({ data: { ...record, ...payload, id, version: 2 } }));
    const view = await mount(t, { initialEntry: `/plots/${plot.id}/updates/${record.id}/edit`, queryData: [[['plot', plot.id], plot], [['maintenance-record', record.id], record]] });
    await waitFor(() => assert.equal(view.field('When did this happen?').value, record.date));
    const form = view.container.querySelector('form');
    await view.change('When did this happen?', '2999-01-01');
    assert.equal(form.checkValidity(), false);
    await interact(() => form.requestSubmit());
    assert.equal(update.mock.calls.length, 0);
    await view.change('When did this happen?', '2026-09-02');
    assert.equal(form.checkValidity(), true);
    await interact(() => form.requestSubmit());
    await waitFor(() => assert.match(view.container.textContent, /Update corrected/));
    assert.equal(update.mock.calls[0].arguments[1].date, '2026-09-02');
  });

  await t.test('a version conflict keeps the draft until the user chooses to reload', async (t) => {
    const plot = { id: 'recPlotConflict', stage: 'active' };
    const record = { id: 'conflict', gardenId: plot.id, version: 1, date: '2026-09-02', notes: 'Original', activity: [], observations: [], photos: [], plants: [] };
    t.mock.method(Api.maintenance, 'update', async () => { throw Object.assign(new Error('Conflict'), { response: { status: 409, data: { message: 'Changed by another editor' } } }); });
    t.mock.method(Api.maintenance, 'get', async () => ({ data: { ...record, version: 2, notes: 'Latest saved note' } }));
    t.mock.method(dom.window, 'confirm', () => true);
    const view = await mount(t, { initialEntry: '/plots/recPlotConflict/updates/conflict/edit', queryData: [[['plot', plot.id], plot], [['maintenance-record', record.id], record]] });
    await waitFor(() => assert.equal(view.field('Anything to add?').value, 'Original'));
    await view.change('Anything to add?', 'My unsaved correction');
    await view.submit();
    await waitFor(() => assert.match(view.container.textContent, /Your draft has been preserved/));
    assert.equal(view.field('Anything to add?').value, 'My unsaved correction');
    await view.click('Load latest update');
    await waitFor(() => assert.equal(view.field('Anything to add?').value, 'Latest saved note'));
  });

  await t.test('removing existing photos requires saved-edit confirmation and reports pending erasure', async (t) => {
    const plot = { id: 'recPlotRemove', stage: 'active' };
    const record = { id: 'remove-photo', gardenId: plot.id, version: 1, date: '2026-09-02', notes: 'Evidence', activity: [], observations: [], photos: [{ id: 'photo-one', url: '/photo.jpg' }], plants: [] };
    const update = t.mock.method(Api.maintenance, 'update', async (id, payload) => ({ data: { ...record, photos: payload.photos, version: 2, cleanupPending: true } }));
    const confirm = t.mock.method(dom.window, 'confirm', () => false);
    const view = await mount(t, { initialEntry: '/plots/recPlotRemove/updates/remove-photo/edit', queryData: [[['plot', plot.id], plot], [['maintenance-record', record.id], record]] });
    await waitFor(() => assert.match(view.container.textContent, /Remove attached photo 1/));
    await view.click('Remove attached photo 1');
    await view.submit();
    assert.equal(update.mock.calls.length, 0);
    confirm.mock.restore();
    t.mock.method(dom.window, 'confirm', () => true);
    await view.submit();
    await waitFor(() => assert.match(view.container.textContent, /Permanent photo erasure is pending/));
    assert.deepEqual(update.mock.calls[0].arguments[1].photos, []);
  });

  await t.test('a garden closing after an uncertain save still permits replay; discard creates a new draft', async (t) => {
    const plot = { id: 'recPlotClosed', stage: 'archived' };
    const { newMaintenanceDraft, maintenancePayload } = await import('../src/Maintenance/maintenance-draft.js');
    const draft = { ...newMaintenanceDraft('2026-09-02'), notes: 'Previously attempted visit' };
    draft.attempt = maintenancePayload(draft, plot.id);
    dom.window.sessionStorage.setItem(draftKey(plot.id), JSON.stringify(draft));
    const create = t.mock.method(Api.maintenance, 'create', async (payload) => ({ data: { id: 'closed-save', ...payload } }));
    const view = await mount(t, { initialEntry: '/plots/recPlotClosed/updates/new', queryData: [[['plot', plot.id], plot]] });
    await waitFor(() => assert.match(view.container.textContent, /Retry the prior save/));
    assert.equal(view.button('Try again').disabled, false);
    await view.submit();
    await waitFor(() => assert.match(view.container.textContent, /Update saved/));
    assert.equal(create.mock.calls.length, 1);
    await view.click('Add another update');
    t.mock.method(dom.window, 'confirm', () => true);
    const before = JSON.parse(dom.window.sessionStorage.getItem(draftKey(plot.id))).submissionId;
    await view.click('Discard local draft');
    await waitFor(() => assert.notEqual(JSON.parse(dom.window.sessionStorage.getItem(draftKey(plot.id))).submissionId, before));
  });
});
