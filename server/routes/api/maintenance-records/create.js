import crypto from 'node:crypto';
import { z } from 'zod';
import { requireMaintenanceCreator, validateNewVisit } from '#lib/maintenance-policy.js';
import { maintenanceFingerprint, replayMaintenanceCreate, transactionRolledBack } from '#lib/maintenance-save.js';
import { PhotoUploadError } from '#lib/photo-upload.js';
import { cleanupPhotoObjects } from '#lib/photos.js';
import { findPlotByPublicId } from '#models/plot.js';
import {
  findMaintenanceRecordById, formatMaintenanceRecord, maintenanceRecordFieldsFromBody,
  MaintenanceRecordCreateSchema, MaintenanceRecordSchema, syncMaintenanceRecordPhotos,
  syncMaintenanceRecordPlants,
} from '#models/maintenance-record.js';

export default async function (fastify) {
  fastify.post('/', {
    onRequest: requireMaintenanceCreator(fastify),
    schema: {
      description: 'Creates a visit, safely replaying the same submitted draft.',
      body: MaintenanceRecordCreateSchema,
      response: { 200: MaintenanceRecordSchema, 201: MaintenanceRecordSchema, 409: z.object({ message: z.string() }), 410: z.object({ message: z.string() }), 422: fastify.ValidationErrorSchema },
    },
  }, async (request, reply) => {
    if (await replayMaintenanceCreate(fastify.prisma, request.body, reply)) return;
    const contributor = request.user?.canContribute ? request.user : null;
    const copied = [];
    let callbackCompleted = false;
    try {
      const record = await fastify.prisma.$transaction(async (tx) => {
        const { plotId, ...body } = request.body;
        const plot = await findPlotByPublicId(tx, plotId, { select: { id: true, stage: true } });
        if (!plot) throw new PhotoUploadError('Garden not found', 'plotId');
        validateNewVisit(plot, body);
        const created = await tx.maintenanceRecord.create({
          data: {
            airtableId: `pg_${crypto.randomUUID()}`,
            ...maintenanceRecordFieldsFromBody(body),
            plotId: plot.id,
            submissionId: body.submissionId,
            submissionFingerprint: maintenanceFingerprint(request.body),
            creditKind: contributor ? (contributor.isAdmin ? 'admin' : 'community') : 'anonymous',
            createdById: contributor?.id ?? null,
          },
        });
        if (body.plants) await syncMaintenanceRecordPlants(tx, created.id, body.plants);
        if (body.photos) await syncMaintenanceRecordPhotos(tx, created.id, body.photos, { retainUpload: true, onCopyTarget: (key) => copied.push(key) });
        // Uploads can take time. Prevent a stage change between the final
        // eligibility check and the commit, without locking during copies.
        const [currentPlot] = await tx.$queryRaw`SELECT "stage" FROM "Plot" WHERE id = ${plot.id}::uuid FOR SHARE`;
        validateNewVisit(currentPlot, body);
        const saved = await findMaintenanceRecordById(tx, created.id);
        callbackCompleted = true;
        return saved;
      }, { timeout: 60000 });
      await cleanupPhotoObjects((request.body.photos ?? []).map(({ upload }) => `_uploads/${upload}`), request.log);
      return reply.code(201).send(formatMaintenanceRecord(record));
    } catch (error) {
      if (!callbackCompleted || transactionRolledBack(error)) await cleanupPhotoObjects(copied, request.log);
      if (await replayMaintenanceCreate(fastify.prisma, request.body, reply)) return;
      throw error;
    }
  });
}
