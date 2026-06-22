import { StatusCodes } from 'http-status-codes';
import { z } from 'zod';

import { createPlot, formatPlot } from '#lib/airtable.js';

const PlotSchema = z.object({ id: z.string(), createdTime: z.string() }).passthrough();
const PlotFieldsSchema = z.record(z.string(), z.unknown());

export default async function (fastify, opts) {
  fastify.post('/', {
    schema: {
      description: 'Creates a new Plot in Airtable.',
      body: PlotFieldsSchema,
      response: {
        [StatusCodes.CREATED]: PlotSchema,
        [StatusCodes.UNPROCESSABLE_ENTITY]: z.null(),
      },
    },
    // ponytail: add requireUser/requireAdmin when auth is ready
  }, async function (request, reply) {
    const record = await createPlot(request.body);
    reply.code(StatusCodes.CREATED).send(formatPlot(record));
  });
}
