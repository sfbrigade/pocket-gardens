import crypto from 'node:crypto';
import { StatusCodes } from 'http-status-codes';

import {
  findPlantById,
  formatPlant,
  plantFieldsFromBody,
  PlantCreateFieldsSchema,
  PlantSchema,
  syncPlantPhotos,
} from '#models/plant.js';

export default async function (fastify, opts) {
  fastify.post('/', {
    schema: {
      description: 'Creates a new Plant.',
      body: PlantCreateFieldsSchema,
      response: {
        [StatusCodes.CREATED]: PlantSchema,
        [StatusCodes.UNPROCESSABLE_ENTITY]: fastify.ValidationErrorSchema,
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
      return findPlantById(tx, created.id);
    });
    reply.code(StatusCodes.CREATED).send(formatPlant(record));
  });
}
