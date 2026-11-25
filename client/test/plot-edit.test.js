import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setupPlotTests, waitFor } from './helpers/plot-harness.js';

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

test('garden editing uses the admin-only Info action and separate draft', async (t) => {
  const { Api, dom, mount } = await setupPlotTests(t);
  const bounds = { north: 10, south: 0, east: 10, west: 0 };
  const queryData = [[['plot', garden.id], garden], [['plots', bounds], [garden]]];
  t.mock.method(Api.plots, 'get', async () => ({ data: garden }));

  await t.test('direct access requires a verified, unbanned administrator', async (t) => {
    for (const user of [null, { ...admin, isAdmin: false }, { ...admin, emailVerified: false }, { ...admin, banned: true }]) {
      const view = await mount(t, { initialEntry: `${gardenPath}/edit`, user, queryData });
      await waitFor(() => assert.match(view.container.textContent, /Only verified administrators/));
      assert.equal(view.container.querySelector('form'), null);
      if (!user) assert.equal(view.button('Sign in').getAttribute('href'), `/login?from=${encodeURIComponent(`${gardenPath}/edit`)}`);
      await view.unmount();
    }
  });

  await t.test('restores only this account and garden’s changes, retries a validation failure, and refreshes Info', async (t) => {
    const first = await mount(t, { initialEntry: gardenPath, user: admin, queryData, showHome: true });
    await first.click('Edit garden details');
    assert.equal(first.field('Garden title').value, 'Original name');
    await first.change('Garden title', 'Revised name');
    await first.change('Environmental notes', '');
    assert.deepEqual(JSON.parse(dom.window.sessionStorage.getItem(draftKey)), { 'Pocket Garden Name': 'Revised name', environmentalNotes: '' });
    await first.unmount();

    const other = await mount(t, { initialEntry: `${gardenPath}/edit`, user: otherAdmin, queryData });
    assert.equal(other.field('Garden title').value, 'Original name');
    await other.unmount();

    const view = await mount(t, { initialEntry: `${gardenPath}/edit`, user: admin, queryData, showHome: true });
    assert.equal(view.field('Garden title').value, 'Revised name');
    assert.equal(view.field('Environmental notes').value, '');
    let attempt = 0;
    const patch = t.mock.method(Api.plots, 'update', async (id, payload) => {
      assert.equal(id, garden.id);
      if (++attempt === 1) throw Object.assign(new Error('Validation'), { response: { status: 422, data: { errors: [{ path: 'Pocket Garden Name', message: 'Check this title' }] } } });
      return { data: { ...garden, ...payload } };
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
    assert.equal(view.client.getQueryState(['plots', bounds]).isInvalidated, true);
    assert.match(view.container.textContent, /Garden details saved/);
  });

  await t.test('a forbidden save preserves the draft and disables retries', async (t) => {
    const view = await mount(t, { initialEntry: `${gardenPath}/edit`, user: admin, queryData });
    const patch = t.mock.method(Api.plots, 'update', async () => {
      throw Object.assign(new Error('Forbidden'), { response: { status: 403 } });
    });
    await view.change('Garden title', 'Unsaved change');
    await view.submit();
    await waitFor(() => assert.match(view.container.textContent, /no longer have access/));
    assert.equal(view.button('Save garden details').disabled, true);
    await view.submit();
    assert.equal(patch.mock.calls.length, 1);
    assert.match(dom.window.sessionStorage.getItem(draftKey), /Unsaved change/);
  });
});
