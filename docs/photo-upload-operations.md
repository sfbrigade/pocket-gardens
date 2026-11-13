# Photo upload lifecycle operations

Implementation is local only. No production migration, storage policy, cleanup,
schedule, deployment, or historical orphan scan was executed for this change.
There are no production uploads to backfill. The prerequisite commit for the
photo/draft replacement seam belongs in stack layer #55; lifecycle changes sit
above it.

## Retention and recovery contract

`PHOTO_UPLOAD_RETENTION_DAYS` defaults to **7** and must be an integer from 1 to
365. Set it explicitly in both application and cleanup-job environments and use
that same value when generating the native bucket policy. Changing it requires
coordinating those environments and policy together; existing issued token expiry
is not rewritten. Lowering it can require users with unfinished drafts to reattach
photos. Increasing it does not revive an already expired token.

POST `/api/assets` records filename and expiry before issuing a signed PUT URL.
The PUT is valid for **900 seconds**. An upload token expires from issuance time;
storage expiration is based on object age. A PUT that started before URL expiry
can complete later: repeated prefix sweeps/native object-age expiry eventually
collect that new object too. Browser removal, discard, refresh and tab closure do
not have to reach the server for cleanup to happen.

Garden saves replay an existing successful submission **before** checking staging.
Otherwise they lock their upload tokens and require both a valid token and a
recent, existing source. Missing or expired sources return HTTP 422 with a `Photos`
field error. The form retains all other fields and submission ID, releases the
stale attachment and requires reattachment or an explicit opt-out. Storage
permission/outage errors remain server failures so they cannot silently detach a
potentially valid photo. Recent sources survive failed saves. Successful saves
attempt immediate staging deletion; failure never turns success into a failed
save, and eventual staging expiration remains responsible for retries.

The retention boundary is inclusive: sources at or beyond the age cutoff are
expired. Native S3 expiration is asynchronous and rounded according to S3's
lifecycle rules; it does not promise deletion at an exact hour. A save at the
boundary may need reattachment. Permanent photo paths are never covered by the
native `_uploads/` expiration rules.

## Durable copy reconciliation

`PhotoCopyIntent` is written before each external garden-create copy, separately
from the garden transaction. The save locks the intent until commit/rollback.
Reconciliation takes that same lock with `SKIP LOCKED`, checks the exact committed
`PlotPhoto` reference, and commits a retirement fence before deleting an
unreferenced destination. A deletion that outlasts a lost database connection
cannot race a new copy through an uncommitted retirement. Database errors
retain objects for retry. No permanent bucket listing or ownership inference is
performed, and existing/imported permanent objects without an intent are untouched.

The first reconciliation is due one hour after intent creation. Successful checks
are due again in 24 hours; failures stay due. Retired intents are **retained as
tombstones**, including after successful deletion, so later runs remove external
copies that finished after a transaction or process was interrupted. Do not prune
these records without a separate design that bounds external operation completion.
`AssetUpload` records also remain as token-expiry tombstones; they prevent an old
filename from being treated as newly issued. Budget for their gradual database
growth. This is a small garden-create ledger, not tracking for every legacy asset
mutation. Shared user-picture/gallery/import APIs keep their existing behavior.

A save uses a 60-second transaction timeout and performs durable intent writes on
another database connection before storage copies. Size the connection pool for
these extra writes; pool exhaustion safely fails the save and leaves sources for
retry. Cleanup releases the database lock only after its retirement fence commits,
then deletes externally. External operations can outlast a lost database
connection; repeated tombstone reconciliation is intentional.

Inspect due work and failures with read-only SQL:

```sql
SELECT "key", "upload", "retired", "checks", "lastError", "nextCheckAt"
FROM "PhotoCopyIntent"
ORDER BY "nextCheckAt", "key";
SELECT count(*) AS expired_tokens
FROM "AssetUpload" WHERE "expiresAt" <= now();
```

Run inspection with the intended database/bucket credentials loaded into the
environment; the command prints endpoint, bucket, versioning, retention and
per-object decisions, never credentials:

```sh
npm run photos:cleanup:dry -w server
# Equivalent default: npm run photos:cleanup -w server
```

Dry-run performs no database/storage mutations. It takes short row locks while
checking references and skips active saves. After reviewing its output, operators
can run the **separate, destructive execution step**, not run as part of this task:

```sh
npm run photos:cleanup -w server -- --apply
```

The command exits nonzero on listing/database/configuration failures or failed
object cleanup. Copy failures expose `lastError` and `checks`; staging failures
are logged and rediscovered by later listings. Alert on nonzero exits and repeated
errors. Copy intents and object listings use pagination. Concurrent jobs skip locks
and deletion is idempotent, but prefer one scheduled worker to reduce duplicate
work.

