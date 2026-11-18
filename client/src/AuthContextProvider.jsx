import { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import Api from './Api';
import { authClient } from './auth-client';
import { authContext } from './AuthContext';
import { useStaticContext } from './StaticContext';
import { clearAccountQueries, profileKey } from './auth-session';

function AuthContextProvider ({ children }) {
  const staticContext = useStaticContext();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const location = useLocation();
  if (staticContext.authContext?.session) authClient.hydrateSession(staticContext.authContext.session);
  const session = authClient.useSession();
  const [sessionObserved, setSessionObserved] = useState(false);
  useEffect(() => {
    if (!session.isPending) setSessionObserved(true);
  }, [session.isPending]);
  // The SDK's server snapshot is pending. Retain the request's profile during
  // SSR and initial hydration, then let useSession own the identity.
  const identity = session.isPending && !session.error && !sessionObserved
    ? staticContext.authContext?.user?.id ?? null
    : session.data?.user?.id ?? null;
  const [observedIdentity, setObservedIdentity] = useState(identity);
  const changingIdentity = observedIdentity !== identity;

  useEffect(() => {
    if (changingIdentity) {
      clearAccountQueries(queryClient);
      setObservedIdentity(identity);
    }
  }, [identity, changingIdentity, queryClient]);

  const profile = useQuery({
    queryKey: profileKey(identity),
    enabled: !!identity && !changingIdentity,
    initialData: !sessionObserved && identity && identity === staticContext.authContext?.user?.id ? staticContext.authContext.user : undefined,
    queryFn: async ({ signal }) => {
      const response = await Api.users.me(signal);
      signal.throwIfAborted();
      // Ask the SDK to recheck a missing or mismatched session; application
      // profile data never establishes an authentication identity itself.
      if (response.status === 204 || (response.status === 200 && response.data?.id !== identity)) {
        await session.refetch();
        signal.throwIfAborted();
      }
      if (response.status !== 200 || response.data?.id !== identity) throw new Error('Unable to load your account. Please try again.');
      return response.data;
    },
  });
  const signOut = useMutation({
    mutationFn: () => Api.auth.logout(),
    onSuccess: (_, options) => {
      clearAccountQueries(queryClient);
      if (!options?.stayOnPage) navigate('/', { replace: true });
    },
  });
  useEffect(() => {
    if (signOut.isSuccess && (signOut.variables?.stayOnPage || location.pathname === '/')) signOut.reset();
  }, [signOut.isSuccess, signOut.variables, signOut.reset, location.pathname]);

  const user = !changingIdentity && identity ? profile.data ?? null : null;
  const isPending = signOut.isPending || signOut.isSuccess || changingIdentity || (session.isPending && !user) || (!!identity && profile.isPending);

  return <authContext.Provider value={{ user, isPending, profileError: profile.error, refetchProfile: profile.refetch, signOut }}>{children}</authContext.Provider>;
}

export default AuthContextProvider;
