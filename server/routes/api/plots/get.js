import { StatusCodes } from 'http-status-codes';
import { z } from 'zod';

import { formatPlot, PlotSchema } from '#models/plot.js';

export default async function (fastify, opts) {
  fastify.get('/:id', {
    schema: {
      description: 'Returns a Plot by Airtable record id (or internal UUID).',
      params: z.object({
        id: z.string().min(1),
      }),
      response: {
        [StatusCodes.OK]: PlotSchema,
        [StatusCodes.NOT_FOUND]: z.null(),
      },
    },
  }, async function (request, reply) {
    const { id } = request.params;
    const record = await fastify.prisma.plot.findFirst({
      where: {
        OR: [
          { airtableId: id },
          ...(id.match(/^[0-9a-f-]{36}$/i) ? [{ id }] : []),
        ],
      },
    });
    if (!record) {
      return reply.code(StatusCodes.NOT_FOUND).send(null);
    }
    reply.send(formatPlot(record));
  });
}
