import { StatusCodes } from 'http-status-codes';
import { z } from 'zod';

import {
  airtable,
  formatPlot,
  preparePlotFieldsForWrite,
  PlotFieldsSchema,
  PlotSchema,
  TABLES,
} from '#lib/airtable.js';

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
  }, async function (request, reply) {
    const { id } = request.params;
    let fields;
    try {
      fields = preparePlotFieldsForWrite(request.body);
    } catch (error) {
      if (error.statusCode === StatusCodes.UNPROCESSABLE_ENTITY) {
        return reply.code(StatusCodes.UNPROCESSABLE_ENTITY).send();
      }
      throw error;
    }
    const record = await airtable(TABLES.plots, `/${id}`, {
      method: 'PATCH',
      body: { fields },
      searchParams: new URLSearchParams({ typecast: 'true' }),
    });
    reply.send(formatPlot(record));
  });
}
