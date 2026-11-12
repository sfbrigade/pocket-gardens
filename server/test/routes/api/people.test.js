import { test } from 'node:test';
import * as assert from 'node:assert';
import { StatusCodes } from 'http-status-codes';

import { authenticate, build } from '#test/helper.js';

test('/api/people', async (t) => {
  const app = await build(t);
  const adminHeaders = await authenticate(app, 'admin.user@test.com', 'test');

  await t.test('GET /:id', async (t) => {
    await t.test('returns a Person by id', async (t) => {
      const person = await app.prisma.person.findFirst({
        where: { firstName: 'Alice', lastName: 'Smith' },
      });

      const response = await app.inject({
        url: `/api/people/${person.id}`,
      }).headers(adminHeaders);

      assert.deepStrictEqual(response.statusCode, StatusCodes.OK);

      const data = JSON.parse(response.payload);
      assert.deepStrictEqual(data.id, person.id);
      assert.deepStrictEqual(data.firstName, 'Alice');
      assert.deepStrictEqual(data.lastName, 'Smith');
      assert.deepStrictEqual(data.homeZipCode, null);
      assert.deepStrictEqual(data.assignedPlots, []);
    });

    await t.test('returns home ZIP code for a Person', async (t) => {
      const person = await app.prisma.person.findFirst({
        where: { firstName: 'Alice', lastName: 'Smith' },
      });

      const zipCode = await app.prisma.zipCode.create({
        data: {
          airtableId: 'recTestHomeZip',
          code: '94110',
        },
      });

      await app.prisma.person.update({
        where: { id: person.id },
        data: { homeZipId: zipCode.id },
      });

      const response = await app.inject({
        url: `/api/people/${person.id}`,
      }).headers(adminHeaders);

      assert.deepStrictEqual(response.statusCode, StatusCodes.OK);

      const data = JSON.parse(response.payload);
      assert.deepStrictEqual(data.homeZipCode, '94110');
    });

    await t.test('returns assigned plots for a Person', async (t) => {
      const person = await app.prisma.person.findFirst({
        where: { firstName: 'Alice', lastName: 'Smith' },
      });

      const plot = await app.prisma.plot.findFirst({
        where: { name: 'Alpha Garden' },
      });

      await app.prisma.plotAssignedVolunteer.create({
        data: {
          personId: person.id,
          plotId: plot.id,
        },
      });

      const response = await app.inject({
        url: `/api/people/${person.id}`
      }).headers(adminHeaders);

      assert.deepStrictEqual(response.statusCode, StatusCodes.OK);

      const data = JSON.parse(response.payload);

      assert.deepStrictEqual(data.assignedPlots, [
        {
          id: plot.id,
          name: 'Alpha Garden',
          streetAddress: '100 Test St',
          status: 'Planted',
        },
      ]);
    });

    await t.test('returns 404 when Person does not exist', async (t) => {
      const response = await app.inject({
        url: '/api/people/00000000-0000-4000-8000-000000000000'
      }).headers(adminHeaders);

      assert.deepStrictEqual(response.statusCode, StatusCodes.NOT_FOUND);
    });

    await t.test('returns 422 when Person id is invalid', async (t) => {
      const response = await app.inject({
        url: '/api/people/not-a-uuid',
      }).headers(adminHeaders);

      assert.deepStrictEqual(response.statusCode, StatusCodes.UNPROCESSABLE_ENTITY);
    });

    await t.test('requires authentication', async (t) => {
      const person = await app.prisma.person.findFirst({
        where: { firstName: 'Alice', lastName: 'Smith' },
      });

      const response = await app.inject({
        url: `/api/people/${person.id}`
      });

      assert.deepStrictEqual(response.statusCode, StatusCodes.UNAUTHORIZED);
    });

    await t.test('forbids non-admin users', async (t) => {
      const userHeaders = await authenticate(app, 'regular.user@test.com', 'test');

      const person = await app.prisma.person.findFirst({
        where: { firstName: 'Alice', lastName: 'Smith' },
      });

      const response = await app.inject({
        url: `/api/people/${person.id}`
      }).headers(userHeaders);

      assert.deepStrictEqual(response.statusCode, StatusCodes.FORBIDDEN);
    });
  });

  await t.test('GET /', async (t) => {
    await t.test('returns a list of People', async (t) => {
      const response = await app.inject({
        url: '/api/people'
      }).headers(adminHeaders);

      assert.deepStrictEqual(response.statusCode, StatusCodes.OK);

      const data = JSON.parse(response.payload);
      assert.deepStrictEqual(data.length, 5);
      assert.deepStrictEqual(data[0].firstName, 'Alex');
      assert.deepStrictEqual(data[1].firstName, 'Bob');
      assert.deepStrictEqual(data[2].firstName, 'Alice');
      assert.deepStrictEqual(data[3].firstName, 'Bailey');
      assert.deepStrictEqual(data[4].name, 'Community Volunteer');
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

  await t.test('searches People case-insensitively', async (t) => {
    const response = await app.inject({
      url: '/api/people?search=bailey'
    }).headers(adminHeaders);

    assert.deepStrictEqual(response.statusCode, StatusCodes.OK);

    const data = JSON.parse(response.payload);
    assert.deepStrictEqual(data.length, 1);
    assert.deepStrictEqual(data[0].firstName, 'Bailey');
    assert.deepStrictEqual(data[0].lastName, 'Volunteer');
  });

  await t.test('searches emails case-insensitively', async (t) => {
    const response = await app.inject({
      url: '/api/people?search=ALICE@EXAMPLE.COM'
    }).headers(adminHeaders);

    assert.deepStrictEqual(response.statusCode, StatusCodes.OK);

    const data = JSON.parse(response.payload);
    assert.deepStrictEqual(data.length, 1);
    assert.deepStrictEqual(data[0].email, 'alice@example.com');
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
    assert.deepStrictEqual(data[0].firstName, 'Bob');
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
