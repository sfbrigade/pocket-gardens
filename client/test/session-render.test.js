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
    role: 'admin',
    emailVerified: true,
    banned: false,
    createdAt: new Date('2026-11-01'),
    updatedAt: new Date('2026-11-01'),
    legacyHashedPassword: 'private-password-hash',
    legacyPasswordResetToken: 'private-reset-token',
  });
  const context = { context: {} };
  const authSession = { user: { id: user.id }, session: { id: 'public-session-id', token: 'private-session-token', expiresAt: new Date('2026-12-01'), ipAddress: 'private-address' } };
  const page = await render({ url: '/', urlData: () => '/', user, authSession }, {}, context);
  assert.match(page.html, /Demo(?:<!-- -->)?!/);
  assert.equal(context.context.authContext.session.user.id, user.id);
  assert.equal(context.context.authContext.session.session.id, 'public-session-id');
  assert.doesNotMatch(JSON.stringify(context), /private-session-token|private-address/);
  const anonymous = { context: {} };
  const signedOut = await render({ url: '/', urlData: () => '/', user: null }, {}, anonymous);
  assert.doesNotMatch(signedOut.html, /Demo(?:<!-- -->)?!/);
  assert.equal(anonymous.context.authContext.user, null);
  assert.ok(page.html);
  assert.equal(context.context.authContext.user.id, user.id);
  assert.equal(context.context.authContext.user.pictureUrl, null);
  assert.doesNotMatch(JSON.stringify(context), /private-password-hash|private-reset-token|legacyHashedPassword|legacyPasswordResetToken/);
});
