# Authentication reference

The application uses [Better Auth](https://better-auth.com/) under `/api/auth`, with
the Magic Link and Admin plugins. Refer to Better Auth's documentation for
standard APIs and the [README](../README.md#authentication-setup) for required configuration.

For local development, `npm run dev` prepares the ignored env files before starting
the processes. It generates and persists a random `BETTER_AUTH_SECRET` if the local
value is missing, too short, or the example placeholder, including in an existing
env file from before the auth port. Valid secrets stay unchanged on subsequent
runs. The server env file is private, and only `VITE_` settings are copied into the
client env file. No secret value is logged. Production startup still requires an
explicitly configured secret and rejects the example placeholder.

## Login and registration

The web login page offers email-link login and password login. Both return to the
originally requested application page. Registration and invitation acceptance offer
email-link signup (the default) or password signup. Both require first and last names.
Verification, password recovery, and registration keep that return destination when
entered from login. Returning from password setup or verification selects password login.

Password signup stays signed out until email verification, and the login form offers
verification resends. Email-link signup creates the verified account and signs the
user in when they confirm the link.

Passwordless accounts have no credential account until a password is added through
the email password-reset flow. **My Account → Sign-in options → Set or reset your
password** opens that flow. Profile editing supports names and pictures; email is
read-only, and email-change endpoints are disabled.

## API and sessions

The React client uses Better Auth's native endpoints and browser session cookies.
After login, it loads `/api/users/me` for the application profile and admin permissions.
When the session refresh detects an account change or logout, it clears cached
account data and pending queries before exposing the new session. This also covers
changes made in another tab when the application regains focus.

Passwordless signup uses `/api/auth/sign-in/magic-link` with `email` and
`metadata.registration: { firstName, lastName, inviteId? }`. The server validates and
stores those profile fields in an additional `registration` field on the hashed,
expiring verification record, leaving Better Auth's token value unchanged. Confirmation
creates a verified user and session through Better Auth, and accepts any invitation in
the same transaction. Public registration settings and invitation availability are
checked both when requesting and confirming the link.

Plain login requests without registration metadata only send mail to existing accounts
and cannot create new accounts. Registration links for existing verified accounts sign
them in without replacing their profile or credentials. For an existing unverified
account, Better Auth proves email ownership by removing its unverified password and
old sessions; the owner can add a password through email password reset.

Forward `/api/...` requests unchanged to the backend; the proxy must not add or strip
`/api`. API callers whose base URL already ends in `/api` append `/auth/...`.

## Browser email links

Email links open `/auth/magic-link`, `/auth/verify-email`, `/passwords/reset`, or
`/invites/:id` directly on `BASE_URL`. Opening a screen does not consume a token.
Verification and magic-link tokens require explicit confirmation; reset tokens are
redeemed when the new password is submitted. Browser sessions use cookies only;
Bearer authentication and native-app instruction pages are not supported.

## Password lifecycle

Reset links are single-use and expire after 30 minutes. New reset-token identifiers
are hashed before storage; magic-link tokens are hashed by their plugin. Password
changes leave other unused reset links valid until expiry, following Better Auth's
token lifecycle.
Password resets revoke sessions through the built-in option; admin password changes
also force logout through Better Auth's native session-revocation API.

## Administrator access

Create the first administrator using the [bootstrap script](../README.md#one-time-setup).
HTTP account creation remains unavailable to admins. The bootstrap CLI prompts for a
password and creates a verified administrator, so no verification email is needed.
Its version is pinned alongside the server's Better Auth version; see the
[CLI documentation](https://better-auth.com/docs/concepts/cli#create-admin).

To add subsequent administrators, an existing admin can invite a user, wait for email
verification, then open **Admin → Users → Edit Profile** and save **Administrator access**.
Role changes use `/api/auth/admin/set-role` separately from profile updates. The server
rejects promotion of unverified accounts, and role changes apply to existing sessions
immediately. Administrators cannot remove their own admin access; another administrator
must make that change.

The admin interface displays verification status and refreshes user information after
a role change. Confirmed role updates remain successful if a background profile refresh
fails, and role saves preserve unsaved profile photos.

## Resource Binder provenance

The authentication implementation was ported from Resource Binder commit
`4254e78b5ba2074fd1fc1d22930c337db0a3d06e`, retaining both email-link and password
flows, transactional invitation handling, confirmation pages, and admin behavior.
Pocket Gardens pins Better Auth/core and its bootstrap CLI to `1.7.25`; the source
used runtime version `1.7.14`. The source test suites were brought over and adapted
to the existing garden APIs, photo validation, and client test setup.

## Existing Pocket Gardens accounts

Existing users keep their User UUIDs, emails, profiles, roles, invitation history,
and explicit Person links. Their linked plots and maintenance history remain intact.
They do not need to register again. On first use after cutover, choose **Email me a
login link**, enter the existing account email, and confirm the link from that inbox.
Email addresses are matched case-insensitively. Existing account presence does not
mark an email verified; mailbox confirmation does.

There is no legacy password migration: existing users do not currently use passwords.
After email sign-in, **My Account → Sign-in options → Set or reset your password**
lets them optionally add one. Both login methods then access the same account.
Existing deactivated accounts remain banned. Existing admins retain their role and
can access admin features after email confirmation. Old Fastify sessions are not
imported, so users sign in once after the cutover.

Carer search and new assignments require verified, unbanned users. Saved assignments
and plot-submission retry recovery remain intact even if a carer is later banned.
No imported Person is claimed by matching its name or email; existing explicit
User–Person links remain the identity authority.

## Pocket Gardens deployment and migration

Before deploying, configure the public HTTPS `BASE_URL`, a private `BETTER_AUTH_SECRET`
(at least 32 characters), SMTP delivery, and the actual trusted proxy addresses.
Never copy a secret from Resource Binder. `SESSION_SECRET` is no longer used. Confirm that an
existing administrator can receive email at their account address before cutover.

Back up the database and rehearse the migration on an isolated copy before rollout.
The new migration is `20261116000000_better_auth`; all earlier Pocket Gardens
migrations, including the plot/carer work, stay unchanged. Deploy the compatible
server and client together. Startup applies pending migrations without resetting
the database. Do not copy or reconcile Resource Binder migration history into this app.

The migration adds auth tables and fields, backfills display names, admin roles,
and bans, and keeps every existing User row and UUID. It retains legacy columns
under Prisma `legacy*` field names for cutover validation; `hashedPassword` becomes
nullable to allow passwordless signup. Those columns are excluded from application
profile responses and are no longer authentication or permission authorities. No
legacy hashes, reset tokens, or sessions are imported into Better Auth. Removal of
retained columns is a later migration after production verification.

The automated migration test checks existing User IDs, profiles and access mappings,
Invites, explicit Person links, plot assignments, and maintenance history. The
existing-account flow test signs a previously unverified account in by email and
adds a password without registration or changing its UUID.

After deployment, verify actual email delivery and confirmation, an existing admin
login, public plot reads, plot capabilities and submission, profile editing,
invitation signup, password signup/verification/reset, and logout/session revocation.
Previously issued legacy reset emails need to be replaced using the new reset flow.

Retaining columns does not automatically make an application-only rollback safe.
Accounts created or passwords set after cutover are not synchronized into the old
authentication implementation. Restore an appropriate database/application pair if
required, accounting for any garden writes since the backup. A failed transactional
auth migration must be investigated before marking its failed Prisma attempt
rolled back and retrying. Do not reset a database containing user or garden data.

## Tests

Run `npm run prisma:generate -w server` after schema changes and before tests.
`npm test -w server` runs the auth and garden backend suites using disposable
PostgreSQL and object-storage containers. When running directly on the host without
the Compose network, use `CI=true npm test -w server`. Tests set their own temporary
database and test-only auth secret; they do not migrate the configured application
database. `npm test -w client` runs existing Node tests followed by the imported
Vitest UI tests. `npm run lint:check` and `npm run build -w client` cover lint and
both browser/server rendering builds.
