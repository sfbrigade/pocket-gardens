import crypto from 'node:crypto';
import { z } from 'zod';
import { requireMaintenanceWriter, validateNewVisit } from '#lib/maintenance-policy.js';
import { maintenanceFingerprint, replayMaintenanceCreate } from '#lib/maintenance-save.js';
import { PhotoUploadError } from '#lib/photo-upload.js';
import { findPlotByPublicId } from '#models/plot.js';
import {
  findMaintenanceRecordById, formatMaintenanceRecord, maintenanceRecordFieldsFromBody,
  MaintenanceRecordCreateSchema, MaintenanceRecordSchema, syncMaintenanceRecordPhotos,
  syncMaintenanceRecordPlants, validateMaintenanceRecordLinks,
} from '#models/maintenance-record.js';

export default async function (fastify) {
  fastify.post('/', {
    onRequest: requireMaintenanceWriter(fastify),
    schema: {
      description: 'Creates a visit, safely replaying the same submitted draft.',
      body: MaintenanceRecordCreateSchema,
      response: { 200: MaintenanceRecordSchema, 201: MaintenanceRecordSchema, 409: z.object({ message: z.string() }), 410: z.object({ message: z.string() }), 422: fastify.ValidationErrorSchema },
    },
  }, async (request, reply) => {
    if (await replayMaintenanceCreate(fastify.prisma, request.body, reply)) return;
    try {
      const record = await fastify.prisma.$transaction(async (tx) => {
        const { plotId, ...body } = request.body;
        const plot = await findPlotByPublicId(tx, plotId, { select: { id: true, stage: true } });
        if (!plot) throw new PhotoUploadError('Garden not found', 'plotId');
        validateNewVisit(plot, body);
        await validateMaintenanceRecordLinks(tx, body);
        const created = await tx.maintenanceRecord.create({
          data: {
            airtableId: `pg_${crypto.randomUUID()}`,
            ...maintenanceRecordFieldsFromBody(body),
            plotId: plot.id,
            submissionId: body.submissionId,
            submissionFingerprint: maintenanceFingerprint(request.body),
            creditKind: request.user?.isActive && request.user.isAdmin ? 'admin' : 'anonymous',
            createdById: request.user?.isActive && request.user.isAdmin ? request.user.id : null,
          },
        });
        if (body.plants) await syncMaintenanceRecordPlants(tx, created.id, body.plants);
        if (body.photos) await syncMaintenanceRecordPhotos(tx, created.id, body.photos);
        return findMaintenanceRecordById(tx, created.id);
      });
      return reply.code(201).send(formatMaintenanceRecord(record));
    } catch (error) {
      if (await replayMaintenanceCreate(fastify.prisma, request.body, reply)) return;
      throw error;
    }
  });
}
