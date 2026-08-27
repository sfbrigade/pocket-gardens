import { StatusCodes } from 'http-status-codes';
import { z } from 'zod';

import { findPlotByPublicId, formatPlot, PlotSchema } from '#models/plot.js';

export default async function (fastify, opts) {
  fastify.get('/:id', {
    schema: {
      description: 'Returns a Plot by UUID (or legacy Airtable record id).',
      params: z.object({
        id: z.string().min(1),
      }),
      response: {
        [StatusCodes.OK]: PlotSchema,
        [StatusCodes.NOT_FOUND]: z.null(),
      },
    },
  }, async function (request, reply) {
    const record = await findPlotByPublicId(fastify.prisma, request.params.id);
    if (!record) {
      return reply.code(StatusCodes.NOT_FOUND).send(null);
    }
    reply.send(formatPlot(record));
  });
}
