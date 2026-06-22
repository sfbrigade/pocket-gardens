import { StatusCodes } from 'http-status-codes';
import { z } from 'zod';

import { airtable, formatPlot, PlotFieldsSchema, PlotSchema, TABLES } from '#lib/airtable.js';

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
    const record = await airtable(TABLES.plots, '', {
      method: 'POST',
      body: { fields: request.body },
      searchParams: new URLSearchParams({ typecast: 'true' }),
    });
    reply.code(StatusCodes.CREATED).send(formatPlot(record));
  });
}
