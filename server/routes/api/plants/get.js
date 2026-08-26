import { StatusCodes } from 'http-status-codes';
import { z } from 'zod';

import { findPlantByPublicId, formatPlant, PlantSchema } from '#models/plant.js';

export default async function (fastify, opts) {
  fastify.get('/:id', {
    schema: {
      description: 'Returns a Plant by Airtable record id (or internal UUID).',
      params: z.object({
        id: z.string().min(1),
      }),
      response: {
        [StatusCodes.OK]: PlantSchema,
        [StatusCodes.NOT_FOUND]: z.null(),
      },
    },
  }, async function (request, reply) {
    const record = await findPlantByPublicId(fastify.prisma, request.params.id);
    if (!record) {
      return reply.code(StatusCodes.NOT_FOUND).send(null);
    }
    reply.send(formatPlant(record));
  });
}
