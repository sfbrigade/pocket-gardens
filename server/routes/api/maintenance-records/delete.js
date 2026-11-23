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
    const { id } = request.params;
    let changed;
    let writeError;
    try {
      changed = await fastify.prisma.maintenanceRecord.updateMany({
        where: { id, version: request.body.version, deletedAt: null },
        data: { deletedAt: new Date(), version: { increment: 1 }, lastChangedById: request.user?.isActive && request.user.isAdmin ? request.user.id : null },
      });
    } catch (error) {
      writeError = error;
    }
    if (changed?.count) return reply.code(204).send();

    // A write error may mean the update committed and its acknowledgment was lost.
    const existing = await fastify.prisma.maintenanceRecord.findUnique({
      where: { id },
      select: { deletedAt: true },
    });
    if (existing?.deletedAt) return reply.code(204).send();
    if (!changed) throw writeError;
    if (!existing) return reply.code(404).send();
    return reply.code(409).send({ message: 'This update changed since you opened it. Refresh the history and review it before deleting.' });
  });
}
