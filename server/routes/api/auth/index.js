import { fromNodeHeaders } from 'better-auth/node';

export default async function (fastify) {
  const { auth } = fastify;
  fastify.route({
    method: ['GET', 'POST'],
    url: '/*',
    async handler (request, reply) {
      const headers = fromNodeHeaders(request.headers);
      // Always overwrite this header with Fastify's trusted connection address.
      headers.set('x-auth-client-ip', request.ip);
      const url = new URL(request.url, auth.options.baseURL);
      const response = await auth.handler(new Request(url, {
        method: request.method,
        headers,
        ...(request.body ? { body: JSON.stringify(request.body) } : {}),
      }));
      reply.code(response.status);
      response.headers.forEach((value, key) => {
        if (key !== 'set-cookie') reply.header(key, value);
      });
      const cookies = response.headers.getSetCookie();
      if (cookies.length) reply.header('set-cookie', cookies);
      return reply.send(await response.text());
    },
  });
}
