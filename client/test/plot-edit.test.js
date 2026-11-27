import { test } from 'node:test';
import assert from 'node:assert/strict';
import { interact, setupPlotTests, waitFor } from './helpers/plot-harness.js';

const garden = {
  id: 'recGarden',
  stage: 'potential',
  'Pocket Garden Name': 'Original name',
  'Location Description': 'Near the corner',
  permissionStatus: null,
  environmentalNotes: 'Afternoon sun',
};
const gardenPath = `/plots/${garden.id}`;
const admin = { id: 'admin', isAdmin: true, emailVerified: true, banned: false };
const otherAdmin = { ...admin, id: 'other-admin' };
const draftKey = `pocket-gardens:plot-edit:v1:${admin.id}:${garden.id}`;

test('garden editing uses an authorized Info action and separate draft', async (t) => {
  const { Api, dom, mount } = await setupPlotTests(t);
  const bounds = { north: 10, south: 0, east: 10, west: 0 };
  const queryData = [[['plot', garden.id], garden], [['plots', bounds], [garden]]];
  t.mock.method(Api.plots, 'get', async () => ({ data: garden }));

  await t.test('direct access requires a verified, unbanned account', async (t) => {
    for (const user of [null, { ...admin, emailVerified: false }, { ...admin, banned: true }]) {
      const view = await mount(t, { initialEntry: `${gardenPath}/edit`, user, queryData });
      await waitFor(() => assert.match(view.container.textContent, /A verified account is required/));
      assert.equal(view.container.querySelector('form'), null);
      if (!user) assert.equal(view.button('Sign in').getAttribute('href'), `/login?from=${encodeURIComponent(`${gardenPath}/edit`)}`);
      await view.unmount();
    }
  });

  await t.test('contributors can open the editor and submit only fields the server marks as editable', async (t) => {
    const author = { ...admin, id: 'author', isAdmin: false };
    t.mock.method(Api.plots, 'editAccess', async () => ({ data: { canEdit: true } }));
    t.mock.method(Api.plots, 'getForEdit', async () => ({ data: { ...garden, editableFields: ['gardenCareNote'] } }));
    const patch = t.mock.method(Api.plots, 'update', async (_id, changes) => ({ data: { ...garden, ...changes } }));
    const key = `pocket-gardens:plot-edit:v1:${author.id}:${garden.id}`;
    dom.window.sessionStorage.setItem(key, JSON.stringify({ 'Pocket Garden Name': 'An old unauthorized draft' }));
    const view = await mount(t, { initialEntry: gardenPath, user: author, queryData, showHome: true });
    await waitFor(() => view.button('Edit garden details'));
    assert.doesNotMatch(view.container.textContent, /Move to Preparing/);
    await view.click('Edit garden details');
    await waitFor(() => view.field('Garden care note'));
    assert.doesNotMatch(view.container.textContent, /Garden title|Staff-only permission notes/);
    await view.change('Garden care note', 'Water weekly');
    await view.submit();
    await waitFor(() => assert.equal(view.path, gardenPath));
    assert.deepEqual(patch.mock.calls[0].arguments[1], { gardenCareNote: 'Water weekly' });
  });

  await t.test('restores only this account and garden’s changes, retries a validation failure, and refreshes Info', async (t) => {
    const first = await mount(t, { initialEntry: gardenPath, user: admin, queryData, showHome: true });
    await first.click('Edit garden details');
    await waitFor(() => assert.equal(first.field('Garden title').value, 'Original name'));
    await first.change('Garden title', 'Revised name');
    await first.change('Environmental notes', '');
    assert.deepEqual(JSON.parse(dom.window.sessionStorage.getItem(draftKey)), {
      changes: { 'Pocket Garden Name': 'Revised name', environmentalNotes: '' },
      baseline: { 'Pocket Garden Name': 'Original name', environmentalNotes: 'Afternoon sun' },
    });
    await first.unmount();

    const other = await mount(t, { initialEntry: `${gardenPath}/edit`, user: otherAdmin, queryData });
    await waitFor(() => assert.equal(other.field('Garden title').value, 'Original name'));
    await other.unmount();

    const view = await mount(t, { initialEntry: `${gardenPath}/edit`, user: admin, queryData, showHome: true });
    await waitFor(() => assert.equal(view.field('Garden title').value, 'Revised name'));
    assert.equal(view.field('Environmental notes').value, '');
    let attempt = 0;
    let saved = garden;
    t.mock.method(Api.plots, 'get', async () => ({ data: saved }));
    const patch = t.mock.method(Api.plots, 'update', async (id, payload) => {
      assert.equal(id, garden.id);
      if (++attempt === 1) throw Object.assign(new Error('Validation'), { response: { status: 422, data: { errors: [{ path: 'Pocket Garden Name', message: 'Check this title' }] } } });
      saved = { ...garden, ...payload };
      return { data: saved };
    });

    await view.change('Where exactly is it?', ' ');
    await view.submit();
    assert.equal(patch.mock.calls.length, 0);
    await view.change('Where exactly is it?', garden['Location Description']);
    await view.submit();
    await waitFor(() => assert.match(view.container.textContent, /Check this title/));
    assert.equal(view.field('Garden title').value, 'Revised name');
    await view.submit();
    await waitFor(() => assert.equal(view.path, gardenPath));
    assert.deepEqual(patch.mock.calls[1].arguments[1], { 'Pocket Garden Name': 'Revised name', environmentalNotes: '' });
    assert.equal(dom.window.sessionStorage.getItem(draftKey), null);
    assert.equal(view.client.getQueryData(['plot', garden.id])['Pocket Garden Name'], 'Revised name');
    assert.equal(view.client.getQueryData(['plots', bounds])[0]['Pocket Garden Name'], 'Revised name');
    assert.equal(view.client.getQueryState(['plots', bounds]).isInvalidated, true);
    assert.match(view.container.textContent, /Garden details saved/);
  });

  await t.test('a partially applied draft retries only its remaining changes', async (t) => {
    const saved = { ...garden, 'Pocket Garden Name': 'Title from an uncertain save' };
    t.mock.method(Api.plots, 'get', async () => ({ data: saved }));
    dom.window.sessionStorage.setItem(draftKey, JSON.stringify({ 'Pocket Garden Name': saved['Pocket Garden Name'], environmentalNotes: 'Unsaved note' }));
    const view = await mount(t, { initialEntry: `${gardenPath}/edit`, user: admin, queryData });
    await waitFor(() => assert.equal(view.field('Environmental notes').value, 'Unsaved note'));
    assert.deepEqual(JSON.parse(dom.window.sessionStorage.getItem(draftKey)).changes, { environmentalNotes: 'Unsaved note' });
    const patch = t.mock.method(Api.plots, 'update', async (_id, changes) => ({ data: { ...saved, ...changes } }));
    await view.submit();
    await waitFor(() => assert.equal(view.path, gardenPath));
    assert.deepEqual(patch.mock.calls[0].arguments[1], { environmentalNotes: 'Unsaved note' });
    assert.equal(dom.window.sessionStorage.getItem(draftKey), null);
  });

  await t.test('staff permission notes stay out of browser drafts and public caches', async (t) => {
    t.mock.method(Api.plots, 'getForEdit', async () => ({ data: { ...garden, staffPermissionNotes: 'Imported permission note', editableFields: ['staffPermissionNotes', 'gardenCareNote'] } }));
    const patch = t.mock.method(Api.plots, 'update', async (_id, { gardenCareNote }) => ({ data: { ...garden, gardenCareNote } }));
    const view = await mount(t, { initialEntry: `${gardenPath}/edit`, user: admin, queryData, showHome: true });
    await waitFor(() => assert.equal(view.field('Staff-only permission notes').value, 'Imported permission note'));
    await view.change('Staff-only permission notes', 'Updated private note');
    await view.change('Garden care note', 'Water weekly');
    assert.deepEqual(JSON.parse(dom.window.sessionStorage.getItem(draftKey)).changes, { gardenCareNote: 'Water weekly' });
    await view.submit();
    await waitFor(() => assert.equal(view.path, gardenPath));
    assert.deepEqual(patch.mock.calls[0].arguments[1], { staffPermissionNotes: 'Updated private note', gardenCareNote: 'Water weekly' });
    assert.equal(view.client.getQueryData(['plot', garden.id]).staffPermissionNotes, undefined);
    assert.doesNotMatch(view.container.textContent, /Imported permission note|Updated private note/);
  });

  await t.test('reopening during a save waits for its result before restoring the draft', async (t) => {
    const saved = { ...garden, 'Pocket Garden Name': 'Already saved' };
    const response = Promise.withResolvers();
    t.after(() => response.resolve({ data: saved }));
    const patch = t.mock.method(Api.plots, 'update', async () => response.promise);
    const view = await mount(t, { initialEntry: gardenPath, user: admin, queryData, showHome: true });
    await view.click('Edit garden details');
    await waitFor(() => view.field('Garden title'));
    await view.change('Garden title', saved['Pocket Garden Name']);
    await view.submit();
    await waitFor(() => assert.equal(patch.mock.calls.length, 1));
    await view.navigate(-1);
    await view.click('Edit garden details');
    await waitFor(() => assert.ok(view.container.querySelector('[aria-label="Finishing garden save"]')));

    await interact(() => response.resolve({ data: saved }));
    await waitFor(() => assert.equal(view.field('Garden title').value, saved['Pocket Garden Name']));
    assert.equal(view.path, `${gardenPath}/edit`);
    assert.equal(view.button('Save garden details').disabled, true);
    assert.equal(dom.window.sessionStorage.getItem(draftKey), null);
  });

  await t.test('a forbidden save preserves the draft and disables retries', async (t) => {
    t.after(() => dom.window.sessionStorage.removeItem(draftKey));
    const view = await mount(t, { initialEntry: `${gardenPath}/edit`, user: admin, queryData });
    const patch = t.mock.method(Api.plots, 'update', async () => {
      throw Object.assign(new Error('Forbidden'), { response: { status: 403 } });
    });
    await waitFor(() => view.field('Garden title'));
    await view.change('Garden title', 'Unsaved change');
    await view.submit();
    await waitFor(() => assert.match(view.container.textContent, /no longer have access/));
    assert.equal(view.button('Save garden details').disabled, true);
    await view.submit();
    assert.equal(patch.mock.calls.length, 1);
    assert.match(dom.window.sessionStorage.getItem(draftKey), /Unsaved change/);
  });

  await t.test('a stale save keeps the draft and offers a return path to review the newer value', async (t) => {
    t.after(() => dom.window.sessionStorage.removeItem(draftKey));
    let saved = garden;
    t.mock.method(Api.plots, 'get', async () => ({ data: saved }));
    const patch = t.mock.method(Api.plots, 'update', async (_id, _changes, original) => {
      assert.deepEqual(original, { environmentalNotes: garden.environmentalNotes });
      throw Object.assign(new Error('Conflict'), { response: { status: 409 } });
    });
    const view = await mount(t, { initialEntry: `${gardenPath}/edit`, user: admin, queryData, showHome: true });
    await waitFor(() => view.field('Environmental notes'));
    await view.change('Environmental notes', 'My stale draft');
    saved = { ...garden, environmentalNotes: 'New saved value' };
    await view.submit();
    await waitFor(() => assert.match(view.container.textContent, /changed while you were editing/));
    await view.submit();
    assert.equal(patch.mock.calls.length, 1);
    await view.click('Return to garden and keep public draft');
    await view.click('Edit garden details');
    const conflict = await waitFor(() => view.container.querySelector('[role="alert"]') || assert.fail('Missing draft conflict'));
    assert.match(conflict.textContent, /Saved details changed/);
    assert.match(conflict.textContent, /New saved value/);
    assert.equal(view.field('Environmental notes').value, 'My stale draft');
  });
});
