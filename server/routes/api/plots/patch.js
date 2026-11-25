import { StatusCodes } from 'http-status-codes';
import { z } from 'zod';

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
    onRequest: fastify.requireAdmin,
  }, async function (request, reply) {
    const existing = await findPlotByPublicId(fastify.prisma, request.params.id, {
      select: { id: true, stage: true },
    });
    if (!existing) {
      return reply.code(StatusCodes.NOT_FOUND).send(null);
    }
    const data = plotFieldsFromBody(request.body, existing);
    const { expectedStage, Photos } = request.body;
    const record = await fastify.prisma.$transaction(async (tx) => {
      if (expectedStage !== undefined) {
        const { count } = await tx.plot.updateMany({ where: { id: existing.id, stage: expectedStage }, data });
        if (count === 0) return null;
      } else if (Object.keys(data).length) {
        await tx.plot.update({
          where: { id: existing.id },
          data,
        });
      }
      if (Photos !== undefined) {
        await syncPlotPhotos(tx, existing.id, Photos);
      }
      return reloadPlotDetails(tx, existing.id);
    });
    if (!record) {
      return reply.code(StatusCodes.CONFLICT).send({ message: 'The garden stage has changed. Reload the garden to see its current stage.' });
    }
    reply.send(formatPlot(record));
  });
}
