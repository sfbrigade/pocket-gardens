import { test } from 'node:test';
import assert from 'node:assert/strict';
import { draftKey, newMaintenanceDraft } from '../src/Maintenance/maintenance-draft.js';
import { interact, setupPlotTests, waitFor } from './helpers/plot-harness.js';

const garden = { id: 'recGarden', stage: 'potential', 'Pocket Garden Name': 'Corner garden', permissionStatus: 'needed' };
const gardenPath = `/plots/${garden.id}`;
const admin = { id: 'admin', isAdmin: true, emailVerified: true, banned: false };
const transition = { stage: 'preparing', expectedStage: 'potential' };

test('garden stage changes are distinct from visits and recover from stale or lost responses', async (t) => {
  const { Api, dom, mount } = await setupPlotTests(t);
  const doc = dom.window.document;
  const matchMedia = dom.window.matchMedia;
  const queryData = [[['plot', garden.id], garden]];
  const mountGarden = (t, user = admin) => mount(t, { initialEntry: gardenPath, user, showHome: true, queryData });

  async function confirmMove (view) {
    await view.click('Move to Preparing');
    const dialog = await waitFor(() => [...doc.querySelectorAll('[role="dialog"]')].find((dialog) => dialog.textContent.includes('Move this garden to Preparing?')) || assert.fail('Missing stage confirmation'));
    const confirm = [...dialog.querySelectorAll('button')].find((button) => button.textContent === 'Move to Preparing');
    await interact(() => confirm.click());
  }

  await t.test('a contributor records a visit and an administrator moves the same site in the mobile drawer', async (t) => {
    dom.window.matchMedia = (media) => ({ ...matchMedia(media), matches: media === '(max-width: 48em)' });
    t.after(() => { dom.window.matchMedia = matchMedia; });
    let plot = garden;
    const visits = [];
    t.mock.method(Api.plots, 'get', async () => ({ data: plot }));
    t.mock.method(Api.maintenance, 'index', async () => ({ data: [...visits], headers: {} }));
    const create = t.mock.method(Api.maintenance, 'create', async (payload) => {
      const record = { ...payload, id: 'first-visit', credit: 'Contributor', createdAt: '2026-11-15T18:00:00Z' };
      visits.push(record);
      return { data: record };
    });
    const patch = t.mock.method(Api.plots, 'update', async (id, body) => {
      assert.equal(id, garden.id);
      assert.deepEqual(body, transition);
      plot = { ...plot, stage: body.stage };
      return { data: plot };
    });

    const contributor = await mountGarden(t, { ...admin, id: 'contributor', isAdmin: false });
    await waitFor(() => assert.match(doc.querySelector('[role="dialog"]')?.textContent || '', /Potential site/));
    assert.doesNotMatch(doc.body.textContent, /Edit garden details|Move to Preparing/);
    await contributor.click('Updates');
    await waitFor(() => contributor.button('Add an update'));
    await contributor.click('Add an update');
    const watered = await waitFor(() => contributor.field('Watered'));
    await interact(() => watered.click());
    await contributor.click('Add this update');
    await waitFor(() => contributor.button('Back to updates'));
    await contributor.click('Back to updates');
    await waitFor(() => assert.match(doc.body.textContent, /Watered/));
    assert.equal(create.mock.calls.length, 1);
    assert.equal(patch.mock.calls.length, 0);
    assert.equal(plot.stage, 'potential');
    await contributor.unmount();

    const visitDraft = JSON.stringify({ ...newMaintenanceDraft('2026-11-15'), notes: 'Follow-up visit draft' });
    dom.window.sessionStorage.setItem(draftKey(admin.id, garden.id), visitDraft);
    const staff = await mountGarden(t);
    await waitFor(() => staff.button('Edit garden details'));
    await confirmMove(staff);
    await waitFor(() => assert.match(doc.body.textContent, /Garden moved to Preparing/));
    assert.equal(staff.client.getQueryData(['plot', garden.id]).permissionStatus, 'needed');
    assert.equal(patch.mock.calls.length, 1);
    assert.equal(visits.length, 1);
    assert.equal(dom.window.sessionStorage.getItem(draftKey(admin.id, garden.id)), visitDraft);
    await staff.click('Updates');
    await waitFor(() => staff.button('Resume update draft'));
    await waitFor(() => assert.equal(doc.querySelectorAll('article').length, 1));
  });

  await t.test('an offline stage write fails immediately and verification can be retried without a second write', async (t) => {
    const { onlineManager } = await import('@tanstack/react-query');
    t.after(() => onlineManager.setOnline(true));
    const patch = t.mock.method(Api.plots, 'update', async () => { throw new Error('Response lost'); });
    t.mock.method(Api.maintenance, 'index', async () => ({ data: [], headers: {} }));
    let attempts = 0;
    t.mock.method(Api.plots, 'get', async () => {
      if (++attempts === 1) throw new Error('Network unavailable');
      return { data: { ...garden, stage: 'preparing' } };
    });
    const view = await mountGarden(t);
    await interact(() => onlineManager.setOnline(false));
    await confirmMove(view);
    await waitFor(() => view.button('Check garden stage'));
    assert.doesNotMatch(view.container.textContent, /Move to Preparing/);
    assert.equal(patch.mock.calls.length, 1);
    await interact(() => onlineManager.setOnline(true));
    await view.click('Updates');
    await view.click('Info');
    await waitFor(() => view.button('Check garden stage'));
    assert.doesNotMatch(view.container.textContent, /Move to Preparing/);
    assert.equal(attempts, 1);

    const otherGarden = { ...garden, id: 'recAnotherGarden' };
    view.client.setQueryData(['plot', otherGarden.id], otherGarden);
    await view.navigate(`/plots/${otherGarden.id}`);
    await waitFor(() => view.button('Move to Preparing'));
    assert.doesNotMatch(view.container.textContent, /Check garden stage/);
    await view.navigate(gardenPath);
    await waitFor(() => view.button('Check garden stage'));

    await view.click('Check garden stage');
    await waitFor(() => assert.match(doc.body.textContent, /already Preparing/));
    assert.equal(view.client.getQueryData(['plot', garden.id]).stage, 'preparing');
    assert.equal(patch.mock.calls.length, 1);
  });

  await t.test('stage conflict verification survives navigation, refreshes both IDs, and performs no second write', async (t) => {
    const alias = '22222222-2222-4222-8222-222222222222';
    const checking = Promise.withResolvers();
    const patch = t.mock.method(Api.plots, 'update', async () => { throw Object.assign(new Error('Conflict'), { response: { status: 409 } }); });
    const get = t.mock.method(Api.plots, 'get', async () => ({ data: await checking.promise }));
    const view = await mount(t, { initialEntry: `/plots/${alias}`, user: admin, showHome: true, queryData: [...queryData, [['plot', alias], garden]] });

    await confirmMove(view);
    await waitFor(() => assert.match(view.container.textContent, /Checking garden stage/));
    await view.navigate('/');
    await interact(() => checking.resolve({ ...garden, stage: 'active' }));
    await waitFor(() => assert.equal(view.client.getQueryData(['plot', alias]).stage, 'active'));
    assert.equal(view.client.getQueryData(['plot', garden.id]).stage, 'active');
    assert.equal(get.mock.calls.length, 1);

    await view.navigate(gardenPath);
    await waitFor(() => assert.match(view.container.textContent, /garden stage has changed/i));
    assert.doesNotMatch(view.container.textContent, /Move to Preparing/);
    assert.equal(patch.mock.calls.length, 1);
  });

  await t.test('a stage response cannot initialize the editor before its garden read finishes', async (t) => {
    const editorRead = Promise.withResolvers();
    const stageResponse = Promise.withResolvers();
    t.after(() => { editorRead.resolve(garden); stageResponse.resolve(garden); });
    const get = t.mock.method(Api.plots, 'get', async () => ({ data: await editorRead.promise }));
    const patch = t.mock.method(Api.plots, 'update', async () => ({ data: await stageResponse.promise }));
    const key = `pocket-gardens:plot-edit:v1:${admin.id}:${garden.id}`;
    const saved = { ...garden, 'Pocket Garden Name': 'Already saved', stage: 'preparing' };
    dom.window.sessionStorage.setItem(key, JSON.stringify({ 'Pocket Garden Name': saved['Pocket Garden Name'] }));
    const view = await mountGarden(t);

    await confirmMove(view);
    await waitFor(() => assert.equal(patch.mock.calls.length, 1));
    await view.click('Edit garden details');
    await waitFor(() => assert.equal(get.mock.calls.length, 1));
    await interact(() => stageResponse.resolve(saved));
    await waitFor(() => assert.equal(view.client.getQueryData(['plot', garden.id]).stage, 'preparing'));
    assert.equal(view.container.querySelector('form'), null);

    await interact(() => editorRead.resolve(saved));
    await waitFor(() => assert.equal(view.field('Garden title').value, 'Already saved'));
    assert.equal(view.button('Save garden details').disabled, true);
    assert.equal(dom.window.sessionStorage.getItem(key), null);
  });

  await t.test('a late edit response preserves the stage already shown in Info and on the map', async (t) => {
    const editResponse = Promise.withResolvers();
    const finalRead = Promise.withResolvers();
    let plot = garden;
    let delayReads = false;
    t.mock.method(Api.plots, 'get', async () => {
      if (delayReads) await finalRead.promise;
      return { data: plot };
    });
    const patch = t.mock.method(Api.plots, 'update', async (_id, { expectedStage, ...changes }) => {
      plot = { ...plot, ...changes };
      const saved = plot;
      if (!expectedStage) await editResponse.promise;
      return { data: saved };
    });
    const view = await mountGarden(t);
    const viewportKey = ['plots', { north: 10, south: 0, east: 10, west: 0 }];
    view.client.setQueryData(viewportKey, [garden]);

    try {
      await view.click('Edit garden details');
      await waitFor(() => view.field('Garden title'));
      await view.change('Garden title', 'Revised title');
      await view.submit();
      await waitFor(() => assert.equal(patch.mock.calls.length, 1));
      await view.navigate(-1);
      await confirmMove(view);
      await waitFor(() => assert.match(view.container.textContent, /Garden moved to Preparing/));

      delayReads = true;
      await interact(() => editResponse.resolve());
      await waitFor(() => assert.deepEqual(view.client.getQueryData(['plot', garden.id]), plot));
      assert.equal(view.client.getQueryData(viewportKey)[0].stage, 'preparing');
      assert.equal(view.client.getQueryData(viewportKey)[0]['Pocket Garden Name'], 'Revised title');
      assert.match(view.container.textContent, /Garden moved to Preparing/);
    } finally {
      await interact(() => { editResponse.resolve(); finalRead.resolve(); });
    }
  });
});
