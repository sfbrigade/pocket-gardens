import { StatusCodes } from 'http-status-codes';
import { z } from 'zod';

import {
  airtable,
  buildListSearchParams,
  DEFAULT_PAGE_SIZE,
  formatPlot,
  isInViewport,
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
      description: 'Returns a paginated list of Plots from Airtable. Pass north, south, east, and west (Leaflet map.getBounds()) to filter plots visible in the map viewport; in viewport mode, pageSize and offset are ignored and all matching plots are returned. Without viewport params, use X-Next-Offset for the next page.',
      querystring: ListQuerySchema,
      response: {
        [StatusCodes.OK]: z.array(PlotSchema),
      },
    },
  }, async function (request, reply) {
    const pageSize = request.query.pageSize ?? DEFAULT_PAGE_SIZE;

    if (hasViewport(request.query)) {
      const viewport = {
        north: request.query.north,
        south: request.query.south,
        east: request.query.east,
        west: request.query.west,
      };
      const records = [];
      let offset;
      do {
        const searchParams = buildListSearchParams({ pageSize: 100, offset });
        const page = await airtable(TABLES.plots, '', { searchParams });
        records.push(...page.records);
        offset = page.offset;
      } while (offset);
      const plots = records
        .map(formatPlot)
        .filter((plot) => {
          const latitude = plot.Latitude;
          const longitude = plot.Longitude;
          if (latitude === undefined || longitude === undefined) {
            return false;
          }
          return isInViewport({ latitude, longitude }, viewport);
        });
      reply.send(plots);
      return;
    }

    const searchParams = buildListSearchParams({
      pageSize,
      offset: request.query.offset,
    });
    const { records, offset: nextOffset } = await airtable(TABLES.plots, '', { searchParams });
    if (nextOffset) {
      reply.header('X-Next-Offset', nextOffset);
    }
    reply.send(records.map(formatPlot));
  });
}
