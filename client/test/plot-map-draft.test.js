import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createPlotDraft } from '../src/Plots/plot-form.js';
import { preparePlotSubmission } from '../src/Plots/plot-submission.js';
import { draftStorageKey, setupPlotTests, waitFor } from './helpers/plot-harness.js';

const incoming = { latitude: 37.79, longitude: -122.41 };
const initialEntry = { pathname: '/plots/new', state: { mapPosition: incoming } };

test('incoming map pins protect recovered drafts', async (t) => {
  const { dom, Api, mount, readDraft } = await setupPlotTests(t);
  t.mock.method(globalThis, 'fetch', async () => ({ ok: true, json: async () => ({ features: [] }) }));
  const create = t.mock.method(Api.plots, 'create', async () => { throw new Error('Unexpected save'); });

  for (const choice of ['Keep existing draft', 'Discard draft and start here']) {
    await t.test(`${choice}, including refresh before choosing`, async (t) => {
      const original = {
        ...createPlotDraft(),
        position: { latitude: 37.77, longitude: -122.43 },
        address: 'My manual address',
        addressEdited: true,
        name: 'My manual title',
        nameEdited: true,
        locator: 'Second tree well',
        stage: 'preparing',
        plants: [{ key: 'plant', plantId: 'plant-id', label: 'Poppy', quantity: '2', notes: 'Keep me' }],
        photoWasSelected: true,
      };
      original.submissionAttempt = preparePlotSubmission(original);
      dom.window.sessionStorage.setItem(draftStorageKey, JSON.stringify(original));
      let view = await mount(t, { initialEntry });
      await waitFor(() => assert.match(view.container.textContent, /You have an unfinished garden/));
      assert.deepEqual(readDraft(), original);
      assert.equal(view.field('Garden title').value, original.name);
      assert.equal(view.field('Address or cross street').value, original.address);
      assert.ok(view.button('Create garden').closest('fieldset').disabled);
      await view.submit();
      assert.equal(create.mock.calls.length, 0);
      await view.unmount();

      view = await mount(t, { initialEntry });
      await waitFor(() => assert.match(view.container.textContent, /You have an unfinished garden/));
      assert.deepEqual(readDraft(), original);
      await view.click(choice);
      await waitFor(() => assert.doesNotMatch(view.container.textContent, /You have an unfinished garden/));
      assert.equal(view.location.state?.mapPosition, undefined, 'the choice consumes the incoming pin');
      if (choice === 'Keep existing draft') {
        assert.deepEqual(readDraft(), original);
        assert.equal(view.field('Garden title').value, original.name);
        assert.equal(view.field('Address or cross street').value, original.address);
      } else {
        await waitFor(() => assert.deepEqual(readDraft().position, incoming));
        assert.notEqual(readDraft().submissionId, original.submissionId);
        assert.equal(readDraft().submissionAttempt, null);
        assert.equal(view.field('Where exactly is it?').value, '');
        assert.equal(view.field('Garden title').value, '');
        assert.deepEqual(readDraft().plants, []);
        assert.equal(readDraft().photoWasSelected, false);
        await view.change('Address or cross street', 'New manual address');
        await view.change('Garden title', 'New manual title');
      }
      const retained = readDraft();
      await view.unmount();
      view = await mount(t);
      await waitFor(() => assert.equal(view.field('Garden title').value, retained.name));
      assert.equal(view.field('Address or cross street').value, retained.address);
      assert.deepEqual(readDraft(), retained);
      assert.equal(create.mock.calls.length, 0);
    });
  }

  await t.test('draft fields without a location still require a choice', async (t) => {
    const original = { ...createPlotDraft(), locator: 'Unfinished details' };
    dom.window.sessionStorage.setItem(draftStorageKey, JSON.stringify(original));
    const view = await mount(t, { initialEntry });
    await waitFor(() => assert.match(view.container.textContent, /You have an unfinished garden/));
    assert.deepEqual(readDraft(), original);
  });

  await t.test('the same pin keeps draft identity, accuracy and manual overrides', async (t) => {
    const original = { ...createPlotDraft(), position: { ...incoming, accuracy: 20 }, name: 'Custom', nameEdited: true, address: 'Custom address', addressEdited: true };
    dom.window.sessionStorage.setItem(draftStorageKey, JSON.stringify(original));
    const view = await mount(t, { initialEntry });
    await waitFor(() => assert.equal(view.field('Garden title').value, 'Custom'));
    assert.doesNotMatch(view.container.textContent, /You have an unfinished garden/);
    assert.deepEqual(readDraft(), original);
  });

  for (const mapPosition of [{ latitude: 37, longitude: -122.43 }, { latitude: '37.77', longitude: -122.43 }, { latitude: Infinity, longitude: -122.43 }]) {
    await t.test(`ignores invalid incoming pin ${JSON.stringify(mapPosition)}`, async (t) => {
      dom.window.sessionStorage.clear();
      const view = await mount(t, { initialEntry: { pathname: '/plots/new', state: { mapPosition } } });
      await waitFor(() => assert.match(view.container.textContent, /A map pin is required/));
      assert.equal(readDraft()?.position ?? null, null);
    });
  }

  await t.test('no creation permission means no incoming pin is applied', async (t) => {
    dom.window.sessionStorage.clear();
    const view = await mount(t, { initialEntry, canCreatePlot: false });
    await waitFor(() => assert.match(view.container.textContent, /A staff account is needed/));
    assert.equal(readDraft()?.position ?? null, null);
  });
});
