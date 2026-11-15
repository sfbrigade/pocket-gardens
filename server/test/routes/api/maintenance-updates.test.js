import { test } from 'node:test';
import assert from 'node:assert/strict';
import { authenticate, build } from '#test/helper.js';

const plotId = '11111111-1111-4111-8111-111111111111';
const draft = (extra = {}) => ({ submissionId: crypto.randomUUID(), plotId: 'recPlotAlpha', date: '2026-09-02', notes: 'A quiet visit', ...extra });

test('maintenance update workflows', async (t) => {
  const app = await build(t);
  let headers;
  t.beforeEach(async () => { headers = await authenticate(app, 'admin.user@test.com', 'test'); });
  const create = (payload) => app.inject({ method: 'POST', url: '/api/maintenance-records', headers, payload });

  await t.test('each kind of contribution is valid independently and credits the administrator', async () => {
    for (const content of [{ notes: 'Visit note' }, { activity: ['Watered'] }, { observations: ['Nothing stood out'] }]) {
      const response = await create(draft({ notes: undefined, ...content }));
      assert.equal(response.statusCode, 201, response.payload);
      const saved = response.json();
      assert.equal(saved.credit, 'Pocket Gardens team');
      assert.equal(saved.createdById, undefined);
    }
  });

  await t.test('repeated and concurrent creates recover one record, while changed reuse conflicts', async () => {
    const payload = draft();
    const responses = await Promise.all([create(payload), create(payload)]);
    assert.deepEqual(responses.map(({ statusCode }) => statusCode).sort(), [200, 201]);
    assert.equal(responses[0].json().id, responses[1].json().id);
    assert.equal(await app.prisma.maintenanceRecord.count({ where: { submissionId: payload.submissionId } }), 1);
    assert.equal((await create({ ...payload, notes: 'Different' })).statusCode, 409);
    assert.equal((await create(draft())).statusCode, 201);
  });

  await t.test('validates quiet observation exclusivity, blank notes, future dates and untrusted identity', async () => {
    for (const changes of [
      { observations: ['Nothing stood out', 'Plants look dry'] },
      { notes: '   ' }, { date: '2999-01-01' }, { volunteerId: 'b1111111-1111-4111-8111-111111111111' },
    ]) assert.equal((await create(draft(changes))).statusCode, 422);
  });

  await t.test('stage restrictions apply to new visits, but not already-committed replays', async () => {
    const payload = draft();
    assert.equal((await create(payload)).statusCode, 201);
    await app.prisma.plot.update({ where: { id: plotId }, data: { stage: 'archived' } });
    assert.equal((await create(payload)).statusCode, 200);
    assert.equal((await create(draft())).statusCode, 422);
    await app.prisma.plot.update({ where: { id: plotId }, data: { stage: 'paused' } });
    assert.equal((await create(draft({ activity: ['Watered'] }))).statusCode, 422);
    assert.equal((await create(draft())).statusCode, 201);
  });
});
