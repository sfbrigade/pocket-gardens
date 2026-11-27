import { StatusCodes } from 'http-status-codes';
import { z } from 'zod';
import { editablePlotFields, plotAuthorshipSelect, plotNoteAuthorChanges, plotNotePreconditions } from '#lib/plot-editing.js';

import {
  findPlotByPublicId,
  formatPlot,
  plotFieldsFromBody,
  PlotUpdateSchema,
  PlotDetailSchema,
  reloadPlotDetails,
  syncPlotPhotos,
} from '#models/plot.js';

export default async function (fastify, opts) {
  fastify.patch('/:id', {
    schema: {
      description: 'Updates a Plot by Airtable record id (or internal UUID).',
      params: z.object({
        id: z.string().min(1),
      }),
      body: PlotUpdateSchema,
      response: {
        [StatusCodes.OK]: PlotDetailSchema,
        [StatusCodes.NOT_FOUND]: z.null(),
        [StatusCodes.CONFLICT]: z.object({ message: z.string() }),
        [StatusCodes.UNPROCESSABLE_ENTITY]: fastify.ValidationErrorSchema,
      },
    },
    onRequest: fastify.requireContributor,
  }, async function (request, reply) {
    const existing = await findPlotByPublicId(fastify.prisma, request.params.id, {
      select: { id: true, stage: true, ...plotAuthorshipSelect },
    });
    if (!existing) {
      return reply.code(StatusCodes.NOT_FOUND).send(null);
    }
    const { expectedStage, expectedValues, ...changes } = request.body;
    if (!request.user.isAdmin) {
      const editable = editablePlotFields(request.user, existing);
      if (Object.keys(changes).some((field) => !editable.includes(field))) return reply.code(StatusCodes.FORBIDDEN).send();
    }
    const data = {
      ...plotFieldsFromBody(changes, existing),
      ...plotNoteAuthorChanges(changes, request.user.id, existing),
    };
    const { Photos } = changes;
    const record = await fastify.prisma.$transaction(async (tx) => {
      if (Object.keys(data).length) {
        const { count } = await tx.plot.updateMany({
          where: {
            id: existing.id,
            stage: expectedStage,
            AND: [plotNotePreconditions(changes, existing), plotFieldsFromBody(expectedValues)],
          },
          data,
        });
        if (count === 0) return null;
      }
      if (Photos !== undefined) {
        await syncPlotPhotos(tx, existing.id, Photos);
      }
      return reloadPlotDetails(tx, existing.id);
    });
    if (!record) {
      const message = expectedStage
        ? 'The garden stage has changed. Reload the garden to see its current stage.'
        : 'The garden details have changed. Reload the garden and review your changes.';
      return reply.code(StatusCodes.CONFLICT).send({ message });
    }
    reply.send(formatPlot(record));
  });
}
