import './config.js';
import path from 'node:path';
import AutoLoad from '@fastify/autoload';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Pass --options via CLI arguments in command to enable these options.
export const options = {
  trustProxy: process.env.TRUSTED_PROXIES?.split(',').map(value => value.trim()).filter(Boolean) || false,
  logger: {
    serializers: {
      req (request) {
        // Log the registered route, never raw paths/queries that may contain tokens.
        const url = request.routeOptions?.url ?? '[unmatched]';
        return { method: request.method, url, remoteAddress: request.ip };
      },
    },
    redact: ['req.headers.authorization', 'req.headers.cookie', 'res.headers.set-cookie', 'res.headers.set-auth-token', 'req.body'],
  },
};

export default async function (fastify, opts) {
  // Place here your custom code!

  // Do not touch the following lines

  // This loads all plugins defined in plugins
  // those should be support plugins that are reused
  // through your application
  fastify.register(AutoLoad, {
    dir: path.join(__dirname, 'plugins'),
    options: Object.assign({}, opts)
  });

  // This loads all plugins defined in routes
  // define your routes in one of these
  fastify.register(AutoLoad, {
    dir: path.join(__dirname, 'routes'),
    options: Object.assign({}, opts)
  });
}
