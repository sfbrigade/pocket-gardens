import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { test } from 'node:test';
import { authenticate, build } from '#test/helper.js';

const regularId = 'dab5dff3-360d-4dbb-98dd-1990dfb5c4c5';
const anotherId = 'aa1fdcf6-a63c-454e-9775-2d6fd116fdb1';
const deactivatedId = '33409349-ebd1-4c04-af14-46959188b819';
const validPlot = { Latitude: 37.77, Longitude: -122.43, 'Location Description': 'Second tree well' };

test('registered carer selection and plot assignments', async (t) => {
  const app = await build(t);
  const { prisma } = app;

  await t.test('staff search active users by full name or email and can page through matches', async () => {
    const headers = await authenticate(app, 'admin.user@test.com', 'test');
    const response = await app.inject({ url: '/api/plots/carers?pageSize=1', headers });
    assert.equal(response.statusCode, 200);
    assert.equal(response.json().length, 1);
    assert.equal(response.headers['x-next-offset'], '1');
    const next = await app.inject({ url: '/api/plots/carers?pageSize=1&offset=1', headers });
    assert.notEqual(next.json()[0].id, response.json()[0].id);
    for (const search of ['regular user', 'REGULAR.USER@TEST.COM']) {
      const found = await app.inject({ url: `/api/plots/carers?search=${encodeURIComponent(search)}`, headers });
      assert.deepEqual(found.json(), [{ id: regularId, displayName: 'Regular User', email: 'regular.user@test.com' }]);
    }
    const unavailable = await app.inject({ url: '/api/plots/carers?search=Deactivated', headers });
    assert.deepEqual(unavailable.json(), []);
    for (const query of ['pageSize=0', 'offset=-1', 'pageSize=1.5']) {
      assert.equal((await app.inject({ url: `/api/plots/carers?${query}`, headers })).statusCode, 422);
    }
    const all = (await app.inject({ url: '/api/plots/carers', headers })).json();
    assert.ok(all.every((user) => Object.keys(user).sort().join() === 'displayName,email,id'));
  });

  await t.test('only active administrators can search carers', async () => {
    assert.equal((await app.inject({ url: '/api/plots/carers' })).statusCode, 401);
    const member = await authenticate(app, 'regular.user@test.com', 'test');
    assert.equal((await app.inject({ url: '/api/plots/carers', headers: member })).statusCode, 403);
    const admin = await authenticate(app, 'admin.user@test.com', 'test');
    await prisma.user.update({ where: { email: 'admin.user@test.com' }, data: { banned: true } });
    assert.equal((await app.inject({ url: '/api/plots/carers', headers: admin })).statusCode, 403);
  });

  await t.test('multiple carers save atomically and retries return the same assignments', async () => {
    const headers = await authenticate(app, 'admin.user@test.com', 'test');
    const payload = { ...validPlot, submissionId: crypto.randomUUID(), carerUserIds: [regularId, anotherId] };
    const created = await app.inject({ method: 'POST', url: '/api/plots', headers, payload });
    assert.equal(created.statusCode, 201, created.body);
    assert.deepEqual(created.json().assignedVolunteers.map(({ displayName }) => displayName).sort(), ['Another User', 'Regular User']);
    assert.ok(!created.body.includes('regular.user@test.com'));
    const replay = await app.inject({ method: 'POST', url: '/api/plots', headers, payload: { ...payload, carerUserIds: [anotherId, regularId] } });
    assert.equal(replay.statusCode, 200, replay.body);
    assert.deepEqual(replay.json(), created.json());
    assert.equal(await prisma.person.count({ where: { userId: { in: payload.carerUserIds } } }), 2);
    const saved = await prisma.plot.findUnique({ where: { submissionId: payload.submissionId } });
    assert.equal(await prisma.plotAssignedVolunteer.count({ where: { plotId: saved.id } }), 2);
    const changed = await app.inject({ method: 'POST', url: '/api/plots', headers, payload: { ...payload, carerUserIds: [regularId] } });
    assert.equal(changed.statusCode, 409);
    const detail = await app.inject({ url: `/api/plots/${created.json().id}` });
    assert.deepEqual(detail.json().assignedVolunteers, created.json().assignedVolunteers);
    await prisma.user.update({ where: { id: regularId }, data: { banned: true } });
    assert.equal((await app.inject({ method: 'POST', url: '/api/plots', headers, payload })).statusCode, 200, 'a completed save can still be recovered after a carer is deactivated');
  });

  await t.test('unverified users cannot be selected as new carers', async () => {
    const headers = await authenticate(app, 'admin.user@test.com', 'test');
    await prisma.user.update({ where: { id: regularId }, data: { emailVerified: false } });
    const response = await app.inject({ url: '/api/plots/carers?search=regular', headers });
    assert.deepEqual(response.json(), []);
    const before = await prisma.plot.count();
    const save = await app.inject({ method: 'POST', url: '/api/plots', headers, payload: { ...validPlot, carerUserIds: [regularId] } });
    assert.equal(save.statusCode, 422, save.body);
    assert.equal(await prisma.plot.count(), before);
  });

  await t.test('unavailable, malformed, duplicate and names-only carers insert nothing', async () => {
    const headers = await authenticate(app, 'admin.user@test.com', 'test');
    const before = { plots: await prisma.plot.count(), people: await prisma.person.count() };
    for (const fields of [
      { carerUserIds: [regularId, crypto.randomUUID()] },
      { carerUserIds: [regularId, deactivatedId] },
      { carerUserIds: [regularId, regularId] },
      { carerUserIds: ['not-a-user-id'] },
      { carerNames: ['Regular User'] },
    ]) {
      const response = await app.inject({ method: 'POST', url: '/api/plots', headers, payload: { ...validPlot, ...fields } });
      assert.equal(response.statusCode, 422, response.body);
    }
    assert.equal(await prisma.plot.count(), before.plots);
    assert.equal(await prisma.person.count(), before.people);
  });

  await t.test('existing volunteer links and history are preserved without inferring identity', async () => {
    const headers = await authenticate(app, 'admin.user@test.com', 'test');
    const person = await prisma.person.findUnique({ where: { airtableId: 'recPersonAlpha' } });
    const originalPlot = await prisma.plot.findUnique({ where: { airtableId: 'recPlotAlpha' } });
    await prisma.person.update({ where: { id: person.id }, data: { userId: regularId } });
    await prisma.plotAssignedVolunteer.create({ data: { personId: person.id, plotId: originalPlot.id } });
    // An unlinked imported record with a matching name is never claimed.
    await prisma.person.create({ data: { airtableId: 'recUnlinkedSameName', name: 'Another User', email: 'another.user@test.com' } });
    const before = await prisma.person.count();
    const response = await app.inject({ method: 'POST', url: '/api/plots', headers, payload: { ...validPlot, carerUserIds: [regularId, anotherId] } });
    assert.equal(response.statusCode, 201, response.body);
    assert.ok(response.json().assignedVolunteers.some(({ id, displayName }) => id === person.id && displayName === 'Regular User'));
    assert.equal(await prisma.person.count(), before + 1);
    assert.ok(await prisma.plotAssignedVolunteer.findUnique({ where: { plotId_personId: { plotId: originalPlot.id, personId: person.id } } }));
    assert.equal((await prisma.person.findUnique({ where: { airtableId: 'recUnlinkedSameName' } })).userId, null);
  });

  await t.test('concurrent plots reuse one volunteer record per registered account', async () => {
    const headers = await authenticate(app, 'admin.user@test.com', 'test');
    const responses = await Promise.all([[regularId, anotherId], [anotherId, regularId]].map((carerUserIds) => app.inject({
      method: 'POST',
      url: '/api/plots',
      headers,
      payload: { ...validPlot, submissionId: crypto.randomUUID(), carerUserIds },
    })));
    assert.ok(responses.every((response) => response.statusCode === 201), responses.map((response) => response.body).join('\n'));
    for (const userId of [regularId, anotherId]) {
      const person = await prisma.person.findUnique({ where: { userId } });
      assert.equal(await prisma.plotAssignedVolunteer.count({ where: { personId: person.id } }), 2);
    }
  });

  await t.test('anonymous development creation never grants carer assignment', async () => {
    const previous = { NODE_ENV: process.env.NODE_ENV, ALLOW_ANONYMOUS_PLOT_SUBMISSION: process.env.ALLOW_ANONYMOUS_PLOT_SUBMISSION };
    try {
      process.env.NODE_ENV = 'development';
      process.env.ALLOW_ANONYMOUS_PLOT_SUBMISSION = 'true';
      assert.deepEqual((await app.inject({ url: '/api/plots/capabilities' })).json(), { canCreatePlot: true, canAssignCarers: false });
      assert.equal((await app.inject({ method: 'POST', url: '/api/plots', payload: { ...validPlot, carerUserIds: [regularId] } })).statusCode, 401);
      const headers = await authenticate(app, 'regular.user@test.com', 'test');
      assert.equal((await app.inject({ method: 'POST', url: '/api/plots', headers, payload: { ...validPlot, carerUserIds: [regularId] } })).statusCode, 403);
      assert.equal((await app.inject({ method: 'POST', url: '/api/plots', payload: { ...validPlot, carerUserIds: [] } })).statusCode, 201);
      assert.equal(await prisma.person.count({ where: { userId: { not: null } } }), 0);
    } finally {
      for (const [key, value] of Object.entries(previous)) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    }
  });
});
