import { z } from 'zod';
import { activities, requireMaintenanceWriter } from '#lib/maintenance-policy.js';
import { maintenanceFingerprint } from '#lib/maintenance-save.js';
import { PhotoUploadError } from '#lib/photo-upload.js';
import { cleanupSubmissionObjects } from '#lib/plot-submission.js';
import { changeMaintenancePhotos, cleanupMaintenancePhotos } from '#lib/maintenance-photos.js';
import {
  findMaintenanceRecordById, formatMaintenanceRecord, hasMaintenanceContent,
  maintenanceRecordFieldsFromBody, MaintenanceRecordSchema, MaintenanceRecordUpdateSchema,
  syncMaintenanceRecordPlants, validateMaintenanceRecordLinks,
} from '#models/maintenance-record.js';

const conflict = () => Object.assign(new Error('This update changed since you opened it. Reload and review your changes.'), { statusCode: 409 });

export default async function (fastify) {
  fastify.patch('/:id', {
    onRequest: requireMaintenanceWriter(fastify),
    schema: {
      description: 'Corrects a visit with optimistic concurrency and recoverable photo removal.',
      params: z.object({ id: z.string().uuid() }),
      body: MaintenanceRecordUpdateSchema,
      response: { 200: MaintenanceRecordSchema, 404: z.null(), 409: z.object({ message: z.string() }), 422: fastify.ValidationErrorSchema },
    },
  }, async (request, reply) => {
    const body = request.body;
    const fingerprint = maintenanceFingerprint(body);
    const copied = [];
    let callbackCompleted = false;
    async function recover () {
      const row = await fastify.prisma.maintenanceRecord.findUnique({ where: { id: request.params.id } });
      if (row && !row.deletedAt && row.lastMutationId === body.mutationId && row.lastMutationFingerprint === fingerprint) return findMaintenanceRecordById(fastify.prisma, row.id);
      return null;
    }
    let record = await recover();
    if (!record) {
      try {
        record = await fastify.prisma.$transaction(async (tx) => {
          const existing = await findMaintenanceRecordById(tx, request.params.id);
          if (!existing) return null;
          if (existing.version !== body.version) throw conflict();
          if (body.activity?.some((value) => !activities.includes(value) && !existing.activity.includes(value))) throw new PhotoUploadError('Choose a supported activity', 'activity');
          for (const field of ['activity', 'observations']) {
            if (body[field] && new Set(body[field]).size !== body[field].length) throw new PhotoUploadError('Choose each option once', field);
          }
          if (body.observations?.includes('Nothing stood out') && body.observations.length > 1) throw new PhotoUploadError('Nothing stood out cannot be combined with other observations', 'observations');
          const activePhotos = existing.photos.filter(({ pendingRemovalAt }) => !pendingRemovalAt);
          if (body.photos?.length > 4 && (body.photos.some(({ upload }) => upload) || body.photos.length > activePhotos.length)) throw new PhotoUploadError('Attach up to four photos', 'photos');
          if (hasMaintenanceContent({ ...existing, photos: activePhotos }) && !hasMaintenanceContent({ ...existing, photos: activePhotos, ...body })) throw new PhotoUploadError('Keep an activity, observation, photo, or note', 'notes');
          await validateMaintenanceRecordLinks(tx, body, existing.id);
          const updated = await tx.maintenanceRecord.updateMany({
            where: { id: existing.id, version: body.version, deletedAt: null },
            data: {
              ...maintenanceRecordFieldsFromBody(body),
              version: { increment: 1 },
              editedAt: new Date(),
              lastMutationId: body.mutationId,
              lastMutationFingerprint: fingerprint,
              lastChangedById: request.user?.isActive && request.user.isAdmin ? request.user.id : null,
            },
          });
          if (!updated.count) throw conflict();
          if (body.plants !== undefined) await syncMaintenanceRecordPlants(tx, existing.id, body.plants);
          if (body.photos !== undefined) await changeMaintenancePhotos(tx, existing.id, body.photos, { retainUpload: true, onCopyTarget: (key) => copied.push(key) });
          const saved = await findMaintenanceRecordById(tx, existing.id);
          callbackCompleted = true;
          return saved;
        });
      } catch (error) {
        if (!callbackCompleted) await cleanupSubmissionObjects(copied, request.log);
        record = await recover();
        if (!record) throw error;
      }
    }
    if (!record) return reply.code(404).send(null);
    await cleanupSubmissionObjects((body.photos ?? []).flatMap(({ upload }) => upload ? [`_uploads/${upload}`] : []), request.log);
    // Cleanup failures must not turn an already-committed correction into a 500.
    try { await cleanupMaintenancePhotos(fastify.prisma, request.log, { recordId: record.id }); } catch (error) { request.log.warn({ err: error }, 'Maintenance cleanup remains pending'); }
    const current = await findMaintenanceRecordById(fastify.prisma, record.id);
    if (!current) return reply.code(404).send(null);
    return reply.send(formatMaintenanceRecord(current));
  });
}
