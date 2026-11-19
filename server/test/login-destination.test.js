import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loginDestination } from '../../client/src/LoginDestination.js';

test('login destinations preserve internal paths and reject external redirects', () => {
  for (const value of ['/account', '/admin/users?page=2#profile']) {
    assert.equal(loginDestination(value), value);
  }
  assert.equal(loginDestination({ pathname: '/account', search: '?tab=profile', hash: '#password' }), '/account?tab=profile#password');
  for (const value of [undefined, null, '', 'https://untrusted.example/account', '//untrusted.example', '/\\untrusted.example', 'javascript:alert(1)']) {
    assert.equal(loginDestination(value), '/');
  }
});
