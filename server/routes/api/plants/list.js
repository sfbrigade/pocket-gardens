import { StatusCodes } from 'http-status-codes';
import { z } from 'zod';

import {
  decodeListOffset,
  DEFAULT_PAGE_SIZE,
  encodeListOffset,
  formatPlant,
  PLANT_PHOTOS_INCLUDE,
  PlantSchema,
} from '#models/plant.js';

const ListQuerySchema = z.object({
  pageSize: z.coerce.number().min(1).max(100).optional(),
  offset: z.string().optional(),
});

export default async function (fastify, opts) {
  fastify.get('/', {
    schema: {
      description: 'Returns a paginated list of Plants. Use X-Next-Offset for the next page.',
      querystring: ListQuerySchema,
      response: {
        [StatusCodes.OK]: z.array(PlantSchema),
      },
    },
  }, async function (request, reply) {
    const pageSize = request.query.pageSize ?? DEFAULT_PAGE_SIZE;
    const skip = decodeListOffset(request.query.offset);

    const records = await fastify.prisma.plant.findMany({
      include: PLANT_PHOTOS_INCLUDE,
      orderBy: { id: 'asc' },
      skip,
      take: pageSize + 1,
    });

    const hasMore = records.length > pageSize;
    const page = hasMore ? records.slice(0, pageSize) : records;
    if (hasMore) {
      reply.header('X-Next-Offset', encodeListOffset(skip + pageSize));
    }
    reply.send(page.map(formatPlant));
  });
}
