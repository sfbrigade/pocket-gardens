import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import AutoLoad from '@fastify/autoload';
import Fastify from 'fastify';

test('autoloaded auth routes apply the API prefix once and preserve separate cookies', async (t) => {
  const app = Fastify();
  t.after(() => app.close());
  const requests = [];
  app.decorate('auth', {
    options: { baseURL: 'https://example.com' },
    async handler (request) {
      requests.push(request);
      const headers = new Headers();
      headers.append('set-cookie', 'session=first; HttpOnly');
      headers.append('set-cookie', 'session=second; HttpOnly');
      return Response.json({ forwarded: true }, { status: 201, headers });
    },
  });
  await app.register(AutoLoad, {
    dir: fileURLToPath(new URL('../routes', import.meta.url)),
    matchFilter: path => path.startsWith('/api/auth/'),
  });

  for (const [method, url, payload] of [
    ['GET', '/api/auth/verify-email?token=test-token'],
    ['POST', '/api/auth/sign-in/email', { email: 'person@example.com', password: 'test-password' }],
  ]) {
    const response = await app.inject({
      method,
      url,
      payload,
      remoteAddress: '192.0.2.42',
      headers: { 'x-auth-client-ip': 'spoofed-ip', authorization: 'Bearer incoming-token' },
    });
    assert.equal(response.statusCode, 201);
    assert.deepEqual(response.json(), { forwarded: true });
    assert.deepEqual(response.headers['set-cookie'], ['session=first; HttpOnly', 'session=second; HttpOnly']);
    const request = requests.at(-1);
    assert.equal(request.url, `https://example.com${url}`);
    assert.equal(request.method, method);
    assert.equal(request.headers.get('x-auth-client-ip'), '192.0.2.42');
    assert.equal(request.headers.get('authorization'), 'Bearer incoming-token');
    if (payload) assert.deepEqual(await request.json(), payload);
    else assert.equal(await request.text(), '');
  }

  assert.equal((await app.inject('/api/api/auth/get-session')).statusCode, 404);
  assert.equal((await app.inject('/auth/magic-link?token=test-token')).statusCode, 404);
});
