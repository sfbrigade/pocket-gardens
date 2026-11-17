import { createHash } from 'node:crypto';

export async function authLinkPage (request, reply) {
  // Read tokens in the browser instead of reflecting them into the HTML.
  // Native apps still intercept the original link; browsers offer an explicit continuation.
  const script = `const source = new URL(window.location.href);
const action = source.pathname.split('/').pop();
const routes = { 'reset-password': '/passwords/reset', 'verify-email': '/auth/verify-email', 'magic-link': '/auth/magic-link' };
const value = source.searchParams.get(action === 'invite' ? 'inviteId' : 'token');
if (value && (action === 'invite' || routes[action])) {
  const target = new URL(action === 'invite' ? '/invites/' + encodeURIComponent(value) : routes[action], ${JSON.stringify(new URL(request.server.auth.options.baseURL).origin)});
  if (action !== 'invite') target.searchParams.set('token', value);
  if (action !== 'invite' && source.searchParams.has('from')) target.searchParams.set('from', source.searchParams.get('from'));
  const link = document.getElementById('continue');
  link.href = target.href;
  link.hidden = false;
}`;
  const hash = createHash('sha256').update(script).digest('base64');
  return reply
    .header('Cache-Control', 'no-store')
    .header('Referrer-Policy', 'no-referrer')
    .header('Content-Security-Policy', `default-src 'none'; script-src 'sha256-${hash}'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'`)
    .type('text/html')
    .send(`<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Continue to your account</title><h1>Open this link on your phone</h1><p>Open this email link on the device where the app is installed, or continue in your browser. If the link has expired, request a new one.</p><p><a id="continue" hidden>Continue in browser</a></p><noscript>Enable JavaScript to continue in your browser.</noscript><script>${script}</script></html>`);
}
