import { Navigate, useLocation, matchPath } from 'react-router';
import { Alert, Button, Container, Loader } from '@mantine/core';
import { useAuthContext } from './AuthContext';
import { handleRedirects } from './AppRedirectsConfig';

function AppRedirects ({ children }) {
  const location = useLocation();
  const authContext = useAuthContext();
  if (authContext.profileError && !authContext.user) return <Container><Alert color='red'>{authContext.profileError.message}<Button variant='subtle' onClick={() => authContext.refetchProfile()}>Try again</Button></Alert></Container>;
  if (authContext.isPending && ['/account/*', '/admin/*'].some(path => matchPath(path, location.pathname))) return <Container><Loader aria-label='Loading session' /></Container>;
  const result = handleRedirects(authContext, location, location.pathname, (to, state) => {
    if (state) {
      return <Navigate to={to} state={state} replace />;
    }
    return <Navigate to={to} />;
  });
  return result || children;
}
export default AppRedirects;
