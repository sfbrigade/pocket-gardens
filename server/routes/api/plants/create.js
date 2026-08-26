import crypto from 'node:crypto';
import { StatusCodes } from 'http-status-codes';
import { z } from 'zod';

import {
  formatPlant,
  plantFieldsFromBody,
  PlantFieldsSchema,
  PlantSchema,
  reloadPlantWithPhotos,
  syncPlantPhotos,
} from '#models/plant.js';

export default async function (fastify, opts) {
  fastify.post('/', {
    schema: {
      description: 'Creates a new Plant.',
      body: PlantFieldsSchema,
      response: {
        [StatusCodes.CREATED]: PlantSchema,
        [StatusCodes.UNPROCESSABLE_ENTITY]: z.null(),
      },
    },
  }, async function (request, reply) {
    const fields = plantFieldsFromBody(request.body);
    const { Photos } = request.body;
    const record = await fastify.prisma.$transaction(async (tx) => {
      const created = await tx.plant.create({
        data: {
          airtableId: `pg_${crypto.randomUUID()}`,
          ...fields,
        },
      });
      if (Photos !== undefined) {
        await syncPlantPhotos(tx, created.id, Photos);
      }
      return reloadPlantWithPhotos(tx, created.id);
    });
    reply.code(StatusCodes.CREATED).send(formatPlant(record));
  });
}
