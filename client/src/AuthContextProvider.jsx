import { useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import Api from './Api';
import { authContext } from './AuthContext';
import { useStaticContext } from './StaticContext';

function AuthContextProvider ({ children }) {
  const staticContext = useStaticContext();
  const queryClient = useQueryClient();
  const location = useLocation();
  const navigate = useNavigate();
  const { data: user = staticContext.authContext?.user } = useQuery({
    queryKey: ['users', 'me'],
    queryFn: () => Api.users.me().then(response => response.status === 200 ? response.data : null),
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
