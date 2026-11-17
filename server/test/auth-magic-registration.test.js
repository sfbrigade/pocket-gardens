import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { build, mailToken, nodemailerMock, password, waitForMail } from '#test/helper.js';

test('passwordless registration', async (t) => {
  const app = await build(t);
  const { prisma } = app;
  const mail = nodemailerMock.mock;
  const post = (path, body) => app.inject().post(`/api/auth${path}`)
    .headers({ origin: process.env.BASE_URL }).payload(body);
  const profile = { firstName: 'Email', lastName: 'Member' };
  const email = 'passwordless@example.com';
  const requestLink = (address = email, registration = profile) => post('/sign-in/magic-link', {
    email: address, metadata: { registration },
  });
  const redeem = token => app.inject({
    url: `/api/auth/magic-link/verify?token=${token}`,
    headers: { accept: 'application/json' },
  });

  await t.test('creates a verified profile only on confirmation, with no credential account, and can add a password later', async () => {
    const sent = await requestLink(email, { ...profile, role: 'admin', emailVerified: false });
    assert.equal(sent.statusCode, 200, sent.body);
    assert.deepEqual(sent.json(), { status: true });
    assert.equal(await prisma.user.count({ where: { email } }), 0);
    assert.equal(await prisma.session.count(), 0);
    const token = await mailToken(mail);
    assert.ok(token);
    const stored = await prisma.verification.findFirst();
    assert.deepEqual(JSON.parse(stored.value), { type: 'magic-link', email, name: 'Email Member' });
    const { internalAdapter } = await app.auth.$context;
    assert.deepEqual((await internalAdapter.findVerificationValue(stored.identifier)).registration, { ...profile, email });
    const response = await redeem(token);
    assert.equal(response.statusCode, 200, response.body);
    const user = response.json().user;
    assert.equal(user.firstName, profile.firstName);
    assert.equal(user.lastName, profile.lastName);
    assert.equal(user.name, 'Email Member');
    assert.equal(user.emailVerified, true);
    assert.equal(user.role, 'user');
    assert.equal(await prisma.account.count({ where: { userId: user.id } }), 0);
    const cookie = response.cookies.map(({ name, value }) => `${name}=${value}`).join('; ');
    assert.ok(cookie);
    const headers = { cookie };
    assert.equal((await app.inject({ url: '/api/users/me', headers })).json().id, user.id);
    assert.equal((await app.inject({ url: '/api/users', headers })).statusCode, 403);
    assert.equal((await redeem(token)).statusCode, 400);
    assert.equal((await post('/sign-in/email', { email, password })).statusCode, 401);
    assert.equal((await post('/request-password-reset', { email })).statusCode, 200);
    const resetToken = await mailToken(mail);
    assert.equal((await post('/reset-password', { token: resetToken, newPassword: password })).statusCode, 200);
    assert.equal((await app.inject({ url: '/api/users/me', headers })).statusCode, 204);
    assert.equal((await post('/sign-in/email', { email, password })).statusCode, 200);
    await prisma.rateLimit.deleteMany();
    assert.equal((await post('/sign-in/magic-link', { email })).statusCode, 200);
    assert.equal((await redeem(await mailToken(mail))).statusCode, 200);
  });

  await t.test('rejects invalid names and cannot create accounts using the plain login endpoint or a display name', async () => {
    for (const registration of [{}, { ...profile, firstName: 'A' }, { ...profile, lastName: 'x'.repeat(31) }]) {
      assert.equal((await requestLink(email, registration)).statusCode, 400);
    }
    assert.equal(await prisma.user.count({ where: { email } }), 0);
    assert.equal((await post('/sign-in/magic-link', { email, name: 'Email Member' })).statusCode, 200);
    // Login requests for unknown addresses stay opaque and send no email.
    await waitForMail();
    assert.equal(mail.getSentMail().length, 0);
    const stored = await prisma.verification.findFirst();
    assert.equal(stored.registration, null);
    const token = 'test-token-without-registration';
    const identifier = `magic-link:${createHash('sha256').update(token).digest('base64url')}`;
    await prisma.verification.create({
      data: {
        identifier,
        value: JSON.stringify({ type: 'magic-link', email, name: 'Email Member' }),
        expiresAt: new Date(Date.now() + 60_000),
      }
    });
    assert.equal((await redeem(token)).statusCode, 400);
    assert.equal(await prisma.verification.findUnique({ where: { identifier } }), null);
    assert.equal(await prisma.user.count({ where: { email } }), 0);
  });

  await t.test('expired registration links use native token expiry without creating an account', async () => {
    assert.equal((await requestLink()).statusCode, 200);
    const token = await mailToken(mail);
    await prisma.verification.updateMany({ data: { expiresAt: new Date(0) } });
    const response = await redeem(token);
    assert.equal(response.statusCode, 400, response.body);
    assert.equal(response.json().code, 'INVALID_TOKEN');
    assert.equal(await prisma.verification.count(), 0);
    assert.equal(await prisma.user.count({ where: { email } }), 0);
  });

  await t.test('invitation signup validates email, stays unclaimed until confirmation, and accepts it with the new account', async () => {
    process.env.VITE_FEATURE_REGISTRATION = 'false';
    assert.equal((await requestLink()).statusCode, 403);
    const inviteId = '6ed61e21-1062-4b10-a967-53b395f5c34c';
    const registration = { ...profile, inviteId };
    assert.equal((await requestLink(email, registration)).statusCode, 400);
    const address = 'invited.user.1@test.com';
    assert.equal((await requestLink(address.toUpperCase(), registration)).statusCode, 200);
    assert.equal((await prisma.invite.findUnique({ where: { id: inviteId } })).acceptedAt, null);
    const response = await redeem(await mailToken(mail));
    assert.equal(response.statusCode, 200, response.body);
    const invite = await prisma.invite.findUnique({ where: { id: inviteId } });
    assert.equal(invite.acceptedById, response.json().user.id);
    assert.ok(invite.acceptedAt);
    assert.equal(response.json().user.email, address);
    assert.equal(await prisma.account.count({ where: { userId: invite.acceptedById } }), 0);
  });

  await t.test('revoked and accepted invitations reject requests and outstanding registration links', async () => {
    for (const inviteId of ['e28fddba-8e9b-41c9-924a-c5f1f4a2f8f6', '157d4be5-fd7d-4d08-b74e-2d3584062c8a']) {
      assert.equal((await requestLink('invited.user.2@test.com', { ...profile, inviteId })).statusCode, 400);
    }
    const inviteId = '6ed61e21-1062-4b10-a967-53b395f5c34c';
    assert.equal((await requestLink('invited.user.1@test.com', { ...profile, inviteId })).statusCode, 200);
    const token = await mailToken(mail);
    await prisma.invite.update({ where: { id: inviteId }, data: { revokedAt: new Date() } });
    const response = await redeem(token);
    assert.equal(response.statusCode, 400, response.body);
    assert.equal(response.headers['set-cookie'], undefined);
    assert.equal(response.headers['set-auth-token'], undefined);
    assert.equal(await prisma.user.count({ where: { email: 'invited.user.1@test.com' } }), 0);
    assert.equal(await prisma.session.count(), 0);
  });

  await t.test('closing public registration blocks outstanding public signup links', async () => {
    assert.equal((await requestLink()).statusCode, 200);
    const token = await mailToken(mail);
    process.env.VITE_FEATURE_REGISTRATION = 'false';
    assert.equal((await redeem(token)).statusCode, 403);
    assert.equal(await prisma.user.count({ where: { email } }), 0);
    assert.equal(await prisma.session.count(), 0);
  });

  await t.test('losing the invitation claim rolls back the new user and session without exposing cookies', async () => {
    const inviteId = '6ed61e21-1062-4b10-a967-53b395f5c34c';
    const address = 'invited.user.1@test.com';
    assert.equal((await requestLink(address, { ...profile, inviteId })).statusCode, 200);
    const token = await mailToken(mail);
    const { adapter } = await app.auth.$context;
    const transaction = adapter.transaction.bind(adapter);
    // Simulate another request taking the invite between admission and claim.
    const racing = t.mock.method(adapter, 'transaction', fn => transaction(async (tx) => {
      const update = tx.update.bind(tx);
      tx.update = input => input.model === 'invite' ? null : update(input);
      return fn(tx);
    }));
    try {
      const response = await redeem(token);
      assert.equal(response.statusCode, 400, response.body);
      assert.equal(response.headers['set-cookie'], undefined);
      assert.equal(response.headers['set-auth-token'], undefined);
      assert.equal(await prisma.user.count({ where: { email: address } }), 0);
      assert.equal(await prisma.session.count(), 0);
      assert.equal((await prisma.invite.findUnique({ where: { id: inviteId } })).acceptedAt, null);
    } finally {
      racing.mock.restore();
    }
    assert.equal((await redeem(token)).statusCode, 200, 'A rolled-back claim must not strand the invitation');
  });

  await t.test('existing accounts sign in without replacing their profile or password', async () => {
    const address = 'regular.user@test.com';
    const before = await prisma.user.findUnique({ where: { email: address } });
    const credentials = await prisma.account.findMany({ where: { userId: before.id } });
    assert.equal((await requestLink(address)).statusCode, 200);
    const response = await redeem(await mailToken(mail));
    assert.equal(response.statusCode, 200, response.body);
    assert.equal(response.json().user.id, before.id);
    assert.equal(response.json().user.firstName, before.firstName);
    assert.deepEqual(await prisma.account.findMany({ where: { userId: before.id } }), credentials);
    assert.equal((await post('/sign-in/email', { email: address, password: 'test' })).statusCode, 200);
  });

  await t.test('failed session creation does not leave a partial passwordless account', async () => {
    assert.equal((await requestLink()).statusCode, 200);
    const token = await mailToken(mail);
    const { adapter } = await app.auth.$context;
    const transaction = adapter.transaction.bind(adapter);
    const unavailable = t.mock.method(adapter, 'transaction', fn => transaction(async (tx) => {
      const create = tx.create.bind(tx);
      tx.create = input => input.model === 'session' ? null : create(input);
      return fn(tx);
    }));
    try {
      const response = await redeem(token);
      assert.equal(response.statusCode, 400, response.body);
      assert.equal(response.headers['set-cookie'], undefined);
      assert.equal(response.headers['set-auth-token'], undefined);
      assert.equal(await prisma.user.count({ where: { email } }), 0);
      assert.equal(await prisma.session.count(), 0);
    } finally {
      unavailable.mock.restore();
    }
    assert.equal((await redeem(token)).statusCode, 200);
  });

  await t.test('concurrent signup confirmation creates only one user and session', async () => {
    assert.equal((await requestLink()).statusCode, 200);
    const token = await mailToken(mail);
    const responses = await Promise.all([redeem(token), redeem(token)]);
    assert.equal(responses.filter(r => r.statusCode === 200).length, 1, responses.map(r => r.body).join('\n'));
    assert.equal(await prisma.user.count({ where: { email } }), 1);
    assert.equal(await prisma.session.count(), 1);
  });

  await t.test('native browser callback commits registration and sets a session before redirecting', async () => {
    assert.equal((await requestLink()).statusCode, 200);
    const token = await mailToken(mail);
    const response = await app.inject(`/api/auth/magic-link/verify?token=${token}&callbackURL=/account`);
    assert.equal(response.statusCode, 302, response.body);
    assert.equal(response.headers.location, `${process.env.BASE_URL}/account`);
    assert.ok(response.headers['set-cookie']);
    assert.ok(response.headers['set-auth-token']);
    assert.equal(await prisma.user.count({ where: { email } }), 1);
    assert.equal(await prisma.session.count(), 1);
  });

  await t.test('disabled email delivery rejects registration without creating accounts', async () => {
    process.env.SMTP_ENABLED = 'false';
    assert.equal((await requestLink()).statusCode, 503);
    assert.equal(await prisma.user.count({ where: { email } }), 0);
  });
});
