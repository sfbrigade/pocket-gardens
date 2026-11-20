import { omit, pick } from 'es-toolkit';
import { StatusCodes } from 'http-status-codes';
import { z } from 'zod';

import User from '#models/user.js';

export default async function (fastify, opts) {
  fastify.patch('/:id',
    {
      schema: {
        description: 'Updates a User object by id.',
        params: z.object({
          id: z.string().uuid()
        }),
        body: User.UpdateSchema,
        response: {
          [StatusCodes.OK]: User.ResponseSchema,
          [StatusCodes.FORBIDDEN]: z.null(),
          [StatusCodes.NOT_FOUND]: z.null(),
        },
      },
      onRequest: fastify.requireUser,
    },
    async function (request, reply) {
      const { id } = request.params;
      let data = await fastify.prisma.user.findUnique({
        where: { id },
      });
      if (!data) {
        return reply.code(StatusCodes.NOT_FOUND).send();
      }
      if (data.id !== request.user.id && !request.user.isAdmin) {
        return reply.code(StatusCodes.FORBIDDEN).send();
      }
      const user = new User(data);
      user.update(omit(request.body, ['picture']));
      if ('firstName' in request.body || 'lastName' in request.body) {
        user.name = `${user.firstName} ${user.lastName}`;
      }
      const pictureHandler = 'picture' in request.body ? user.setAsset('picture', request.body.picture) : undefined;
      await fastify.prisma.$transaction(async (tx) => {
        data = await tx.user.update({
          where: { id },
          data: pick(data, [...user.changes])
        });
        await pictureHandler?.();
      });
      return reply.send(new User(data));
    });
}
