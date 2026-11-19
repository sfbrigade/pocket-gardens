import { expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, Link } from 'react-router';
import { MantineProvider } from '@mantine/core';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const mocks = vi.hoisted(() => ({ fetch: vi.fn(), profile: vi.fn() }));
vi.mock('../src/auth-client', async () => {
  const { createAuthClient } = await import('better-auth/react');
  return { authClient: createAuthClient({ baseURL: 'http://localhost/api/auth', fetchOptions: { customFetchImpl: mocks.fetch } }) };
});
vi.mock('../src/Api', async () => {
  const { authClient } = await import('../src/auth-client');
  return { default: { auth: { logout: () => authClient.signOut() }, users: { me: mocks.profile } } };
});

import { authClient } from '../src/auth-client';
import { useAuthContext } from '../src/AuthContext';
import AuthContextProvider from '../src/AuthContextProvider';
import AppRedirects from '../src/AppRedirects';
import StaticContextProvider from '../src/StaticContextProvider';

it('keeps logout final through failed refreshes and permits a new session for the same account', async () => {
  const profile = { id: 'member', firstName: 'Member', isAdmin: false };
  let session = { user: { id: profile.id }, session: { id: 'revoked-session' } };
  let unavailable = false;
  let failedRefreshes = 0;
  mocks.fetch.mockImplementation(async input => {
    const path = new URL(input).pathname;
    if (path.endsWith('/sign-out')) {
      unavailable = true;
      return Response.json({ success: true });
    }
    if (path.endsWith('/sign-in/email')) {
      unavailable = false;
      session = { user: { id: profile.id }, session: { id: 'new-session' } };
      return Response.json(session);
    }
    if (path.endsWith('/get-session')) {
      if (unavailable) {
        failedRefreshes++;
        return Response.json({ message: 'Session service unavailable' }, { status: 503 });
      }
      return Response.json(session);
    }
    throw new Error(`Unexpected request: ${path}`);
  });
  mocks.profile.mockImplementation(async () => {
    if (unavailable) throw new Error('Profile service unavailable');
    return { status: 200, data: profile };
  });
  function Controls () {
    const { user, signOut } = useAuthContext();
    return (
      <>
        <output>{user ? user.firstName : 'Signed out'}</output>
        <button onClick={() => signOut.mutate()}>Log out</button>
        <Link to='/login'>Login page</Link>
        <button onClick={() => authClient.signIn.email({ email: 'member@example.com', password: 'test' })}>Sign in again</button>
      </>
    );
  }
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <StaticContextProvider value={{ authContext: { user: null } }}>
      <MemoryRouter initialEntries={['/account']}>
        <QueryClientProvider client={queryClient}>
          <MantineProvider>
            <AuthContextProvider>
              <Controls />
              <AppRedirects>
                <Routes>
                  <Route path='/account' element={<div>Private account</div>} />
                  <Route path='/' element={<div>Public home</div>} />
                  <Route path='/login' element={<div>Public login</div>} />
                </Routes>
              </AppRedirects>
            </AuthContextProvider>
          </MantineProvider>
        </QueryClientProvider>
      </MemoryRouter>
    </StaticContextProvider>
  );
  const user = userEvent.setup();
  await screen.findByText('Member');
  queryClient.setQueryData(['private', 'account'], profile);
  const profileReads = mocks.profile.mock.calls.length;
  await user.click(screen.getByRole('button', { name: 'Log out' }));
  await waitFor(() => expect(failedRefreshes).toBeGreaterThan(0));
  // The SDK retains its prior snapshot on a 503. A revoked session must not
  // reload an old profile or block public screens while that snapshot remains.
  expect(authClient.$store.atoms.session.get().data.session.id).toBe('revoked-session');
  await screen.findByText('Public home');
  expect(screen.getByText('Signed out')).toBeTruthy();
  expect(queryClient.getQueryData(['private', 'account'])).toBeUndefined();
  expect(mocks.profile).toHaveBeenCalledTimes(profileReads);
  await user.click(screen.getByRole('link', { name: 'Login page' }));
  await screen.findByText('Public login');
  expect(screen.queryByText('Profile service unavailable')).toBeNull();
  await user.click(screen.getByRole('button', { name: 'Sign in again' }));
  await screen.findByText('Member');
  expect(authClient.$store.atoms.session.get().data.session.id).toBe('new-session');
});
