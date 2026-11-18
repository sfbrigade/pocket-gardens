# Pocket Gardens browser authentication simplification

## Objective and authorization

Implement the three recommended changes below on
`feat/user-auth/better-auth-resource-binder`. The implementation baseline is local
commit `7fa569c3f976ececbaf3e357fadf4f250731805a`, followed by the commit adding this
handoff. Preserve the branch's unpublished commits and work on this existing
branch. Check the working tree before editing and preserve any later user work.

The user wants Better Auth's documented browser behavior with as little custom
authentication plumbing as practical. They authorized implementation and logical
local commits. **Do not push, merge, deploy, or create/update a pull request.**

The scope is the three implementation steps below. Keep existing registration,
verification, carer eligibility, account migration, and administrator-role policies.

## 1. Remove the mobile-specific authentication layer

- Remove the Better Auth Bearer plugin and obsolete `set-auth-token` forwarding.
  Browser authentication must continue through Better Auth's session cookies.
- Convert backend authentication helpers and relevant integration tests to cookies.
  Preserve multiple `Set-Cookie` headers correctly; test the actual browser-style
  session path. Verify a bearer-only request no longer authenticates.
- Send email links directly to the existing web screens:
  `/auth/magic-link`, `/auth/verify-email`, `/passwords/reset`, and `/invites/:id`.
  Preserve tokens and safe return destinations where appropriate.
- Remove `/api/auth/links/*` instruction pages and their supporting renderer.
  Remove `AUTH_LINK_BASE_URL` and its extra trusted origin/configuration/docs.
- Keep explicit confirmation on magic-link and verification screens. Opening an
  email or rendering a confirmation page must not consume its token. Password
  reset consumes its token only when the new password is submitted.

Complete when both login methods work with cookies, delivered links open the
correct web screens, and the removed mobile-specific layer has no live callers.

## 2. Use Better Auth's browser client and native redirect flow

- Introduce the official React `createAuthClient`, with the relevant client plugins,
  using the same pinned Better Auth version as the server. Use the documented
  `useSession` lifecycle as the browser's authentication-state authority.
- Replace auth-specific Axios transport/session plumbing where the official client
  provides that behavior. Keep Axios for unrelated application APIs.
- Keep the application-profile data needed by the UI, including computed admin
  status and picture URLs. Application queries should follow the authenticated
  identity rather than becoming a competing session authority.
- Preserve server-rendered session/profile hydration and protected-route behavior.
  A pending or failed profile fetch must not expose the previous account's profile.
- Use Better Auth's native success/error callback redirects after the user confirms
  a magic link. Keep safe same-origin destinations and useful expired/invalid-link
  errors. Remove the server hook that converts magic-link redirects into JSON.
  The client SDK alone does not make that hook redundant: change the confirmation
  flow to browser navigation through the native verification endpoint first.
- Preserve verification/reset success notices, password-login selection after
  verification or reset, and the requested pathname, query, and fragment.
- Retain a small bridge to clear application caches and obsolete pending queries
  when identity changes or logout is detected. Better Auth does not manage the
  application's TanStack Query cache. Preserve the late-profile-save guard.

Complete when the browser client owns auth session observation, native callbacks
handle confirmation outcomes, and the existing session-race regressions still pass.

## 3. Disable unused administrator password assignment

- Disable `/api/auth/admin/set-user-password` and remove its granted permission.
- Remove the custom hook that revokes sessions after that endpoint succeeds.
  Remove the hook only alongside disabling the endpoint.
- Keep email-based password setup/reset and the native
  `revokeSessionsOnPasswordReset` option. Keep administrator role editing, bans,
  and the protections against self-demotion and unverified promotion.
- Replace tests of successful admin password assignment with denial coverage.
  Verify denial leaves credentials and sessions unchanged. Preserve tests for
  self-service recovery, session revocation, roles, bans, and unauthorized callers.

Complete when manual admin password assignment is unavailable and ordinary
password recovery continues to work and revoke the reset account's sessions.

## Behaviors to preserve

- Password and magic-link login, including existing accounts without re-registration.
- Password and passwordless registration/invitation acceptance, required first and
  last names, closed-registration settings, email-bound invitations, and rejection
  of revoked or already accepted invitations.
- Atomic account/session creation and invitation acceptance. Retain the custom
  registration admission/transaction integration needed for these rules; this task
  does not authorize redesigning that workflow.
- Case-insensitive emails; unchanged user UUIDs, administrator roles, bans, explicit
  person links, garden assignments, and maintenance history.
- Hashed expiring reset/magic-link tokens, single-use redemption, and existing
  password-reset expiry/revocation behavior.
- Current email-verification defaults and verified-carer eligibility. Keep schema
  migrations and retained legacy columns unchanged unless an actual incompatibility
  is discovered and explained.
- Origin/CSRF protections, trusted proxy/IP handling, rate limits, token-safe logs,
  private persistent development secrets, and profile/photo validation.

## Implementation references

Read `docs/authentication.md` for the current behavior contract and update it,
`README.md`, and `docs/dokku.md` to describe the final browser-only setup.

Relevant seams:

- `server/lib/auth.js`, `server/lib/auth-magic-registration.js`,
  `server/lib/auth-http.js`, `server/plugins/auth.js`, `server/routes/api/auth/`.
- `server/models/invite.js`, `server/example.env`, `server/test/helper.js`.
- `client/src/Api.js`, `client/src/AuthContextProvider.jsx`,
  `client/src/auth-session.js`, `client/src/EmailLink.jsx`, `client/src/Login.jsx`,
  `client/src/entry-server.jsx`, and account/password/registration components.
- `client/test/login-flows.test.jsx`, `client/test/auth-redirect.test.js`, and
  `client/test/mobile-navigation.test.jsx`; `server/test/auth*.test.js`,
  `server/test/routes/api/auth.test.js`, and `server/test/routes/api/web-auth.test.js`.

Use official documentation and verify behavior against the installed version:

- https://better-auth.com/docs/concepts/client
- https://better-auth.com/docs/plugins/magic-link
- https://better-auth.com/docs/plugins/admin
- https://better-auth.com/docs/integrations/fastify

## Validation and delivery

Update regression tests at the real affected seams. Cover both login methods,
registration/invitations, confirmation success/failure/replay, verification/resend,
password setup/reset, logout, expired-session destinations, SSR hydration, and
admin password-assignment denial. Preserve cache-isolation tests for explicit
login, cross-tab account changes/logout, stale session responses, and late profile
saves; a same-account refresh should preserve cached data.

Run the repository's lint checks, complete client/backend tests, and both client
builds. On the host outside the Compose network, backend tests need
`CI=true npm test -w server`; they use disposable databases/storage and mocked mail.
Generate the Prisma client first if the checkout needs generated artifacts.

Perform a local browser smoke test with test email delivery: confirm that email
links open safely, cookies persist across reload, protected destinations are
restored, and logout/account switching behaves correctly across tabs. Report any
environment limitation precisely; distinguish this from production SMTP testing.

Make three logical local commits corresponding to the implementation steps,
adjusting their order if dependencies require it. Include related tests/docs in
each commit. Finish with a summary of behavior changed, commit hashes, validation
results, and any remaining limitations. Leave the work committed and unpushed.
