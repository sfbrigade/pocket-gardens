import { StatusCodes } from 'http-status-codes';
import { z } from 'zod';

import { formatPlot, plotFieldsFromBody, PlotFieldsSchema, PlotSchema } from '#models/plot.js';

export default async function (fastify, opts) {
  fastify.patch('/:id', {
    schema: {
      description: 'Updates a Plot by Airtable record id (or internal UUID).',
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
    const { id } = request.params;
    const existing = await fastify.prisma.plot.findFirst({
      where: {
        OR: [
          { airtableId: id },
          ...(id.match(/^[0-9a-f-]{36}$/i) ? [{ id }] : []),
        ],
      },
    });
    if (!existing) {
      return reply.code(StatusCodes.NOT_FOUND).send(null);
    }
    const record = await fastify.prisma.plot.update({
      where: { id: existing.id },
      data: plotFieldsFromBody(request.body),
    });
    reply.send(formatPlot(record));
  });
}