The fallback sweeper lists only `_uploads/`, checks the current object's age, and
locks issued tokens to skip active saves. Recent untracked import staging is kept.
Versioned/suspended buckets use paginated version listings and purge exact-key
versions/delete markers, including keys with only a current delete marker. An
unrelated key sharing the same filename prefix is not deleted. Permanent cleanup
also purges exact-key versions only after the reference check. Object lock,
replication restrictions or insufficient permissions produce retryable failures;
verify the actual storage implementation before enabling uploads.

## Prepare a native staging policy without changing storage

The generator only reads a JSON file and writes a proposed document to stdout.
It preserves unrelated rules and replaces only these owned rule IDs:
`pocket-gardens-staging-expiration`, `pocket-gardens-staging-markers`.
It does not connect to a bucket or install anything.

1. With the intended storage endpoint/account selected, download the bucket's
   current lifecycle configuration using the storage provider's read-only tooling.
   Keep an untouched backup. For AWS CLI, the read operation is:

   ```sh
   aws s3api get-bucket-lifecycle-configuration --bucket "$BUCKET" > existing-lifecycle.json
   ```

   For S3-compatible storage supply the correct `--endpoint-url`. Only when the
   provider explicitly returns `NoSuchLifecycleConfiguration` may the starting
   document be `{"Rules":[]}`. An access/network error is not an empty policy.

2. Generate the proposed merge from this checkout:

   ```sh
   PHOTO_UPLOAD_RETENTION_DAYS=7 node server/bin/photo-lifecycle-policy.js existing-lifecycle.json > proposed-lifecycle.json
   diff -u existing-lifecycle.json proposed-lifecycle.json
   ```

3. Verify all new filters are exactly `_uploads/`. The current-object rule expires
   at the configured number of days, expires noncurrent versions after the same
   number of days, and aborts incomplete multipart uploads after one day. The
   second rule removes expired delete markers. No permanent prefix receives any
   of these rules. Noncurrent retention is counted from becoming noncurrent, so
   versioned storage can remain physically present longer than the current object.
   Confirm unrelated rules and top-level configuration are preserved.

4. Later, after owner review, installation is a separate infrastructure action:

   ```sh
   aws s3api put-bucket-lifecycle-configuration --bucket "$BUCKET" --lifecycle-configuration file://proposed-lifecycle.json
   aws s3api get-bucket-lifecycle-configuration --bucket "$BUCKET"
   ```

   Re-download current rules immediately before installation and regenerate if
   another operator changed them. Compare the read-back rules to the reviewed
   proposal, including version behavior. Never replace the bucket configuration
   with just the new rules. Preserve the backup for rollback/merge.

5. Verify provider support in a disposable bucket using both current and
   noncurrent objects and delete markers. Lifecycle propagation/expiry can be
   delayed. If RustFS or another implementation cannot run the native rules,
   schedule the equivalent server command instead. Reconciliation is required
   regardless of native staging policy, because it also collects permanent copies.

Sources: [AWS lifecycle configuration](https://docs.aws.amazon.com/AmazonS3/latest/userguide/how-to-set-lifecycle-configuration-intro.html)
and [AWS expiration/versioning semantics](https://docs.aws.amazon.com/AmazonS3/latest/userguide/lifecycle-expire-general-considerations.html).

## Later rollout and scheduling (not executed)

1. Place the first photo commit, `fix: isolate photo uploads when replacing
   garden drafts (PR 55 prerequisite)`, into #55 when preparing the stack. Its
   original SHA was `ce31116`; after rebasing onto `72eaa34` it is `9ea2884`. Preserve layer
   ordering and leave the user's branch 07 testing checkout to its owner.
2. Back up the target database and apply the additive migration
   `20261113000000_photo_upload_lifecycle` using the normal deployment process.
   Generate the Prisma client and deploy the matching server/client code together.
   Disabling uploads remains the rollback option; keep the additive ledger tables.
3. Set `PHOTO_UPLOAD_RETENTION_DAYS` consistently. Review/install/verify the merged
   native policy above, or verify the fallback job on that provider.
4. Run dry-run on the intended database and bucket; check its printed target and
   inspect any due intents. No unknown historical permanent objects are swept.
5. Schedule hourly reconciliation with the application's database, storage and
   retention environment. For Dokku, prepare a scheduler job equivalent to
   `cd /app/server && node bin/reconcile-photos.js --apply` in the deployed image;
   confirm the actual image working directory before installing the schedule.
   Use a single worker, retain logs and alert on failed runs/overdue intent errors.
   Exact scheduler provisioning remains an infrastructure-owner action.
6. Verify on nonproduction first: abandon an upload, interrupt a save, confirm
   dry-run decisions, retry cleanup and confirm committed references remain. Then
   enable production uploads through the existing authorized release process.

Local tests exercise the PostgreSQL/RustFS lifecycle and recovery seams, including
versioned deletion. Native policy execution/timing, production credentials,
provider permissions, scheduler provisioning and physical-device performance have
not been validated by this change.
