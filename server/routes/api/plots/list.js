import { StatusCodes } from 'http-status-codes';
import { z } from 'zod';

import { formatPlot, listPlots, DEFAULT_PAGE_SIZE } from '#lib/airtable.js';

const PlotSchema = z.object({ id: z.string(), createdTime: z.string() }).passthrough();

const SortSchema = z.array(z.object({
  field: z.string(),
  direction: z.enum(['asc', 'desc']).optional(),
}));

const ListQuerySchema = z.object({
  pageSize: z.coerce.number().min(1).max(100).optional(),
  offset: z.string().optional(),
  maxRecords: z.coerce.number().min(1).optional(),
  view: z.string().optional(),
  filterByFormula: z.string().optional(),
  fields: z.union([z.string(), z.array(z.string())]).optional().transform((v) => v === undefined ? undefined : [].concat(v)),
  sort: z.string().optional().transform((value, ctx) => {
    if (!value) return undefined;
    try {
      return SortSchema.parse(JSON.parse(value));
    } catch {
      ctx.addIssue({ code: 'custom', message: 'sort must be a JSON array of { field, direction? }' });
      return z.NEVER;
    }
  }),
});

function nextPageLink (request, nextOffset) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(request.query)) {
    if (key === 'offset' || value === undefined) continue;
    if (Array.isArray(value)) {
      for (const item of value) params.append(key, item);
    } else {
      params.set(key, String(value));
    }
  }
  params.set('offset', nextOffset);
  const base = `${request.protocol}://${request.hostname}${request.routeOptions.url}`;
  return `${base}?${params}`;
}

export default async function (fastify, opts) {
  fastify.get('/', {
    schema: {
      description: 'Returns a paginated list of Plots from Airtable. Passes through Airtable list params (pageSize, offset, fields, sort, view, filterByFormula, maxRecords). Use X-Next-Offset or Link rel=next for the next page.',
      querystring: ListQuerySchema,
      response: {
        [StatusCodes.OK]: z.array(PlotSchema),
      },
    },
    // ponytail: add requireUser/requireAdmin when auth is ready
  }, async function (request, reply) {
    const {
      offset,
      maxRecords,
      view,
      filterByFormula,
      fields,
      sort,
    } = request.query;
    const pageSize = request.query.pageSize ?? DEFAULT_PAGE_SIZE;
    const { records, offset: nextOffset } = await listPlots({
      pageSize,
      offset,
      maxRecords,
      view,
      filterByFormula,
      fields,
      sort,
    });
    if (nextOffset) {
      reply.header('Link', `<${nextPageLink(request, nextOffset)}>; rel="next"`);
      reply.header('X-Next-Offset', nextOffset);
    }
    reply.header('X-Page-Size', pageSize);
    reply.send(records.map(formatPlot));
  });
}
