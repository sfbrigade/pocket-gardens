import { test } from 'node:test';
import assert from 'node:assert/strict';
import { allowsAnonymousMaintenance, canWriteMaintenance, validateNewVisit } from '#lib/maintenance-policy.js';

test('maintenance development capability cannot enable anonymous production writes', () => {
  assert.equal(allowsAnonymousMaintenance({ NODE_ENV: 'production', ALLOW_ANONYMOUS_MAINTENANCE_WRITES: 'true' }), false);
  assert.equal(allowsAnonymousMaintenance({ NODE_ENV: 'development', ALLOW_ANONYMOUS_MAINTENANCE_WRITES: 'true' }), true);
  assert.equal(canWriteMaintenance({ isAdmin: true, isActive: false }, {}), false);
  assert.equal(canWriteMaintenance({ isAdmin: true, isActive: true }, {}), true);
  assert.equal(canWriteMaintenance({ isAdmin: false, isActive: true }, {}), false);
});

test('paused gardens accept observations but not work; archived stages reject new visits', () => {
  assert.doesNotThrow(() => validateNewVisit({ stage: 'paused' }, { observations: ['Nothing stood out'] }));
  assert.throws(() => validateNewVisit({ stage: 'paused' }, { activity: ['Watered'] }));
  assert.throws(() => validateNewVisit({ stage: 'archived' }, { notes: 'Visit' }));
  assert.throws(() => validateNewVisit({ stage: null }, { notes: 'Visit' }));
});
