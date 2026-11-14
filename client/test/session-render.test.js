import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import User from '../../server/models/user.js';

test('signed-in page rendering serializes only public session fields', async (t) => {
  const vite = await createServer({
    root: fileURLToPath(new URL('../', import.meta.url)),
    server: { middlewareMode: true, ws: false },
    appType: 'custom',
  });
  t.after(() => vite.close());
  const { render } = await vite.ssrLoadModule('/src/entry-server.jsx');
  const user = new User({
    id: '555740af-17e9-48a3-93b8-d5236dfd2c29',
    firstName: 'Demo',
    lastName: 'Gardener',
    email: 'demo@example.test',
    picture: null,
    isAdmin: true,
    createdAt: new Date('2026-11-01'),
    updatedAt: new Date('2026-11-01'),
    deactivatedAt: null,
    hashedPassword: 'private-password-hash',
    passwordResetToken: 'private-reset-token',
  });
  const context = { context: {} };
  const page = await render({ url: '/', urlData: () => '/', user }, {}, context);
  assert.ok(page.html);
  assert.equal(context.context.authContext.user.id, user.id);
  assert.equal(context.context.authContext.user.pictureUrl, null);
  assert.doesNotMatch(JSON.stringify(context), /private-password-hash|private-reset-token|hashedPassword|passwordResetToken/);
});
