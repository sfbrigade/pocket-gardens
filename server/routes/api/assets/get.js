import s3 from '#lib/s3.js';

export default async function (fastify, opts) {
  fastify.get('/*',
    {
      schema: {
        description: 'Redirects to a signed url for the specified asset in storage',
      }
    },
    async function (request, reply) {
      const { '*': assetPath } = request.params;
      if (assetPath.split('/').includes('..') || assetPath.includes('\\')) return reply.code(404).send();
      if (assetPath.startsWith('maintenance_record_photos/')) {
        reply.header('Cache-Control', 'private, no-store');
        const match = /^maintenance_record_photos\/([0-9a-f-]{36})\/file\/([a-z0-9_.-]+)$/i.exec(assetPath);
        if (!match) return reply.code(404).send();
        const photo = await fastify.prisma.maintenanceRecordPhoto.findFirst({ where: { id: match[1], file: match[2], pendingRemovalAt: null, maintenanceRecord: { deletedAt: null } } });
        if (!photo) return reply.code(404).send();
      }
      const url = await s3.getSignedAssetUrl(assetPath, 900);
      if (!assetPath.startsWith('maintenance_record_photos/')) reply.header('Cache-Control', 'public, max-age=845');
      reply.redirect(url);
    });
}
