import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createPlotDraft, hasDraftContent, plotPayload, plotFormErrors } from '../src/Plots/plot-form.js';

test('a restored draft keeps its submission identity and catalogue selections', () => {
  const draft = createPlotDraft();
  assert.equal(hasDraftContent(draft), false);
  draft.position = { latitude: 37.77, longitude: -122.43, accuracy: 5 };
  draft.locator = ' Second tree well ';
  draft.stage = 'active';
  draft.area = 0;
  draft.firstPlanted = '2026-10-01';
  draft.plants = [{ key: 'ui-only', plantId: 'directory-id', label: 'Lavender', quantity: 0, notes: '' }];
  const restored = JSON.parse(JSON.stringify(draft));
  assert.equal(hasDraftContent(restored), true);
  const payload = plotPayload(restored);
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
  assert.deepEqual(plotFormErrors({ Latitude: 'Set a pin', 'Location Description': 'Describe it', _form: 'Failed', plotId: 'saved' }), {
    position: 'Set a pin', locator: 'Describe it', _form: 'Failed',
  });
});
