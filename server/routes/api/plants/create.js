import { StatusCodes } from 'http-status-codes';

import {
  createPlant,
  findPlantById,
  formatPlant,
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
    const { photos } = request.body;
    const record = await fastify.prisma.$transaction(async (tx) => {
      const created = await createPlant(tx, request.body);
      if (photos !== undefined) {
        await syncPlantPhotos(tx, created.id, photos);
      }
      return findPlantById(tx, created.id);
    });
    reply.code(StatusCodes.CREATED).send(formatPlant(record));
  });
}
