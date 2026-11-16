import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { createElement as h } from 'react';
import { renderToString } from 'react-dom/server';
import { MemoryRouter } from 'react-router';
import { MantineProvider } from '@mantine/core';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createHead, UnheadProvider } from '@unhead/react/server';
import { createServer } from 'vite';

test('forms initialize from their owner instead of copying defaults with effects', async (t) => {
  const vite = await createServer({
    root: fileURLToPath(new URL('../', import.meta.url)),
    server: { middlewareMode: true, ws: false },
    appType: 'custom',
  });
  t.after(() => vite.close());
  const { default: UserForm } = await vite.ssrLoadModule('/src/Users/UserForm.jsx');
  const { default: PhotoInput } = await vite.ssrLoadModule('/src/Components/PhotoInput.jsx');
  const { authContext } = await vite.ssrLoadModule('/src/AuthContext.js');
  const user = { id: 'account-one', firstName: 'Avery', lastName: 'Gardener', email: 'avery@example.test', picture: 'avatar.png', pictureUrl: '/avatar.png', isAdmin: false };
  function render (component, client) {
    return renderToString(h(QueryClientProvider, { client },
      h(MantineProvider, null,
        h(UnheadProvider, { value: createHead() },
          h(MemoryRouter, null,
            h(authContext.Provider, { value: { user, setUser: () => {} } }, component))))));
  }

  await t.test('cached account data and its photo are present in the initial render', () => {
    const client = new QueryClient();
    t.after(() => client.clear());
    client.setQueryData(['users', user.id], { data: user });
    const html = render(h(UserForm), client);
    assert.match(html, /value="Avery"/);
    assert.match(html, /value="Gardener"/);
    assert.match(html, /src="\/avatar.png"/);
    assert.doesNotMatch(html, /Loading account/);
  });

  await t.test('a pending account does not mount an empty editable form', () => {
    const client = new QueryClient();
    t.after(() => client.clear());
    const html = render(h(UserForm), client);
    assert.match(html, /Loading account/);
    assert.doesNotMatch(html, /<form/);
  });

  await t.test('a failed background refresh keeps the loaded account editor', async () => {
    const client = new QueryClient();
    t.after(() => client.clear());
    client.setQueryData(['users', user.id], { data: user });
    await assert.rejects(client.fetchQuery({
      queryKey: ['users', user.id], queryFn: async () => { throw new Error('Offline'); }, retry: false,
    }));
    const html = render(h(UserForm), client);
    assert.match(html, /value="Avery"/);
    assert.doesNotMatch(html, /Unable to load account/);
  });

  await t.test('an explicitly cleared controlled photo wins over the initial default', () => {
    const client = new QueryClient();
    t.after(() => client.clear());
    const html = render(h(PhotoInput, { value: '', defaultValue: 'avatar.png', valueUrl: '/avatar.png', onChange: () => {} }), client);
    assert.doesNotMatch(html, /src="\/avatar.png"/);
    assert.match(html, /Drag-and-drop a photo/);
  });
});
