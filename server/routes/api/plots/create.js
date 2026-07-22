import crypto from 'node:crypto';
import { StatusCodes } from 'http-status-codes';
import { z } from 'zod';

import { formatPlot, plotFieldsFromBody, PlotFieldsSchema, PlotSchema } from '#models/plot.js';

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
    const record = await fastify.prisma.plot.create({
      data: {
        airtableId: `pg_${crypto.randomUUID()}`,
        ...fields,
      },
    });
    reply.code(StatusCodes.CREATED).send(formatPlot(record));
  });
}
