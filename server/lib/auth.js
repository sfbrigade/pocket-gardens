import { betterAuth } from 'better-auth';
import { prismaAdapter } from 'better-auth/adapters/prisma';
import { getCurrentAdapter } from '@better-auth/core/context';
import { APIError, createAuthMiddleware, isAPIError } from 'better-auth/api';
import { admin, bearer } from 'better-auth/plugins';
import { defaultAc, userAc } from 'better-auth/plugins/admin/access';
import User from '#models/user.js';
import mailer from '#lib/mailer.js';
import { magicRegistrationProfile, registrationMagicLink } from '#lib/auth-magic-registration.js';

async function sendAuthEmail (email, template, locals) {
  if (process.env.SMTP_ENABLED !== 'true') {
    throw new APIError('SERVICE_UNAVAILABLE', { message: 'Email delivery is unavailable.' });
  }
  try {
    await mailer.send({ message: { to: email }, template, locals });
  } catch {
    throw new APIError('SERVICE_UNAVAILABLE', { message: 'Email delivery failed. Please try again.' });
  }
}

// Declaring the existing Invite table lets hooks update it on Better Auth's
// transaction adapter. No invitation endpoints or credential writes are added.
const invitations = {
  id: 'invitations',
  schema: {
    invite: {
      fields: {
        email: { type: 'string' },
        acceptedById: { type: 'string', required: false },
        acceptedAt: { type: 'date', required: false },
        revokedAt: { type: 'date', required: false },
      },
    },
  },
};

