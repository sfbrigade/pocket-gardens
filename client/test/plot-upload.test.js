import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createPlotDraft } from '../src/Plots/plot-form.js';
import { draftStorageKey, interact, setupPlotTests, waitFor } from './helpers/plot-harness.js';

test('garden photo upload lifecycle', async (t) => {
  const { dom, Api, mount, readDraft, revokePreview } = await setupPlotTests(t);
  const filename = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.jpg';
  t.beforeEach(() => dom.window.sessionStorage.setItem(draftStorageKey, JSON.stringify({
    ...createPlotDraft(), position: { latitude: 37.77, longitude: -122.43 }, locator: 'Near gate', addressEdited: true,
  })));
  t.mock.method(Api.assets, 'create', async () => ({ data: { filename, url: '/qa-upload', headers: {} } }));

  await t.test('uploading and failed uploads block saving; retry attaches the successful upload', async (t) => {
    const first = Promise.withResolvers();
    const retry = Promise.withResolvers();
    let attempt = 0;
    const upload = t.mock.method(Api.assets, 'upload', () => (++attempt === 1 ? first.promise : retry.promise));
    const create = t.mock.method(Api.plots, 'create', async () => ({ data: { id: 'pg_with-photo' } }));
    const view = await mount(t);
    await waitFor(() => assert.equal(view.field('Where exactly is it?').value, 'Near gate'));
    await view.upload();
    await waitFor(() => assert.equal(upload.mock.calls.length, 1));
    assert.equal(view.button('Create garden').disabled, true);
    await view.submit();
    assert.equal(create.mock.calls.length, 0);

    await interact(() => first.reject(new Error('Upload unavailable')));
    await waitFor(() => assert.match(view.container.textContent, /Photo upload failed/));
    assert.equal(view.button('Create garden').disabled, true);
    await view.submit();
    assert.equal(create.mock.calls.length, 0);
    await view.click('Retry upload');
    await waitFor(() => assert.equal(upload.mock.calls.length, 2));
    await interact(() => retry.resolve());
    await waitFor(() => assert.equal(view.button('Create garden').disabled, false));
    assert.equal(readDraft().photo, filename);
    await view.submit();
    await waitFor(() => assert.equal(view.path, '/plots/pg_with-photo'));
    assert.deepEqual(create.mock.calls[0].arguments[0].Photos, [filename]);
  });

  await t.test('removal aborts the upload and a late completion cannot reattach the photo', async (t) => {
    const pending = Promise.withResolvers();
    const upload = t.mock.method(Api.assets, 'upload', () => pending.promise);
    const view = await mount(t);
    await waitFor(() => assert.equal(view.field('Where exactly is it?').value, 'Near gate'));
    await view.upload();
    await waitFor(() => assert.equal(upload.mock.calls.length, 1));
    const signal = upload.mock.calls[0].arguments[3];
    const preview = view.container.querySelector('img').getAttribute('src');
    const mutation = view.client.getMutationCache().getAll()[0];
    assert.equal(signal.aborted, false);
    await view.click('Remove photo');
    assert.equal(signal.aborted, true);
    assert.ok(revokePreview.mock.calls.some(({ arguments: args }) => args[0] === preview));
    assert.equal(readDraft().photo, '');
    assert.equal(readDraft().photoWasSelected, false);
    assert.equal(view.button('Create garden').disabled, false);

    // The transport deliberately ignores abort and succeeds late.
    await interact(() => pending.resolve());
    await waitFor(() => assert.equal(mutation.state.status, 'success'));
    assert.equal(readDraft().photo, '');
    assert.equal(view.container.querySelector('button[aria-label="Remove photo"]'), null);
  });

  await t.test('refresh during upload preserves fields and requires reattachment or an explicit opt-out', async (t) => {
    const pending = Promise.withResolvers();
    const upload = t.mock.method(Api.assets, 'upload', () => pending.promise);
    const first = await mount(t);
    await waitFor(() => assert.equal(first.field('Where exactly is it?').value, 'Near gate'));
    await first.upload();
    await waitFor(() => assert.equal(upload.mock.calls.length, 1));
    const mutation = first.client.getMutationCache().getAll()[0];
    const signal = upload.mock.calls[0].arguments[3];
    await first.unmount();
    assert.equal(signal.aborted, true);
    const refreshed = await mount(t);
    await waitFor(() => assert.match(refreshed.container.textContent, /Reattach your photo/));
    assert.equal(refreshed.field('Where exactly is it?').value, 'Near gate');
    assert.equal(refreshed.button('Create garden').disabled, true);
    await refreshed.click('Continue without photo');
    await waitFor(() => assert.equal(refreshed.button('Create garden').disabled, false));
    await interact(() => pending.resolve());
    await waitFor(() => assert.equal(mutation.state.status, 'success'));
    assert.equal(readDraft().photo, '');
    assert.equal(readDraft().photoWasSelected, false);
  });
});


