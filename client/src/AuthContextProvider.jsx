import { useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import Api from './Api';
import { authContext } from './AuthContext';
import { useStaticContext } from './StaticContext';
import { clearAccountQueries } from './auth-session';

function AuthContextProvider ({ children }) {
  const staticContext = useStaticContext();
  const queryClient = useQueryClient();
  const location = useLocation();
  const navigate = useNavigate();
  const { data: user = staticContext.authContext?.user } = useQuery({
    queryKey: ['users', 'me'],
    queryFn: async ({ signal }) => {
      const response = await Api.users.me();
      // A canceled request must not clear data loaded after a newer login.
      signal.throwIfAborted();
      const nextUser = response.status === 200 ? response.data : null;
      const cachedUser = queryClient.getQueryData(['users', 'me']);
      const previousUser = cachedUser === undefined ? staticContext.authContext?.user : cachedUser;
      if (previousUser?.id !== nextUser?.id) clearAccountQueries(queryClient);
      return nextUser;
    },
  });
  const signOut = useMutation({
    mutationFn: () => Api.auth.logout(),
    onSuccess: async (_, options) => {
      await queryClient.cancelQueries();
      if (!options?.stayOnPage) navigate('/', { replace: true });
    },
  });

  useEffect(() => {
    // Clear private data after leaving protected routes. The provider stays
    // mounted even when the mobile menu closes during the request.
    if (signOut.isSuccess && (signOut.variables?.stayOnPage || location.pathname === '/')) {
      queryClient.clear();
      queryClient.setQueryData(['users', 'me'], null);
      signOut.reset();
    }
  }, [signOut.isSuccess, signOut.variables, signOut.reset, location.pathname, queryClient]);

  return <authContext.Provider value={{ user, signOut }}>{children}</authContext.Provider>;
}

export default AuthContextProvider;
