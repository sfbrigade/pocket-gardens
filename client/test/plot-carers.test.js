import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createPlotDraft } from '../src/Plots/plot-form.js';
import { draftStorageKey, setupPlotTests, waitFor } from './helpers/plot-harness.js';

test('registered carer picker', async (t) => {
  const { dom, Api, mount, readDraft } = await setupPlotTests(t);
  const user = { id: 'dab5dff3-360d-4dbb-98dd-1990dfb5c4c5', displayName: 'Regular User' };
  t.beforeEach(() => dom.window.sessionStorage.setItem(draftStorageKey, JSON.stringify({
    ...createPlotDraft(), position: { latitude: 37.77, longitude: -122.43 }, locator: 'Gate', addressEdited: true,
  })));
  t.mock.method(globalThis, 'fetch', async () => ({ ok: true, json: async () => ({ features: [] }) }));
  await t.test('staff select carers and retain them across refresh and save retries', async (t) => {
    const other = { id: 'aa1fdcf6-a63c-454e-9775-2d6fd116fdb1', displayName: 'Another User' };
    const create = t.mock.method(Api.plots, 'create', async () => { throw Object.assign(new Error('Response lost'), { _form: 'Response lost' }); });
    let view = await mount(t);
    await waitFor(() => assert.equal(view.field('Where exactly is it?').value, 'Gate'));
    assert.ok(view.field('Who looks after it'));
    const search = t.mock.method(Api.plots, 'carers', async ({ offset }) => offset
      ? { data: [other], headers: {} }
      : { data: [user], headers: { 'x-next-offset': '1' } });
    await view.change('Who looks after it', 'User');
    await waitFor(() => assert.ok([...dom.window.document.querySelectorAll('[role=option]')].some((option) => option.textContent === 'Show more matches')));
    await view.selectPlantOption('Show more matches');
    await waitFor(() => assert.ok([...dom.window.document.querySelectorAll('[role=option]')].some((option) => option.textContent === 'Another User')));
    assert.equal(search.mock.calls.length, 2);
    await view.selectPlantOption('Another User');
    await waitFor(() => assert.equal(readDraft().carers[0].userId, other.id));
    await view.change('Who looks after it', 'Regular');
    await waitFor(() => assert.ok([...dom.window.document.querySelectorAll('[role=option]')].some((option) => option.textContent === 'Regular User')));
    await view.selectPlantOption('Regular User');
    await waitFor(() => assert.equal(readDraft().carers.length, 2));
    await view.click('Remove Another User');
    await view.submit();
    await waitFor(() => assert.match(view.container.textContent, /Response lost/));
    const sent = create.mock.calls[0].arguments[0];
    assert.deepEqual(sent.carerUserIds, [user.id]);
    await view.unmount();
    view = await mount(t);
    await waitFor(() => assert.match(view.container.textContent, /Regular User/));
    create.mock.mockImplementation(async () => ({ data: { id: 'pg_saved' } }));
    await view.submit();
    await waitFor(() => assert.equal(view.path, '/plots/pg_saved'));
    assert.deepEqual(create.mock.calls[1].arguments[0], sent);
  });

  await t.test('search failures can be retried and selected users cannot be added twice', async (t) => {
    const search = t.mock.method(Api.plots, 'carers', async () => { throw new Error('Unavailable'); });
    const view = await mount(t);
    await waitFor(() => assert.equal(view.field('Where exactly is it?').value, 'Gate'));
    await view.change('Who looks after it', 'Regular');
    await waitFor(() => assert.match(dom.window.document.body.textContent, /Unable to search/));
    search.mock.mockImplementation(async () => ({ data: [user], headers: {} }));
    await view.click('Retry search');
    await waitFor(() => assert.ok([...dom.window.document.querySelectorAll('[role=option]')].some((option) => option.textContent === user.displayName)));
    await view.selectPlantOption(user.displayName);
    await waitFor(() => assert.equal(readDraft().carers.length, 1));
    await view.change('Who looks after it', 'Regular');
    await waitFor(() => assert.match(dom.window.document.body.textContent, /No other registered users found/));
    assert.equal(readDraft().carers.length, 1);
    await view.change('Who looks after it', '');
  });

  await t.test('unavailable carers receive field feedback and can be removed before resubmitting', async (t) => {
    dom.window.sessionStorage.setItem(draftStorageKey, JSON.stringify({
      ...createPlotDraft(),
      position: { latitude: 37.77, longitude: -122.43 },
      locator: 'Gate',
      addressEdited: true,
      carers: [{ userId: user.id, displayName: user.displayName }],
    }));
    const create = t.mock.method(Api.plots, 'create', async () => { throw Object.assign(new Error('Unavailable carer'), { carerUserIds: 'A selected carer is no longer available' }); });
    const view = await mount(t);
    await waitFor(() => assert.match(view.container.textContent, /Regular User/));
    await view.submit();
    await waitFor(() => assert.match(view.container.textContent, /A selected carer is no longer available/));
    assert.equal(view.field('Who looks after it').getAttribute('aria-invalid'), 'true');
    await view.click('Remove Regular User');
    create.mock.mockImplementation(async () => ({ data: { id: 'pg_saved' } }));
    await view.submit();
    await waitFor(() => assert.equal(view.path, '/plots/pg_saved'));
    assert.equal(create.mock.calls[1].arguments[0].carerUserIds, undefined);
  });

  await t.test('creation without carer assignment access shows staff sign-in guidance', async (t) => {
    const search = t.mock.method(Api.plots, 'carers', async () => { throw new Error('Should not search'); });
    const create = t.mock.method(Api.plots, 'create', async () => ({ data: { id: 'pg_saved' } }));
    const view = await mount(t, { canAssignCarers: false });
    await waitFor(() => assert.equal(view.field('Where exactly is it?').value, 'Gate'));
    assert.match(view.container.textContent, /Sign in with a staff account to assign registered carers/);
    assert.ok(![...view.container.querySelectorAll('label')].some((label) => label.textContent === 'Who looks after it'));
    await view.submit();
    await waitFor(() => assert.equal(view.path, '/plots/pg_saved'));
    assert.equal(search.mock.calls.length, 0);
    assert.equal(create.mock.calls[0].arguments[0].carerUserIds, undefined);
  });

  await t.test('typing a different name hides previous matches and never assigns an unselected name', async (t) => {
    t.mock.method(Api.plots, 'carers', async () => ({ data: [user], headers: {} }));
    const create = t.mock.method(Api.plots, 'create', async () => ({ data: { id: 'pg_saved' } }));
    const view = await mount(t);
    await waitFor(() => assert.equal(view.field('Where exactly is it?').value, 'Gate'));
    await view.change('Who looks after it', 'Regular');
    await waitFor(() => assert.ok([...dom.window.document.querySelectorAll('[role=option]')].some((option) => option.textContent === user.displayName)));
    await view.change('Who looks after it', 'Someone else');
    assert.ok(![...dom.window.document.querySelectorAll('[role=option]')].some((option) => option.textContent === user.displayName));
    await view.submit();
    await waitFor(() => assert.equal(view.path, '/plots/pg_saved'));
    assert.equal(create.mock.calls[0].arguments[0].carerUserIds, undefined);
  });
});
