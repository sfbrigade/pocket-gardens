import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { StatusCodes } from 'http-status-codes';

import { authenticate, build } from '#test/helper.js';
import s3 from '#lib/s3.js';

const photo = await readFile(new URL('../../fixtures/assets/640x480.jpg', import.meta.url));
const valid = { contentType: 'image/jpeg', byteSize: photo.length };

test('/api/assets', async (t) => {
  const app = await build(t);
  const userHeaders = await authenticate(app, 'regular.user@test.com', 'test');
  const create = (payload = valid, headers = userHeaders) => app.inject({ method: 'POST', url: '/api/assets', payload, headers });

  await t.test('anonymous issuance is denied before signing or creating cleanup work', async () => {
    assert.equal((await create(valid, {})).statusCode, 401);
    assert.equal(await app.prisma.photoCopyIntent.count(), 0);
  });

  await t.test('inactive users cannot issue uploads', async () => {
    await app.prisma.user.update({ where: { email: 'regular.user@test.com' }, data: { deactivatedAt: new Date() } });
    assert.equal((await create()).statusCode, 403);
    assert.equal(await app.prisma.photoCopyIntent.count(), 0);
  });

  await t.test('anonymous development opt-in never permits production issuance', async () => {
    const mode = process.env.NODE_ENV;
    const allowed = process.env.ALLOW_ANONYMOUS_PLOT_SUBMISSION;
    try {
      process.env.ALLOW_ANONYMOUS_PLOT_SUBMISSION = 'true';
      process.env.NODE_ENV = 'production';
      assert.equal((await create(valid, {})).statusCode, 401);
      assert.equal(await app.prisma.photoCopyIntent.count(), 0);
      process.env.NODE_ENV = 'development';
      assert.equal((await create(valid, {})).statusCode, 200);
    } finally {
      process.env.NODE_ENV = mode;
      if (allowed === undefined) delete process.env.ALLOW_ANONYMOUS_PLOT_SUBMISSION;
      else process.env.ALLOW_ANONYMOUS_PLOT_SUBMISSION = allowed;
    }
  });

  await t.test('rejects unsupported types and invalid declared sizes before creating rows', async () => {
    for (const contentType of ['text/html', 'image/svg+xml', 'application/octet-stream', 'image/jpeg; charset=utf-8']) {
      assert.equal((await create({ ...valid, contentType })).statusCode, 422);
    }
    for (const byteSize of [undefined, 0, -1, 1.5, '100', 10 * 1024 * 1024 + 1]) {
      assert.equal((await create({ ...valid, byteSize })).statusCode, 422);
    }
    assert.equal(await app.prisma.photoCopyIntent.count(), 0);
  });

  await t.test('a signing failure creates no cleanup work', async (t) => {
    t.mock.method(console, 'error', () => {});
    t.mock.method(s3, 'getSignedUploadUrl', async () => { throw new Error('Signing unavailable'); });
    assert.equal((await create()).statusCode, 500);
    assert.equal(await app.prisma.photoCopyIntent.count(), 0);
  });

  await t.test('signed URLs bind actual type and length; matching uploads work', async () => {
    const response = await create();
    assert.equal(response.statusCode, 200);
    const { url, headers, filename } = response.json();
    assert.equal(response.json().expiresAt, undefined);
    const [table] = await app.prisma.$queryRaw`SELECT to_regclass('public."AssetUpload"')::text AS name`;
    assert.equal(table.name, null, 'upload issuance has no persistent token registry');
    const signed = new URL(url).searchParams.get('X-Amz-SignedHeaders').split(';');
    assert.ok(signed.includes('content-length'));
    assert.ok(signed.includes('content-type'));
    assert.equal(headers['Content-Type'], valid.contentType);
    assert.ok((await fetch(url, { method: 'PUT', headers, body: photo })).ok);
    assert.equal((await s3.headObject(`_uploads/${filename}`)).ContentLength, photo.length);
    const wrongType = await fetch(url, { method: 'PUT', headers: { 'Content-Type': 'text/html' }, body: photo });
    assert.equal(wrongType.status, 403);
    const wrongLength = await fetch(url, { method: 'PUT', headers, body: Buffer.concat([photo, Buffer.from('extra')]) });
    assert.equal(wrongLength.status, 403);
  });

  await t.test('forged photo bytes are rejected across shared attachment consumers', async () => {
    const good = (await create()).json();
    assert.ok((await fetch(good.url, { method: 'PUT', headers: good.headers, body: photo })).ok);
    const user = await app.prisma.user.findUnique({ where: { email: 'regular.user@test.com' } });
    const patchPicture = (picture) => app.inject({ method: 'PATCH', url: `/api/users/${user.id}`, headers: userHeaders, payload: { picture } });
    assert.equal((await patchPicture(good.filename)).statusCode, 200);
    const permanent = `users/${user.id}/picture/${good.filename}`;
    assert.ok(await s3.objectExists(permanent));
    const bad = (await create()).json();
    const forged = Buffer.alloc(photo.length, 32);
    forged.write('<html>not a photo</html>');
    assert.ok((await fetch(bad.url, { method: 'PUT', headers: bad.headers, body: forged })).ok);
    const rejected = await patchPicture(bad.filename);
    assert.equal(rejected.statusCode, 422);
    assert.equal(rejected.json().errors[0].path, 'picture');
    assert.equal((await app.prisma.user.findUnique({ where: { id: user.id } })).picture, good.filename);
    assert.ok(await s3.objectExists(permanent), 'invalid replacement must preserve the previous picture');
    const admin = await authenticate(app, 'admin.user@test.com', 'test');
    const garden = await app.inject({ method: 'POST', url: '/api/plots', headers: admin, payload: { Latitude: 37.77, Longitude: -122.43, 'Location Description': 'Review fixture', Photos: [bad.filename] } });
    assert.equal(garden.statusCode, 422);
    assert.equal(garden.json().errors[0].path, 'Photos');
    const plant = await app.inject({ method: 'POST', url: '/api/plants', headers: admin, payload: { plantName: 'Bad photo', photos: [{ upload: bad.filename }] } });
    assert.equal(plant.statusCode, 422);
    assert.equal(plant.json().errors[0].path, 'photos');
  });

  await t.test('a repeated PUT cannot swap the source after validation and before copying', async (t) => {
    const issued = (await create()).json();
    assert.ok((await fetch(issued.url, { method: 'PUT', headers: issued.headers, body: photo })).ok);
    const changed = Buffer.from(photo);
    changed[changed.length - 1] ^= 1;
    const copy = s3.copyObject;
    t.mock.method(s3, 'copyObject', async (...args) => {
      assert.ok((await fetch(issued.url, { method: 'PUT', headers: issued.headers, body: changed })).ok);
      return copy(...args);
    });
    const admin = await authenticate(app, 'admin.user@test.com', 'test');
    const response = await app.inject({ method: 'POST', url: '/api/plots', headers: admin, payload: { Latitude: 37.77, Longitude: -122.43, 'Location Description': 'Changing source', Photos: [issued.filename] } });
    assert.equal(response.statusCode, 422);
    assert.equal(response.json().errors[0].path, 'Photos');
    assert.match(response.json().errors[0].message, /changed/);
    assert.equal(await app.prisma.plot.count({ where: { locationDescription: 'Changing source' } }), 0);
  });

  await t.test('issuance is rate limited per signed-in user before signing another URL', async (t) => {
    t.mock.method(console, 'error', () => {});
    const signing = t.mock.method(s3, 'getSignedUploadUrl');
    const other = await authenticate(app, 'admin.user@test.com', 'test');
    let response;
    for (let i = 0; i < 31; i++) {
      response = await create();
      if (response.statusCode === 429) break;
      assert.equal(response.statusCode, 200);
    }
    assert.equal(response.statusCode, 429);
    const calls = signing.mock.calls.length;
    assert.equal((await create()).statusCode, 429);
    assert.equal(signing.mock.calls.length, calls);
    assert.equal((await create(valid, other)).statusCode, 200, 'another account has its own allowance');
  });

  await t.test('GET redirects to a signed asset url', async () => {
    const response = await app.inject().get('/api/assets/users/12345678-1234-5678-1234-567812345678/picture/12345678-1234-5678-1234-567812345678.jpeg');
    assert.equal(response.statusCode, StatusCodes.MOVED_TEMPORARILY);
    assert.ok(response.headers.location.includes('users/12345678-1234-5678-1234-567812345678/picture/12345678-1234-5678-1234-567812345678.jpeg'));
  });
});
