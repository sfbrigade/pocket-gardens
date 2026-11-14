import crypto from 'crypto';
import { StatusCodes } from 'http-status-codes';
import rateLimit from '@fastify/rate-limit';
import { z } from 'zod';

import s3 from '#lib/s3.js';
import { maxPhotoBytes, photoTypes, uploadsPerHour } from '#lib/upload-policy.js';
import { allowsAnonymousPlotCreation } from '#models/plot.js';

export default async function (fastify, opts) {
  await fastify.register(rateLimit, { global: false, hook: 'preHandler', max: uploadsPerHour, timeWindow: '1 hour', cache: 10000, keyGenerator: (request) => request.user?.id ?? request.ip });
  fastify.post('/',
    {
      onRequest: async (request, reply) => {
        if (!allowsAnonymousPlotCreation()) return fastify.requireUser(request, reply);
      },
      config: { rateLimit: {} },
      schema: {
        description: 'Returns a signed URL for asset upload to storage.',
        body: z.object({
          contentType: z.enum(Object.keys(photoTypes)),
          byteSize: z.number().int().positive().max(maxPhotoBytes),
        }),
        response: {
          [StatusCodes.OK]: z.object({
            filename: z.string(),
            url: z.string(),
            headers: z.object({}).catchall(z.string()),
          }),
        },
      }
    },
    async function (request, reply) {
      const { contentType, byteSize } = request.body;
      const filename = `${crypto.randomUUID()}.${photoTypes[contentType]}`;
      const url = await s3.getSignedUploadUrl(contentType, `_uploads/${filename}`, byteSize);
      const data = {
        filename,
        url,
        headers: {
          'Content-Type': contentType,
        },
      };
      reply.send(data);
    });
}
