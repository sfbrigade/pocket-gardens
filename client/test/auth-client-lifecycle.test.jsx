import { expect, it, vi } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
import { createAuthClient } from 'better-auth/react';

it('the installed React SDK cancels stale session reads after explicit login and logout', async () => {
  let finishOld;
  const old = new Promise(resolve => { finishOld = resolve; });
  let identity = null;
  let reads = 0;
  const client = createAuthClient({
    baseURL: 'http://localhost/api/auth',
    fetchOptions: {
      customFetchImpl: vi.fn(async (input) => {
        const url = String(input);
        if (url.endsWith('/get-session')) {
          reads++;
          if (reads === 1) return old;
          return Response.json(identity);
        }
        if (url.endsWith('/sign-in/email')) {
          identity = { user: { id: 'current' }, session: { id: 'new-session' } };
          return Response.json(identity);
        }
        if (url.endsWith('/sign-out')) {
          identity = null;
          return Response.json({ success: true });
        }
        throw new Error(`Unexpected path: ${url}`);
      }),
    },
  });
  function Session () {
    const { data, isPending } = client.useSession();
    return <output>{isPending ? 'Pending' : data?.user.id || 'Signed out'}</output>;
  }
  render(<Session />);
  await waitFor(() => expect(reads).toBe(1));
  await act(async () => { await client.signIn.email({ email: 'current@example.com', password: 'test' }); });
  await screen.findByText('current');
  await act(async () => { finishOld(Response.json(null)); await old; });
  expect(screen.getByText('current')).toBeTruthy();
  await act(async () => { await client.signOut(); });
  await screen.findByText('Signed out');
});
