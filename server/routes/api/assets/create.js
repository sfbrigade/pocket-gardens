import crypto from 'crypto';
import { StatusCodes } from 'http-status-codes';
import mime from 'mime-types';
import { z } from 'zod';

import s3 from '#lib/s3.js';
import { uploadExpiresAt } from '#lib/upload-policy.js';

export default async function (fastify, opts) {
  fastify.post('/',
    {
      schema: {
        description: 'Returns a signed URL for asset upload to storage.',
        body: z.object({
          contentType: z.string(),
        }),
        response: {
          [StatusCodes.OK]: z.object({
            filename: z.string(),
            url: z.string(),
            expiresAt: z.string(),
            headers: z.object({}).catchall(z.string()),
          }),
        },
      }
    },
    async function (request, reply) {
      const { contentType } = request.body;
      const filename = `${crypto.randomUUID()}.${mime.extension(contentType)}`;
      const expiresAt = uploadExpiresAt();
      await fastify.prisma.assetUpload.create({ data: { filename, expiresAt } });
      // Store the issued token before making a signed PUT available.
      const url = await s3.getSignedUploadUrl(contentType, `_uploads/${filename}`);
      const data = {
        filename,
        expiresAt: expiresAt.toISOString(),
        url,
        headers: {
          'Content-Type': contentType,
        },
      };
      reply.send(data);
    });
}
