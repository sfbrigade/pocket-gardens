import { createAuthClient } from 'better-auth/react';
import { adminClient, inferAdditionalFields, magicLinkClient } from 'better-auth/client/plugins';

export const authClient = createAuthClient({
  plugins: [adminClient(), magicLinkClient(), inferAdditionalFields({
    user: { firstName: { type: 'string' }, lastName: { type: 'string' } },
  })],
});
