import { test } from 'node:test';
import assert from 'node:assert/strict';
import { build, mailToken, nodemailerMock, verifiedAdmin, verifiedUser } from '#test/helper.js';

test('browser magic-link error callbacks', async t => {
  const app = await build(t);
  const { prisma } = app;
  const mail = nodemailerMock.mock;
  const post = (path, payload, headers = {}) => app.inject().post(`/api/auth${path}`)
    .headers({ origin: process.env.BASE_URL, ...headers }).payload(payload);
  const from = '/account?tab=profile#password';
  const errorCallbackURL = `/auth/magic-link?from=${encodeURIComponent(from)}`;
  const confirm = (token, callbacks = {}) => app.inject({
    url: `/api/auth/magic-link/verify?${new URLSearchParams({ token, callbackURL: from, errorCallbackURL, ...callbacks })}`,
    headers: { accept: 'text/html' },
  });
  async function request (email, registration) {
    assert.equal((await post('/sign-in/magic-link', { email, ...(registration ? { metadata: { registration } } : {}) })).statusCode, 200);
    return mailToken(mail);
  }
  function assertError (response, code) {
    assert.equal(response.statusCode, 302, response.body);
    const target = new URL(response.headers.location);
    assert.equal(target.origin, process.env.BASE_URL);
    assert.equal(target.pathname, '/auth/magic-link');
    assert.equal(target.searchParams.get('from'), from);
    assert.equal(target.searchParams.get('error'), code);
    assert.equal(response.headers['set-cookie'], undefined);
  }

  for (const registration of [undefined, { firstName: 'Test', lastName: 'Person' }]) {
    await t.test(`banned ${registration ? 'registration' : 'login'} redirects and still consumes its token`, async () => {
      const admin = await verifiedAdmin(app);
      const { user } = await verifiedUser(app);
      const token = await request(user.email, registration);
      assert.equal((await post('/admin/ban-user', { userId: user.id }, admin.headers)).statusCode, 200);
      assertError(await confirm(token), 'BANNED_USER');
      assert.equal(await prisma.session.count({ where: { userId: user.id } }), 0);
      assert.equal((await post('/admin/unban-user', { userId: user.id }, admin.headers)).statusCode, 200);
      assertError(await confirm(token), 'INVALID_TOKEN');
    });
  }

  await t.test('registration closure redirects without creating an account or stranding the token', async () => {
    const email = 'callback@example.com';
    const token = await request(email, { firstName: 'Test', lastName: 'Person' });
    process.env.VITE_FEATURE_REGISTRATION = 'false';
    assertError(await confirm(token), 'REGISTRATION_CLOSED');
    assert.equal(await prisma.user.count({ where: { email } }), 0);
    assert.equal(await prisma.session.count(), 0);
    process.env.VITE_FEATURE_REGISTRATION = 'true';
    const success = await confirm(token);
    assert.equal(success.statusCode, 302);
    assert.equal(success.headers.location, `${process.env.BASE_URL}${from}`);
    assert.ok(success.headers['set-cookie']);
  });

  await t.test('revoked invitations redirect and remain unclaimed', async () => {
    const inviteId = '6ed61e21-1062-4b10-a967-53b395f5c34c';
    const email = 'invited.user.1@test.com';
    const token = await request(email, { firstName: 'Test', lastName: 'Person', inviteId });
    await prisma.invite.update({ where: { id: inviteId }, data: { revokedAt: new Date() } });
    assertError(await confirm(token), 'INVALID_INVITATION');
    assert.equal(await prisma.user.count({ where: { email } }), 0);
    assert.equal(await prisma.session.count(), 0);
    assert.equal((await prisma.invite.findUnique({ where: { id: inviteId } })).acceptedAt, null);
  });

  await t.test('a lost invitation claim rolls back account/session creation before redirecting', async () => {
    const inviteId = '6ed61e21-1062-4b10-a967-53b395f5c34c';
    const email = 'invited.user.1@test.com';
    const token = await request(email, { firstName: 'Test', lastName: 'Person', inviteId });
    const { adapter } = await app.auth.$context;
    const transaction = adapter.transaction.bind(adapter);
    const racing = t.mock.method(adapter, 'transaction', fn => transaction(async tx => {
      const update = tx.update.bind(tx);
      tx.update = input => input.model === 'invite' ? null : update(input);
      return fn(tx);
    }));
    try {
      assertError(await confirm(token), 'INVALID_INVITATION');
      assert.equal(await prisma.user.count({ where: { email } }), 0);
      assert.equal(await prisma.session.count(), 0);
      assert.equal((await prisma.invite.findUnique({ where: { id: inviteId } })).acceptedAt, null);
    } finally {
      racing.mock.restore();
    }
    assert.equal((await confirm(token)).statusCode, 302);
    assert.equal(await prisma.user.count({ where: { email } }), 1);
    assert.equal(await prisma.session.count(), 1);
  });

  await t.test('untrusted error callbacks are rejected before token redemption', async () => {
    const { user } = await verifiedUser(app);
    const token = await request(user.email);
    const before = await prisma.verification.findMany();
    const denied = await confirm(token, { errorCallbackURL: 'https://untrusted.example/callback' });
    assert.equal(denied.statusCode, 403);
    assert.equal(denied.headers.location, undefined);
    assert.deepEqual(await prisma.verification.findMany(), before);
    assert.equal((await confirm(token)).statusCode, 302);
  });
});
