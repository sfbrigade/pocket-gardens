import { StatusCodes } from 'http-status-codes';
import { z } from 'zod';

import {
  airtable,
  DEFAULT_PAGE_SIZE,
  formatPlot,
  PlotSchema,
  TABLES,
} from '#lib/airtable.js';

const ListQuerySchema = z.object({
  pageSize: z.coerce.number().min(1).max(100).optional(),
  offset: z.string().optional(),
});

export default async function (fastify, opts) {
  fastify.get('/', {
    schema: {
      description: 'Returns a paginated list of Plots from Airtable. Use X-Next-Offset for the next page.',
      querystring: ListQuerySchema,
      response: {
        [StatusCodes.OK]: z.array(PlotSchema),
      },
    },
    // ponytail: add requireUser/requireAdmin when auth is ready
  }, async function (request, reply) {
    const pageSize = request.query.pageSize ?? DEFAULT_PAGE_SIZE;
    const searchParams = new URLSearchParams({ pageSize: String(pageSize) });
    if (request.query.offset) {
      searchParams.set('offset', request.query.offset);
    }
    const { records, offset: nextOffset } = await airtable(TABLES.plots, '', { searchParams });
    if (nextOffset) {
      reply.header('X-Next-Offset', nextOffset);
    }
    reply.send(records.map(formatPlot));
  });
}
