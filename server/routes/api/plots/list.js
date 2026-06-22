import { StatusCodes } from 'http-status-codes';
import { z } from 'zod';

import { formatPlot, listPlots } from '#lib/airtable.js';

const PlotSchema = z.object({ id: z.string(), createdTime: z.string() }).passthrough();

export default async function (fastify, opts) {
  fastify.get('/', {
    schema: {
      description: 'Returns all Plots from Airtable.',
      response: {
        [StatusCodes.OK]: z.array(PlotSchema),
      },
    },
    // ponytail: add requireUser/requireAdmin when auth is ready
  }, async function (request, reply) {
    const records = await listPlots();
    reply.send(records.map(formatPlot));
  });
}
