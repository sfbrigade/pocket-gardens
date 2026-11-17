import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createPlotDraft, hasDraftContent, plotDraftErrors, plotPayload, plotFormErrors } from '../src/Plots/plot-form.js';

test('payload mapping retains submission identity, plant selections, and valid zero values', () => {
  const draft = createPlotDraft();
  assert.equal(hasDraftContent(draft), false);
  draft.position = { latitude: 37.77, longitude: -122.43, accuracy: 5 };
  draft.locator = ' Second tree well ';
  draft.stage = 'active';
  draft.area = 0;
  draft.firstPlanted = '2026-10-01';
  draft.plants = [{ key: 'ui-only', plantId: 'directory-id', label: 'Lavender', quantity: 0, notes: '' }];
  assert.equal(hasDraftContent(draft), true);
  const payload = plotPayload(draft);
  assert.equal(payload.submissionId, draft.submissionId);
  assert.equal(payload['Location Description'], 'Second tree well');
  assert.equal(payload['Est. Area (Sq. Ft)'], 0);
  assert.deepEqual(payload.plants, [{ plantId: 'directory-id', quantity: 0, notes: undefined }]);
  assert.equal(payload.firstPlanted, '2026-10-01');
});

test('switching stage omits hidden fields without removing their draft values', () => {
  const draft = { ...createPlotDraft(), firstPlanted: '2026-10-01', plants: [{ newPlant: { plantName: 'Yarrow' }, quantity: 2, notes: 'Near gate' }] };
  assert.deepEqual(plotPayload(draft).plants, []);
  assert.equal(plotPayload(draft).firstPlanted, undefined);
  draft.stage = 'preparing';
  assert.equal(plotPayload(draft).plants[0].newPlant.plantName, 'Yarrow');
  assert.equal(plotPayload(draft).firstPlanted, undefined);
  draft.stage = 'active';
  assert.equal(plotPayload(draft).firstPlanted, '2026-10-01');
});

test('server field names map to form controls and preserve form-level feedback', () => {
  assert.deepEqual(plotFormErrors({ Latitude: 'Set a pin', 'Location Description': 'Describe it', carerUserIds: 'Select an active user', _form: 'Failed', plotId: 'saved' }), {
    position: 'Set a pin', locator: 'Describe it', carers: 'Select an active user', _form: 'Failed',
  });
});

test('carer-only drafts are retained and only account IDs are submitted', () => {
  const draft = createPlotDraft();
  assert.equal(plotPayload(draft).carerUserIds, undefined, 'unchanged older drafts retain their original save fingerprint');
  draft.carers = [{ userId: 'user-b', displayName: 'Carer B' }, { userId: 'user-a', displayName: 'Carer A' }];
  assert.equal(hasDraftContent(draft), true);
  assert.deepEqual(plotPayload(draft).carerUserIds, ['user-a', 'user-b']);
  assert.equal(plotPayload(draft).carers, undefined);
});

test('plant quantity validation respects the database range and skips hidden potential plantings', () => {
  const draft = { ...createPlotDraft(), position: { latitude: 37.77, longitude: -122.43 }, locator: 'Near gate', stage: 'active' };
  for (const quantity of [0, '', 2147483647]) {
    draft.plants = [{ plantId: 'directory-id', quantity }];
    assert.deepEqual(plotDraftErrors(draft), {});
  }
  for (const quantity of [-1, 1.5, 2147483648, 'not a number']) {
    draft.plants = [{ plantId: 'directory-id', quantity }];
    assert.ok(plotDraftErrors(draft)['plants.0.quantity']);
    draft.stage = 'potential';
    assert.deepEqual(plotDraftErrors(draft), {});
    assert.deepEqual(plotPayload(draft).plants, []);
    draft.stage = 'active';
  }
});
