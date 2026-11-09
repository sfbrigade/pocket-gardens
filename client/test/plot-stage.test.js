import assert from 'node:assert/strict';
import { test } from 'node:test';
import { plotStageLabel } from '../src/plots.js';

test('stage labels distinguish preparing from potential and handle unrecorded stages', () => {
  assert.equal(plotStageLabel('potential'), 'Potential site');
  assert.equal(plotStageLabel('preparing'), 'Preparing');
  assert.equal(plotStageLabel('active'), 'Active');
  assert.equal(plotStageLabel('paused'), 'Paused');
  assert.equal(plotStageLabel('archived'), 'Archived');
  assert.equal(plotStageLabel(null), 'Stage not recorded');
});
