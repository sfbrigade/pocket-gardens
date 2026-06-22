import { StatusCodes } from 'http-status-codes';
import { z } from 'zod';

import { formatPlot, updatePlot } from '#lib/airtable.js';

const PlotSchema = z.object({ id: z.string(), createdTime: z.string() }).passthrough();
const PlotFieldsSchema = z.record(z.string(), z.unknown());

export default async function (fastify, opts) {
  fastify.patch('/:id', {
    schema: {
      description: 'Updates a Plot in Airtable.',
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
    // ponytail: add requireUser/requireAdmin when auth is ready
  }, async function (request, reply) {
    const { id } = request.params;
    const record = await updatePlot(id, request.body);
    reply.send(formatPlot(record));
  });
}
