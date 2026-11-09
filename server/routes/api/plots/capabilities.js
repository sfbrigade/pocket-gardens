import { z } from 'zod';

import { allowsAnonymousPlotCreation } from '#models/plot.js';

export default async function (fastify) {
  fastify.get('/capabilities', {
    schema: {
      description: 'Returns plot creation capabilities for the current session.',
      response: { 200: z.strictObject({ canCreatePlot: z.boolean() }) },
    },
  }, async (request) => ({
    canCreatePlot: allowsAnonymousPlotCreation() || !!(request.user?.isActive && request.user?.isAdmin),
  }));
}
