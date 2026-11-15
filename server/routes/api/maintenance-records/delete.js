import { z } from 'zod';
import { requireMaintenanceManager } from '#lib/maintenance-policy.js';

export default async function (fastify) {
  fastify.delete('/:id', {
    onRequest: requireMaintenanceManager(fastify),
    schema: {
      description: 'Withdraws an update while retaining its data and attached photos.',
      params: z.object({ id: z.string().uuid() }),
      body: z.strictObject({ version: z.number().int().positive() }),
      response: { 409: z.object({ message: z.string() }) },
    },
  }, async (request, reply) => {
    let changed;
    try {
      changed = await fastify.prisma.maintenanceRecord.updateMany({
        where: { id: request.params.id, version: request.body.version, deletedAt: null },
        data: { deletedAt: new Date(), version: { increment: 1 }, lastChangedById: request.user?.isActive && request.user.isAdmin ? request.user.id : null },
      });
    } catch (error) {
      // A lost acknowledgment can still mean the single update committed.
      const existing = await fastify.prisma.maintenanceRecord.findUnique({ where: { id: request.params.id } });
      if (!existing?.deletedAt) throw error;
      return reply.code(204).send();
    }
    if (changed.count) return reply.code(204).send();
    const existing = await fastify.prisma.maintenanceRecord.findUnique({ where: { id: request.params.id } });
    if (!existing) return reply.code(404).send();
    if (existing.deletedAt) return reply.code(204).send();
    return reply.code(409).send({ message: 'This update changed since you opened it. Refresh the history and review it before deleting.' });
  });
}
