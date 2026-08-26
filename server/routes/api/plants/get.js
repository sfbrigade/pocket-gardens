import { StatusCodes } from 'http-status-codes';
import { z } from 'zod';

import { findPlantById, formatPlant, PlantSchema } from '#models/plant.js';

export default async function (fastify, opts) {
  fastify.get('/:id', {
    schema: {
      description: 'Returns a Plant by id.',
      params: z.object({
        id: z.string().uuid(),
      }),
      response: {
        [StatusCodes.OK]: PlantSchema,
        [StatusCodes.NOT_FOUND]: z.null(),
      },
    },
  }, async function (request, reply) {
    const record = await findPlantById(fastify.prisma, request.params.id);
    if (!record) {
      return reply.code(StatusCodes.NOT_FOUND).send(null);
    }
    reply.send(formatPlant(record));
  });
}
