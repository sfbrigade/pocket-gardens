import { StatusCodes } from 'http-status-codes';
import { z } from 'zod';

import {
  findMaintenanceRecordById,
  formatMaintenanceRecord,
  MaintenanceRecordSchema,
} from '#models/maintenance-record.js';

export default async function (fastify, opts) {
  fastify.get('/:id', {
    schema: {
      description: 'Returns a maintenance record by id.',
      params: z.strictObject({ id: z.string().uuid() }),
      response: {
        [StatusCodes.OK]: MaintenanceRecordSchema,
        [StatusCodes.NOT_FOUND]: z.null(),
        [StatusCodes.UNPROCESSABLE_ENTITY]: fastify.ValidationErrorSchema,
      },
    },
  }, async function (request, reply) {
    const record = await findMaintenanceRecordById(fastify.prisma, request.params.id);
    if (!record) return reply.code(StatusCodes.NOT_FOUND).send(null);
    reply.send(formatMaintenanceRecord(record));
  });
}
