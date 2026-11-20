import { vi } from 'vitest';

const store = vi.hoisted(() => ({ value: { data: null, isPending: false }, listeners: new Set() }));

vi.mock('../src/auth-client', async () => {
  const { useSyncExternalStore } = await import('react');
  return {
    authClient: {
      hydrateSession: vi.fn(),
      useSession: () => useSyncExternalStore(
        (listener) => { store.listeners.add(listener); return () => store.listeners.delete(listener); },
        () => store.value
      ),
    },
  };
});

export const refetchSession = vi.fn(async () => setSession(null));

export function setSession (user, options = {}) {
  store.value = { data: user ? { user, session: { id: `session-${user.id}` } } : null, isPending: false, refetch: refetchSession, ...options };
  store.listeners.forEach(listener => listener());
}
