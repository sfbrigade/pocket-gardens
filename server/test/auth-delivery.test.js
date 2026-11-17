import { test } from 'node:test';
import assert from 'node:assert/strict';
import mailer from '#lib/mailer.js';
import { build, mailToken, nodemailerMock, password, waitForMail } from '#test/helper.js';

test('Better Auth email delivery policy', async (t) => {
  const app = await build(t);
  const { auth, prisma } = app;
  const mail = nodemailerMock.mock;
  const post = (path, payload) => app.inject().post(`/api/auth${path}`)
    .headers({ origin: process.env.BASE_URL }).payload(payload);
  const { logger } = await auth.$context;
  const email = 'delivery@example.com';
  const verifiedEmail = 'verified@example.com';

  async function createUser (address, emailVerified = false) {
    const { user } = await auth.api.createUser({
      body: { name: 'Test Person', email: address, password, data: { firstName: 'Test', lastName: 'Person' } },
    });
    if (emailVerified) await prisma.user.update({ where: { id: user.id }, data: { emailVerified } });
  }

  for (const [path, api, action] of [
    ['/request-password-reset', 'requestPasswordReset', 'reset-password'],
    ['/send-verification-email', 'sendVerificationEmail', 'verify-email'],
    ['/sign-in/magic-link', 'signInMagicLink', 'magic-link'],
  ]) {
    await t.test(`${path} responds before SMTP completes and delivers a usable link`, async (t) => {
      await createUser(email, action !== 'verify-email');
      await createUser(verifiedEmail, true);
      const gate = Promise.withResolvers();
      const send = mailer.send;
      let started = false;
      const sending = t.mock.method(mailer, 'send', async (options) => {
        started = true;
        await gate.promise;
        return send(options);
      });
      let eligible;
      const request = post(path, { email }).then(response => { eligible = response; });
      try {
        await t.waitFor(() => assert.ok(started), { timeout: 5000 });
        const unknown = await post(path, { email: 'unknown@example.com' });
        await t.waitFor(() => assert.ok(eligible), { timeout: 5000 });
        assert.equal(eligible.statusCode, 200, eligible.body);
        assert.equal(unknown.statusCode, eligible.statusCode);
        assert.deepEqual(unknown.json(), eligible.json());
        assert.equal(mail.getSentMail().length, 0);
        if (action === 'verify-email') {
          const verified = await post(path, { email: verifiedEmail });
          assert.equal(verified.statusCode, eligible.statusCode);
          assert.deepEqual(verified.json(), eligible.json());
        }
      } finally {
        gate.resolve();
        await request;
        // The held mock starts the real tracked delivery only after release.
        await t.waitFor(() => assert.equal(mail.getSentMail().length, 1), { timeout: 5000 });
        await waitForMail();
        sending.mock.restore();
      }
      const token = await mailToken(mail);
      const link = new URL(mail.getSentMail()[0].text.match(/http[^\s]+/)[0]);
      assert.equal(link.origin, new URL(process.env.AUTH_LINK_BASE_URL || process.env.BASE_URL).origin);
      assert.equal(link.pathname, `/api/auth/links/${action}`);
      assert.equal(link.searchParams.get('token'), token);
      assert.equal((await app.inject(`${link.pathname}${link.search}`)).statusCode, 200);
      const redeemed = action === 'reset-password'
        ? await post('/reset-password', { token, newPassword: `${password}Changed` })
        : await app.inject(`/api/auth/${action === 'magic-link' ? 'magic-link/verify' : 'verify-email'}?token=${encodeURIComponent(token)}`);
      assert.equal(redeemed.statusCode, 200, redeemed.body);
      if (action === 'reset-password') {
        assert.equal((await post('/sign-in/email', { email, password: `${password}Changed` })).statusCode, 200);
      }
    });

    for (const smtpEnabled of [false, true]) {
      await t.test(`${path} hides ${smtpEnabled ? 'delivery failures' : 'disabled SMTP'}`, async (t) => {
        await createUser(email, action !== 'verify-email');
        await createUser(verifiedEmail, true);
        const warnings = t.mock.method(logger, 'warn', () => {});
        t.mock.method(mailer, 'send', async () => {
          throw new Error(`Transport failed for ${email} with secret-token`);
        });
        process.env.SMTP_ENABLED = String(smtpEnabled);
        try {
          const eligible = await post(path, { email });
          assert.equal(eligible.statusCode, 200, eligible.body);
          const addresses = ['unknown@example.com', ...(action === 'verify-email' ? [verifiedEmail] : [])];
          for (const address of addresses) {
            const response = await post(path, { email: address });
            assert.equal(response.statusCode, eligible.statusCode);
            assert.deepEqual(response.json(), eligible.json());
          }
          await t.waitFor(() => assert.ok(warnings.mock.calls.some(call => call.arguments[0] === 'Authentication email delivery failed.')));
          const messages = warnings.mock.calls.map(call => call.arguments);
          assert.equal(messages.filter(args => args[0] === 'Authentication email delivery failed.').length, 1);
          assert.doesNotMatch(JSON.stringify(messages), /delivery@example|secret-token|Transport failed/);
          if (action === 'verify-email') {
            await assert.rejects(auth.api.sendVerificationEmail({ body: { email } }), { statusCode: 503 });
          }
        } finally {
          process.env.SMTP_ENABLED = 'true';
        }
      });
    }

    await t.test(`${api} without an HTTP request awaits delivery and preserves failure behavior`, async (t) => {
      await createUser(email, action !== 'verify-email');
      const gate = Promise.withResolvers();
      let started = false;
      let settled = false;
      t.mock.method(mailer, 'send', async () => {
        started = true;
        await gate.promise;
        throw new Error(`Transport failed for ${email} with secret-token`);
      });
      const errors = t.mock.method(logger, 'error', () => {});
      const warnings = t.mock.method(logger, 'warn', () => {});
      const request = auth.api[api]({ body: { email }, headers: new Headers() }).then(
        value => ({ value }), error => ({ error })
      ).finally(() => { settled = true; });
      try {
        await t.waitFor(() => assert.ok(started));
        assert.equal(settled, false);
      } finally {
        gate.resolve();
      }
      const result = await request;
      if (action === 'verify-email') assert.equal(result.error?.statusCode, 503);
      else assert.equal(result.value?.status, true, JSON.stringify(result));
      assert.doesNotMatch(JSON.stringify([...errors.mock.calls, ...warnings.mock.calls].map(call => call.arguments)), /delivery@example|secret-token|Transport failed/);
    });
  }
});
