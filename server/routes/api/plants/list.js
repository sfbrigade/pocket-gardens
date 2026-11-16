import { StatusCodes } from 'http-status-codes';
import { z } from 'zod';
import { searchPlants } from '#lib/plant-search.js';

import {
  formatPlant,
  PLANT_PHOTOS_INCLUDE,
  PlantSchema,
} from '#models/plant.js';

const DEFAULT_PAGE_SIZE = 25;

const ListQuerySchema = z.strictObject({
  pageSize: z.coerce.number().int().min(1).max(100).optional(),
  offset: z.coerce.number().int().nonnegative().optional(),
  search: z.string().trim().min(1).max(200).optional(),
});

export default async function (fastify, opts) {
  fastify.get('/', {
    schema: {
      description: 'Returns a paginated list of Plants. Use X-Next-Offset for the next page.',
      querystring: ListQuerySchema,
      response: {
        [StatusCodes.OK]: z.array(PlantSchema),
        [StatusCodes.UNPROCESSABLE_ENTITY]: fastify.ValidationErrorSchema,
      },
    },
  }, async function (request, reply) {
    const pageSize = request.query.pageSize ?? DEFAULT_PAGE_SIZE;
    const skip = request.query.offset ?? 0;

    const records = request.query.search
      ? await searchPlants(fastify.prisma, { search: request.query.search, skip, take: pageSize + 1 })
      : await fastify.prisma.plant.findMany({
        include: PLANT_PHOTOS_INCLUDE,
        orderBy: { id: 'asc' },
        skip,
        take: pageSize + 1,
      });

    const hasMore = records.length > pageSize;
    const page = hasMore ? records.slice(0, pageSize) : records;
    if (hasMore) {
      reply.header('X-Next-Offset', String(skip + pageSize));
    }
    reply.send(page.map(formatPlant));
  });
}
