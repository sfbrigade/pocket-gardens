import { test } from 'node:test';
import * as assert from 'node:assert';
import { StatusCodes } from 'http-status-codes';

import { authenticate, build } from '#test/helper.js';

test('/api/people', async (t) => {
  const app = await build(t);
  const adminHeaders = await authenticate(app, 'admin.user@test.com', 'test');

  await t.test('GET /', async (t) => {
    await t.test('returns a list of People', async (t) => {
      const response = await app.inject({
        url: '/api/people'
      }).headers(adminHeaders);

      assert.deepStrictEqual(response.statusCode, StatusCodes.OK);

      const data = JSON.parse(response.payload);
      assert.deepStrictEqual(data.length, 3);
      assert.deepStrictEqual(data[0].firstName, 'Bob');
      assert.deepStrictEqual(data[1].firstName, 'Alice');
      assert.deepStrictEqual(data[2].name, 'Community Volunteer');
    });
  });

  await t.test('filters People by search', async (t) => {
    const response = await app.inject({
      url: '/api/people?search=Smith'
    }).headers(adminHeaders);

    assert.deepStrictEqual(response.statusCode, StatusCodes.OK);

    const data = JSON.parse(response.payload);
    assert.deepStrictEqual(data.length, 1);
    assert.deepStrictEqual(data[0].firstName, 'Alice');
    assert.deepStrictEqual(data[0].lastName, 'Smith');
  });

  await t.test('returns an empty list when no People match', async (t) => {
    const response = await app.inject({
      url: '/api/people?search=Nonexistent'
    }).headers(adminHeaders);

    assert.deepStrictEqual(response.statusCode, StatusCodes.OK);

    const data = JSON.parse(response.payload);
    assert.deepStrictEqual(data, []);
  });

  await t.test('paginates People', async (t) => {
    const response = await app.inject({
      url: '/api/people?page=2&perPage=1'
    }).headers(adminHeaders);

    assert.deepStrictEqual(response.statusCode, StatusCodes.OK);

    const data = JSON.parse(response.payload);
    assert.deepStrictEqual(data.length, 1);
    assert.deepStrictEqual(data[0].firstName, 'Alice');
  });

  await t.test('requires authentication', async (t) => {
    const response = await app.inject({
      url: '/api/people'
    });

    assert.deepStrictEqual(response.statusCode, StatusCodes.UNAUTHORIZED);
  });

  await t.test('forbids non-admin users', async (t) => {
    const userHeaders = await authenticate(app, 'regular.user@test.com', 'test');

    const response = await app.inject({
      url: '/api/people'
    }).headers(userHeaders);

    assert.deepStrictEqual(response.statusCode, StatusCodes.FORBIDDEN);
  });
});
