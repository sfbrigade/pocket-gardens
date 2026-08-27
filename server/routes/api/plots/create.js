import crypto from 'node:crypto';
import { StatusCodes } from 'http-status-codes';
import { z } from 'zod';

import {
  formatPlot,
  plotFieldsFromBody,
  PlotFieldsSchema,
  PlotSchema,
  reloadPlotWithPhotos,
  syncPlotPhotos,
} from '#models/plot.js';

export default async function (fastify, opts) {
  fastify.post('/', {
    schema: {
      description: 'Creates a new Plot.',
      body: PlotFieldsSchema,
      response: {
        [StatusCodes.CREATED]: PlotSchema,
        [StatusCodes.UNPROCESSABLE_ENTITY]: z.null(),
      },
    },
  }, async function (request, reply) {
    const fields = plotFieldsFromBody(request.body);
    const { photos } = request.body;
    const record = await fastify.prisma.$transaction(async (tx) => {
      const created = await tx.plot.create({
        data: {
          airtableId: `pg_${crypto.randomUUID()}`,
          ...fields,
        },
      });
      if (photos !== undefined) {
        await syncPlotPhotos(tx, created.id, photos);
      }
      return reloadPlotWithPhotos(tx, created.id);
    });
    reply.code(StatusCodes.CREATED).send(formatPlot(record));
  });
}
