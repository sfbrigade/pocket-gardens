# Resource Binder Better Auth port

The implementation is ported on `feat/user-auth/better-auth-resource-binder` from
Resource Binder commit `4254e78b5ba2074fd1fc1d22930c337db0a3d06e`, based on Pocket
Gardens main at `615805a`. Both email-link and password options are included.
Changes are local; production migration and deployment have not been performed.

See the [authentication reference](authentication.md) for setup and rollout details,
and [research](better-auth-migration-research.md) for the original investigation.

## Included from Resource Binder

- Email-link login by default, with password login as an alternative.
- Email-link or password registration and invitation acceptance. Names are required;
  registration flags and invitation validity are enforced at request and confirmation.
- Email verification/resend, password setup/reset, and their email templates.
- Non-consuming email instruction pages and explicit browser confirmation screens,
  preserving the requested return destination.
- Better Auth sessions, bearer support, request-user integration, and session refresh.
- Account profile/photo editing with read-only email and optional password setup.
- Verified administrator promotion, immediate role changes on existing sessions,
  self-demotion prevention, and source administrator/bootstrap behavior.
- Hashed expiring tokens, transactional signup/invitation acceptance, mail delivery
  handling, rate limits, trusted proxy handling, and token-safe access logging.
- Source server integration tests and client login/navigation tests, adapted to this app.

## Main implementation locations

| Area | Pocket Gardens implementation |
| --- | --- |
| Configuration and transactional registration | [auth.js](../server/lib/auth.js), [auth-magic-registration.js](../server/lib/auth-magic-registration.js) |
| Fastify sessions and API forwarding | [auth plugin](../server/plugins/auth.js), [auth API](../server/routes/api/auth/index.js) |
| Email-link instruction pages | [auth-http.js](../server/lib/auth-http.js), [link routes](../server/routes/api/auth/links) |
| User profile and role behavior | [User model](../server/models/user.js), [profile API](../server/routes/api/users/patch.js), [role form](../client/src/Users/UserRoleForm.jsx) |
| Login/signup and confirmation | [Login](../client/src/Login.jsx), [RegistrationForm](../client/src/RegistrationForm.jsx), [EmailLink](../client/src/EmailLink.jsx) |
| Browser session state and API methods | [AuthContextProvider](../client/src/AuthContextProvider.jsx), [Api](../client/src/Api.js) |
| Account/password options | [UserForm](../client/src/Users/UserForm.jsx), [password screens](../client/src/Passwords) |
| Database schema and cutover | [schema](../server/prisma/schema.prisma), [migration](../server/prisma/migrations/20261116000000_better_auth/migration.sql) |
| Existing-account and migration verification | [account flow test](../server/test/auth-existing-accounts.test.js), [migration test](../server/test/lib/better-auth-migration.test.js) |

## Adaptations for Pocket Gardens

The source used runtime Better Auth/core `1.7.14`; this port pins both packages and
the bootstrap CLI to `1.7.25`. Browser origin/CSRF checks are explicitly enabled so
the backend tests exercise the same protections as production. The existing garden
APIs, map routes, people navigation, photo validation, and plot submission remain.

The profile editor retains Pocket Gardens' cached-data-first form initialization,
while bringing over Resource Binder's profile fields, separate role editing, and
password setup option. Auth navigation works in both desktop and mobile layouts.
The test scripts retain existing Node tests and add Vitest for the source UI tests.

### Existing accounts

The user confirmed that existing accounts do not currently use passwords. No legacy
password import or bcrypt compatibility is needed. Existing users enter their email
and confirm a login link without registering again. They may optionally set a
password later; both login methods use the same account.

The new migration keeps every existing User UUID, email, name, picture, creation
and update timestamp, and invitation relationship. It adds Better Auth fields and
tables and backfills names, roles, and bans. Existing emails start unverified until
their owner confirms a link; deactivated accounts remain banned. Old sessions are
not imported. At least one existing administrator must have a reachable mailbox
before production cutover.

Unlike the source's development migration, this migration retains the legacy
password/reset/access columns for cutover validation. Prisma exposes them with
`legacy*` names so they do not shadow the source's computed `isAdmin` behavior.
`hashedPassword` is nullable so new passwordless accounts can be created. Retained
fields are excluded from application profile responses and are no longer live
authentication authorities. Remove them only in a later reviewed migration.

### Carer and garden relationships

The merged plot submission work already added explicit `Person.userId` links.
Those links and all Person IDs, plot assignments, and maintenance history are
preserved. The auth port does not claim imported volunteer records by matching
names or email addresses. Carer search and new assignments now require verified,
unbanned users, matching Better Auth's active-account definition. Existing saved
assignments and retry recovery remain intact if a carer later becomes inactive.

## Local commits and release boundary

Changes are organized as a schema/dependency foundation, server port, client port,
and documentation. These are reviewable commits on one feature branch. The final
server/client/schema combination is the release unit; intermediate commits are not
independent deployment steps. Nothing has been pushed to GitHub.

## Validation and deployment

Run Prisma generation, lint, the complete backend/client tests, and both client
builds as described in the [authentication reference](authentication.md#tests).
Tests use disposable databases/storage and mocked email transport; production SMTP
and target-environment behavior still need verification before release.

The migration test upgrades the actual preceding garden migration chain with
existing accounts, invitation links, an explicit volunteer/account link, plot
assignment, and maintenance history. It checks unchanged identities/relationships,
access mappings, case-insensitive email lookup, and new passwordless account inserts.
The account-flow test confirms email login for an unverified existing admin without
registration, preserved garden links/role, optional password setup, and both login
methods on the same UUID afterward.

Before release, configure the private Better Auth secret, public HTTPS origin, SMTP,
and trusted proxy addresses; back up and rehearse against the target database
state. Deploy the compatible server/client together, then verify real email delivery,
existing-admin access, garden reads/submission, invitations, password flows, and
session revocation. Retaining legacy columns does not synchronize new credentials
back into the old app or make an application-only rollback safe. Detailed steps are
in the [deployment reference](authentication.md#pocket-gardens-deployment-and-migration).
