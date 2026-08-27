import { StatusCodes } from 'http-status-codes';
import { z } from 'zod';

import {
  findPlotByPublicId,
  formatPlot,
  plotFieldsFromBody,
  PlotFieldsSchema,
  PlotSchema,
  reloadPlotWithPhotos,
  syncPlotPhotos,
} from '#models/plot.js';

export default async function (fastify, opts) {
  fastify.patch('/:id', {
    schema: {
      description: 'Updates a Plot by UUID (or legacy Airtable record id).',
      params: z.object({
        id: z.string().min(1),
      }),
      body: PlotFieldsSchema,
      response: {
        [StatusCodes.OK]: PlotSchema,
        [StatusCodes.NOT_FOUND]: z.null(),
        [StatusCodes.UNPROCESSABLE_ENTITY]: z.null(),
      },
    },
  }, async function (request, reply) {
    const existing = await findPlotByPublicId(fastify.prisma, request.params.id);
    if (!existing) {
      return reply.code(StatusCodes.NOT_FOUND).send(null);
    }
    const data = plotFieldsFromBody(request.body);
    const { photos } = request.body;
    const record = await fastify.prisma.$transaction(async (tx) => {
      if (Object.keys(data).length) {
        await tx.plot.update({
          where: { id: existing.id },
          data,
        });
      }
      if (photos !== undefined) {
        await syncPlotPhotos(tx, existing.id, photos);
      }
      return reloadPlotWithPhotos(tx, existing.id);
    });
    reply.send(formatPlot(record));
  });
}
