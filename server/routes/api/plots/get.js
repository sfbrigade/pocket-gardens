import { StatusCodes } from 'http-status-codes';
import { z } from 'zod';

import { formatPlot, getPlot } from '#lib/airtable.js';

const PlotSchema = z.object({ id: z.string(), createdTime: z.string() }).passthrough();

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
    // ponytail: add requireUser/requireAdmin when auth is ready
  }, async function (request, reply) {
    const { id } = request.params;
    const record = await getPlot(id);
    reply.send(formatPlot(record));
  });
}
