import { StatusCodes } from 'http-status-codes';
import { z } from 'zod';

import {
  airtable,
  buildListSearchParams,
  buildViewportFormula,
  DEFAULT_PAGE_SIZE,
  formatPlot,
  PlotSchema,
  TABLES,
} from '#lib/airtable.js';

const VIEWPORT_KEYS = ['north', 'south', 'east', 'west'];

const ListQuerySchema = z.object({
  pageSize: z.coerce.number().min(1).max(100).optional(),
  offset: z.string().optional(),
  north: z.coerce.number().min(-90).max(90).optional(),
  south: z.coerce.number().min(-90).max(90).optional(),
  east: z.coerce.number().min(-180).max(180).optional(),
  west: z.coerce.number().min(-180).max(180).optional(),
}).superRefine((data, ctx) => {
  const present = VIEWPORT_KEYS.filter((key) => data[key] !== undefined);
  if (present.length > 0 && present.length < VIEWPORT_KEYS.length) {
    ctx.addIssue({
      code: 'custom',
      message: 'north, south, east, and west must all be provided together',
    });
  }
  if (data.north !== undefined && data.south !== undefined && data.north < data.south) {
    ctx.addIssue({
      code: 'custom',
      message: 'north must be >= south',
      path: ['north'],
    });
  }
});

function hasViewport (query) {
  return VIEWPORT_KEYS.every((key) => query[key] !== undefined);
}

export default async function (fastify, opts) {
  fastify.get('/', {
    schema: {
      description: 'Returns a paginated list of Plots from Airtable. Pass north, south, east, and west (Leaflet map.getBounds()) to filter plots visible in the map viewport. Use X-Next-Offset for the next page.',
      querystring: ListQuerySchema,
      response: {
        [StatusCodes.OK]: z.array(PlotSchema),
      },
    },
  }, async function (request, reply) {
    const pageSize = request.query.pageSize ?? DEFAULT_PAGE_SIZE;
    const options = {
      pageSize,
      offset: request.query.offset,
    };
    if (hasViewport(request.query)) {
      options.filterByFormula = buildViewportFormula({
        north: request.query.north,
        south: request.query.south,
        east: request.query.east,
        west: request.query.west,
      });
    }
    const searchParams = buildListSearchParams(options);
    const { records, offset: nextOffset } = await airtable(TABLES.plots, '', { searchParams });
    if (nextOffset) {
      reply.header('X-Next-Offset', nextOffset);
    }
    reply.send(records.map(formatPlot));
  });
}
