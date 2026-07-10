import { StatusCodes } from 'http-status-codes';
import { z } from 'zod';

import {
  airtable,
  formatPlot,
  normalizePlotFields,
  PlotFieldsSchema,
  PlotSchema,
  TABLES,
} from '#lib/airtable.js';

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
  }, async function (request, reply) {
    let fields;
    try {
      fields = normalizePlotFields(request.body);
    } catch (error) {
      if (error.statusCode === StatusCodes.UNPROCESSABLE_ENTITY) {
        return reply.code(StatusCodes.UNPROCESSABLE_ENTITY).send();
      }
      throw error;
    }
    const record = await airtable(TABLES.plots, '', {
      method: 'POST',
      body: { fields },
      searchParams: new URLSearchParams({ typecast: 'true' }),
    });
    reply.code(StatusCodes.CREATED).send(formatPlot(record));
  });
}
