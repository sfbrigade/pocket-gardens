import assert from 'node:assert/strict';
import { test } from 'node:test';

import { authenticate, build, upload } from '#test/helper.js';
import s3 from '#lib/s3.js';

test('plant directory search and plot plantings', async (t) => {
  const app = await build(t);
  const { prisma } = app;
  const headers = await authenticate(app, 'admin.user@test.com', 'test');
  const base = { Latitude: 37.77, Longitude: -122.43, 'Location Description': 'Second tree well', stage: 'active' };
  const create = (payload) => app.inject({ method: 'POST', url: '/api/plots', headers, payload: { ...base, ...payload } });
  const lavender = 'a2222222-2222-4222-8222-222222222222';

  await t.test('searches names and scientific names with typo tolerance across directory pages', async () => {
    await prisma.plant.createMany({
      data: Array.from({ length: 30 }, (_, index) => ({
        airtableId: `extra_${index}`,
        plantName: `Unrelated plant ${index}`,
        id: `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
      })),
    });
    for (const search of ['Lavender', 'English Lavender', 'Lavandula angustifolia', 'Lavendr']) {
      const response = await app.inject({ url: `/api/plants?search=${encodeURIComponent(search)}&pageSize=1` });
      assert.equal(response.statusCode, 200);
      assert.equal(response.json()[0].id, lavender, search);
    }
  });

  await t.test('ranks exact matches before fuzzy matches and paginates deterministically', async () => {
    const fuzzy = await prisma.plant.create({ data: { airtableId: 'fuzzy_lavender', plantName: 'Lavendr' } });
    const first = await app.inject({ url: '/api/plants?search=Lavender&pageSize=1' });
    assert.equal(first.json().length, 1);
    assert.equal(first.json()[0].id, lavender);
    assert.equal(first.headers['x-next-offset'], '1');
    const second = await app.inject({ url: '/api/plants?search=Lavender&pageSize=1&offset=1' });
    assert.equal(second.json()[0].id, fuzzy.id);
    const repeated = await app.inject({ url: '/api/plants?search=Lavender&pageSize=1' });
    assert.deepEqual(repeated.json(), first.json());
    assert.deepEqual((await app.inject({ url: '/api/plants?search=%25%27%3B%20DROP%20TABLE&pageSize=1' })).json(), []);
  });

  await t.test('stores directory links, creates explicit new plants and returns current entries', async () => {
    const response = await create({
      plants: [
        { plantId: lavender, quantity: 4, notes: 'By the gate' },
        { newPlant: { plantName: 'Yarrow', latinName: 'Achillea millefolium' }, quantity: 2 },
      ]
    });
    assert.equal(response.statusCode, 201);
    const plot = response.json();
    assert.equal(plot.plants.length, 2);
    assert.ok(plot.plants.every(({ state }) => state === 'current'));
    const existing = plot.plants.find(({ plantId }) => plantId === lavender);
    assert.equal(existing.quantity, 4);
    assert.equal(existing.notes, 'By the gate');
    assert.equal(existing.plantName, 'Lavender');
    const added = plot.plants.find(({ plantId }) => plantId !== lavender);
    assert.equal(added.plantName, 'Yarrow');
    assert.equal((await prisma.plant.findUnique({ where: { id: added.plantId } })).latinName, 'Achillea millefolium');
    assert.deepEqual((await app.inject({ url: `/api/plots/${plot.id}` })).json(), plot);
    assert.equal((await app.inject({ url: '/api/plots' })).json().find(({ id }) => id === plot.id).plants, undefined);
    assert.equal(await prisma.maintenanceRecordPlant.count(), 2);
  });

  await t.test('preparing gardens store planned plants', async () => {
    const response = await create({ stage: 'preparing', plants: [{ plantId: lavender, quantity: 0 }] });
    assert.equal(response.statusCode, 201);
    assert.equal(response.json().plants[0].state, 'planned');
    assert.equal(response.json().plants[0].quantity, 0);
  });

  await t.test('accepts the largest quantity supported by the database', async () => {
    const response = await create({ plants: [{ plantId: lavender, quantity: 2147483647 }] });
    assert.equal(response.statusCode, 201);
    assert.equal(response.json().plants[0].quantity, 2147483647);
  });

  await t.test('rejects invalid or duplicate selections without creating plot or directory entries', async () => {
    const plots = await prisma.plot.count();
    const plants = await prisma.plant.count();
    for (const payload of [
      { stage: 'potential', plants: [{ plantId: lavender }] },
      { plants: [{ plantId: lavender }, { plantId: lavender }] },
      { plants: [{ notes: 'No selected plant' }] },
      { plants: [{ plantId: lavender, newPlant: { plantName: 'Yarrow' } }] },
      { plants: [{ plantId: lavender, quantity: -1 }] },
      { plants: [{ plantId: lavender, quantity: 1.5 }] },
      { plants: [{ plantId: lavender, quantity: 2147483648 }] },
      { plants: [{ newPlant: { plantName: ' ' } }] },
      { plants: [{ newPlant: { plantName: 'Yarrow' } }, { plantId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' }] },
    ]) {
      const response = await create(payload);
      assert.equal(response.statusCode, 422, JSON.stringify(payload));
      assert.ok(response.json().errors.length);
    }
    assert.equal(await prisma.plot.count(), plots);
    assert.equal(await prisma.plant.count(), plants);
  });

  await t.test('rolls back a new directory plant when a later photo attachment fails', async (t) => {
    const plots = await prisma.plot.count();
    const plants = await prisma.plant.count();
    await upload([['640x480.jpg', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.jpg']]);
    t.mock.method(s3, 'copyObject', async () => { throw new Error('Simulated storage failure'); });
    t.mock.method(console, 'error', () => {});
    const response = await create({
      plants: [{ newPlant: { plantName: 'Yarrow' } }],
      Photos: ['aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.jpg'],
    });
    assert.equal(response.statusCode, 500);
    assert.equal(await prisma.plot.count(), plots);
    assert.equal(await prisma.plant.count(), plants);
    assert.equal(await prisma.plotPlant.count(), 0);
  });
});
