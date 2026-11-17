import { test } from 'node:test';
import assert from 'node:assert/strict';
import { request } from 'node:http';
import Fastify from 'fastify';
import { authenticate, build, mailToken, nodemailerMock, password } from '#test/helper.js';
import authRoutes from '#routes/api/auth/index.js';
import { options } from '#app.js';

test('application Better Auth cutover', async (t) => {
  const app = await build(t);

  await t.test('registration, verification, native magic exchange and logout reach protected routes', async () => {
    const signup = await app.inject().post('/api/auth/sign-up/email')
      .headers({ origin: process.env.BASE_URL })
      .payload({ firstName: 'Test', lastName: 'Person', email: 'person@example.com', password });
    assert.equal(signup.statusCode, 200, signup.body);
    assert.equal((await app.inject(`/api/auth/verify-email?token=${await mailToken(nodemailerMock.mock)}`)).statusCode, 200);
    assert.equal((await app.inject().post('/api/auth/sign-in/magic-link')
      .headers({ origin: process.env.BASE_URL })
      .payload({ email: 'person@example.com' })).statusCode, 200);
    const token = await mailToken(nodemailerMock.mock);
    const landing = await app.inject(`/api/auth/links/magic-link?token=${token}`);
    assert.equal(landing.statusCode, 200);
    const login = await app.inject(`/api/auth/magic-link/verify?token=${token}`);
    assert.equal(login.statusCode, 200, login.body);
    const headers = { authorization: `Bearer ${login.headers['set-auth-token']}` };
    const profile = await app.inject({ url: '/api/users/me', headers });
    assert.equal(profile.statusCode, 200, profile.body);
    assert.equal(profile.json().id, signup.json().user.id);
    assert.equal(profile.json().isAdmin, false);
    assert.equal((await app.inject({ url: '/api/users', headers })).statusCode, 403);
    assert.equal((await app.inject().post('/api/auth/sign-in/email')
      .headers({ origin: process.env.BASE_URL })
      .payload({ email: 'person@example.com', password })).statusCode, 200);
    assert.equal((await app.inject().post('/api/auth/sign-out')
      .headers({ origin: process.env.BASE_URL, ...headers })
      .payload({})).statusCode, 200);
    assert.equal((await app.inject({ url: '/api/users/me', headers })).statusCode, 204);
    assert.equal((await app.inject({ url: `/api/users/${signup.json().user.id}`, headers })).statusCode, 401);
  });

  await t.test('expired and admin-revoked sessions lose application access immediately', async () => {
    const adminHeaders = await authenticate(app, 'admin.user@test.com', 'test');
    const headers = await authenticate(app, 'regular.user@test.com', 'test');
    const userId = 'dab5dff3-360d-4dbb-98dd-1990dfb5c4c5';
    assert.equal((await app.inject().post('/api/auth/admin/revoke-user-sessions')
      .headers({ origin: process.env.BASE_URL, ...adminHeaders })
      .payload({ userId })).statusCode, 200);
    assert.equal((await app.inject({ url: `/api/users/${userId}`, headers })).statusCode, 401);
    const expired = await authenticate(app, 'regular.user@test.com', 'test');
    await app.prisma.session.updateMany({ where: { userId }, data: { expiresAt: new Date(0) } });
    assert.equal((await app.inject({ url: `/api/users/${userId}`, headers: expired })).statusCode, 401);
  });

  await t.test('legacy endpoints and untrusted browser origins cannot authenticate', async () => {
    for (const path of ['/login', '/register']) {
      assert.equal((await app.inject().post(`/api/auth${path}`)
        .headers({ origin: process.env.BASE_URL })
        .payload({ email: 'regular.user@test.com', password: 'test' })).statusCode, 404);
    }
    const response = await app.inject().post('/api/auth/sign-in/email')
      .headers({ origin: 'https://untrusted.example' })
      .payload({ email: 'regular.user@test.com', password: 'test' });
    assert.equal(response.statusCode, 403);
  });

  await t.test('raw reset callback paths never log a usable token', async (t) => {
    assert.equal((await app.inject().post('/api/auth/request-password-reset')
      .payload({ email: 'regular.user@test.com' })).statusCode, 200);
    const token = await mailToken(nodemailerMock.mock);
    const logs = [];
    const loggedApp = Fastify({ logger: { ...options.logger, stream: { write: line => logs.push(line) } } });
    t.after(() => loggedApp.close());
    loggedApp.decorate('auth', app.auth);
    await loggedApp.register(authRoutes, { prefix: '/api/auth' });
    await loggedApp.listen({ host: '127.0.0.1', port: 0 });
    for (const path of [
      `/api/auth/reset-password/${token}`,
      `/api/auth/reset-password/./${token}`,
      `/api/auth/extra/../reset-password/${token}`,
      `/api/auth/reset-password/%2e/${token}`,
      `/api/auth/extra/%2e%2e/reset-password/${token}`,
    ]) {
      // Injection/fetch normalize dot segments before sending; preserve the raw target.
      const response = await new Promise((resolve, reject) => {
        request({ host: '127.0.0.1', port: loggedApp.server.address().port, path: `${path}?callbackURL=/api/auth/links/reset-password` }, res => {
          res.resume();
          res.on('end', () => resolve(res));
          res.on('error', reject);
        }).on('error', reject).end();
      });
      assert.equal(response.statusCode, 302);
      assert.equal(new URL(response.headers.location).searchParams.get('token'), token);
    }
    assert.equal((await app.inject().post('/api/auth/reset-password')
      .payload({ token, newPassword: password })).statusCode, 200);
    assert.equal(logs.map(line => JSON.parse(line)).filter(line => line.req).length, 5);
    assert.equal(logs.some(line => line.includes(token)), false, 'Reset token leaked into access logs');
  });

  await t.test('access log serializer excludes link tokens and headers', () => {
    for (const [url, route] of [
      ['/api/auth/links/magic-link?token=secret', '/api/auth/links/magic-link'],
      ['/api/auth/reset-password/secret?callbackURL=/', '/api/auth/*'],
      ['/api/auth/reset-password/encoded%2Dsecret/', '/api/auth/*'],
      ['/api/auth/reset-password', '/api/auth/*'],
      ['/api/users/123', '/api/users/:id'],
      ['/unknown/secret'],
      ['/malformed/%?token=secret'],
    ]) {
      assert.deepEqual(options.logger.serializers.req({ method: 'GET', url, routeOptions: { url: route }, ip: '127.0.0.1', headers: { authorization: 'secret' } }), {
        method: 'GET', url: route || '[unmatched]', remoteAddress: '127.0.0.1',
      });
    }
    assert.deepEqual(options.logger.serializers.req({ method: 'GET', url: '/raw/secret' }), {
      method: 'GET', url: '[unmatched]', remoteAddress: undefined,
    });
  });
});
