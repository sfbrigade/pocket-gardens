import { z } from 'zod';
import { activities, observations, canCreateMaintenance, canManageMaintenance, today } from '#lib/maintenance-policy.js';

export default async function (fastify) {
  fastify.get('/capabilities', {
    schema: {
      response: {
        200: z.object({ canCreate: z.boolean(), canManage: z.boolean(), activities: z.array(z.string()), observations: z.array(z.string()), today: z.string() }),
      },
    },
  }, async (request) => ({
    canCreate: canCreateMaintenance(request.user),
    canManage: canManageMaintenance(request.user),
    activities,
    observations,
    today: today(),
  }));
}
