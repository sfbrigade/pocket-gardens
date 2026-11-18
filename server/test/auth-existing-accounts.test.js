import assert from 'node:assert/strict';
import { test } from 'node:test';

import { cookieHeaders, build, mailToken, nodemailerMock, password } from '#test/helper.js';
import { createPlotDraft, plotPayload } from '../../client/src/Plots/plot-form.js';

test('existing accounts use email links without registering again', async (t) => {
  const app = await build(t);
  const { prisma } = app;

  for (const [email, canCreatePlot] of [['admin.user@test.com', true], ['regular.user@test.com', false]]) {
    await t.test(`an existing ${canCreatePlot ? 'administrator can' : 'regular user cannot'} submit a plot after browser-style email login`, async () => {
      const original = await prisma.user.findUnique({ where: { email } });
      await prisma.account.deleteMany({ where: { userId: original.id } });
      await prisma.user.update({ where: { id: original.id }, data: { emailVerified: false } });
      process.env.VITE_FEATURE_REGISTRATION = 'false';
      const userCount = await prisma.user.count();
      const plotCount = await prisma.plot.count();
      // Build the same payload as the browser's Create garden form.
      const payload = plotPayload({
        ...createPlotDraft(),
        position: { latitude: 37.77, longitude: -122.43 },
        locator: 'Second tree well beside the blue gate',
        name: 'Existing account garden',
      });
      assert.equal((await app.inject({ method: 'POST', url: '/api/plots', payload })).statusCode, 401);
      const requested = await app.inject().post('/api/auth/sign-in/magic-link')
        .headers({ origin: process.env.BASE_URL }).payload({ email: email.toUpperCase() });
      assert.equal(requested.statusCode, 200, requested.body);
      assert.equal((await app.inject('/api/users/me')).statusCode, 204, 'Requesting mail must not sign in');
      const from = '/plots/new?entry=existing-account#location';
      const token = await mailToken(nodemailerMock.mock);
      const login = await app.inject({
        url: `/api/auth/magic-link/verify?${new URLSearchParams({ token, callbackURL: from, errorCallbackURL: '/auth/magic-link' })}`,
        headers: { accept: 'text/html' },
      });
      assert.equal(login.statusCode, 302, login.body);
      assert.equal(login.headers.location, `${process.env.BASE_URL}${from}`);
      const headers = cookieHeaders(login);
      assert.ok(headers.cookie);
      // Separate reads model subsequent page loads using the persisted cookie.
      assert.equal((await app.inject({ url: '/api/auth/get-session', headers })).json().user.id, original.id);
      const profile = await app.inject({ url: '/api/users/me', headers });
      assert.equal(profile.statusCode, 200, profile.body);
      assert.equal(profile.json().id, original.id);
      assert.equal(profile.json().emailVerified, true);
      assert.equal(profile.json().isAdmin, canCreatePlot);
      assert.deepEqual((await app.inject({ url: '/api/plots/capabilities', headers })).json(), {
        canCreatePlot, canAssignCarers: canCreatePlot,
      });
      const saved = await app.inject({ method: 'POST', url: '/api/plots', headers, payload });
      assert.equal(saved.statusCode, canCreatePlot ? 201 : 403, saved.body);
      assert.equal(await prisma.plot.count(), plotCount + Number(canCreatePlot));
      if (canCreatePlot) {
        const plot = await prisma.plot.findUnique({ where: { submissionId: payload.submissionId } });
        assert.equal(plot.airtableId, saved.json().id);
        assert.equal(plot.name, payload['Pocket Garden Name']);
        assert.equal(plot.latitude, payload.Latitude);
        assert.equal(plot.longitude, payload.Longitude);
      }
      assert.equal(await prisma.user.count(), userCount, 'Existing accounts must not re-register');
      assert.equal(await prisma.account.count({ where: { userId: original.id } }), 0, 'No password is required');
      assert.equal((await app.inject().post('/api/auth/sign-out')
        .headers({ origin: process.env.BASE_URL, ...headers }).payload({})).statusCode, 200);
      assert.equal((await app.inject({ method: 'POST', url: '/api/plots', headers, payload })).statusCode, 401);
    });
  }

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
    const headers = cookieHeaders(login);
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
