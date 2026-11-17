import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { runInNewContext } from 'node:vm';
import AutoLoad from '@fastify/autoload';
import Fastify from 'fastify';

test('autoloaded auth routes apply the API prefix once and keep landing pages separate', async (t) => {
  const app = Fastify();
  t.after(() => app.close());
  const requests = [];
  app.decorate('auth', {
    options: { baseURL: 'https://example.com' },
    async handler (request) {
      requests.push(request);
      const headers = new Headers({ 'set-auth-token': 'bearer-token' });
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
    assert.equal(response.headers['set-auth-token'], 'bearer-token');
    assert.deepEqual(response.headers['set-cookie'], ['session=first; HttpOnly', 'session=second; HttpOnly']);
    const request = requests.at(-1);
    assert.equal(request.url, `https://example.com${url}`);
    assert.equal(request.method, method);
    assert.equal(request.headers.get('x-auth-client-ip'), '192.0.2.42');
    assert.equal(request.headers.get('authorization'), 'Bearer incoming-token');
    if (payload) assert.deepEqual(await request.json(), payload);
    else assert.equal(await request.text(), '');
  }

  for (const action of ['magic-link', 'verify-email', 'reset-password', 'invite']) {
    const response = await app.inject(`/api/auth/links/${action}?token=test-token&inviteId=test-invite`);
    assert.equal(response.statusCode, 200);
    assert.match(response.headers['content-type'], /^text\/html/);
    assert.match(response.body, /Open this link on your phone/);
    assert.doesNotMatch(response.body, /test-token|test-invite/);
    assert.equal(response.headers['cache-control'], 'no-store');
    assert.equal(response.headers['referrer-policy'], 'no-referrer');
    const script = response.body.match(/<script>([\s\S]*?)<\/script>/)[1];
    const hash = createHash('sha256').update(script).digest('base64');
    assert.equal(response.headers['content-security-policy'], `default-src 'none'; script-src 'sha256-${hash}'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'`);
    const link = { hidden: true };
    runInNewContext(script, {
      URL,
      window: { location: { href: `https://links.example.com/api/auth/links/${action}?token=test-token&inviteId=test-invite&from=${encodeURIComponent('/account?tab=profile#password')}` } },
      document: { getElementById: () => link },
    });
    const paths = { 'magic-link': '/auth/magic-link?token=test-token', 'verify-email': '/auth/verify-email?token=test-token', 'reset-password': '/passwords/reset?token=test-token', invite: '/invites/test-invite' };
    const destination = new URL(paths[action], 'https://example.com');
    if (action !== 'invite') destination.searchParams.set('from', '/account?tab=profile#password');
    assert.equal(link.href, destination.href, 'Continue on the web origin, including when mail links use a separate domain');
    assert.equal(link.hidden, false);
    const missingTokenLink = { hidden: true };
    runInNewContext(script, {
      URL,
      window: { location: { href: `https://links.example.com/api/auth/links/${action}` } },
      document: { getElementById: () => missingTokenLink },
    });
    assert.equal(missingTokenLink.hidden, true);
    assert.equal(response.headers['set-cookie'], undefined);
    assert.equal(response.headers['set-auth-token'], undefined);
  }
  assert.equal(requests.length, 2, 'Landing pages must not invoke Better Auth');
  assert.equal((await app.inject('/api/api/auth/get-session')).statusCode, 404);
  assert.equal((await app.inject('/auth/magic-link?token=test-token')).statusCode, 404);
});
