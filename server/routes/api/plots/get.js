import { StatusCodes } from 'http-status-codes';
import { z } from 'zod';

import { findPlotByPublicId, formatPlot, PlotDetailSchema, PlotEditorSchema } from '#models/plot.js';
import { editablePlotFields, plotAuthorshipSelect } from '#lib/plot-editing.js';
import { findSubmission } from '#lib/plot-submission.js';

const params = z.object({ id: z.string().min(1) });

export default async function (fastify, opts) {
  fastify.get('/submissions/:submissionId', {
    schema: {
      description: 'Returns a previously saved plot to the submitting account.',
      params: z.object({ submissionId: z.string().uuid() }),
      response: {
        [StatusCodes.OK]: PlotDetailSchema,
        [StatusCodes.NOT_FOUND]: z.null(),
      },
    },
    onRequest: fastify.requireContributor,
  }, async function (request, reply) {
    reply.header('Cache-Control', 'private, no-store');
    const record = await findSubmission(fastify.prisma, request.params.submissionId);
    if (!record || record.createdById !== request.user.id) return reply.code(StatusCodes.NOT_FOUND).send(null);
    reply.send(formatPlot(record));
  });

  fastify.get('/:id', {
    schema: {
      description: 'Returns a Plot by Airtable record id (or internal UUID).',
      params,
      response: {
        [StatusCodes.OK]: PlotDetailSchema,
        [StatusCodes.NOT_FOUND]: z.null(),
      },
    },
  }, async function (request, reply) {
    const record = await findPlotByPublicId(fastify.prisma, request.params.id);
    if (!record) {
      return reply.code(StatusCodes.NOT_FOUND).send(null);
    }
    reply.send(formatPlot(record));
  });

  fastify.get('/:id/edit-access', {
    schema: {
      description: 'Checks whether the signed-in account can edit a plot or its notes.',
      params,
      response: {
        [StatusCodes.OK]: z.object({ canEdit: z.boolean() }),
        [StatusCodes.NOT_FOUND]: z.null(),
      },
    },
    onRequest: fastify.requireContributor,
  }, async function (request, reply) {
    reply.header('Cache-Control', 'private, no-store');
    const record = await findPlotByPublicId(fastify.prisma, request.params.id, { select: plotAuthorshipSelect });
    if (!record) return reply.code(StatusCodes.NOT_FOUND).send(null);
    return { canEdit: editablePlotFields(request.user, record).length > 0 };
  });

  fastify.get('/:id/edit', {
    schema: {
      description: 'Returns plot details and the fields this account can edit.',
      params,
      response: {
        [StatusCodes.OK]: PlotEditorSchema,
        [StatusCodes.NOT_FOUND]: z.null(),
      },
    },
    onRequest: fastify.requireContributor,
  }, async function (request, reply) {
    reply.header('Cache-Control', 'private, no-store');
    const record = await findPlotByPublicId(fastify.prisma, request.params.id);
    if (!record) return reply.code(StatusCodes.NOT_FOUND).send(null);
    const editableFields = editablePlotFields(request.user, record);
    if (!editableFields.length) return reply.code(StatusCodes.FORBIDDEN).send();
    reply.send({
      ...formatPlot(record),
      editableFields,
      ...(request.user.isAdmin && { staffPermissionNotes: record.staffPermissionNotes }),
    });
  });
}
