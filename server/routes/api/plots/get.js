import { StatusCodes } from 'http-status-codes';
import { z } from 'zod';

import { airtable, formatPlot, PlotSchema, TABLES } from '#lib/airtable.js';

export default async function (fastify, opts) {
  fastify.get('/:id', {
    schema: {
      description: 'Returns a Plot by Airtable record id.',
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
    const record = await airtable(TABLES.plots, `/${id}`);
    reply.send(formatPlot(record));
  });
}
