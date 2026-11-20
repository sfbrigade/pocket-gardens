import { authPath, loginDestination } from './LoginDestination.js';

export const profileKey = (id) => ['users', 'me', id];

export function clearAccountQueries (queryClient) {
  // Removing queries cancels pending work before another identity is exposed.
  queryClient.removeQueries();
}

export function magicLinkConfirmationURL (token, destination) {
  const from = loginDestination(destination);
  return `/api/auth/magic-link/verify?${new URLSearchParams({
    token,
    callbackURL: from,
    errorCallbackURL: authPath('/auth/magic-link', from),
  })}`;
}
