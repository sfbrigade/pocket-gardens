# Browser authentication simplification validation

Implemented on `feat/user-auth/better-auth-resource-binder`, continuing from
`50832f7d792222be6d4347a7791aacfa8a073449` and preserving its preceding local commits.
The three implementation commits cover mobile scaffolding removal, the official
React client/native browser callbacks, and administrator password-assignment denial.

## Behavior delivered

- Cookie-only authentication, direct web email links, and no mobile instruction
  routes, Bearer plugin, token-header forwarding, or separate email-link origin.
- Better Auth React client `1.7.25` owns session observation. Application profiles
  follow that identity, retain SSR hydration, and cannot expose another account's
  profile during pending/failed reads. Identity changes cancel/remove application
  queries; same-account refreshes preserve caches. Late profile saves are guarded.
- Magic-link confirmation navigates through the native verification endpoint.
  Success and invalid/expired/replayed-link callbacks preserve safe destinations.
- Manual admin password assignment returns 404 and has no granted permission or
  supporting revocation hook. Email password setup/reset still works and revokes
  the reset account's sessions. Role editing, bans, registration admission and
  transaction integration, invitation policies, and migrations remain intact.

## Automated validation

Completed locally on November 17, 2026:

| Command | Result |
| --- | --- |
| `DATABASE_URL=postgresql://unused:unused@localhost:5432/unused npm run prisma:generate -w server` | Passed; generated client and TypeScript output without connecting to that placeholder database |
| `npm run lint:check` | Passed for both workspaces |
| `CI=true npm test -w server` | 284 passed; no failures or skips |
| `npm test -w client` | 109 Node tests and 37 UI tests passed |
| `npm run build -w client` | Browser and SSR builds passed |

Regression coverage includes real cookie-backed application APIs, separate
Set-Cookie forwarding, bearer-only denial, SDK session-response cancellation,
registration/invitation transactions and recovery, native confirmation errors and
replay, verification/resend, password setup/reset and session revocation, admin
password denial without credential/session changes, roles/bans, migration
preservation, SSR public-session serialization, protected destinations, application
cache isolation, pending/failed profiles, and late profile saves.

## Local browser smoke test

Used the Vite browser application with the actual Fastify/Better Auth backend,
disposable PostgreSQL/object storage, and captured test email delivery. Checked:

- Password login restored pathname, query, and fragment; cookies survived reload.
- Logout cleared the other tab's account view and protected-page access.
- A delivered magic link opened its confirmation screen without signing in.
  Confirmation used a native callback and restored the requested destination;
  the other tab observed the new account on focus. Reload retained the session.
- Reconfirming the consumed link displayed the invalid/expired notice, retained
  the destination, and preserved the existing session.
- Delivered invitation and verification links opened their correct web screens.
  Opening verification left the account unverified; explicit confirmation showed
  the success notice and selected password login with the same destination.
- Opening a delivered reset link left the session active. Submitting the new
  password revoked it, showed the success notice, selected password login, and
  retained the destination. The new password successfully authenticated.

The temporary browser tabs, servers, harness, and disposable smoke resources were
removed after validation. Mail was captured with the test mailer; production SMTP
delivery was not tested. No remote push, PR operation, merge, or deployment was
performed.
