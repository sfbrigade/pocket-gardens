import { test } from 'node:test';
import assert from 'node:assert/strict';
import Fastify from 'fastify';
import authRoutes from '#routes/api/auth/index.js';
import mailer from '#lib/mailer.js';
import { build, mailToken, nodemailerMock, password, verifiedAdmin, verifiedUser, waitForMail } from '#test/helper.js';

test('Better Auth magic links and native sessions', async (t) => {
  const app = await build(t);
  const { prisma } = app;
  const mail = nodemailerMock.mock;
  const post = (path, payload, headers = {}) => app.inject().post(`/api/auth${path}`)
    .headers({ origin: process.env.BASE_URL, ...headers }).payload(payload);

  async function requestLink (email, registration) {
    const response = await post('/sign-in/magic-link', { email, ...(registration ? { metadata: { registration } } : {}) });
    assert.equal(response.statusCode, 200, response.body);
    return mailToken(mail);
  }

  await t.test('the auth handler normalizes JSON magic-link errors before Fastify forwarding', async () => {
    const headers = new Headers({ accept: 'application/json' });
    const response = await app.auth.handler(new Request(`${process.env.BASE_URL}/api/auth/magic-link/verify?token=invalid`, { headers }));
    assert.equal(response.status, 400);
    assert.equal(response.headers.get('location'), null);
    assert.equal(response.headers.get('set-cookie'), null);
    assert.equal(response.headers.get('set-auth-token'), null);
    assert.equal((await response.json()).code, 'INVALID_TOKEN');

    const serverResponse = await app.auth.api.magicLinkVerify({ query: { token: 'invalid' }, headers, asResponse: true });
    assert.equal(serverResponse.status, 302, 'Server-only API calls retain native error behavior');

    for (const options of [
      { headers: new Headers({ accept: 'text/html' }), query: { token: 'invalid' } },
      { headers, query: { token: 'invalid', callbackURL: '/', errorCallbackURL: '/auth/magic-link' } },
    ]) {
      const redirect = await app.auth.api.magicLinkVerify({ ...options, asResponse: true });
      assert.equal(redirect.status, 302);
      assert.equal(new URL(redirect.headers.get('location')).searchParams.get('error'), 'INVALID_TOKEN');
    }
  });

  await t.test('app exchanges a single-use token for a bearer session; landing pages never consume it', async () => {
    const { user } = await verifiedUser(app);
    const token = await requestLink(user.email);
    const stored = await prisma.verification.findMany();
    assert.ok(stored.length);
    assert.ok(stored.every(row => row.identifier !== token));
    for (const action of ['magic-link', 'verify-email', 'reset-password', 'invite']) {
      const landing = await app.inject(`/api/auth/links/${action}?token=${token}`);
      assert.equal(landing.statusCode, 200);
      assert.ok(landing.body.includes('Open this link on your phone'));
      assert.ok(!landing.body.includes(token));
      assert.equal(landing.headers['set-cookie'], undefined);
      assert.equal(landing.headers['cache-control'], 'no-store');
      assert.equal(landing.headers['referrer-policy'], 'no-referrer');
      assert.match(landing.headers['content-security-policy'], /^default-src 'none'; script-src 'sha256-[A-Za-z0-9+/=]+';/);
    }
    const response = await app.inject(`/api/auth/magic-link/verify?token=${token}`);
    assert.equal(response.statusCode, 200);
    const bearer = response.headers['set-auth-token'];
    assert.ok(bearer);
    const headers = { authorization: `Bearer ${bearer}` };
    assert.equal((await app.inject({ url: '/api/auth/get-session', headers })).json().user.id, user.id);
    assert.notEqual((await app.inject(`/api/auth/magic-link/verify?token=${token}`)).statusCode, 200);
    assert.equal((await post('/sign-in/email', { email: user.email, password })).statusCode, 200);
    assert.equal((await post('/sign-out', {}, headers)).statusCode, 200);
    assert.equal((await app.inject({ url: '/api/auth/get-session', headers })).json(), null);
  });

  await t.test('unknown accounts receive an opaque response without mail or signup', async () => {
    const response = await post('/sign-in/magic-link', { email: 'unknown@example.com' });
    assert.equal(response.statusCode, 200);
    assert.deepEqual(response.json(), { status: true });
    assert.equal(mail.getSentMail().length, 0);
    assert.equal(await prisma.user.count({ where: { email: 'unknown@example.com' } }), 0);
  });

  await t.test('pending accounts prove ownership through magic links and reset their password', async () => {
    const signup = await post('/sign-up/email', { firstName: 'Test', lastName: 'Person', email: 'pending@example.com', password });
    assert.equal(signup.statusCode, 200, signup.body);
    const user = signup.json().user;
    // Simulate standing access created before the mailbox owner proved ownership.
    const { internalAdapter } = await app.auth.$context;
    const oldSession = await internalAdapter.createSession(user.id);
    await waitForMail();
    mail.reset();
    const token = await requestLink(user.email);
    assert.equal(mail.getSentMail().length, 1);
    const response = await app.inject(`/api/auth/magic-link/verify?token=${token}`);
    assert.equal(response.statusCode, 200, response.body);
    assert.equal(response.json().user.id, user.id);
    assert.equal(response.json().user.emailVerified, true);
    assert.equal(await prisma.account.count({ where: { userId: user.id } }), 0);
    assert.equal(await prisma.session.findUnique({ where: { id: oldSession.id } }), null);
    const headers = { authorization: `Bearer ${response.headers['set-auth-token']}` };
    assert.equal((await app.inject({ url: '/api/auth/get-session', headers })).json().user.id, user.id);
    assert.equal((await post('/sign-in/email', { email: user.email, password })).statusCode, 401);
    assert.equal((await post('/request-password-reset', { email: user.email })).statusCode, 200);
    assert.equal((await post('/reset-password', { token: await mailToken(mail), newPassword: `${password}New` })).statusCode, 200);
    assert.equal((await post('/sign-in/email', { email: user.email, password: `${password}New` })).statusCode, 200);
  });

  for (const registration of [undefined, { firstName: 'Test', lastName: 'Person' }]) {
    await t.test(`failed ${registration ? 'registration' : 'login'} links stay consumed after an account is unbanned`, async () => {
      const admin = await verifiedAdmin(app);
      const { user } = await verifiedUser(app);
      const outstanding = await requestLink(user.email, registration);
      assert.equal((await post('/admin/ban-user', { userId: user.id }, admin.headers)).statusCode, 200);
      const fresh = await requestLink(user.email, registration);
      for (const token of [outstanding, fresh]) {
        const response = await app.inject(`/api/auth/magic-link/verify?token=${token}`);
        assert.equal(response.statusCode, 403, response.body);
        assert.equal(response.headers['set-auth-token'], undefined);
      }
      assert.equal(await prisma.session.count({ where: { userId: user.id } }), 0);
      assert.equal((await post('/admin/unban-user', { userId: user.id }, admin.headers)).statusCode, 200);
      for (const token of [outstanding, fresh]) {
        const response = await app.inject(`/api/auth/magic-link/verify?token=${token}`);
        assert.notEqual(response.statusCode, 200, 'A failed verification must still consume its token');
        assert.equal(response.headers['set-cookie'], undefined);
        assert.equal(response.headers['set-auth-token'], undefined);
      }
      assert.equal(await prisma.session.count({ where: { userId: user.id } }), 0);
    });
  }

  await t.test('magic sign-in clears expired temporary bans without a password sign-in', async () => {
    const admin = await verifiedAdmin(app);
    const { user } = await verifiedUser(app);
    assert.equal((await post('/admin/ban-user', { userId: user.id, banExpiresIn: 60 }, admin.headers)).statusCode, 200);
    await prisma.user.update({ where: { id: user.id }, data: { banExpires: new Date(0) } });
    const token = await requestLink(user.email);
    const response = await app.inject(`/api/auth/magic-link/verify?token=${token}`);
    assert.equal(response.statusCode, 200, response.body);
    assert.ok(response.headers['set-auth-token']);
    const updated = await prisma.user.findUnique({ where: { id: user.id } });
    assert.equal(updated.banned, false);
  });

  await t.test('disabled SMTP and delivery failures do not expose account eligibility or secrets', async () => {
    const { user } = await verifiedUser(app);
    const { logger } = await app.auth.$context;
    const warnings = t.mock.method(logger, 'warn', () => {});
    try {
      for (const enabled of [false, true]) {
        process.env.SMTP_ENABLED = String(enabled);
        const sending = t.mock.method(mailer, 'send', async () => {
          throw new Error(`Transport failed for ${user.email} with secret-token`);
        });
        try {
          for (const email of [user.email, 'unknown@example.com']) {
            const response = await post('/sign-in/magic-link', { email });
            assert.equal(response.statusCode, 200, response.body);
            assert.deepEqual(response.json(), { status: true });
          }
        } finally {
          sending.mock.restore();
        }
      }
      assert.deepEqual(warnings.mock.calls.map(call => call.arguments), [
        ['Authentication email delivery failed.'],
        ['Authentication email delivery failed.'],
      ]);
    } finally {
      warnings.mock.restore();
      process.env.SMTP_ENABLED = 'true';
    }
  });

  await t.test('expired tokens fail and concurrent verification creates only one session', async () => {
    const { user } = await verifiedUser(app);
    const expiredToken = await requestLink(user.email);
    await prisma.verification.updateMany({ data: { expiresAt: new Date(0) } });
    assert.notEqual((await app.inject(`/api/auth/magic-link/verify?token=${expiredToken}`)).statusCode, 200);
    const token = await requestLink(user.email);
    const before = await prisma.session.count();
    const responses = await Promise.all([
      app.inject(`/api/auth/magic-link/verify?token=${token}`),
      app.inject(`/api/auth/magic-link/verify?token=${token}`),
    ]);
    assert.equal(responses.filter(r => r.statusCode === 200).length, 1);
    assert.equal(await prisma.session.count(), before + 1);
  });

  await t.test('rate limits use connection IP, not a caller-supplied override', async () => {
    for (let i = 0; i < 5; i++) {
      const response = await post('/sign-in/magic-link', { email: 'unknown@example.com' }, { 'x-auth-client-ip': `192.0.2.${i}` });
      assert.equal(response.statusCode, 200);
    }
    const blocked = await post('/sign-in/magic-link', { email: 'unknown@example.com' }, { 'x-auth-client-ip': '192.0.2.99' });
    assert.equal(blocked.statusCode, 429);
  });

  await t.test('trusted proxies preserve separate client limits; direct callers cannot spoof them', async (t) => {
    const previous = process.env.TRUSTED_PROXIES;
    process.env.TRUSTED_PROXIES = '192.0.2.10, 192.0.2.11/32';
    let options;
    try {
      ({ options } = await import('../app.js?proxy-test'));
    } finally {
      if (previous === undefined) delete process.env.TRUSTED_PROXIES;
      else process.env.TRUSTED_PROXIES = previous;
    }
    const proxied = Fastify({ ...options, logger: false });
    t.after(() => proxied.close());
    proxied.decorate('auth', app.auth);
    await proxied.register(authRoutes, { prefix: '/api/auth' });
    const request = (remoteAddress, ip) => proxied.inject({
      method: 'POST',
      url: '/api/auth/sign-in/magic-link',
      remoteAddress,
      headers: { origin: process.env.BASE_URL, 'x-forwarded-for': ip, 'x-auth-client-ip': ip },
      payload: { email: 'unknown@example.com' },
    });
    for (let i = 1; i <= 6; i++) {
      assert.equal((await request('192.0.2.10', `198.51.100.${i}`)).statusCode, 200);
    }
    for (let i = 0; i < 4; i++) assert.equal((await request('192.0.2.11', '198.51.100.1')).statusCode, 200);
    assert.equal((await request('192.0.2.10', '198.51.100.1')).statusCode, 429);
    for (let i = 1; i <= 5; i++) {
      assert.equal((await request('203.0.113.1', `198.51.100.${i}`)).statusCode, 200);
    }
    assert.equal((await request('203.0.113.1', '198.51.100.99')).statusCode, 429);
  });
});
