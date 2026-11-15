import { z } from 'zod';
import { activities, observations, canWriteMaintenance, maintenanceZone, today } from '#lib/maintenance-policy.js';

export default async function (fastify) {
  fastify.get('/capabilities', {
    schema: { response: { 200: z.object({ canWrite: z.boolean(), activities: z.array(z.string()), observations: z.array(z.string()), timeZone: z.string(), today: z.string() }) } },
  }, async (request) => ({ canWrite: canWriteMaintenance(request.user), activities, observations, timeZone: maintenanceZone, today: today() }));
}
