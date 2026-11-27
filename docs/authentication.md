# Authentication

Pocket Gardens uses [Better Auth](https://better-auth.com/) `1.7.25` under
`/api/auth`, with Magic Link and Admin plugins. See the
[README](../README.md#authentication-setup) for environment configuration.

## Sign-in and registration

- Email links are the default for signup and login; passwords are optional.
  Signup requires first and last names. Password signup requires email verification
  before login; the login screen offers verification resends.
- New accounts receive the `user` role through public and invitation signup,
  using either email links or passwords. Existing accounts keep their roles.
- Existing users sign in with their existing email without registering again.
  Account IDs, roles, bans, profiles, existing Person links, and garden history
  are preserved. Emails are matched case-insensitively. Pre-Better Auth accounts
  are treated as email-verified during migration; new accounts still require
  verification through their normal signup flow.
- When `VITE_FEATURE_REGISTRATION` is not `true`, signup requires a matching,
  unused invitation. Existing accounts can still log in.
- Email links open `/auth/magic-link`, `/auth/verify-email`, `/passwords/reset`,
  or `/invites/:id`. Opening a link does not redeem it: magic links and verification
  require confirmation; password resets require submitting a new password.
  Success and error flows retain safe application destinations.
- **My Account → Sign-in options → Set or reset your password** lets passwordless
  accounts add a password through email recovery. Reset links expire after
  30 minutes, are single-use, and revoke the reset account's sessions when used.
  Other unused reset links remain valid until expiry.
- Profile editing supports names and pictures. Email changes and manual
  administrator password assignment are disabled.

## Sessions and access

The official React client owns session observation through `useSession`. Sessions
use cookies; `/api/users/me` supplies the application profile. SSR hydrates public
session/profile fields without exposing session tokens. Account changes and logout
clear application caches and pending queries; same-account refreshes preserve them.
Late profile saves and stale snapshots of a successfully logged-out session cannot
restore the previous account. Public authentication screens remain available if
profile loading fails.

Plot submission requires a verified, unbanned user or administrator account,
including existing users without a role change.
Contributors can edit the garden details and public notes they submitted. Verified,
unbanned administrators can edit any garden. Stage changes and carer assignment
require an administrator. New carer assignments require verified, unbanned users.
Accounts and Person records remain separate;
existing links are preserved, and matching names or emails do not claim imported
Person records.

Only verified, unbanned administrators can write and view staff permission notes.
Garden care, additional permission, and environmental notes are public.

Create the first administrator with the [bootstrap script](../README.md#one-time-setup).
For subsequent administrators, invite a user, wait for email verification, then use
**Admin → Users → Edit Profile → Administrator access**. Role changes affect existing
sessions immediately. Unverified accounts cannot be promoted, and administrators
cannot remove their own admin access.
Removing administrator access through the user form returns the account to the
`user` role, retaining plot submission access.

## Registration safeguards

Passwordless signup calls `/api/auth/sign-in/magic-link` with `email` and
`metadata.registration: { firstName, lastName, inviteId? }`. The server validates
registration and invitations when requesting and confirming a link. Account/session
creation and invitation acceptance commit together. Plain login requests cannot
create accounts.

Magic-link login to an existing unverified account proves email ownership and
removes its unverified password and old sessions. The owner can then set a password
through email recovery. Reset and magic-link tokens are hashed before storage.
Origin/CSRF checks, trusted proxy handling, and rate limits remain enabled; logs
exclude usable authentication tokens. Forward `/api/...` unchanged to the backend.

## Deployment and migration

1. Configure an HTTPS `BASE_URL`, a private `BETTER_AUTH_SECRET` of at least
   32 characters, SMTP, and the actual `TRUSTED_PROXIES` addresses. Confirm that an
   existing administrator can receive email before cutover.
2. Back up the database and rehearse `20261116000000_better_auth` and
   `20261118000000_verify_existing_accounts` on an isolated copy. Deploy the server
   and client together. Startup applies pending migrations without resetting the
   database; earlier migrations remain unchanged.
3. Verify email delivery, existing-admin login, plot submission, invitations,
   registration/verification, password recovery, profile editing, and logout.

The migration preserves existing users and garden relationships, adds Better Auth
records, and retains legacy columns for cutover validation. Legacy passwords, reset
tokens, and sessions are not imported: users sign in again and replace old reset
emails. Retained columns are not authentication authorities and do not synchronize
new credentials back to the old implementation.

The follow-up migration treats pre-Better Auth accounts as verified, so active
existing users remain selectable as carers before their first new login. It
identifies those accounts by the retained `hashedPassword` column, which the old
schema required and new Better Auth signups leave null. Pending new signups remain
unverified, and deactivated accounts remain banned. Verification status does not
sign anyone in; existing users still request and confirm a magic link for access.

An application-only rollback is therefore insufficient. Restore a compatible
application/database pair while accounting for writes since backup. Investigate
failed migrations before retrying; never reset a database containing user or garden
data. See [Dokku deployment](dokku.md) for hosting commands.

## Validation

With Docker available, generate the Prisma client and run:

```sh
npm run prisma:generate -w server
CI=true npm test -w server
npm test -w client
npm run lint:check
npm run build -w client
```

Backend tests use disposable databases/storage and captured test mail. On the host,
`CI=true` avoids assuming the Compose network. The client build covers browser and
SSR output. Test real SMTP delivery separately during deployment.