test('photo work belongs to its garden draft', async (t) => {
  const { dom, Api, mount, readDraft, revokePreview } = await setupPlotTests(t);
  t.mock.method(globalThis, 'fetch', async () => ({ ok: true, json: async () => ({ features: [] }) }));
  t.mock.method(Api.assets, 'create', async () => ({ data: { filename: 'old.jpg', url: '/upload', headers: {} } }));
  for (const choice of ['Keep existing draft', 'Discard draft and start here']) {
    await t.test(`drop while choosing: ${choice}`, async (t) => {
      const original = { ...createPlotDraft(), locator: 'Old garden', addressEdited: true };
      dom.window.sessionStorage.setItem(draftStorageKey, JSON.stringify(original));
      const upload = t.mock.method(Api.assets, 'upload', async () => {});
      const view = await mount(t, { initialEntry: { pathname: '/plots/new', state: { mapPosition: { latitude: 37.79, longitude: -122.41 } } } });
      await waitFor(() => assert.match(view.container.textContent, /You have an unfinished garden/));
      await view.dropPhoto();
      // Flush the dropzone's asynchronous file extraction.
      await interact(() => new Promise((resolve) => setTimeout(resolve, 30)));
      assert.equal(upload.mock.calls.length, 0, 'the choice prompt must disable div drop handlers');
      assert.deepEqual(readDraft(), original);
      await view.click(choice);
      if (choice === 'Keep existing draft') assert.equal(readDraft().submissionId, original.submissionId);
      else assert.notEqual(readDraft().submissionId, original.submissionId);
    });
  }
  for (const outcome of ['success', 'failure']) {
    for (const choice of ['Keep existing draft', 'Discard draft and start here']) {
      await t.test(`in-flight ${outcome} after ${choice}`, async (t) => {
        const original = { ...createPlotDraft(), locator: 'Old garden', addressEdited: true };
        dom.window.sessionStorage.setItem(draftStorageKey, JSON.stringify(original));
        const pending = Promise.withResolvers();
        const upload = t.mock.method(Api.assets, 'upload', () => pending.promise);
        const view = await mount(t);
        await waitFor(() => assert.equal(view.field('Where exactly is it?').value, 'Old garden'));
        await view.upload();
        await waitFor(() => assert.equal(upload.mock.calls.length, 1));
        const signal = upload.mock.calls[0].arguments[3];
        const preview = view.container.querySelector('img').getAttribute('src');
        await view.navigate('/plots/new', { state: { mapPosition: { latitude: 37.79, longitude: -122.41 } } });
        await waitFor(() => assert.match(view.container.textContent, /You have an unfinished garden/));
        await view.click(choice);
        const replaced = choice.startsWith('Discard');
        assert.equal(signal.aborted, replaced);
        if (replaced) assert.ok(revokePreview.mock.calls.some(({ arguments: args }) => args[0] === preview));
        await view.change('Garden title', 'My title');
        await interact(() => outcome === 'success' ? pending.resolve() : pending.reject(new Error('Late failure')));
        await waitFor(() => assert.equal(view.client.isMutating(), 0));
        assert.equal(readDraft().name, 'My title');
        assert.equal(readDraft().photo, !replaced && outcome === 'success' ? 'old.jpg' : '');
        if (replaced) {
          assert.equal(readDraft().photoWasSelected, false);
          assert.doesNotMatch(view.container.textContent, /Photo upload failed/);
        }
      });
    }
  }
});
