import assert from 'node:assert/strict';
import { test } from 'node:test';
import axios from 'axios';

test('expired-session redirects preserve the application destination', async (t) => {
  const previousAdapter = axios.defaults.adapter;
  const previousWindow = globalThis.window;
  t.after(() => {
    if (previousWindow === undefined) delete globalThis.window;
    else globalThis.window = previousWindow;
  });
  axios.defaults.adapter = async config => {
    const response = { status: 401, data: {}, headers: {}, config };
    throw new axios.AxiosError('Unauthorized', undefined, config, undefined, response);
  };
  let Api;
  try {
    ({ default: Api } = await import('../src/Api.js'));
  } finally {
    axios.defaults.adapter = previousAdapter;
  }

  await t.test('a protected request retains the pathname, query, and fragment', async () => {
    globalThis.window = { location: { pathname: '/admin/users', search: '?page=2&search=Test', hash: '#selected' } };
    await assert.rejects(Api.users.get('member'));
    const target = new URL(window.location, 'https://app.example');
    assert.equal(target.pathname, '/login');
    assert.equal(target.searchParams.get('from'), '/admin/users?page=2&search=Test#selected');
  });

  await t.test('authentication errors stay on the form', async () => {
    const location = { pathname: '/login', search: '?from=%2Faccount', hash: '' };
    globalThis.window = { location };
    await assert.rejects(Api.auth.login('member@example.com', 'incorrect-password'));
    assert.equal(window.location, location);
  });

  await t.test('server-side requests reject without requiring a browser', async () => {
    delete globalThis.window;
    await assert.rejects(Api.users.get('member'), { message: 'Unauthorized' });
  });
});
