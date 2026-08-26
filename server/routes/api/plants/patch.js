import { StatusCodes } from 'http-status-codes';
import { z } from 'zod';

import {
  findPlantByPublicId,
  formatPlant,
  plantFieldsFromBody,
  PlantFieldsSchema,
  PlantSchema,
  reloadPlantWithPhotos,
  syncPlantPhotos,
} from '#models/plant.js';

export default async function (fastify, opts) {
  fastify.patch('/:id', {
    schema: {
      description: 'Updates a Plant by Airtable record id (or internal UUID).',
      params: z.object({
        id: z.string().min(1),
      }),
      body: PlantFieldsSchema,
      response: {
        [StatusCodes.OK]: PlantSchema,
        [StatusCodes.NOT_FOUND]: z.null(),
        [StatusCodes.UNPROCESSABLE_ENTITY]: z.null(),
      },
    },
  }, async function (request, reply) {
    const existing = await findPlantByPublicId(fastify.prisma, request.params.id);
    if (!existing) {
      return reply.code(StatusCodes.NOT_FOUND).send(null);
    }
    const data = plantFieldsFromBody(request.body);
    const { Photos } = request.body;
    const record = await fastify.prisma.$transaction(async (tx) => {
      if (Object.keys(data).length) {
        await tx.plant.update({
          where: { id: existing.id },
          data,
        });
      }
      if (Photos !== undefined) {
        await syncPlantPhotos(tx, existing.id, Photos);
      }
      return reloadPlantWithPhotos(tx, existing.id);
    });
    reply.send(formatPlant(record));
  });
}
