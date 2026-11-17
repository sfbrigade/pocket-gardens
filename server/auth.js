import './config.js';
import prisma from '#prisma/client.js';
import { createAuth } from '#lib/auth.js';

export const auth = createAuth(prisma);
