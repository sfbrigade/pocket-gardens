import { z } from 'zod';

export default async function (fastify) {
  fastify.get('/carers', {
    onRequest: fastify.requireAdmin,
    schema: {
      description: 'Search active registered users available for staff carer assignment. Use X-Next-Offset for the next page.',
      querystring: z.strictObject({
        search: z.string().trim().min(1).max(200).optional(),
        offset: z.coerce.number().int().nonnegative().default(0),
        pageSize: z.coerce.number().int().min(1).max(100).default(10),
      }),
      response: {
        200: z.array(z.strictObject({ id: z.string().uuid(), displayName: z.string(), email: z.string() })),
        422: fastify.ValidationErrorSchema,
      },
    },
  }, async (request, reply) => {
    const { search, offset, pageSize } = request.query;
    const records = await fastify.prisma.user.findMany({
      where: {
        deactivatedAt: null,
        ...(search && {
          AND: search.split(/\s+/).map((term) => ({
            OR: ['firstName', 'lastName', 'email'].map((field) => ({ [field]: { contains: term, mode: 'insensitive' } })),
          })),
        }),
      },
      select: { id: true, firstName: true, lastName: true, email: true },
      orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }, { id: 'asc' }],
      skip: offset,
      take: pageSize + 1,
    });
    if (records.length > pageSize) reply.header('X-Next-Offset', String(offset + pageSize));
    return records.slice(0, pageSize).map(({ id, firstName, lastName, email }) => ({ id, displayName: `${firstName} ${lastName}`, email }));
  });
}
