import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createPlotDraft } from '../src/Plots/plot-form.js';
import { preparePlotSubmission } from '../src/Plots/plot-submission.js';
import { draftStorageKey, interact, setupPlotTests, waitFor } from './helpers/plot-harness.js';

const filename = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.jpg';
const replacement = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb.jpg';
const incoming = { latitude: 37.79, longitude: -122.41 };
const response = (name = filename) => ({ data: { filename: name, url: '/upload', headers: {} } });
const draft = () => ({ ...createPlotDraft(), position: { latitude: 37.77, longitude: -122.43 }, locator: 'Gate', addressEdited: true });

test('garden photos upload only when submitted', async (t) => {
  const { dom, Api, mount, readDraft, revokePreview } = await setupPlotTests(t);
  t.beforeEach(() => dom.window.sessionStorage.setItem(draftStorageKey, JSON.stringify(draft())));
  t.mock.method(Api.assets, 'create', async () => response());
  t.mock.method(Api.assets, 'upload', async () => {});
  t.mock.method(Api.plots, 'create', async () => ({ data: { id: 'pg_saved' } }));
  t.mock.method(globalThis, 'fetch', async () => ({ ok: true, json: async () => ({ features: [] }) }));

  await t.test('selection, removal and confirmed discard create no remote upload', async (t) => {
    const sign = t.mock.method(Api.assets, 'create', async () => response());
    const view = await mount(t);
    await waitFor(() => assert.equal(view.field('Where exactly is it?').value, 'Gate'));
    await view.upload();
    await waitFor(() => assert.ok(view.container.querySelector('img')));
    const preview = view.container.querySelector('img').getAttribute('src');
    assert.equal(sign.mock.calls.length, 0);
    assert.equal(readDraft().photo, '');
    assert.equal(readDraft().photoWasSelected, true);
    assert.equal(view.button('Create garden').disabled, false);
    assert.equal(readDraft().photoFile, undefined);
    await view.click('Remove photo');
    assert.ok(revokePreview.mock.calls.some(({ arguments: args }) => args[0] === preview));
    assert.equal(readDraft().photoWasSelected, false);
    await view.upload();
    await view.click('Cancel and discard draft');
    await waitFor(() => assert.ok(view.button('Discard draft')));
    await view.click('Discard draft');
    await waitFor(() => assert.equal(view.path, '/'));
    assert.equal(sign.mock.calls.length, 0);
    assert.equal(readDraft(), null);
  });

  await t.test('invalid garden fields prevent uploading', async (t) => {
    dom.window.sessionStorage.setItem(draftStorageKey, JSON.stringify({ ...createPlotDraft(), addressEdited: true }));
    const sign = t.mock.method(Api.assets, 'create', async () => response());
    const view = await mount(t);
    await view.upload();
    await view.submit();
    await waitFor(() => assert.match(view.container.textContent, /Describe exactly where/));
    assert.equal(sign.mock.calls.length, 0);
    assert.equal(readDraft().photoWasSelected, true);
  });

  await t.test('submit uploads once before saving and guards duplicate submits and map replacement', async (t) => {
    const putting = Promise.withResolvers();
    const saving = Promise.withResolvers();
    const upload = t.mock.method(Api.assets, 'upload', () => putting.promise);
    const create = t.mock.method(Api.plots, 'create', () => saving.promise);
    const view = await mount(t);
    await waitFor(() => assert.equal(view.field('Where exactly is it?').value, 'Gate'));
    const id = readDraft().submissionId;
    await view.upload();
    assert.equal(upload.mock.calls.length, 0);
    await view.submit();
    await waitFor(() => assert.equal(upload.mock.calls.length, 1));
    assert.equal(create.mock.calls.length, 0);
    assert.ok(view.button('Create garden').closest('fieldset').disabled);
    assert.equal(view.button('Remove photo').disabled, true);
    await view.submit();
    assert.equal(upload.mock.calls.length, 1);
    await view.navigate('/plots/new', { state: { mapPosition: incoming } });
    await waitFor(() => assert.match(view.container.textContent, /You have an unfinished garden/));
    assert.equal(view.button('Discard draft and start here').disabled, true);
    await view.click('Discard draft and start here');
    assert.equal(readDraft().submissionId, id);
    await interact(() => putting.resolve());
    await waitFor(() => assert.equal(create.mock.calls.length, 1));
    assert.equal(readDraft().photo, filename, 'save retries can recover the completed upload');
    assert.deepEqual(create.mock.calls[0].arguments[0].Photos, [filename]);
    assert.equal(create.mock.calls[0].arguments[0].submissionId, id);
    await interact(() => saving.resolve({ data: { id: 'pg_photo' } }));
    await waitFor(() => assert.equal(view.path, '/plots/pg_photo'));
  });

  for (const choice of ['retry', 'remove']) {
    await t.test(`failed upload keeps the local selection for ${choice}`, async (t) => {
      const pending = Promise.withResolvers();
      const upload = t.mock.method(Api.assets, 'upload', () => pending.promise);
      const create = t.mock.method(Api.plots, 'create', async () => ({ data: { id: 'pg_retried' } }));
      const view = await mount(t);
      await waitFor(() => assert.equal(view.field('Where exactly is it?').value, 'Gate'));
      await view.upload();
      const preview = view.container.querySelector('img').getAttribute('src');
      await view.submit();
      await waitFor(() => assert.equal(upload.mock.calls.length, 1));
      await interact(() => pending.reject(new Error('Unavailable')));
      await waitFor(() => assert.match(view.container.textContent, /Photo upload failed/));
      assert.equal(create.mock.calls.length, 0);
      assert.equal(view.container.querySelector('img').getAttribute('src'), preview);
      assert.equal(view.button('Create garden').disabled, false);
      if (choice === 'retry') upload.mock.mockImplementation(async () => {});
      else await view.click('Remove photo');
      await view.submit();
      await waitFor(() => assert.equal(view.path, '/plots/pg_retried'));
      assert.equal(upload.mock.calls.length, choice === 'retry' ? 2 : 1);
      assert.deepEqual(create.mock.calls[0].arguments[0].Photos, choice === 'retry' ? [filename] : undefined);
    });
  }

  for (const refresh of [false, true]) {
    await t.test(`a lost save response reuses the completed upload ${refresh ? 'after refresh' : 'in the same form'}`, async (t) => {
      const original = { ...draft(), addressEdited: false };
      dom.window.sessionStorage.setItem(draftStorageKey, JSON.stringify(original));
      const sign = t.mock.method(Api.assets, 'create', async () => response());
      const upload = t.mock.method(Api.assets, 'upload', async () => {});
      const create = t.mock.method(Api.plots, 'create', async () => { throw Object.assign(new Error('Lost'), { _form: 'Save response lost' }); });
      const addressKey = ['nearby-address', '37.77000', '-122.43000'];
      let view = await mount(t, { queryData: [[addressKey, { position: original.position, address: 'Custom suggested address' }]] });
      await waitFor(() => assert.equal(view.field('Garden title').value, 'Custom suggested address · Gate'));
      await view.upload();
      await view.submit();
      await waitFor(() => assert.match(view.container.textContent, /Save response lost/));
      const sent = create.mock.calls[0].arguments[0];
      assert.equal(readDraft().photo, filename);
      if (refresh) {
        await view.unmount();
        view = await mount(t);
        await waitFor(() => assert.match(view.container.textContent, /Photo uploaded and attached/));
      }
      create.mock.mockImplementation(async () => ({ data: { id: 'pg_recovered' } }));
      await view.submit();
      await waitFor(() => assert.equal(view.path, '/plots/pg_recovered'));
      assert.equal(sign.mock.calls.length, 1);
      assert.equal(upload.mock.calls.length, 1);
      assert.deepEqual(create.mock.calls[1].arguments[0], sent);
    });
  }

  await t.test('refresh before submission requires reattachment or explicit opt-out', async (t) => {
    const sign = t.mock.method(Api.assets, 'create', async () => response());
    let view = await mount(t);
    await waitFor(() => assert.equal(view.field('Where exactly is it?').value, 'Gate'));
    const id = readDraft().submissionId;
    await view.upload();
    await view.unmount();
    view = await mount(t);
    await waitFor(() => assert.match(view.container.textContent, /Reattach your photo/));
    assert.equal(view.field('Where exactly is it?').value, 'Gate');
    assert.equal(readDraft().submissionId, id);
    assert.equal(view.button('Create garden').disabled, true);
    await view.submit();
    assert.equal(sign.mock.calls.length, 0);
    await view.click('Continue without photo');
    await view.submit();
    await waitFor(() => assert.equal(view.path, '/plots/pg_saved'));
    assert.equal(sign.mock.calls.length, 0);
  });

  for (const phase of ['sign', 'put']) {
    for (const outcome of ['success', 'failure']) {
      await t.test(`leaving during ${phase} ignores late ${outcome} and preserves a newer draft`, async (t) => {
        const pending = Promise.withResolvers();
        const sign = t.mock.method(Api.assets, 'create', () => phase === 'sign' ? pending.promise : Promise.resolve(response()));
        const upload = t.mock.method(Api.assets, 'upload', () => pending.promise);
        const create = t.mock.method(Api.plots, 'create', async () => ({ data: { id: 'pg_unexpected' } }));
        let view = await mount(t);
        await waitFor(() => assert.equal(view.field('Where exactly is it?').value, 'Gate'));
        await view.upload();
        const preview = view.container.querySelector('img').getAttribute('src');
        await view.submit();
        await waitFor(() => assert.equal(phase === 'sign' ? sign.mock.calls.length : upload.mock.calls.length, 1));
        const signal = phase === 'sign' ? sign.mock.calls[0].arguments[1] : upload.mock.calls[0].arguments[3];
        const mutation = view.client.getMutationCache().getAll()[0];
        await view.unmount();
        assert.equal(signal.aborted, true);
        assert.ok(revokePreview.mock.calls.some(({ arguments: args }) => args[0] === preview));
        const newer = { ...draft(), name: 'New garden', nameEdited: true };
        dom.window.sessionStorage.setItem(draftStorageKey, JSON.stringify(newer));
        view = await mount(t);
        await waitFor(() => assert.equal(view.field('Garden title').value, newer.name));
        await interact(() => outcome === 'success' ? pending.resolve(response()) : pending.reject(new Error('Late failure')));
        await waitFor(() => assert.equal(mutation.state.status, 'error'));
        assert.equal(create.mock.calls.length, 0);
        assert.deepEqual(readDraft(), newer);
        if (phase === 'sign') assert.equal(upload.mock.calls.length, 0, 'aborted signing cannot start a PUT');
      });
    }
  }

  for (const choice of ['Keep existing draft', 'Discard draft and start here']) {
    await t.test(`recovered draft prompt disables drops before a photo is selected: ${choice}`, async (t) => {
      const sign = t.mock.method(Api.assets, 'create', async () => response());
      const view = await mount(t, { initialEntry: { pathname: '/plots/new', state: { mapPosition: incoming } } });
      await waitFor(() => assert.match(view.container.textContent, /You have an unfinished garden/));
      const original = readDraft();
      await view.dropPhoto();
      await interact(() => new Promise((resolve) => setTimeout(resolve, 20)));
      assert.equal(sign.mock.calls.length, 0);
      assert.deepEqual(readDraft(), original);
      assert.equal(view.container.querySelector('img'), null);
      await view.click(choice);
      assert.equal(readDraft().photoWasSelected, false);
      assert.equal(readDraft().submissionId === original.submissionId, choice.startsWith('Keep'));
    });
  }

  for (const choice of ['Keep existing draft', 'Discard draft and start here']) {
    await t.test(`selected photos respect the map choice: ${choice}`, async (t) => {
      const sign = t.mock.method(Api.assets, 'create', async () => response());
      const upload = t.mock.method(Api.assets, 'upload', async () => {});
      const view = await mount(t);
      await waitFor(() => assert.equal(view.field('Where exactly is it?').value, 'Gate'));
      await view.upload();
      const file = view.container.querySelector('input[type=file]').files[0];
      const preview = view.container.querySelector('img').getAttribute('src');
      await view.navigate('/plots/new', { state: { mapPosition: incoming } });
      await waitFor(() => assert.match(view.container.textContent, /You have an unfinished garden/));
      const before = readDraft();
      await view.dropPhoto();
      await interact(() => new Promise((resolve) => setTimeout(resolve, 20)));
      assert.deepEqual(readDraft(), before);
      assert.equal(sign.mock.calls.length, 0);
      await view.click(choice);
      if (choice.startsWith('Discard')) {
        assert.notEqual(readDraft().submissionId, before.submissionId);
        assert.equal(readDraft().photoWasSelected, false);
        assert.equal(view.container.querySelector('img'), null);
        assert.ok(revokePreview.mock.calls.some(({ arguments: args }) => args[0] === preview));
        await view.change('Where exactly is it?', 'New garden');
      }
      await view.submit();
      await waitFor(() => assert.equal(view.path, '/plots/pg_saved'));
      assert.equal(upload.mock.calls.length, choice.startsWith('Keep') ? 1 : 0);
      if (choice.startsWith('Keep')) assert.equal(upload.mock.calls[0].arguments[2], file);
    });
  }

  for (const choice of ['reattach', 'continue']) {
    await t.test(`expired photo keeps attempted suggestions after refresh: ${choice}`, async (t) => {
      const original = { ...draft(), addressEdited: false, photo: filename, photoWasSelected: true };
      const address = '440 5th Avenue, San Francisco';
      original.submissionAttempt = preparePlotSubmission(original, { position: original.position, address });
      const sent = original.submissionAttempt.payload;
      dom.window.sessionStorage.setItem(draftStorageKey, JSON.stringify(original));
      t.mock.method(globalThis, 'fetch', async () => { throw new Error('Address lookup unavailable'); });
      t.mock.method(Api.assets, 'create', async () => response(replacement));
      const create = t.mock.method(Api.plots, 'create', async () => { throw Object.assign(new Error('Expired'), { Photos: 'Photo expired' }); });
      let view = await mount(t);
      await waitFor(() => assert.equal(view.field('Address or cross street').value, address));
      await view.submit();
      await waitFor(() => assert.match(view.container.textContent, /Reattach your photo/));
      assert.equal(view.field('Address or cross street').value, address);
      assert.equal(view.field('Garden title').value, sent['Pocket Garden Name']);
      await view.unmount();
      view = await mount(t);
      await waitFor(() => assert.equal(view.field('Address or cross street').value, address));
      if (choice === 'reattach') await view.upload();
      else await view.click('Continue without photo');
      create.mock.mockImplementation(async () => ({ data: { id: 'pg_preserved' } }));
      await view.submit();
      await waitFor(() => assert.equal(view.path, '/plots/pg_preserved'));
      assert.deepEqual(JSON.parse(JSON.stringify(create.mock.calls[1].arguments[0])), JSON.parse(JSON.stringify({ ...sent, Photos: choice === 'reattach' ? [replacement] : undefined })));
    });

    await t.test(`expired completed photo recovery: ${choice}`, async (t) => {
      const original = { ...draft(), photo: filename, photoWasSelected: true, name: 'My title', nameEdited: true };
      dom.window.sessionStorage.setItem(draftStorageKey, JSON.stringify(original));
      const sign = t.mock.method(Api.assets, 'create', async () => response(replacement));
      const create = t.mock.method(Api.plots, 'create', async () => { throw Object.assign(new Error('Expired'), { Photos: 'Photo expired. Reattach it or continue without a photo.' }); });
      const view = await mount(t);
      await waitFor(() => assert.match(view.container.textContent, /Photo uploaded and attached/));
      await view.submit();
      await waitFor(() => assert.match(view.container.textContent, /Reattach your photo/));
      assert.equal(sign.mock.calls.length, 0);
      assert.equal(readDraft().photo, '');
      assert.equal(readDraft().submissionId, original.submissionId);
      assert.equal(view.field('Garden title').value, original.name);
      if (choice === 'reattach') await view.upload();
      else await view.click('Continue without photo');
      assert.equal(sign.mock.calls.length, 0);
      create.mock.mockImplementation(async () => ({ data: { id: 'pg_photo_recovered' } }));
      await view.submit();
      await waitFor(() => assert.equal(view.path, '/plots/pg_photo_recovered'));
      assert.equal(sign.mock.calls.length, choice === 'reattach' ? 1 : 0);
      assert.deepEqual(create.mock.calls[1].arguments[0].Photos, choice === 'reattach' ? [replacement] : undefined);
    });
  }

  await t.test('server photo validation releases the local preview and requires a new choice', async (t) => {
    t.mock.method(Api.plots, 'create', async () => { throw Object.assign(new Error('Rejected'), { Photos: 'Choose another photo' }); });
    const view = await mount(t);
    await waitFor(() => assert.equal(view.field('Where exactly is it?').value, 'Gate'));
    const id = readDraft().submissionId;
    await view.upload();
    const preview = view.container.querySelector('img').getAttribute('src');
    await view.submit();
    await waitFor(() => assert.match(view.container.textContent, /Reattach your photo/));
    assert.equal(readDraft().photo, '');
    assert.equal(readDraft().submissionId, id);
    assert.equal(view.container.querySelector('img'), null);
    assert.ok(revokePreview.mock.calls.some(({ arguments: args }) => args[0] === preview));
    assert.equal(view.button('Create garden').disabled, true);
  });

  await t.test('server upload errors keep selection retryable without losing fields', async (t) => {
    t.mock.method(Api.assets, 'create', async () => { throw Object.assign(new Error('Rejected'), { response: { data: { errors: [{ message: 'Choose a photo up to 10 MiB.' }] } } }); });
    const view = await mount(t);
    await waitFor(() => assert.equal(view.field('Where exactly is it?').value, 'Gate'));
    await view.upload();
    await view.submit();
    await waitFor(() => assert.match(view.container.textContent, /Choose a photo up to 10 MiB/));
    assert.equal(view.field('Where exactly is it?').value, 'Gate');
    assert.equal(view.button('Create garden').disabled, false);
    assert.ok(view.container.querySelector('img'));
    await view.click('Remove photo');
    assert.equal(readDraft().photoWasSelected, false);
  });
});
