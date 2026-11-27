import { test } from 'node:test';
import * as assert from 'node:assert';
import { StatusCodes } from 'http-status-codes';
import path from 'path';

import { assetExists, authenticate, build, upload, verifiedUser } from '#test/helper.js';

test('/api/plots', async (t) => {
  const app = await build(t);
  const { prisma } = app;
  const previousAnonymousSetting = process.env.ALLOW_ANONYMOUS_PLOT_SUBMISSION;
  process.env.ALLOW_ANONYMOUS_PLOT_SUBMISSION = 'false';
  t.after(() => {
    if (previousAnonymousSetting === undefined) delete process.env.ALLOW_ANONYMOUS_PLOT_SUBMISSION;
    else process.env.ALLOW_ANONYMOUS_PLOT_SUBMISSION = previousAnonymousSetting;
  });
  const validPlot = {
    Latitude: 37.77,
    Longitude: -122.43,
    'Location Description': 'East sidewalk, second tree well beside the blue gate',
  };

  await t.test('GET / returns plots and supports viewport filtering', async () => {
    const response = await app.inject({
      url: '/api/plots?north=37.82&south=37.75&east=-122.38&west=-122.45',
    });
    assert.strictEqual(response.statusCode, StatusCodes.OK);
    const data = JSON.parse(response.payload);
    assert.strictEqual(data.length, 2);
    assert.ok(data.every((p) => p.Latitude >= 37.75 && p.Latitude <= 37.82));
    assert.ok(data.some((p) => p.id === 'recPlotAlpha'));
    assert.ok(!data.some((p) => p.id === 'recPlotOutside'));
  });

  await t.test('GET / without viewport returns all plots', async () => {
    const response = await app.inject({ url: '/api/plots' });
    assert.strictEqual(response.statusCode, StatusCodes.OK);
    const data = JSON.parse(response.payload);
    assert.strictEqual(data.length, 3);
    assert.strictEqual(data[0].id, 'recPlotAlpha');
  });

  await t.test('GET / rejects partial viewport params', async () => {
    const response = await app.inject({
      url: '/api/plots?north=37.82&south=37.75',
    });
    assert.strictEqual(response.statusCode, StatusCodes.UNPROCESSABLE_ENTITY);
  });

  await t.test('GET / rejects north less than south', async () => {
    const response = await app.inject({
      url: '/api/plots?north=37.75&south=37.82&east=-122.38&west=-122.45',
    });
    assert.strictEqual(response.statusCode, StatusCodes.UNPROCESSABLE_ENTITY);
  });

  await t.test('GET / paginates with X-Next-Offset', async () => {
    const response = await app.inject({
      url: '/api/plots?pageSize=1',
    });
    assert.strictEqual(response.statusCode, StatusCodes.OK);
    const data = JSON.parse(response.payload);
    assert.strictEqual(data.length, 1);
    assert.ok(response.headers['x-next-offset']);

    const page2 = await app.inject({
      url: `/api/plots?pageSize=1&offset=${response.headers['x-next-offset']}`,
    });
    const data2 = JSON.parse(page2.payload);
    assert.strictEqual(data2.length, 1);
    assert.notStrictEqual(data2[0].id, data[0].id);
  });

  await t.test('GET / rejects invalid pagination', async () => {
    for (const query of ['pageSize=1.5', 'pageSize=-1', 'offset=-1', 'offset=nope']) {
      const response = await app.inject({ url: `/api/plots?${query}` });
      assert.strictEqual(response.statusCode, StatusCodes.UNPROCESSABLE_ENTITY);
      assert.ok(JSON.parse(response.payload).errors.length > 0);
    }
  });

  await t.test('GET /:id returns a plot by airtable id', async () => {
    const plot = await prisma.plot.findUnique({ where: { airtableId: 'recPlotAlpha' } });
    const photo = await prisma.plotPhoto.create({
      data: {
        plotId: plot.id,
        file: 'a.jpg',
        position: 0,
      },
    });
    const response = await app.inject({ url: '/api/plots/recPlotAlpha' });
    assert.strictEqual(response.statusCode, StatusCodes.OK);
    const data = JSON.parse(response.payload);
    assert.strictEqual(data.id, 'recPlotAlpha');
    assert.strictEqual(data.stage, 'active');
    assert.strictEqual(data.Latitude, 37.78);
    assert.strictEqual(data.Photo, undefined);
    assert.deepStrictEqual(data.Photos, [
      `/api/assets/plot_photos/${photo.id}/file/a.jpg`,
    ]);
  });

  await t.test('GET /:id returns 404 when missing', async () => {
    const response = await app.inject({ url: '/api/plots/recMissing' });
    assert.strictEqual(response.statusCode, StatusCodes.NOT_FOUND);
  });

  await t.test('GET /:id returns 404 for non-UUID 36-char strings', async () => {
    const response = await app.inject({
      url: '/api/plots/xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx',
    });
    assert.strictEqual(response.statusCode, StatusCodes.NOT_FOUND);
  });

  await t.test('GET /:id returns a plot by internal UUID', async () => {
    const row = await prisma.plot.findUnique({ where: { airtableId: 'recPlotAlpha' } });
    const response = await app.inject({ url: `/api/plots/${row.id}` });
    assert.strictEqual(response.statusCode, StatusCodes.OK);
    const data = JSON.parse(response.payload);
    assert.strictEqual(data.id, 'recPlotAlpha');
  });

  await t.test('POST / creates a plot', async () => {
    const headers = await authenticate(app, 'admin.user@test.com', 'test');
    const response = await app.inject({
      method: 'POST',
      url: '/api/plots',
      headers,
      payload: {
        ...validPlot,
        stage: 'active',
        'Bed Type': 'Tree Well',
        'Map Coordinates': '37.77, -122.43',
      },
    });
    assert.strictEqual(response.statusCode, StatusCodes.CREATED);
    const data = JSON.parse(response.payload);
    assert.ok(data.id.startsWith('pg_'));
    assert.strictEqual(data.Latitude, 37.77);
    assert.strictEqual(data.Longitude, -122.43);

    const row = await prisma.plot.findUnique({ where: { airtableId: data.id } });
    assert.ok(row);
    assert.strictEqual(row.latitude, 37.77);
  });

  await t.test('PATCH /:id updates a plot', async () => {
    const headers = await authenticate(app, 'admin.user@test.com', 'test');
    const response = await app.inject({
      method: 'PATCH',
      url: '/api/plots/recPlotBeta',
      headers,
      payload: {
        stage: 'active',
        Latitude: 37.761,
        Longitude: -122.441,
      },
    });
    assert.strictEqual(response.statusCode, StatusCodes.OK);
    const data = JSON.parse(response.payload);
    assert.strictEqual(data.id, 'recPlotBeta');
    assert.strictEqual(data.stage, 'active');
    assert.strictEqual(data.Latitude, 37.761);

    const row = await prisma.plot.findUnique({ where: { airtableId: 'recPlotBeta' } });
    assert.strictEqual(row.stage, 'active');
    assert.strictEqual(row.latitude, 37.761);
  });

  await t.test('PATCH /:id does not clear lat/lng on bad Map Coordinates', async () => {
    const headers = await authenticate(app, 'admin.user@test.com', 'test');
    const before = await prisma.plot.findUnique({ where: { airtableId: 'recPlotAlpha' } });
    const response = await app.inject({
      method: 'PATCH',
      url: '/api/plots/recPlotAlpha',
      headers,
      payload: {
        'Map Coordinates': 'garbage',
      },
    });
    assert.strictEqual(response.statusCode, StatusCodes.OK);
    const data = JSON.parse(response.payload);
    assert.strictEqual(data['Map Coordinates'], 'garbage');
    assert.strictEqual(data.Latitude, before.latitude);
    assert.strictEqual(data.Longitude, before.longitude);

    const after = await prisma.plot.findUnique({ where: { airtableId: 'recPlotAlpha' } });
    assert.strictEqual(after.latitude, before.latitude);
    assert.strictEqual(after.longitude, before.longitude);
    assert.strictEqual(after.mapCoordinates, 'garbage');
  });

  await t.test('POST / attaches uploaded photos via setAsset', async () => {
    const headers = await authenticate(app, 'admin.user@test.com', 'test');
    const filename = '56826175-033e-4a89-8d51-8d7f602e01d9.jpg';
    await upload([['640x480.jpg', filename]]);
    const response = await app.inject({
      method: 'POST',
      url: '/api/plots',
      headers,
      payload: {
        ...validPlot,
        stage: 'active',
        Photos: [filename],
      },
    });
    assert.strictEqual(response.statusCode, StatusCodes.CREATED);
    const data = JSON.parse(response.payload);
    assert.strictEqual(data.Photos.length, 1);
    assert.match(data.Photos[0], /^\/api\/assets\/plot_photos\/.+\/file\/56826175-033e-4a89-8d51-8d7f602e01d9\.jpg$/);

    const row = await prisma.plot.findUnique({
      where: { airtableId: data.id },
      include: { photos: true },
    });
    assert.strictEqual(row.photos.length, 1);
    assert.strictEqual(row.photos[0].file, filename);
    assert.ok(await assetExists(path.join('plot_photos', row.photos[0].id, 'file', filename)));
  });

  await t.test('PATCH /:id attaches uploaded photos via setAsset', async () => {
    const headers = await authenticate(app, 'admin.user@test.com', 'test');
    const filename = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.jpg';
    await upload([['640x480.jpg', filename]]);
    const response = await app.inject({
      method: 'PATCH',
      url: '/api/plots/recPlotAlpha',
      headers,
      payload: {
        Photos: [filename],
      },
    });
    assert.strictEqual(response.statusCode, StatusCodes.OK);
    const data = JSON.parse(response.payload);
    assert.strictEqual(data.id, 'recPlotAlpha');
    assert.strictEqual(data.Photos.length, 1);
    assert.match(data.Photos[0], new RegExp(`/file/${filename}$`));

    const row = await prisma.plot.findUnique({
      where: { airtableId: 'recPlotAlpha' },
      include: { photos: true },
    });
    assert.strictEqual(row.photos.length, 1);
    assert.strictEqual(row.photos[0].file, filename);
    assert.ok(await assetExists(path.join('plot_photos', row.photos[0].id, 'file', filename)));
  });

  await t.test('POST / stores the full scalar form and survives a detail read and viewport query', async () => {
    const headers = await authenticate(app, 'admin.user@test.com', 'test');
    const payload = {
      ...validPlot,
      stage: 'active',
      permissionStatus: 'unknown',
      'Pocket Garden Name': 'Blue Gate Garden',
      'Street Address': '440 5th Avenue',
      'Street City Address (for Maps)': '440 5th Avenue, San Francisco, CA',
      'Bed Type': 'Tree well',
      'Soil Type': 'Loam',
      'Est. Area (Sq. Ft)': 24.5,
      sunExposure: 'Partial sun',
      environmentalNotes: 'Shade from a nearby tree',
      firstPlanted: '2026-10-01',
    };
    const created = await app.inject({ method: 'POST', url: '/api/plots', headers, payload });
    assert.equal(created.statusCode, StatusCodes.CREATED);
    const plot = created.json();
    for (const [key, value] of Object.entries(payload)) assert.deepEqual(plot[key], value);
    assert.equal(plot.Status, undefined);

    const row = await prisma.plot.findUnique({ where: { airtableId: plot.id } });
    assert.equal(row.stage, 'active');
    assert.equal(row.permissionStatus, 'unknown');
    assert.equal(row.sunExposure, 'Partial sun');
    assert.equal(row.environmentalNotes, payload.environmentalNotes);
    assert.equal(row.originalPlantDate.toISOString(), '2026-10-01T00:00:00.000Z');

    const detail = await app.inject({ url: `/api/plots/${plot.id}` });
    assert.deepEqual(detail.json(), plot);
    const viewport = await app.inject({ url: '/api/plots?north=37.78&south=37.76&east=-122.42&west=-122.44' });
    const marker = viewport.json().find(({ id }) => id === plot.id);
    assert.equal(marker.stage, 'active');
    assert.equal(marker.environmentalNotes, undefined);
    assert.equal(marker.assignedVolunteers, undefined);
  });

  await t.test('POST / accepts legacy coordinates, defaults stage and generates a name with the public ID', async () => {
    const headers = await authenticate(app, 'admin.user@test.com', 'test');
    const response = await app.inject({
      method: 'POST',
      url: '/api/plots',
      headers,
      payload: { 'Map Coordinates': '37.77, -122.43', 'Location Description': 'First tree well', 'Street Address': '440 5th Avenue' },
    });
    assert.equal(response.statusCode, StatusCodes.CREATED);
    const plot = response.json();
    assert.equal(plot.stage, 'potential');
    assert.equal(plot.permissionStatus, 'unknown');
    assert.equal(plot['Pocket Garden Name'], `440 5th Avenue · ${plot.id}`);
    assert.equal(plot.Latitude, 37.77);
    assert.equal(plot.Longitude, -122.43);
  });

  await t.test('POST / reports invalid inputs without inserting any plots', async () => {
    const headers = await authenticate(app, 'admin.user@test.com', 'test');
    const before = await prisma.plot.count();
    for (const payload of [
      {},
      { ...validPlot, 'Location Description': '  ' },
      { ...validPlot, Latitude: 91 },
      { ...validPlot, Longitude: null },
      { 'Map Coordinates': '91, 181', 'Location Description': 'First well' },
      { ...validPlot, stage: 'archived' },
      { ...validPlot, Status: 'Planted' },
      { ...validPlot, stage: 'active', Status: 'Planted' },
      { ...validPlot, permissionStatus: 'maybe' },
      { ...validPlot, sunExposure: 'very sunny' },
      { ...validPlot, 'Est. Area (Sq. Ft)': -1 },
      { ...validPlot, stage: 'active', firstPlanted: '2026-02-30' },
      { ...validPlot, firstPlanted: '2026-10-01' },
      { ...validPlot, carerNames: ['Unverified person'] },
    ]) {
      const response = await app.inject({ method: 'POST', url: '/api/plots', headers, payload });
      assert.equal(response.statusCode, StatusCodes.UNPROCESSABLE_ENTITY, JSON.stringify(payload));
      assert.ok(response.json().errors.length > 0);
    }
    assert.equal(await prisma.plot.count(), before);
  });

  await t.test('legacy details preserve imported volunteers without exposing contacts or internal notes', async () => {
    const person = await prisma.person.findUnique({ where: { airtableId: 'recPersonAlpha' } });
    const plot = await prisma.plot.findUnique({ where: { airtableId: 'recPlotAlpha' } });
    await prisma.plotAssignedVolunteer.create({ data: { plotId: plot.id, personId: person.id } });
    await prisma.plot.update({ where: { id: plot.id }, data: { staffPermissionNotes: 'Private note' } });
    const response = await app.inject({ url: '/api/plots/recPlotAlpha' });
    assert.equal(response.statusCode, StatusCodes.OK);
    assert.deepEqual(response.json().assignedVolunteers, [{ id: person.id, displayName: 'Alex Gardener' }]);
    assert.equal(response.json().stage, 'active');
    assert.equal(response.json().permissionStatus, null);
    assert.equal(response.json().staffPermissionNotes, undefined);
    assert.ok(!response.body.includes('alex@example.com'));
    const unchanged = await prisma.plot.findUnique({ where: { id: plot.id } });
    assert.equal(unchanged.stage, 'active');
  });

  await t.test('PATCH / preserves omitted values and validates stage and planting dates', async () => {
    const headers = await authenticate(app, 'admin.user@test.com', 'test');
    const patch = (payload) => app.inject({ method: 'PATCH', url: '/api/plots/recPlotBeta', headers, payload });
    for (const stage of ['potential', 'preparing', 'active', 'paused', 'archived']) {
      assert.equal((await patch({ stage })).json().stage, stage);
    }
    assert.equal((await patch({ stage: 'active', firstPlanted: '2026-10-01' })).statusCode, StatusCodes.OK);
    const partial = await patch({ 'Street Address': 'New address' });
    assert.equal(partial.json().stage, 'active');
    assert.equal(partial.json().firstPlanted, '2026-10-01');
    assert.equal((await patch({ stage: 'paused' })).json().firstPlanted, '2026-10-01');
    const invalidDate = await patch({ firstPlanted: '2026-10-02' });
    assert.equal(invalidDate.statusCode, StatusCodes.UNPROCESSABLE_ENTITY);
    assert.equal(invalidDate.json().errors[0].path, 'firstPlanted');
    assert.equal((await patch({ firstPlanted: null })).json().firstPlanted, null);
    for (const payload of [{}, { stage: 'invalid' }, { Status: 'Planted' }, { stage: 'active', Status: 'Planted' }]) {
      assert.equal((await patch(payload)).statusCode, StatusCodes.UNPROCESSABLE_ENTITY);
    }
    const row = await prisma.plot.findUnique({ where: { airtableId: 'recPlotBeta' } });
    assert.equal(row.stage, 'paused');
    assert.equal(row.originalPlantDate, null);
  });

  await t.test('a guarded stage change updates only a plot that is still at the expected stage', async () => {
    const headers = await authenticate(app, 'admin.user@test.com', 'test');
    const url = '/api/plots/recPlotBeta';
    const patch = (payload) => app.inject({ method: 'PATCH', url, headers, payload });
    const initial = await patch({ stage: 'potential', permissionStatus: 'needed' });
    assert.equal(initial.statusCode, StatusCodes.OK);
    const transition = { stage: 'preparing', expectedStage: 'potential' };

    const member = await authenticate(app, 'regular.user@test.com', 'test');
    assert.equal((await app.inject({ method: 'PATCH', url, payload: transition })).statusCode, StatusCodes.UNAUTHORIZED);
    assert.equal((await app.inject({ method: 'PATCH', url, headers: member, payload: transition })).statusCode, StatusCodes.FORBIDDEN);
    for (const payload of [{ expectedStage: 'potential' }, { ...transition, permissionStatus: 'confirmed' }]) {
      assert.equal((await patch(payload)).statusCode, StatusCodes.UNPROCESSABLE_ENTITY);
    }

    const results = await Promise.all([patch(transition), patch(transition)]);
    assert.deepEqual(results.map(({ statusCode }) => statusCode).sort(), [StatusCodes.OK, StatusCodes.CONFLICT]);
    assert.deepEqual(results.find(({ statusCode }) => statusCode === StatusCodes.OK).json(), { ...initial.json(), stage: 'preparing' });

    assert.equal((await patch({ stage: 'active' })).statusCode, StatusCodes.OK);
    assert.equal((await patch(transition)).statusCode, StatusCodes.CONFLICT);
    assert.equal((await app.inject({ url })).json().stage, 'active');
  });

  await t.test('anonymous requests cannot submit plots and existing users cannot edit unowned plots', async () => {
    assert.equal((await app.inject({ method: 'POST', url: '/api/plots', payload: validPlot })).statusCode, StatusCodes.UNAUTHORIZED);
    assert.equal((await app.inject({ method: 'PATCH', url: '/api/plots/recPlotAlpha', payload: { stage: 'active' } })).statusCode, StatusCodes.UNAUTHORIZED);
    assert.deepEqual((await app.inject({ url: '/api/plots/capabilities' })).json(), { canCreatePlot: false, canAssignCarers: false });
    const member = await authenticate(app, 'regular.user@test.com', 'test');
    assert.equal((await app.inject({ method: 'POST', url: '/api/plots', headers: member, payload: validPlot })).statusCode, StatusCodes.CREATED);
    assert.equal((await app.inject({ method: 'PATCH', url: '/api/plots/recPlotAlpha', headers: member, payload: { stage: 'active' } })).statusCode, StatusCodes.FORBIDDEN);
    assert.deepEqual((await app.inject({ url: '/api/plots/capabilities', headers: member })).json(), { canCreatePlot: true, canAssignCarers: false });
    const admin = await authenticate(app, 'admin.user@test.com', 'test');
    assert.deepEqual((await app.inject({ url: '/api/plots/capabilities', headers: admin })).json(), { canCreatePlot: true, canAssignCarers: true });
  });

  await t.test('new verified users can submit plots with plants and photos but cannot change stages or assign carers', async () => {
    const { user, headers } = await verifiedUser(app);
    assert.equal(user.role, 'user');
    assert.deepEqual((await app.inject({ url: '/api/plots/capabilities', headers })).json(), { canCreatePlot: true, canAssignCarers: false });
    const filename = '56826175-033e-4a89-8d51-8d7f602e01d9.jpg';
    await upload([['640x480.jpg', filename]]);
    const created = await app.inject({
      method: 'POST',
      url: '/api/plots',
      headers,
      payload: {
        ...validPlot,
        stage: 'active',
        environmentalNotes: 'Afternoon shade and sandy soil',
        gardenCareNote: '  Water during dry spells  ',
        permissionAdditionalNote: '  Use the sidewalk entrance  ',
        Photos: [filename],
        plants: [{ plantId: 'a1111111-1111-4111-8111-111111111111', quantity: 2 }],
      },
    });
    assert.equal(created.statusCode, StatusCodes.CREATED, created.body);
    assert.equal(created.json().plants[0].quantity, 2);
    assert.equal(created.json().Photos.length, 1);
    assert.equal(created.json().environmentalNotes, 'Afternoon shade and sandy soil');
    assert.equal(created.json().gardenCareNote, 'Water during dry spells');
    assert.equal(created.json().permissionAdditionalNote, 'Use the sidewalk entrance');
    assert.equal((await prisma.plot.findUnique({ where: { airtableId: created.json().id } })).staffPermissionNotes, null);
    assert.deepEqual(created.json().assignedVolunteers, []);
    const before = await prisma.plot.count();
    assert.equal((await app.inject({
      method: 'POST',
      url: '/api/plots',
      headers,
      payload: { ...validPlot, carerUserIds: [user.id] },
    })).statusCode, StatusCodes.FORBIDDEN);
    assert.equal(await prisma.plot.count(), before);
    assert.equal((await app.inject({ url: '/api/plots/carers', headers })).statusCode, StatusCodes.FORBIDDEN);
    assert.equal((await app.inject({
      method: 'PATCH', url: `/api/plots/${created.json().id}`, headers, payload: { stage: 'paused' },
    })).statusCode, StatusCodes.FORBIDDEN);
    assert.equal((await app.inject({
      method: 'POST', url: '/api/assets', headers, payload: { contentType: 'image/jpeg', byteSize: 100 },
    })).statusCode, StatusCodes.OK);
  });

  await t.test('plot creators and note authors can edit their submissions, with staff access across plots', async () => {
    const owner = await authenticate(app, 'regular.user@test.com', 'test');
    const stranger = await authenticate(app, 'another.user@test.com', 'test');
    const staff = await authenticate(app, 'admin.user@test.com', 'test');
    const created = await app.inject({ method: 'POST', url: '/api/plots', headers: owner, payload: { ...validPlot, gardenCareNote: 'Owner care note' } });
    assert.equal(created.statusCode, StatusCodes.CREATED, created.body);
    assert.equal(created.json().createdById, undefined);
    assert.equal(created.json().gardenCareNoteAuthorId, undefined);
    const url = `/api/plots/${created.json().id}`;
    const getEdit = (headers) => app.inject({ url: `${url}/edit`, headers });
    const access = (headers) => app.inject({ url: `${url}/edit-access`, headers });
    const patch = (headers, payload) => app.inject({ method: 'PATCH', url, headers, payload });
    assert.deepEqual((await access(owner)).json(), { canEdit: true });
    assert.deepEqual((await access(stranger)).json(), { canEdit: false });
    assert.equal((await getEdit(stranger)).statusCode, StatusCodes.FORBIDDEN);
    assert.equal((await patch(stranger, { gardenCareNote: 'Not mine' })).statusCode, StatusCodes.FORBIDDEN);
    assert.equal((await patch(owner, { staffPermissionNotes: 'Restricted' })).statusCode, StatusCodes.FORBIDDEN);
    assert.equal((await patch(owner, { stage: 'preparing' })).statusCode, StatusCodes.FORBIDDEN);
    assert.equal((await patch(owner, { 'Pocket Garden Name': 'Owner correction', gardenCareNote: 'Updated care' })).statusCode, StatusCodes.OK);
    assert.equal((await patch(staff, { gardenCareNote: 'Staff correction', permissionAdditionalNote: 'Staff-authored public note', staffPermissionNotes: 'Private' })).statusCode, StatusCodes.OK);

    const ownerEditor = (await getEdit(owner)).json();
    assert.equal(ownerEditor.staffPermissionNotes, undefined);
    assert.ok(ownerEditor.editableFields.includes('gardenCareNote'));
    assert.ok(!ownerEditor.editableFields.includes('permissionAdditionalNote'));
    assert.equal((await patch(owner, { permissionAdditionalNote: 'Overwrite' })).statusCode, StatusCodes.FORBIDDEN);
    assert.equal((await patch(owner, { gardenCareNote: 'Still editable by original author' })).statusCode, StatusCodes.OK);
    assert.equal((await getEdit(staff)).json().staffPermissionNotes, 'Private');

    await prisma.user.update({ where: { email: 'admin.user@test.com' }, data: { role: 'user' } });
    const formerStaff = await authenticate(app, 'admin.user@test.com', 'test');
    assert.deepEqual((await getEdit(formerStaff)).json().editableFields, ['permissionAdditionalNote']);
    assert.equal((await patch(formerStaff, { 'Pocket Garden Name': 'Other account' })).statusCode, StatusCodes.FORBIDDEN);
    assert.equal((await patch(formerStaff, { permissionAdditionalNote: '' })).statusCode, StatusCodes.OK);
    assert.deepEqual((await access(formerStaff)).json(), { canEdit: false });
    assert.equal((await patch(owner, { permissionAdditionalNote: 'New note in an empty field' })).statusCode, StatusCodes.OK);
  });

  await t.test('editor saves compare only the fields being updated with their original values', async () => {
    const headers = await authenticate(app, 'admin.user@test.com', 'test');
    const url = '/api/plots/recPlotAlpha';
    const patch = (payload) => app.inject({ method: 'PATCH', url, headers, payload });
    const opened = (await app.inject({ url: `${url}/edit`, headers })).json();
    assert.equal((await patch({ environmentalNotes: 'Saved by someone else' })).statusCode, StatusCodes.OK);
    assert.equal((await patch({
      'Pocket Garden Name': 'Independent title edit',
      expectedValues: { 'Pocket Garden Name': opened['Pocket Garden Name'] ?? null },
    })).statusCode, StatusCodes.OK);
    assert.equal((await patch({
      environmentalNotes: 'Stale note',
      expectedValues: { environmentalNotes: opened.environmentalNotes },
    })).statusCode, StatusCodes.CONFLICT);
    assert.equal((await patch({ environmentalNotes: 'Missing baseline', expectedValues: {} })).statusCode, StatusCodes.UNPROCESSABLE_ENTITY);
    assert.equal((await app.inject({ url })).json().environmentalNotes, 'Saved by someone else');
  });

  await t.test('users cannot write staff permission notes, including an empty value', async () => {
    const headers = await authenticate(app, 'regular.user@test.com', 'test');
    const before = await prisma.plot.count();
    for (const note of ['Staff note supplied by a user', '']) {
      const response = await app.inject({
        method: 'POST',
        url: '/api/plots',
        headers,
        payload: { ...validPlot, staffPermissionNotes: note },
      });
      assert.equal(response.statusCode, StatusCodes.FORBIDDEN, response.body);
    }
    assert.equal(await prisma.plot.count(), before);
  });

  await t.test('staff permission notes appear only in the administrator editor response', async () => {
    const headers = await authenticate(app, 'admin.user@test.com', 'test');
    const member = await authenticate(app, 'regular.user@test.com', 'test');
    const note = 'Permission evidence for staff';
    const payload = { ...validPlot, submissionId: '87c0ed72-2e5f-45a8-9d33-5982a6ec3666', staffPermissionNotes: note };
    const created = await app.inject({
      method: 'POST',
      url: '/api/plots',
      headers,
      payload,
    });
    assert.equal(created.statusCode, StatusCodes.CREATED, created.body);
    assert.equal(created.json().staffPermissionNotes, undefined);
    const replay = await app.inject({ method: 'POST', url: '/api/plots', headers, payload });
    assert.equal(replay.statusCode, StatusCodes.OK, replay.body);
    assert.equal(replay.json().staffPermissionNotes, undefined);
    const recoveryUrl = `/api/plots/submissions/${payload.submissionId}`;
    const recovered = await app.inject({ url: recoveryUrl, headers });
    assert.equal(recovered.statusCode, StatusCodes.OK, recovered.body);
    assert.equal(recovered.json().id, created.json().id);
    assert.equal(recovered.json().staffPermissionNotes, undefined);
    assert.equal((await app.inject({ url: recoveryUrl, headers: member })).statusCode, StatusCodes.NOT_FOUND);
    const url = `/api/plots/${created.json().id}`;
    const edited = await app.inject({
      method: 'PATCH',
      url,
      headers,
      payload: { gardenCareNote: 'Water weekly', permissionAdditionalNote: 'Enter from the sidewalk' },
    });
    assert.equal(edited.statusCode, StatusCodes.OK, edited.body);
    assert.equal(edited.json().staffPermissionNotes, undefined);
    const publicDetail = (await app.inject({ url })).json();
    assert.equal(publicDetail.gardenCareNote, 'Water weekly');
    assert.equal(publicDetail.permissionAdditionalNote, 'Enter from the sidewalk');
    assert.equal(publicDetail.staffPermissionNotes, undefined);
    assert.ok(!(await app.inject({ url: '/api/plots' })).body.includes(note));
    assert.equal((await app.inject({ url: `${url}/edit` })).statusCode, StatusCodes.UNAUTHORIZED);
    assert.equal((await app.inject({ url: `${url}/edit`, headers: member })).statusCode, StatusCodes.FORBIDDEN);
    const editor = await app.inject({ url: `${url}/edit`, headers });
    assert.equal(editor.statusCode, StatusCodes.OK, editor.body);
    assert.match(editor.headers['cache-control'], /no-store/);
    assert.equal(editor.json().staffPermissionNotes, note);
    assert.equal((await app.inject({ method: 'PATCH', url, headers, payload: { "Seth's Notes": 'Retired field' } })).statusCode, StatusCodes.UNPROCESSABLE_ENTITY);
    const cleared = await app.inject({ method: 'PATCH', url, headers, payload: { staffPermissionNotes: '' } });
    assert.equal(cleared.statusCode, StatusCodes.OK, cleared.body);
    assert.equal(cleared.json().staffPermissionNotes, undefined);
    assert.equal((await app.inject({ url: `${url}/edit`, headers })).json().staffPermissionNotes, '');
  });

  for (const data of [{ emailVerified: false }, { banned: true }]) {
    await t.test(`inactive users cannot submit plots: ${JSON.stringify(data)}`, async () => {
      const { user, headers } = await verifiedUser(app);
      await prisma.user.update({ where: { id: user.id }, data });
      assert.deepEqual((await app.inject({ url: '/api/plots/capabilities', headers })).json(), { canCreatePlot: false, canAssignCarers: false });
      const response = await app.inject({ method: 'POST', url: '/api/plots', headers, payload: validPlot });
      assert.equal(response.statusCode, StatusCodes.FORBIDDEN);
    });
  }

  await t.test('unrecorded stages remain null in detail and summary responses', async () => {
    await prisma.plot.update({ where: { airtableId: 'recPlotOutside' }, data: { stage: null } });
    const detail = await app.inject({ url: '/api/plots/recPlotOutside' });
    assert.equal(detail.statusCode, StatusCodes.OK);
    assert.equal(detail.json().stage, null);
    assert.equal(detail.json().Status, undefined);
    const list = await app.inject({ url: '/api/plots' });
    assert.equal(list.json().find(({ id }) => id === 'recPlotOutside').stage, null);
    assert.ok(list.json().every((plot) => !Object.hasOwn(plot, 'Status')));
  });

  await t.test('anonymous creation requires an explicit development setting and stays disabled in production', async () => {
    const previous = { nodeEnv: process.env.NODE_ENV, flag: process.env.ALLOW_ANONYMOUS_PLOT_SUBMISSION };
    try {
      process.env.ALLOW_ANONYMOUS_PLOT_SUBMISSION = 'true';
      process.env.NODE_ENV = 'production';
      assert.equal((await app.inject({ method: 'POST', url: '/api/plots', payload: validPlot })).statusCode, StatusCodes.UNAUTHORIZED);
      assert.equal((await app.inject({ url: '/api/plots/capabilities' })).json().canCreatePlot, false);
      process.env.NODE_ENV = 'development';
      assert.equal((await app.inject({ url: '/api/plots/capabilities' })).json().canCreatePlot, true);
      const before = await prisma.plot.count();
      for (const note of ['Staff note supplied anonymously', '']) {
        assert.equal((await app.inject({ method: 'POST', url: '/api/plots', payload: { ...validPlot, staffPermissionNotes: note } })).statusCode, StatusCodes.UNAUTHORIZED);
      }
      assert.equal(await prisma.plot.count(), before);
      const created = await app.inject({ method: 'POST', url: '/api/plots', payload: { ...validPlot, environmentalNotes: 'Morning shade' } });
      assert.equal(created.statusCode, StatusCodes.CREATED, created.body);
      assert.equal(created.json().environmentalNotes, 'Morning shade');
      assert.equal((await app.inject({ method: 'PATCH', url: '/api/plots/recPlotAlpha', payload: { stage: 'active' } })).statusCode, StatusCodes.UNAUTHORIZED);
      process.env.ALLOW_ANONYMOUS_PLOT_SUBMISSION = 'false';
      assert.equal((await app.inject({ method: 'POST', url: '/api/plots', payload: validPlot })).statusCode, StatusCodes.UNAUTHORIZED);
    } finally {
      for (const [key, value] of [['NODE_ENV', previous.nodeEnv], ['ALLOW_ANONYMOUS_PLOT_SUBMISSION', previous.flag]]) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    }
  });
});
