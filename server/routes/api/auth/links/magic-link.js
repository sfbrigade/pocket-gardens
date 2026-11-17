import { authLinkPage } from '#lib/auth-http.js';

export default async function (fastify) {
  fastify.get('/magic-link', authLinkPage);
}
