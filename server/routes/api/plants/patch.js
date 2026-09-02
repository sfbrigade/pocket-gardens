import { errorCodes } from 'fastify';
import { StatusCodes } from 'http-status-codes';
import { z } from 'zod';

import {
  findPlantById,
  formatPlant,
  plantFieldsFromBody,
  PlantUpdateFieldsSchema,
  PlantSchema,
  syncPlantPhotos,
} from '#models/plant.js';

function invalidPhotosError () {
  const error = errorCodes.FST_ERR_VALIDATION();
  error.validation = [{
    params: { issue: { path: ['Photos'], message: 'Photo does not belong to this plant' } },
  }];
  return error;
}

export default async function (fastify, opts) {
  fastify.patch('/:id', {
    schema: {
      description: 'Updates a Plant by id.',
      params: z.object({
        id: z.string().uuid(),
      }),
      body: PlantUpdateFieldsSchema,
      response: {
        [StatusCodes.OK]: PlantSchema,
        [StatusCodes.NOT_FOUND]: z.null(),
        [StatusCodes.UNPROCESSABLE_ENTITY]: fastify.ValidationErrorSchema,
      },
    },
  }, async function (request, reply) {
    const existing = await findPlantById(fastify.prisma, request.params.id);
    if (!existing) {
      return reply.code(StatusCodes.NOT_FOUND).send(null);
    }
    const data = plantFieldsFromBody(request.body);
    const { Photos } = request.body;
    const record = await fastify.prisma.$transaction(async (tx) => {
      const photoIds = Photos?.flatMap((photo) => photo.id ? [photo.id] : []) ?? [];
      if (photoIds.length && await tx.plantPhoto.count({
        where: { plantId: existing.id, id: { in: photoIds } },
      }) !== photoIds.length) {
        throw invalidPhotosError();
      }
      if (Object.keys(data).length) {
        await tx.plant.update({
          where: { id: existing.id },
          data,
        });
      }
      if (Photos !== undefined) {
        await syncPlantPhotos(tx, existing.id, Photos);
      }
      return findPlantById(tx, existing.id);
    });
    reply.send(formatPlant(record));
  });
}
