import { StatusCodes } from 'http-status-codes';

import {
  findMaintenanceRecordById,
  formatMaintenanceRecord,
  maintenanceRecordFieldsFromBody,
  MaintenanceRecordCreateSchema,
  MaintenanceRecordSchema,
  syncMaintenanceRecordPhotos,
  syncMaintenanceRecordPlants,
  validateMaintenanceRecordLinks,
} from '#models/maintenance-record.js';

export default async function (fastify, opts) {
  fastify.post('/', {
    schema: {
      description: 'Creates a maintenance record.',
      body: MaintenanceRecordCreateSchema,
      response: {
        [StatusCodes.CREATED]: MaintenanceRecordSchema,
        [StatusCodes.UNPROCESSABLE_ENTITY]: fastify.ValidationErrorSchema,
      },
    },
  }, async function (request, reply) {
    const record = await fastify.prisma.$transaction(async (tx) => {
      await validateMaintenanceRecordLinks(tx, request.body);
      const created = await tx.maintenanceRecord.create({
        data: maintenanceRecordFieldsFromBody(request.body),
      });
      if (request.body.plants !== undefined) {
        await syncMaintenanceRecordPlants(tx, created.id, request.body.plants);
      }
      if (request.body.photos !== undefined) {
        await syncMaintenanceRecordPhotos(tx, created.id, request.body.photos);
      }
      return findMaintenanceRecordById(tx, created.id);
    });
    reply.code(StatusCodes.CREATED).send(formatMaintenanceRecord(record));
  });
}
