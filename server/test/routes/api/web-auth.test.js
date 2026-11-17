import { test } from 'node:test';
import assert from 'node:assert/strict';
import axios from 'axios';
import { build, mailToken, nodemailerMock, password, waitForMail } from '#test/helper.js';

test('web client authentication through the application routes', async (t) => {
  const app = await build(t);
  let cookie = '';
  let unavailableProfileId;
  let sessionProfileStatus;
  // Exercise the web client's real request paths, bodies and error handling.
  const previousAdapter = axios.defaults.adapter;
  axios.defaults.adapter = async config => {
    if (config.method === 'get' && config.url === '/api/users/me' && sessionProfileStatus) {
      const response = { status: sessionProfileStatus, data: null, headers: {}, config };
      if (sessionProfileStatus === 204) return response;
      throw new axios.AxiosError('Temporary profile read failure', undefined, config, undefined, response);
    }
    if (config.method === 'get' && config.url === `/api/users/${unavailableProfileId}`) {
      const response = { status: 503, data: { message: 'Temporary profile read failure' }, config };
      throw new axios.AxiosError('Profile read failed', undefined, config, undefined, response);
    }
    const headers = { ...config.headers.toJSON(), origin: process.env.BASE_URL, cookie };
    const result = await app.inject({
      method: config.method.toUpperCase(),
      url: axios.getUri(config),
      headers,
      ...(config.data ? { payload: config.data } : {}),
    });
    if (result.cookies.length) cookie = result.cookies.map(({ name, value }) => `${name}=${value}`).join('; ');
    const response = { data: result.body, status: result.statusCode, headers: result.headers, config };
    if (!config.validateStatus || config.validateStatus(response.status)) return response;
    throw new axios.AxiosError(`Request failed with status code ${response.status}`, undefined, config, undefined, response);
  };
  let Api;
  try {
    ({ default: Api } = await import('../../../../client/src/Api.js'));
  } finally {
    axios.defaults.adapter = previousAdapter;
  }
  t.beforeEach(() => { cookie = ''; unavailableProfileId = undefined; sessionProfileStatus = undefined; });

  for (const method of ['password', 'magic-link']) {
    for (const status of [204, 503]) {
      await t.test(`${method} login reports a form error when the session profile returns ${status}`, async () => {
        const email = 'regular.user@test.com';
        let token;
        if (method === 'magic-link') {
          await Api.auth.sendMagicLink(email);
          token = await mailToken(nodemailerMock.mock);
        }
        sessionProfileStatus = status;
        await assert.rejects(method === 'password' ? Api.auth.login(email, 'test') : Api.auth.verifyMagicLink(token), error => typeof error._form === 'string');
      });
    }
  }

  await t.test('login emails retain the requested application destination and reject external destinations', async () => {
    const callbackURL = '/account?tab=profile#password';
    await Api.auth.sendMagicLink('regular.user@test.com', callbackURL);
    await waitForMail();
    const text = nodemailerMock.mock.getSentMail().at(-1).text;
    const link = new URL(text.match(/http[^\s]+/)[0]);
    assert.equal(link.pathname, '/api/auth/links/magic-link');
    assert.equal(link.searchParams.get('from'), callbackURL);
    const mailCount = nodemailerMock.mock.getSentMail().length;
    await assert.rejects(Api.auth.sendMagicLink('regular.user@test.com', 'https://untrusted.example/account'), { _form: 'Invalid callbackURL' });
    await waitForMail();
    assert.equal(nodemailerMock.mock.getSentMail().length, mailCount);
  });

  for (const action of ['verify-email', 'reset-password']) {
    await t.test(`${action} emails retain the login destination through confirmation`, async () => {
      const email = 'recovery.return@example.com';
      await Api.auth.register({ firstName: 'Return', lastName: 'Member', email, password });
      await waitForMail();
      nodemailerMock.mock.reset();
      const from = '/account?tab=profile#password';
      if (action === 'verify-email') {
        await Api.auth.sendVerificationEmail(email, `/login?from=${encodeURIComponent(from)}`);
      } else {
        await Api.passwords.reset(email, `/passwords/reset?from=${encodeURIComponent(from)}`);
      }
      await waitForMail();
      const text = nodemailerMock.mock.getSentMail().at(-1).text;
      const link = new URL(text.match(/http[^\s]+/)[0]);
      assert.equal(link.pathname, `/api/auth/links/${action}`);
      assert.equal(link.searchParams.get('from'), from);
      if (action === 'verify-email') {
        await Api.auth.verifyEmail(link.searchParams.get('token'));
        assert.equal((await Api.auth.login(email, password)).data.email, email);
      } else {
        await Api.passwords.update(link.searchParams.get('token'), `${password}Changed`);
        assert.equal((await app.prisma.account.findFirst({ where: { user: { email }, providerId: 'credential' } })) !== null, true);
      }
    });
  }

  await t.test('the registration form can request an email link without submitting a password and receive an application profile', async () => {
    const email = 'passwordless.web@example.com';
    const response = await Api.auth.register({
      registrationMethod: 'magic-link', firstName: 'Email', lastName: 'Member', email, password: '', callbackURL: '/account?tab=profile',
    });
    assert.equal(response.status, 200);
    assert.equal(await app.prisma.user.count({ where: { email } }), 0);
    const token = await mailToken(nodemailerMock.mock);
    const link = new URL(nodemailerMock.mock.getSentMail().at(-1).text.match(/http[^\s]+/)[0]);
    assert.equal(link.searchParams.get('from'), '/account?tab=profile');
    const signedIn = await Api.auth.verifyMagicLink(token);
    assert.equal(signedIn.data.email, email);
    assert.equal(signedIn.data.firstName, 'Email');
    assert.equal(signedIn.data.emailVerified, true);
    assert.equal(signedIn.data.isAdmin, false);
    assert.equal(await app.prisma.account.count({ where: { userId: signedIn.data.id } }), 0);
    assert.equal((await Api.users.me()).data.id, signedIn.data.id);
  });

  await t.test('a confirmed role update succeeds even when profile reads are unavailable', async () => {
    await Api.auth.login('admin.user@test.com', 'test');
    unavailableProfileId = 'dab5dff3-360d-4dbb-98dd-1990dfb5c4c5';
    const promoted = await Api.users.setRole(unavailableProfileId, 'admin');
    assert.equal(promoted.data.user.role, 'admin');
    assert.equal((await app.prisma.user.findUnique({ where: { id: unavailableProfileId } })).role, 'admin');
    await assert.rejects(Api.users.get(unavailableProfileId), error => error.response?.status === 503);
  });

  await t.test('an invited user verifies their email and gains or loses admin access on their existing session', async () => {
    const email = 'invited@example.com';
    await Api.auth.login('admin.user@test.com', 'test');
    const invite = await Api.invites.create({ firstName: 'Invited', lastName: 'Person', email });
    await Api.auth.logout();
    process.env.VITE_FEATURE_REGISTRATION = 'false';
    const signup = await Api.auth.register({ firstName: 'Invited', lastName: 'Person', email, password, inviteId: invite.data.id });
    const token = await mailToken(nodemailerMock.mock);
    const userId = signup.data.user.id;
    assert.equal((await app.prisma.invite.findUnique({ where: { id: invite.data.id } })).acceptedById, userId);
    await Api.auth.login('admin.user@test.com', 'test');
    await assert.rejects(Api.users.setRole(userId, 'admin'), { _form: 'This user must verify their email before becoming an administrator.' });
    await Api.auth.logout();
    await Api.auth.verifyEmail(token);
    await Api.auth.login(email, password);
    const memberCookie = cookie;
    // Four synthetic sign-ins share one connection IP; rate limits have separate coverage.
    await app.prisma.rateLimit.deleteMany();
    await Api.auth.login('admin.user@test.com', 'test');
    const adminCookie = cookie;
    assert.equal((await Api.users.setRole(userId, 'admin')).data.user.role, 'admin');
    cookie = memberCookie;
    assert.equal((await Api.users.me()).data.isAdmin, true);
    assert.equal((await Api.users.index()).status, 200, 'Promotion must apply without logging in again');
    cookie = adminCookie;
    assert.equal((await Api.users.setRole(userId, 'user')).data.user.role, 'user');
    cookie = memberCookie;
    assert.equal((await Api.users.me()).data.isAdmin, false);
    await assert.rejects(Api.users.index(), error => error.response?.status === 403, 'Demotion must apply without logging in again');
  });

  await t.test('the web client promotes verified users and demotes them through Better Auth', async () => {
    const admin = await Api.auth.login('admin.user@test.com', 'test');
    const memberId = 'dab5dff3-360d-4dbb-98dd-1990dfb5c4c5';
    const pendingId = 'aa1fdcf6-a63c-454e-9775-2d6fd116fdb1';
    await app.prisma.user.update({ where: { id: pendingId }, data: { emailVerified: false } });
    assert.equal((await Api.users.get(memberId)).data.emailVerified, true);
    assert.equal((await Api.users.get(pendingId)).data.emailVerified, false);
    assert.equal((await Api.users.index()).data.find(user => user.id === pendingId).emailVerified, false);
    const promoted = await Api.users.setRole(memberId, 'admin');
    assert.equal(promoted.data.user.role, 'admin');
    assert.equal(promoted.data.user.emailVerified, true);
    assert.equal((await Api.users.setRole(memberId, 'user')).data.user.role, 'user');
    await assert.rejects(Api.users.setRole(pendingId, 'admin'), { _form: 'This user must verify their email before becoming an administrator.' });
    assert.equal((await Api.users.me()).data.id, admin.data.id);
    await Api.auth.logout();
    await Api.auth.login('regular.user@test.com', 'test');
    await assert.rejects(Api.users.setRole(memberId, 'admin'));
    assert.equal((await app.prisma.user.findUnique({ where: { id: memberId } })).role, 'user');
  });

  await t.test('profile saves submit only editable profile fields and preserve credentials and roles', async () => {
    const member = await Api.auth.login('regular.user@test.com', 'test');
    const updated = await Api.users.update(member.data.id, {
      ...member.data,
      firstName: 'Updated',
      email: 'changed@example.com',
      password: 'NewPassword123!',
      isAdmin: true,
      emailVerified: false,
    });
    assert.equal(updated.data.firstName, 'Updated');
    assert.equal(updated.data.email, member.data.email);
    assert.equal(updated.data.isAdmin, false);
    assert.equal(updated.data.emailVerified, true);
    await Api.auth.logout();
    assert.equal((await Api.auth.login(member.data.email, 'test')).data.id, member.data.id);
  });

  await t.test('a verified administrator can log in, access admin routes and log out', async () => {
    const email = 'bootstrap@example.com';
    await app.auth.api.createUser({
      body: { name: 'First Admin', email, password, role: 'admin', data: { firstName: 'First', lastName: 'Admin', emailVerified: true } },
    });
    const login = await Api.auth.login(email, password);
    assert.equal(login.data.email, email);
    assert.equal(login.data.isAdmin, true);
    assert.equal((await Api.users.index()).status, 200);
    await Api.auth.logout();
    assert.equal((await Api.users.me()).status, 204);
  });

  for (const email of ['regular.user@test.com', 'admin.user@test.com']) {
    await t.test(`${email} can save a profile loaded by the web form`, async () => {
      const login = await Api.auth.login(email, 'test');
      const profile = await Api.users.get(login.data.id);
      const saved = await Api.users.update(login.data.id, { ...profile.data, firstName: 'Updated', password: '' });
      assert.equal(saved.status, 200);
      assert.equal(saved.data.firstName, 'Updated');
      assert.equal(saved.data.email, email);
      assert.equal(saved.data.isAdmin, login.data.isAdmin);
      assert.equal((await Api.users.me()).data.firstName, 'Updated');
    });
  }

  await t.test('password recovery sends mail, resets the password and permits login', async () => {
    const email = 'bootstrap@example.com';
    await app.auth.api.createUser({
      body: { name: 'First Admin', email, password, role: 'admin', data: { firstName: 'First', lastName: 'Admin', emailVerified: true } },
    });
    await Api.passwords.reset(email);
    const token = await mailToken(nodemailerMock.mock);
    assert.ok(token);
    await Api.auth.login(email, password);
    await Api.passwords.update(token, `${password}Changed`);
    assert.equal((await Api.users.me()).status, 204, 'Password reset must revoke the old browser session');
    await assert.rejects(Api.passwords.update(token, password), { _form: 'This link is invalid or has expired. Please request a new one.' });
    await assert.rejects(Api.auth.login(email, password), { _form: 'Invalid email and/or password.' });
    const login = await Api.auth.login(email, `${password}Changed`);
    assert.equal(login.data.email, email);
  });

  await t.test('resetting another account preserves the current browser session', async () => {
    const login = await Api.auth.login('admin.user@test.com', 'test');
    await Api.passwords.reset('regular.user@test.com');
    await Api.passwords.update(await mailToken(nodemailerMock.mock), `${password}Changed`);
    assert.equal((await Api.users.me()).data.id, login.data.id);
    await Api.auth.logout();
    assert.equal((await Api.auth.login('regular.user@test.com', `${password}Changed`)).data.email, 'regular.user@test.com');
  });

  await t.test('signup remains signed out until email verification, then returns the application profile', async () => {
    const email = 'new.user@example.com';
    const signup = await Api.auth.register({ email, password, firstName: 'New', lastName: 'User' });
    assert.equal(signup.data.token, null);
    assert.equal((await Api.users.me()).status, 204);
    await assert.rejects(Api.auth.login(email, password), { _form: 'Please verify your email before logging in.', _code: 'EMAIL_NOT_VERIFIED' });
    await Api.auth.sendVerificationEmail(email);
    await Api.auth.verifyEmail(await mailToken(nodemailerMock.mock));
    const login = await Api.auth.login(email, password);
    assert.equal(login.data.email, email);
    assert.equal(login.data.isAdmin, false);
    assert.equal(login.data.user, undefined, 'The login screen needs the application profile, not the Better Auth wrapper');
  });

  await t.test('unknown reset addresses have the same public response', async () => {
    const known = await Api.passwords.reset('regular.user@test.com');
    const unknown = await Api.passwords.reset('unknown@example.com');
    assert.equal(known.status, 200);
    assert.deepEqual(known.data, unknown.data);
  });

  await t.test('invalid credentials and expired links stay on the form instead of redirecting', async () => {
    const previousWindow = globalThis.window;
    globalThis.window = { location: '/login?from=/admin' };
    try {
      await assert.rejects(Api.auth.login('unknown@example.com', password), { _form: 'Invalid email and/or password.' });
      await assert.rejects(Api.auth.verifyEmail('invalid'), { _form: 'This link is invalid or has expired. Please request a new one.' });
      await assert.rejects(Api.auth.verifyMagicLink('invalid'), { _form: 'This link is invalid or has expired. Please request a new one.' });
      await assert.rejects(Api.auth.sendMagicLink('invalid'), error => typeof error._form === 'string');
      await assert.rejects(Api.passwords.update('invalid', password), { _form: 'This link is invalid or has expired. Please request a new one.' });
      assert.equal(globalThis.window.location, '/login?from=/admin');
    } finally {
      if (previousWindow === undefined) delete globalThis.window;
      else globalThis.window = previousWindow;
    }
  });

  await t.test('a magic email link establishes the browser session', async () => {
    const requested = await Api.auth.sendMagicLink('regular.user@test.com');
    assert.equal(requested.status, 200);
    assert.equal((await Api.users.me()).status, 204, 'Requesting a link must not sign the browser in');
    const token = await mailToken(nodemailerMock.mock);
    const login = await Api.auth.verifyMagicLink(token);
    assert.equal(login.data.email, 'regular.user@test.com');
    assert.equal((await Api.users.me()).data.id, login.data.id);
    await assert.rejects(Api.auth.verifyMagicLink(token), { _form: 'This link is invalid or has expired. Please request a new one.' });
    assert.equal((await Api.users.me()).data.id, login.data.id, 'A failed link must preserve an existing session');
  });

  await t.test('expired magic links show a useful error without signing in', async () => {
    await Api.auth.sendMagicLink('regular.user@test.com');
    const token = await mailToken(nodemailerMock.mock);
    await app.prisma.verification.updateMany({ data: { expiresAt: new Date(0) } });
    await assert.rejects(Api.auth.verifyMagicLink(token), { _form: 'This link is invalid or has expired. Please request a new one.' });
    assert.equal((await Api.users.me()).status, 204);
  });

  await t.test('magic-link requests keep account eligibility private', async () => {
    const known = await Api.auth.sendMagicLink('regular.user@test.com');
    await mailToken(nodemailerMock.mock);
    const sentCount = nodemailerMock.mock.getSentMail().length;
    const unknown = await Api.auth.sendMagicLink('unknown@example.com');
    assert.equal(unknown.status, known.status);
    assert.deepEqual(unknown.data, known.data);
    assert.equal(nodemailerMock.mock.getSentMail().length, sentCount);
    assert.equal(await app.prisma.user.count({ where: { email: 'unknown@example.com' } }), 0);
  });

  await t.test('magic-link request rate limits produce a useful form error', async () => {
    for (let attempt = 0; attempt < 5; attempt++) await Api.auth.sendMagicLink('unknown@example.com');
    await assert.rejects(Api.auth.sendMagicLink('unknown@example.com'), { _form: 'Too many attempts. Please try again in a few minutes.' });
  });

  await t.test('native browser magic-link callbacks retain their redirects', async () => {
    const response = await app.inject({
      url: '/api/auth/magic-link/verify?token=invalid&callbackURL=/&errorCallbackURL=/auth/magic-link',
      headers: { accept: 'text/html' },
    });
    assert.equal(response.statusCode, 302);
    assert.equal(response.headers.location, `${process.env.BASE_URL}/auth/magic-link?error=INVALID_TOKEN`);
    const explicitCallback = await app.inject({
      url: '/api/auth/magic-link/verify?token=invalid&callbackURL=/&errorCallbackURL=/auth/magic-link',
      headers: { accept: 'application/json' },
    });
    assert.equal(explicitCallback.statusCode, 302);
  });
});
