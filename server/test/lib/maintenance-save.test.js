import assert from 'node:assert/strict';
import { test } from 'node:test';
import { maintenanceFingerprint } from '#lib/maintenance-save.js';

test('maintenance fingerprints match the persisted format and preserve array order', () => {
  const create = {
    submissionId: '8c25687d-9e99-45c9-9257-da71810c8b69',
    plotId: 'recPlotAlpha',
    notes: 'Pulled weeds near the café',
    date: '2026-11-23',
    activity: ['Weeded', 'Watered'],
    observations: ['Plants look dry'],
    photos: [{ upload: 'aaa.jpg' }, { upload: 'bbb.jpg' }],
    plants: [{ quantity: 3, newPlant: { plantName: 'Yarrow', latinName: 'Achillea millefolium' } }],
  };
  const edit = {
    version: 2,
    mutationId: 'ba07d2df-32b5-4c63-ac7f-b8af101a31ad',
    notes: null,
    photos: [{ id: 'f019f7fe-201d-11ed-861d-0242ac120002' }, { upload: 'a949fbee-88ef-49db-bf1e-2c1d9c683090.jpg' }],
    activity: [],
  };

  const createFingerprint = '833223b26363a80065eb570b5f1cc295e6e2ef8ea775006cbfccdc0acb62fff5';
  assert.equal(maintenanceFingerprint(create), createFingerprint);
  assert.equal(maintenanceFingerprint(edit), 'adfd059231b1d69a36c1d73cf6ad07f46f9a3e029cac8872e9dd627e54f23253');
  assert.equal(maintenanceFingerprint({ ...create, plants: [{ newPlant: { latinName: 'Achillea millefolium', plantName: 'Yarrow' }, quantity: 3 }] }), createFingerprint);
  assert.notEqual(maintenanceFingerprint({ ...create, photos: create.photos.toReversed() }), createFingerprint);
});
