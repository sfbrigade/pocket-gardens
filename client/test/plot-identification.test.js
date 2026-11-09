import assert from 'node:assert/strict';
import { test } from 'node:test';
import { lookupAddress, resolvePlotIdentification, suggestedTitle } from '../src/Plots/plot-identification.js';
import { createPlotDraft, plotPayload } from '../src/Plots/plot-form.js';

const position = { latitude: 37.77, longitude: -122.43 };

test('late address suggestions cannot overwrite manual edits or a newer pin', () => {
  const result = { position, address: '440 5th Avenue' };
  const draft = { ...createPlotDraft(), position };
  assert.equal(resolvePlotIdentification({ ...draft, address: 'Manual address', addressEdited: true }, result).address, 'Manual address');
  assert.equal(resolvePlotIdentification({ ...draft, position: { ...position, latitude: 37.78 } }, result).address, '');
  assert.equal(resolvePlotIdentification(draft, result).address, '440 5th Avenue');
  assert.equal(suggestedTitle('440 5th Avenue, San Francisco, CA', 'Second tree well.'), '440 5th Avenue · Second tree well');
  assert.equal(suggestedTitle('', 'Second tree well'), 'Second tree well');
});

test('address lookup chooses nearby numbered results and retains cancellation', async () => {
  let request;
  const controller = new AbortController();
  const result = await lookupAddress(position, {
    baseUrl: 'https://example.test',
    signal: controller.signal,
    distanceTo: ([longitude]) => longitude === -122.43 ? 20 : 120,
    fetchAddress: async (url, options) => {
      request = { url, options };
      return {
        ok: true,
        json: async () => ({
          features: [
            { properties: { street: 'Unnumbered St' }, geometry: { coordinates: [-122.43, 37.77] } },
            { properties: { housenumber: '1', street: 'Far St' }, geometry: { coordinates: [-122.44, 37.77] } },
            { properties: { housenumber: '440', street: '5th Avenue', city: 'San Francisco' }, geometry: { coordinates: [-122.43, 37.77] } },
          ]
        })
      };
    },
  });
  assert.equal(result.address, '440 5th Avenue, San Francisco');
  assert.equal(new URL(request.url).searchParams.get('lat'), '37.77');
  assert.equal(request.options.credentials, 'omit');
  controller.abort();
  assert.equal(request.options.signal.aborted, true);
});

test('failed or unnumbered lookup results never fabricate an address', async () => {
  await assert.rejects(lookupAddress(position, { fetchAddress: async () => ({ ok: false }) }), /unavailable/);
  await assert.rejects(lookupAddress(position, { distanceTo: () => 0, fetchAddress: async () => ({ ok: true, json: async () => ({ features: [] }) }) }), /No nearby/);
});

test('suggestions derive visible and submitted values without changing the draft', () => {
  const draft = { ...createPlotDraft(), position, locator: 'Second tree well.' };
  const result = { position, address: '440 5th Avenue, San Francisco, CA' };
  const identification = resolvePlotIdentification(draft, result);
  assert.deepEqual(identification, { address: result.address, name: '440 5th Avenue · Second tree well' });
  assert.equal(draft.address, '');
  assert.equal(draft.name, '');
  const payload = plotPayload({ ...draft, ...identification });
  assert.equal(payload['Street Address'], identification.address);
  assert.equal(payload['Pocket Garden Name'], identification.name);
  assert.equal(payload.submissionId, draft.submissionId);
});

test('intentional empty overrides survive late suggestions and draft recovery', () => {
  const draft = { ...createPlotDraft(), position, locator: 'Near gate', address: '', addressEdited: true, name: '', nameEdited: true };
  const restored = JSON.parse(JSON.stringify(draft));
  const identification = resolvePlotIdentification(restored, { position, address: 'Suggested street' });
  assert.deepEqual(identification, { address: '', name: '' });
  const payload = plotPayload({ ...restored, ...identification });
  assert.equal(payload['Street Address'], undefined);
  assert.equal(payload['Pocket Garden Name'], undefined);
});

test('moving a pin immediately excludes the previous suggestion from display and submission', () => {
  const result = { position, address: 'Old address' };
  const draft = { ...createPlotDraft(), position: { ...position, latitude: 37.78 }, locator: 'Near gate' };
  const identification = resolvePlotIdentification(draft, result);
  assert.deepEqual(identification, { address: '', name: 'Near gate' });
  assert.equal(plotPayload({ ...draft, ...identification })['Street Address'], undefined);
  draft.addressEdited = true;
  draft.address = 'My cross street';
  assert.equal(resolvePlotIdentification(draft, result).address, 'My cross street');
});

test('resetting a custom title resumes derivation from the current address and locator', () => {
  const result = { position, address: '440 5th Avenue' };
  const draft = { ...createPlotDraft(), position, locator: 'North gate', name: 'My garden', nameEdited: true };
  assert.equal(resolvePlotIdentification(draft, result).name, 'My garden');
  draft.locator = 'South gate';
  assert.equal(resolvePlotIdentification(draft, result).name, 'My garden');
  draft.nameEdited = false;
  assert.equal(resolvePlotIdentification(draft, result).name, '440 5th Avenue · South gate');
});

test('manual address and title overrides are independent of each other and query refreshes', () => {
  const draft = { ...createPlotDraft(), position, locator: 'Near gate', name: 'Custom title', nameEdited: true };
  assert.deepEqual(resolvePlotIdentification(draft, { position, address: 'New suggestion' }), { address: 'New suggestion', name: 'Custom title' });
  draft.nameEdited = false;
  draft.addressEdited = true;
  draft.address = 'Manual address';
  assert.deepEqual(resolvePlotIdentification(draft, { position, address: 'Another suggestion' }), { address: 'Manual address', name: 'Manual address · Near gate' });
  assert.deepEqual(resolvePlotIdentification(draft), { address: 'Manual address', name: 'Manual address · Near gate' });
});
