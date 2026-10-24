import crypto from 'node:crypto';
import { StatusCodes } from 'http-status-codes';
import { createPlotPlants } from '#models/plot-plant.js';

import {
  formatPlot,
  allowsAnonymousPlotCreation,
  plotFieldsFromBody,
  PlotCreateSchema,
  PlotDetailSchema,
  reloadPlotDetails,
  syncPlotPhotos,
} from '#models/plot.js';

export default async function (fastify, opts) {
  fastify.post('/', {
    schema: {
      description: 'Creates a new Plot.',
      body: PlotCreateSchema,
      response: {
        [StatusCodes.CREATED]: PlotDetailSchema,
        [StatusCodes.UNPROCESSABLE_ENTITY]: fastify.ValidationErrorSchema,
      },
    },
    onRequest: async (request, reply) => {
      if (!allowsAnonymousPlotCreation()) return fastify.requireAdmin(request, reply);
    },
  }, async function (request, reply) {
    const fields = plotFieldsFromBody(request.body);
    fields.mapCoordinates = `${fields.latitude}, ${fields.longitude}`;
    const { Photos } = request.body;
    const publicId = `pg_${crypto.randomUUID()}`;
    const record = await fastify.prisma.$transaction(async (tx) => {
      const created = await tx.plot.create({
        data: {
          airtableId: publicId,
          ...fields,
          name: fields.name || [fields.streetAddress, publicId].filter(Boolean).join(' · '),
        },
      });
      await createPlotPlants(tx, created, request.body.plants);
      if (Photos !== undefined) {
        await syncPlotPhotos(tx, created.id, Photos);
      }
      return reloadPlotDetails(tx, created.id);
    });
    reply.code(StatusCodes.CREATED).send(formatPlot(record));
  });
}
