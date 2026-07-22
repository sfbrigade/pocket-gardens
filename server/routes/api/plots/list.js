import { StatusCodes } from 'http-status-codes';
import { z } from 'zod';

import {
  buildViewportWhere,
  decodeListOffset,
  DEFAULT_PAGE_SIZE,
  encodeListOffset,
  formatPlot,
  PlotSchema,
} from '#models/plot.js';

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
      description: 'Returns a paginated list of Plots. Pass north, south, east, and west (Leaflet map.getBounds()) to filter plots visible in the map viewport. Use X-Next-Offset for the next page.',
      querystring: ListQuerySchema,
      response: {
        [StatusCodes.OK]: z.array(PlotSchema),
      },
    },
  }, async function (request, reply) {
    const pageSize = request.query.pageSize ?? DEFAULT_PAGE_SIZE;
    const skip = decodeListOffset(request.query.offset);
    const where = hasViewport(request.query)
      ? buildViewportWhere({
        north: request.query.north,
        south: request.query.south,
        east: request.query.east,
        west: request.query.west,
      })
      : {};

    const records = await fastify.prisma.plot.findMany({
      where,
      orderBy: { airtableId: 'asc' },
      skip,
      take: pageSize + 1,
    });

    const hasMore = records.length > pageSize;
    const page = hasMore ? records.slice(0, pageSize) : records;
    if (hasMore) {
      reply.header('X-Next-Offset', encodeListOffset(skip + pageSize));
    }
    reply.send(page.map(formatPlot));
  });
}
