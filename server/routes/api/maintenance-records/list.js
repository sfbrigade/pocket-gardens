import { StatusCodes } from 'http-status-codes';
import { z } from 'zod';

import {
  formatMaintenanceRecord,
  MAINTENANCE_RECORD_SELECT,
  MaintenanceRecordListQuerySchema,
  MaintenanceRecordSchema,
} from '#models/maintenance-record.js';

const DEFAULT_PAGE_SIZE = 25;

function asDate (value) {
  return new Date(`${value}T00:00:00.000Z`);
}

export default async function (fastify, opts) {
  fastify.get('/', {
    schema: {
      description: 'Returns a filtered, paginated list of maintenance records. Use X-Next-Offset for the next page.',
      querystring: MaintenanceRecordListQuerySchema,
      response: {
        [StatusCodes.OK]: z.array(MaintenanceRecordSchema),
        [StatusCodes.UNPROCESSABLE_ENTITY]: fastify.ValidationErrorSchema,
      },
    },
  }, async function (request, reply) {
    const { pageSize = DEFAULT_PAGE_SIZE, offset = 0, plotId, volunteerId, from, to } = request.query;
    const where = {
      ...(plotId && { plotId }),
      ...(volunteerId && { volunteerId }),
      ...((from || to) && {
        date: {
          ...(from && { gte: asDate(from) }),
          ...(to && { lt: new Date(asDate(to).getTime() + 86_400_000) }),
        },
      }),
    };
    const records = await fastify.prisma.maintenanceRecord.findMany({
      where,
      select: MAINTENANCE_RECORD_SELECT,
      orderBy: [
        { date: { sort: 'desc', nulls: 'last' } },
        { id: 'asc' },
      ],
      skip: offset,
      take: pageSize + 1,
    });
    const hasMore = records.length > pageSize;
    const page = hasMore ? records.slice(0, pageSize) : records;
    if (hasMore) reply.header('X-Next-Offset', String(offset + pageSize));
    reply.send(page.map(formatMaintenanceRecord));
  });
}
