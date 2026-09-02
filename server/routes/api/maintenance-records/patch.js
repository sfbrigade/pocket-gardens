import { StatusCodes } from 'http-status-codes';
import { z } from 'zod';

import {
  findMaintenanceRecordById,
  formatMaintenanceRecord,
  maintenanceRecordFieldsFromBody,
  MaintenanceRecordSchema,
  MaintenanceRecordUpdateSchema,
  syncMaintenanceRecordPhotos,
  syncMaintenanceRecordPlants,
  validateMaintenanceRecordLinks,
} from '#models/maintenance-record.js';

export default async function (fastify, opts) {
  fastify.patch('/:id', {
    schema: {
      description: 'Updates a maintenance record by id.',
      params: z.strictObject({ id: z.string().uuid() }),
      body: MaintenanceRecordUpdateSchema,
      response: {
        [StatusCodes.OK]: MaintenanceRecordSchema,
        [StatusCodes.NOT_FOUND]: z.null(),
        [StatusCodes.UNPROCESSABLE_ENTITY]: fastify.ValidationErrorSchema,
      },
    },
  }, async function (request, reply) {
    const existing = await findMaintenanceRecordById(fastify.prisma, request.params.id);
    if (!existing) return reply.code(StatusCodes.NOT_FOUND).send(null);

    const record = await fastify.prisma.$transaction(async (tx) => {
      await validateMaintenanceRecordLinks(tx, request.body, existing.id);
      const data = maintenanceRecordFieldsFromBody(request.body);
      if (Object.keys(data).length) {
        await tx.maintenanceRecord.update({ where: { id: existing.id }, data });
      }
      if (request.body.plants !== undefined) {
        await syncMaintenanceRecordPlants(tx, existing.id, request.body.plants);
      }
      if (request.body.photos !== undefined) {
        await syncMaintenanceRecordPhotos(tx, existing.id, request.body.photos);
      }
      return findMaintenanceRecordById(tx, existing.id);
    });
    reply.send(formatMaintenanceRecord(record));
  });
}
