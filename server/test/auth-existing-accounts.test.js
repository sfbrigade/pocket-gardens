import assert from 'node:assert/strict';
import { test } from 'node:test';

import { build, mailToken, nodemailerMock, password } from '#test/helper.js';

test('existing accounts use email links without registering again', async (t) => {
  const app = await build(t);
  const { prisma } = app;

  await t.test('an unverified migrated admin retains their account, garden links, and role and can optionally add a password', async () => {
    const original = await prisma.user.findUnique({ where: { email: 'admin.user@test.com' } });
    await prisma.account.deleteMany({ where: { userId: original.id } });
    await prisma.user.update({
      where: { id: original.id },
      data: {
        emailVerified: false, legacyIsAdmin: false, legacyHashedPassword: 'unused-legacy-placeholder',
      }
    });
    const person = await prisma.person.update({ where: { airtableId: 'recPersonAlpha' }, data: { userId: original.id } });
    const plot = await prisma.plot.findUnique({ where: { airtableId: 'recPlotAlpha' } });
    await prisma.plotAssignedVolunteer.create({ data: { plotId: plot.id, personId: person.id } });
    const userCount = await prisma.user.count();
    process.env.VITE_FEATURE_REGISTRATION = 'false';
    const request = await app.inject().post('/api/auth/sign-in/magic-link')
      .payload({ email: original.email.toUpperCase() });
    assert.equal(request.statusCode, 200, request.body);
    const login = await app.inject(`/api/auth/magic-link/verify?token=${await mailToken(nodemailerMock.mock)}`);
    assert.equal(login.statusCode, 200, login.body);
    assert.equal(login.json().user.id, original.id);
    const headers = { authorization: `Bearer ${login.headers['set-auth-token']}` };
    const profile = await app.inject({ url: '/api/users/me', headers });
    assert.equal(profile.statusCode, 200, profile.body);
    assert.equal(profile.json().isAdmin, true, 'Access comes from Better Auth role, not retained legacy flags');
    assert.equal(profile.json().emailVerified, true);
    assert.equal(profile.json().firstName, original.firstName);
    assert.equal(profile.json().lastName, original.lastName);
    assert.doesNotMatch(profile.body, /legacy|unused-legacy-placeholder/);
    assert.deepEqual((await app.inject({ url: '/api/plots/capabilities', headers })).json(), { canCreatePlot: true, canAssignCarers: true });
    assert.equal(await prisma.user.count(), userCount);
    assert.equal(await prisma.account.count({ where: { userId: original.id } }), 0);
    assert.equal((await prisma.person.findUnique({ where: { id: person.id } })).userId, original.id);
    assert.ok(await prisma.plotAssignedVolunteer.findUnique({ where: { plotId_personId: { plotId: plot.id, personId: person.id } } }));

    const reset = await app.inject().post('/api/auth/request-password-reset').payload({ email: original.email });
    assert.equal(reset.statusCode, 200);
    const resetToken = await mailToken(nodemailerMock.mock);
    const saved = await app.inject().post('/api/auth/reset-password')
      .payload({ token: resetToken, newPassword: password });
    assert.equal(saved.statusCode, 200, saved.body);
    const passwordLogin = await app.inject().post('/api/auth/sign-in/email')
      .payload({ email: original.email, password });
    assert.equal(passwordLogin.statusCode, 200, passwordLogin.body);
    assert.equal(passwordLogin.json().user.id, original.id);
    const credentials = await prisma.account.findMany({ where: { userId: original.id } });
    await prisma.rateLimit.deleteMany();
    await app.inject().post('/api/auth/sign-in/magic-link').payload({ email: original.email });
    const secondLogin = await app.inject(`/api/auth/magic-link/verify?token=${await mailToken(nodemailerMock.mock)}`);
    assert.equal(secondLogin.statusCode, 200, secondLogin.body);
    assert.deepEqual(await prisma.account.findMany({ where: { userId: original.id } }), credentials);
    assert.equal(await prisma.user.count(), userCount);
  });
});
