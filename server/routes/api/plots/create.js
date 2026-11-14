import crypto from 'node:crypto';
import { PhotoUploadError } from '#lib/photo-upload.js';
import { StatusCodes } from 'http-status-codes';
import { createPlotPlants } from '#models/plot-plant.js';
import { z } from 'zod';
import { submissionFingerprint, findSubmission, cleanupSubmissionObjects } from '#lib/plot-submission.js';

import {
  findPlotByPublicId,
  formatPlot,
  allowsAnonymousPlotCreation,
  plotFieldsFromBody,
  PlotCreateSchema,
  PlotDetailSchema,
  reloadPlotDetails,
  syncPlotPhotos,
} from '#models/plot.js';

export default async function (fastify, opts) {
  fastify.post('/', {
    schema: {
      description: 'Creates a new Plot.',
      body: PlotCreateSchema,
      response: {
        [StatusCodes.CREATED]: PlotDetailSchema,
        [StatusCodes.OK]: PlotDetailSchema,
        [StatusCodes.CONFLICT]: z.strictObject({ message: z.string(), plotId: z.string() }),
        [StatusCodes.UNPROCESSABLE_ENTITY]: fastify.ValidationErrorSchema,
      },
    },
    onRequest: async (request, reply) => {
      if (!allowsAnonymousPlotCreation()) return fastify.requireAdmin(request, reply);
    },
  }, async function (request, reply) {
    const fields = plotFieldsFromBody(request.body);
    fields.mapCoordinates = `${fields.latitude}, ${fields.longitude}`;
    const { Photos, submissionId } = request.body;
    const fingerprint = submissionFingerprint(request.body, fields);
    const replay = (existing) => existing.submissionFingerprint === fingerprint
      ? reply.code(StatusCodes.OK).send(formatPlot(existing))
      : reply.code(StatusCodes.CONFLICT).send({ message: 'This draft has already been saved with different values.', plotId: existing.airtableId });
    const existing = await findSubmission(fastify.prisma, submissionId);
    if (existing) return replay(existing);
    const publicId = `pg_${crypto.randomUUID()}`;
    const copied = [];
    let callbackCompleted = false;
    let record;
    try {
      record = await fastify.prisma.$transaction(async (tx) => {
        const created = await tx.plot.create({
          data: {
            airtableId: publicId,
            ...fields,
            submissionId,
            submissionFingerprint: submissionId ? fingerprint : undefined,
            name: fields.name || [fields.streetAddress, publicId].filter(Boolean).join(' · '),
          },
        });
        await createPlotPlants(tx, created, request.body.plants);
        if (Photos !== undefined) {
          await syncPlotPhotos(tx, created.id, Photos, { retainUpload: true, onCopyTarget: (key) => copied.push(key) });
        }
        const details = await reloadPlotDetails(tx, created.id);
        callbackCompleted = true;
        return details;
      }, { timeout: 60000 });
    } catch (error) {
      if (!callbackCompleted) {
        // A failed callback never requests COMMIT, so its copies can be removed.
        await cleanupSubmissionObjects(copied, request.log);
        if (error.code === 'P2002' && submissionId) {
          const winner = await findSubmission(fastify.prisma, submissionId);
          if (winner) return replay(winner);
        }
        if (['NoSuchKey', 'NotFound'].includes(error.name)) {
          // Another concurrent request may have committed and removed staging.
          const winner = await findSubmission(fastify.prisma, submissionId);
          if (winner) return replay(winner);
          throw new PhotoUploadError('This photo is missing or has expired. Reattach it or continue without a photo.', 'Photos');
        }
        throw error;
      }
      // COMMIT may have succeeded despite losing its acknowledgment. Recover our
      // own row even for requests without a submission ID before touching files.
      try {
        record = await findPlotByPublicId(fastify.prisma, publicId);
      } catch (recoveryError) {
        request.log.warn({ err: recoveryError, publicId }, 'Plot commit recovery could not complete');
      }
      if (!record) {
        // A missing row does not prove rollback: COMMIT may still be in flight.
        request.log.warn({ err: error, publicId, copied }, 'Plot commit outcome is uncertain; retaining photo objects');
        throw error;
      }
    }
    await cleanupSubmissionObjects((Photos ?? []).map((filename) => `_uploads/${filename}`), request.log);
    reply.code(StatusCodes.CREATED).send(formatPlot(record));
  });
}
