import fp from 'fastify-plugin';

import prisma from '#prisma/client.js';

const prismaPlugin = fp(async (fastify, opts) => {
  const client = opts.prisma ?? prisma;
  await client.$connect();

  // Make Prisma Client available through the fastify server instance: server.prisma
  fastify.decorate('prisma', client);

  fastify.addHook('onClose', async (fastify) => {
    await fastify.prisma.$disconnect();
  });
}, { name: 'prisma' });

export default prismaPlugin;