// Construct after configuration is loaded; tests supply their own database.
export function createAuth (prisma, { baseURL = process.env.BASE_URL, secret = process.env.BETTER_AUTH_SECRET } = {}) {
  if (!secret || secret.length < 32 || secret.startsWith('replace-with-')) {
    throw new Error('Set BETTER_AUTH_SECRET to a private random value of at least 32 characters.');
  }
  const linkOrigin = new URL(process.env.AUTH_LINK_BASE_URL || baseURL).origin;
  if (process.env.NODE_ENV === 'production' && [baseURL, linkOrigin].some(url => new URL(url).protocol !== 'https:')) {
    throw new Error('Authentication origins must use HTTPS in production.');
  }
  const appLink = (action, token, callbackURL) => {
    const url = new URL(`/api/auth/links/${action}`, linkOrigin);
    url.searchParams.set('token', token);
    if (callbackURL) {
      try {
        const destination = new URL(callbackURL, baseURL);
        if (destination.origin === new URL(baseURL).origin) {
          url.searchParams.set('from', `${destination.pathname}${destination.search}${destination.hash}`);
        }
      } catch {
        // An invalid destination must not prevent delivery of the login link.
      }
    }
    return url.toString();
  };
  const emailReturnDestination = (url) => {
    try {
      const callback = new URL(new URL(url).searchParams.get('callbackURL') || '/', baseURL);
      if (callback.origin === new URL(baseURL).origin) return callback.searchParams.get('from') || undefined;
    } catch {
      // Keep the default destination if a callback URL cannot be parsed.
    }
  };
  async function sendEmail (user, template, url, request) {
    const { logger } = await auth.$context;
    const delivery = sendAuthEmail(user.email, template, { firstName: user.firstName, url });
    if (!request) return delivery;
    // Better Auth recommends not awaiting public mail delivery to avoid timing leaks.
    delivery.catch(() => logger.warn('Authentication email delivery failed.'));
  }
  const auth = betterAuth({
    baseURL,
    secret,
    trustedOrigins: [new URL(baseURL).origin, linkOrigin],
    disabledPaths: ['/update-user', '/admin/update-user'],
    database: prismaAdapter(prisma, { provider: 'postgresql', transaction: true }),
    advanced: {
      // Exercise the same browser-origin protections in test and production.
      disableOriginCheck: false,
      disableCSRFCheck: false,
      database: { generateId: 'uuid' },
      ipAddress: { ipAddressHeaders: ['x-auth-client-ip'] },
    },
    user: {
      validateUserInfo ({ user, source }, ctx) {
        const result = User.RegisterSchema.omit({ inviteId: true }).safeParse(magicRegistrationProfile(user, source, ctx));
        if (!result.success) return { error: 'invalid_profile', errorDescription: result.error.issues[0].message };
      },
      additionalFields: {
        firstName: { type: 'string', required: true },
        lastName: { type: 'string', required: true },
        picture: { type: 'string', required: false, input: false },
      },
    },
    emailAndPassword: {
      enabled: true,
      requireEmailVerification: true,
      customSyntheticUser: ({ coreFields, additionalFields, id }) => ({
        ...coreFields, role: 'user', banned: false, banReason: null, banExpires: null, ...additionalFields, id,
      }),
      revokeSessionsOnPasswordReset: true,
      resetPasswordTokenExpiresIn: 30 * 60,
      sendResetPassword: ({ user, token, url }, request) => sendEmail(user, 'password-reset', appLink('reset-password', token, emailReturnDestination(url)), request),
    },
    emailVerification: {
      sendVerificationEmail: ({ user, token, url }, request) => sendEmail(user, 'verification', appLink('verify-email', token, emailReturnDestination(url)), request),
    },
    hooks: {
      before: createAuthMiddleware(async (ctx) => {
        if (ctx.path !== '/sign-up/email') return;
        if (process.env.SMTP_ENABLED !== 'true') throw new APIError('SERVICE_UNAVAILABLE', { message: 'Email delivery is unavailable.' });
        const result = User.RegisterSchema.safeParse(ctx.body);
        if (!result.success) throw new APIError('BAD_REQUEST', { message: result.error.issues[0].message });
        const { firstName, lastName, inviteId } = result.data;
        if (!inviteId && process.env.VITE_FEATURE_REGISTRATION !== 'true') {
          throw new APIError('FORBIDDEN', { message: 'A valid invitation is required.' });
        }
        // Reject invalid invitations before Better Auth's duplicate-email response.
        if (inviteId && !await prisma.invite.findFirst({
          where: { id: inviteId, email: result.data.email.toLowerCase(), acceptedAt: null, revokedAt: null },
        })) {
          throw new APIError('BAD_REQUEST', { message: 'Invitation is invalid or no longer available.' });
        }
        return { context: { body: { ...ctx.body, name: `${firstName} ${lastName}` } } };
      }),
      after: createAuthMiddleware(async (ctx) => {
        // Magic-link failures redirect even when success uses JSON. Normalize them
        // inside Better Auth while retaining explicit browser callback redirects.
        if (ctx.path === '/magic-link/verify' && !ctx.query?.callbackURL &&
          ctx.request?.headers.get('accept')?.includes('application/json')) {
          const returned = ctx.context.returned;
          const location = ctx.context.responseHeaders?.get('location');
          if (isAPIError(returned) && returned.statusCode === 302 && location) {
            const code = new URL(location, baseURL).searchParams.get('error');
            if (code) {
              ctx.context.responseHeaders.delete('location');
              return Response.json({ code, message: 'Unable to verify this email link.' }, { status: 400 });
            }
          }
        }
        if (ctx.path !== '/admin/set-user-password' || ctx.context.returned?.status !== true) return;
        // Admin password assignment and session revocation are separate native APIs.
        await auth.api.revokeUserSessions({ body: { userId: ctx.body.userId }, headers: ctx.headers });
      }),
    },
    databaseHooks: {
      user: {
        update: {
          async before (data, ctx) {
            if (ctx?.path !== '/admin/set-role') return;
            // The native endpoint authorizes the caller before this update hook runs.
            const assigningAdmin = data.role?.split(',').includes('admin');
            const target = await ctx.context.internalAdapter.findUserById(ctx.body.userId);
            // Compare canonical IDs; PostgreSQL accepts alternate UUID spellings.
            if (!assigningAdmin && target?.id === ctx.context.session.user.id) {
              throw new APIError('BAD_REQUEST', {
                code: 'SELF_DEMOTION_NOT_ALLOWED',
                message: 'You cannot remove your own administrator access. Ask another administrator to make this change.',
              });
            }
            if (!assigningAdmin) return;
            if (!target?.emailVerified) {
              throw new APIError('BAD_REQUEST', {
                code: 'TARGET_EMAIL_NOT_VERIFIED',
                message: 'This user must verify their email before becoming an administrator.',
              });
            }
          },
        },
      },
      account: {
        create: {
          async before (account, ctx) {
            if (ctx?.path !== '/sign-up/email' || !ctx.body.inviteId) return;
            const adapter = await getCurrentAdapter(ctx.context.adapter);
            const invite = await adapter.update({
              model: 'invite',
              where: [
                { field: 'id', value: ctx.body.inviteId },
                { field: 'email', value: ctx.body.email.toLowerCase() },
                { field: 'acceptedAt', value: null },
                { field: 'revokedAt', value: null },
              ],
              update: { acceptedAt: new Date(), acceptedById: account.userId },
            });
            if (!invite) throw new APIError('BAD_REQUEST', { message: 'Invitation is invalid or no longer available.' });
          },
        },
      },
    },
    plugins: [invitations, bearer(), registrationMagicLink({
      async sendMagicLink ({ email, token }, ctx) {
        const user = await prisma.user.findUnique({ where: { email } }) || ctx.context.magicRegistration;
        if (!user) return;
        try {
          await sendEmail(user, 'magic-link', appLink('magic-link', token, ctx.body.callbackURL), ctx.request);
        } catch {
          ctx.context.logger.warn('Magic-link email delivery failed.');
        }
      },
    }), admin({
      roles: {
        user: userAc,
        admin: defaultAc.newRole({
          user: ['get', 'list', 'set-password', 'set-role', 'ban'],
          session: ['list', 'revoke'],
        }),
      },
    })],
    rateLimit: { enabled: true, storage: 'database' },
  });
  return auth;
}
