import assert from 'node:assert/strict';
import { test } from 'node:test';
import { addressSuggestionPatch, lookupAddress, suggestedTitle } from '../src/Plots/plot-identification.js';

const position = { latitude: 37.77, longitude: -122.43 };

test('late address suggestions cannot overwrite manual edits or a newer pin', () => {
  const result = { position, address: '440 5th Avenue' };
  assert.deepEqual(addressSuggestionPatch({ position, addressEdited: true }, result), {});
  assert.deepEqual(addressSuggestionPatch({ position: { ...position, latitude: 37.78 } }, result), {});
  assert.deepEqual(addressSuggestionPatch({ position, addressEdited: false }, result), { address: '440 5th Avenue' });
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
