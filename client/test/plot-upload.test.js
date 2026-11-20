import assert from 'node:assert/strict';
import { test } from 'node:test';
import { interact, setupPlotTests, waitFor } from './helpers/plot-harness.js';

// Profile and gallery photo inputs keep their immediate-upload behavior.
test('shared photo inputs upload immediately', async (t) => {
  const { dom, Api, mount, revokePreview } = await setupPlotTests(t);
  const filename = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.jpg';
  const signed = { data: { filename, url: '/upload', headers: {} } };
  t.mock.method(Api.assets, 'create', async () => signed);

  await t.test('selection starts uploading; failed uploads can be retried', async (t) => {
    const first = Promise.withResolvers();
    const retry = Promise.withResolvers();
    let attempt = 0;
    const upload = t.mock.method(Api.assets, 'upload', () => (++attempt === 1 ? first.promise : retry.promise));
    const view = await mount(t, { initialEntry: '/photo-input' });
    await view.upload();
    await waitFor(() => assert.equal(upload.mock.calls.length, 1));
    await interact(() => first.reject(new Error('Unavailable')));
    await waitFor(() => assert.match(view.container.textContent, /Photo upload failed/));
    await view.click('Retry upload');
    await waitFor(() => assert.equal(upload.mock.calls.length, 2));
    await interact(() => retry.resolve());
    await waitFor(() => assert.doesNotMatch(view.container.textContent, /Photo upload failed/));
    const preview = view.container.querySelector('img').getAttribute('src');
    await view.click('Remove photo');
    assert.equal(view.container.querySelector('img'), null);
    assert.ok(revokePreview.mock.calls.some(({ arguments: args }) => args[0] === preview));
  });

  for (const outcome of ['success', 'failure']) {
    await t.test(`removal aborts an immediate upload and ignores late ${outcome}`, async (t) => {
      const pending = Promise.withResolvers();
      const upload = t.mock.method(Api.assets, 'upload', () => pending.promise);
      const view = await mount(t, { initialEntry: '/photo-input' });
      await view.upload();
      await waitFor(() => assert.equal(upload.mock.calls.length, 1));
      const signal = upload.mock.calls[0].arguments[3];
      const preview = view.container.querySelector('img').getAttribute('src');
      const mutation = view.client.getMutationCache().getAll()[0];
      await view.click('Remove photo');
      assert.equal(signal.aborted, true);
      assert.ok(revokePreview.mock.calls.some(({ arguments: args }) => args[0] === preview));
      await interact(() => outcome === 'success' ? pending.resolve() : pending.reject(new Error('Late failure')));
      await waitFor(() => assert.equal(mutation.state.status, 'error'));
      assert.equal(view.container.querySelector('img'), null);
      assert.doesNotMatch(view.container.textContent, /Photo upload failed/);
      assert.equal(view.container.querySelector('input[type=file]').disabled, false);
    });
  }

  await t.test('unmount during signing prevents a late response from starting the PUT', async (t) => {
    const pending = Promise.withResolvers();
    const sign = t.mock.method(Api.assets, 'create', () => pending.promise);
    const upload = t.mock.method(Api.assets, 'upload', async () => {});
    const view = await mount(t, { initialEntry: '/photo-input' });
    await view.upload();
    await waitFor(() => assert.equal(sign.mock.calls.length, 1));
    const signal = sign.mock.calls[0].arguments[1];
    const mutation = view.client.getMutationCache().getAll()[0];
    await view.unmount();
    assert.equal(signal.aborted, true);
    await interact(() => pending.resolve(signed));
    await waitFor(() => assert.equal(mutation.state.status, 'error'));
    assert.equal(upload.mock.calls.length, 0);
  });

  await t.test('format, size and server errors remain actionable', async (t) => {
    const sign = t.mock.method(Api.assets, 'create', async () => { throw Object.assign(new Error('Rejected'), { response: { data: { errors: [{ message: 'Choose a photo up to 10 MiB.' }] } } }); });
    const view = await mount(t, { initialEntry: '/photo-input' });
    await view.upload(new dom.window.File(['<svg/>'], 'unsafe.svg', { type: 'image/svg+xml' }));
    await waitFor(() => assert.match(view.container.textContent, /File type must be/));
    assert.equal(sign.mock.calls.length, 0);
    await view.upload(new dom.window.File([new Uint8Array(10 * 1024 * 1024 + 1)], 'large.jpg', { type: 'image/jpeg' }));
    await waitFor(() => assert.match(view.container.textContent, /File is larger/));
    assert.equal(sign.mock.calls.length, 0);
    await view.upload();
    await waitFor(() => assert.match(view.container.textContent, /Choose a photo up to 10 MiB/));
    await view.click('Remove photo');
    assert.equal(view.container.querySelector('img'), null);
  });
});
