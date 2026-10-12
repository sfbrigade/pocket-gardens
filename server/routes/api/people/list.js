import { StatusCodes } from 'http-status-codes';
import { z } from 'zod';

import Person from '#models/person.js';

export default async function (fastify, opts) {
  fastify.get(
    '/',
    {
      schema: {
        description: 'Returns a paginated list of People.',
        querystring: z.object({
          page: z.coerce.number().optional(),
          perPage: z.coerce.number().optional(),
          search: z.string().optional(),
        }),
        response: {
          [StatusCodes.OK]: z.array(Person.ResponseSchema),
          [StatusCodes.FORBIDDEN]: z.null(),
        },
      },
      onRequest: fastify.requireAdmin,
    },
    async function (request, reply) {
      const { page = '1', perPage = '25', search } = request.query;

      const options = {
        page,
        perPage,
        orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }, { email: 'asc' }],
      };

      if (search) {
        options.where = {
          OR: [
            { firstName: { contains: search } },
            { lastName: { contains: search } },
            { name: { contains: search } },
            { email: { contains: search } },
            { phone: { contains: search } },
          ],
        };
      }

      const { records, total } = await fastify.prisma.person.paginate(options);
      reply
        .setPaginationHeaders(page, perPage, total)
        .send(records.map((data) => new Person(data)));
    }
  );
}
