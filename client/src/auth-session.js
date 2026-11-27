import { authPath, loginDestination } from './LoginDestination.js';

export const profileKey = (id) => ['users', 'me', id];

export function clearAccountQueries (queryClient) {
  // Keep public garden reads mounted while identity resolves. Editor and access
  // queries use account-specific keys and are removed with other private data.
  queryClient.removeQueries({ predicate: ({ queryKey }) => queryKey[0] !== 'plot' || queryKey.length !== 2 });
}

export function magicLinkConfirmationURL (token, destination) {
  const from = loginDestination(destination);
  return `/api/auth/magic-link/verify?${new URLSearchParams({
    token,
    callbackURL: from,
    errorCallbackURL: authPath('/auth/magic-link', from),
  })}`;
}
