import { z } from 'zod';
import { activities, requireMaintenanceManager } from '#lib/maintenance-policy.js';
import { maintenanceFingerprint } from '#lib/maintenance-save.js';
import { PhotoUploadError } from '#lib/photo-upload.js';
import { cleanupPhotoObjects } from '#lib/photos.js';
import { changeMaintenancePhotos, cleanupMaintenancePhotos } from '#lib/maintenance-photos.js';
import {
  findMaintenanceRecordById, formatMaintenanceRecord, hasMaintenanceContent,
  maintenanceRecordFieldsFromBody, MAINTENANCE_RECORD_SELECT, MaintenanceRecordSchema, MaintenanceRecordUpdateSchema,
  syncMaintenanceRecordPlants, validateMaintenanceRecordLinks,
} from '#models/maintenance-record.js';

const conflict = () => Object.assign(new Error('This update changed since you opened it. Reload and review your changes.'), { statusCode: 409 });

export default async function (fastify) {
  fastify.patch('/:id', {
    onRequest: requireMaintenanceManager(fastify),
    schema: {
      description: 'Corrects a visit with optimistic concurrency and recoverable photo removal.',
      params: z.object({ id: z.string().uuid() }),
      body: MaintenanceRecordUpdateSchema,
      response: {
        200: MaintenanceRecordSchema.extend({ cleanupPending: z.boolean() }),
        404: z.null(),
        409: z.object({ message: z.string() }),
        422: fastify.ValidationErrorSchema,
      },
    },
  }, async (request, reply) => {
    const body = request.body;
    const { id } = request.params;
    const fingerprint = maintenanceFingerprint(body);
    const copied = [];
    let callbackCompleted = false;
    const recover = () => fastify.prisma.maintenanceRecord.findFirst({
      where: { id, deletedAt: null, lastMutationId: body.mutationId, lastMutationFingerprint: fingerprint },
      select: { id: true },
    });
    let committed = Boolean(await recover());
    if (!committed) {
      try {
        committed = await fastify.prisma.$transaction(async (tx) => {
          const existing = await findMaintenanceRecordById(tx, id);
          if (!existing) return false;
          if (existing.version !== body.version) throw conflict();
          if (body.activity?.some((value) => !activities.includes(value) && !existing.activity.includes(value))) throw new PhotoUploadError('Choose a supported activity', 'activity');
          for (const field of ['activity', 'observations']) {
            if (body[field] && new Set(body[field]).size !== body[field].length) throw new PhotoUploadError('Choose each option once', field);
          }
          if (body.observations?.includes('Nothing stood out') && body.observations.length > 1) throw new PhotoUploadError('Nothing stood out cannot be combined with other observations', 'observations');
          if (body.photos?.length > 4 && (body.photos.some(({ upload }) => upload) || body.photos.length > existing.photos.length)) throw new PhotoUploadError('Attach up to four photos', 'photos');
          if (hasMaintenanceContent(existing) && !hasMaintenanceContent({ ...existing, ...body })) throw new PhotoUploadError('Keep an activity, observation, photo, or note', 'notes');
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
          if (body.plants !== undefined) await syncMaintenanceRecordPlants(tx, existing.id, body.plants, existing.plants);
          if (body.photos !== undefined) await changeMaintenancePhotos(tx, existing.id, body.photos, { retainUpload: true, onCopyTarget: (key) => copied.push(key) });
          callbackCompleted = true;
          return true;
        }, { timeout: 60000 });
      } catch (error) {
        if (!callbackCompleted) await cleanupPhotoObjects(copied, request.log);
        committed = Boolean(await recover());
        if (!committed) throw error;
      }
    }
    if (!committed) return reply.code(404).send(null);
    await cleanupPhotoObjects((body.photos ?? []).flatMap(({ upload }) => upload ? [`_uploads/${upload}`] : []), request.log);
    // Cleanup failures must not turn an already-committed correction into a 500.
    try { await cleanupMaintenancePhotos(fastify.prisma, request.log, { recordId: id }); } catch (error) { request.log.warn({ err: error }, 'Maintenance cleanup remains pending'); }
    const current = await fastify.prisma.maintenanceRecord.findFirst({
      where: { id, deletedAt: null },
      select: {
        ...MAINTENANCE_RECORD_SELECT,
        lastMutationId: true,
        lastMutationFingerprint: true,
        _count: { select: { photos: { where: { pendingRemovalAt: { not: null } } } } },
      },
    });
    if (!current) return reply.code(404).send(null);
    if (current.lastMutationId !== body.mutationId || current.lastMutationFingerprint !== fingerprint) throw conflict();
    return reply.send({ ...formatMaintenanceRecord(current), cleanupPending: current._count.photos > 0 });
  });
}
