import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { build, mailToken, nodemailerMock, password, waitForMail } from '#test/helper.js';
import { createAuth } from '#lib/auth.js';
import mailer, { configureMailer } from '#lib/mailer.js';

test('verification email delivery', async (t) => {
  const app = await build(t);
  const { prisma } = app;
  const mail = nodemailerMock.mock;

  await t.test('public verification resends hide mail failures while server calls still fail', async () => {
    const email = 'pending@example.com';
    assert.equal((await app.inject().post('/api/auth/sign-up/email')
      .headers({ origin: process.env.BASE_URL })
      .payload({ firstName: 'Pending', lastName: 'Person', email, password })).statusCode, 200);
    await waitForMail();
    const { logger } = await app.auth.$context;
    const warnings = t.mock.method(logger, 'warn', () => {});
    const sending = t.mock.method(mailer, 'send', async () => {
      throw new Error(`Transport failed for ${email} with secret-token`);
    });
    try {
      for (const enabled of [false, true]) {
        process.env.SMTP_ENABLED = String(enabled);
        for (const address of [email, 'unknown@example.com', 'regular.user@test.com']) {
          await prisma.rateLimit.deleteMany();
          const response = await app.inject().post('/api/auth/send-verification-email')
            .headers({ origin: process.env.BASE_URL }).payload({ email: address });
          assert.equal(response.statusCode, 200, response.body);
          assert.deepEqual(response.json(), { status: true });
        }
        await assert.rejects(app.auth.api.sendVerificationEmail({ body: { email } }), { statusCode: 503 });
      }
      assert.deepEqual(warnings.mock.calls.map(call => call.arguments), [
        ['Authentication email delivery failed.'],
        ['Authentication email delivery failed.'],
      ]);
    } finally {
      sending.mock.restore();
      warnings.mock.restore();
      process.env.SMTP_ENABLED = 'true';
    }
  });

  for (const [name, relativePath] of [['repository root', '../../'], ['server directory', '../']]) {
    await t.test(`renders and verifies when invoked from the ${name}`, async () => {
      const cwd = process.cwd();
      const previousLinkOrigin = process.env.AUTH_LINK_BASE_URL;
      const linkOrigin = name === 'server directory' ? 'https://links.example.com' : process.env.BASE_URL;
      try {
        process.env.AUTH_LINK_BASE_URL = linkOrigin;
        process.chdir(fileURLToPath(new URL(relativePath, import.meta.url)));
        configureMailer(nodemailerMock);
        const auth = createAuth(prisma);
        const email = 'first-admin@example.com';
        const { user } = await auth.api.createUser({
          body: { name: 'First Admin', email, password, role: 'admin', data: { firstName: 'First', lastName: 'Admin' } },
        });
        await auth.api.sendVerificationEmail({ body: { email } });
        assert.equal(mail.getSentMail().length, 1);
        const message = mail.getSentMail()[0];
        assert.equal(message.to, email);
        assert.match(message.subject, /^Verify your .* email/);
        const token = await mailToken(mail);
        assert.ok(token);
        for (const body of [message.html, message.text]) {
          assert.ok(body.includes('Hello First,'));
          assert.ok(body.includes(`${linkOrigin}/api/auth/links/verify-email?token=${encodeURIComponent(token)}`));
        }
        assert.equal((await app.inject(`/api/auth/verify-email?token=${token}`)).statusCode, 200);
        const verified = await prisma.user.findUnique({ where: { id: user.id } });
        assert.equal(verified.emailVerified, true);
        assert.equal(verified.role, 'admin');
      } finally {
        if (previousLinkOrigin === undefined) delete process.env.AUTH_LINK_BASE_URL;
        else process.env.AUTH_LINK_BASE_URL = previousLinkOrigin;
        process.chdir(cwd);
        configureMailer(nodemailerMock);
      }
    });
  }
});
