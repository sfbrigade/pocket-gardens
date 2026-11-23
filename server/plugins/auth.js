import fp from 'fastify-plugin';
import { StatusCodes } from 'http-status-codes';

import { fromNodeHeaders } from 'better-auth/node';
import { createAuth } from '#lib/auth.js';
import User from '#models/user.js';

export default fp(async function (fastify) {
  const auth = createAuth(fastify.prisma);
  fastify.decorate('auth', auth);
  fastify.decorateRequest('user', null);
  fastify.decorateRequest('authSession', null);
  fastify.addHook('onRequest', async (request, reply) => {
    if (request.url.startsWith('/api/auth/')) return;
    const response = await auth.api.getSession({ headers: fromNodeHeaders(request.headers), asResponse: true });
    const cookies = response.headers.getSetCookie();
    if (cookies.length) reply.header('set-cookie', cookies);
    const session = await response.json();
    if (response.ok && session?.user) {
      request.authSession = session;
      request.user = new User(session.user);
    }
  });

  const requireUser = (hasAccess = () => true) => {
    return async (request, reply) => {
      if (!request.user) {
        return reply.code(StatusCodes.UNAUTHORIZED).send();
      }
      if (!request.user.isActive) {
        return reply.code(StatusCodes.FORBIDDEN).send();
      }
      if (!hasAccess(request.user)) {
        return reply.code(StatusCodes.FORBIDDEN).send();
      }
    };
  };

  // onRequest handler to be used to ensure a user is logged in
  fastify.decorate('requireUser', requireUser());
  fastify.decorate('requireAdmin', requireUser(user => user.isAdmin));
  fastify.decorate('requireContributor', requireUser(user => user.canContribute));
}, { dependencies: ['prisma'] });
