import { StatusCodes } from 'http-status-codes';
import { z } from 'zod';

import Person from '#models/person.js';

export default async function (fastify, opts) {
  fastify.get(
    '/:id',
    {
      schema: {
        description: 'Returns a Person object by id.',
        params: z.object({
          id: z.string().uuid(),
        }),
        response: {
          [StatusCodes.OK]: Person.DetailResponseSchema,
          [StatusCodes.FORBIDDEN]: z.null(),
          [StatusCodes.NOT_FOUND]: z.null(),
        },
      },
      onRequest: fastify.requireAdmin,
    },
    async function (request, reply) {
      const { id } = request.params;

      const data = await fastify.prisma.person.findUnique({
        where: { id },
        include: {
          homeZip: true,
          assignedPlots: {
            include: {
              plot: true,
            },
          },
        },
      });

      if (!data) {
        return reply.code(StatusCodes.NOT_FOUND).send();
      }

      reply.send({
        id: data.id,
        firstName: data.firstName,
        lastName: data.lastName,
        name: data.name,
        email: data.email,
        phone: data.phone,
        homeZipCode: data.homeZip?.code ?? null,
        assignedPlots: data.assignedPlots.map(({ plot }) => ({
          id: plot.id,
          name: plot.name,
          streetAddress: plot.streetAddress,
          status: plot.status,
        })),
      });
    }
  );
}
