# Getting Started with [Fastify-CLI](https://www.npmjs.com/package/fastify-cli)

This project was bootstrapped with Fastify-CLI.

## Available Scripts

In the project directory, you can run:

### `npm run dev`

To start the app in dev mode.\
Open [http://localhost:3000](http://localhost:3000) to view it in the browser.

### `npm start`

For production mode

### `npm run test`

Run the test cases.

### Airtable → Postgres import

Requires `AIRTABLE_API_KEY` (scope `data.records:read`), `AIRTABLE_BASE_ID`, and `DATABASE_URL`.

When importing Plots, Plants, or Maintenance Records (default), also requires S3 credentials so attachments are downloaded into `_uploads/` and attached with `setAsset` (same path as user pictures):

- `AWS_S3_ACCESS_KEY_ID`
- `AWS_S3_SECRET_ACCESS_KEY`
- `AWS_S3_BUCKET`
- `AWS_S3_REGION`
- `AWS_S3_ENDPOINT` (optional; used for MinIO / path-style endpoints)

```bash
npx prisma migrate deploy
npm run airtable:import:dry   # report only (photo estimates work without DATABASE_URL; set it to refine skip counts)
npm run airtable:import       # upsert into Postgres; photos → S3 via setAsset
# Exceptional statuses require reviewed public-ID-to-stage mappings:
npm run airtable:import:dry -- --plot-stage-resolutions=/path/to/resolutions.json
```

Photos live on `PlotPhoto`, `PlantPhoto`, and `MaintenanceRecordPhoto` (many-to-one). Each row stores a filename; public URLs look like `/api/assets/plot_photos/{photoId}/file/{filename}` and are served via `GET /api/assets/*`. Plot API responses expose a single merged `Photos` array (Airtable `Photo` + `Photos`). Re-running import skips parents that already have photo rows. Plot lifecycle preflight runs before any writes in both import modes. Planted maps to active and Not Yet Planted to potential; existing stages are preserved. Other nonblank statuses require explicit per-plot stages, and Residents Declined also records permission as not granted. A dry run without DATABASE_URL validates source data only; provide DATABASE_URL to also check existing stages and permissions.

Plot↔Neighborhood is many-to-many (`PlotNeighborhood`) because some Airtable plots link to multiple neighborhoods.
API plot `id` is the Airtable record id when present; plots created via the API use a synthetic `pg_<uuid>` id. Internal UUIDs are also accepted on GET/PATCH.

## Plot submission API

`POST /api/plots` requires an administrator session. To test account-free creation locally, explicitly set both `NODE_ENV=development` and `ALLOW_ANONYMOUS_PLOT_SUBMISSION=true` in the server environment. Anonymous creation stays disabled in production even if the flag is set. `PATCH /api/plots/:id` remains administrator-only.

`GET /api/plots/capabilities` reports `canCreatePlot` for the current session. Use this response to decide whether to display the form entry. Carer assignment is deferred until account linking is ready.

Creation requires `Location Description` and valid coordinates. `stage` defaults to `potential`; `permissionStatus` defaults to `unknown`. Permission is independent of garden stage. `firstPlanted` uses `YYYY-MM-DD` and can be set for active gardens. See `/api/reference` for the full field contract.

Map responses contain marker information and photos; detail responses add site facts and assigned volunteer display names. Private notes and volunteer contact details are excluded. `stage` replaces the legacy `Status` field, which is rejected on POST/PATCH and omitted from responses. Imported plots may have a null stage.

### Convert existing plot statuses

Back up the target database, including the source statuses, and stop application writers before deployment. The single `20261024000000_plot_submission_fields` migration adds the new fields, converts statuses, and removes `status` in one transaction. Fresh empty databases apply the same migration chain.

From the server workspace:

```sh
npx prisma migrate deploy
npm run prisma:generate
```

The [migration](prisma/migrations/20261024000000_plot_submission_fields/migration.sql) maps Planted to active and Not Yet Planted to potential. It includes the six specific Residents Declined plot IDs chosen as paused, with permission not granted. Blank statuses remain null. Any other nonblank status aborts the entire transaction, preserving the old schema and data; review those records and add explicit resolutions before retrying. Planting history is preserved.

If a failed attempt is recorded, resolve the exceptional records and mark only that rolled-back attempt with `npx prisma migrate resolve --rolled-back 20261024000000_plot_submission_fields` before retrying. Verify migration status, plot reads, and authorized writes before restarting traffic. Restore the database backup and previous application revision together if rollback is needed; raw statuses cannot be reconstructed from stage alone. Keep database exports outside the repository.

The six embedded resolutions apply to existing database rows. For Airtable imports, use `--plot-stage-resolutions=/path/to/resolutions.json` with a JSON object mapping exceptional plot IDs to explicit stages, for example `{"recExample": "paused"}`. Existing canonical stages are preserved; fresh imports containing declined plots need explicit resolutions even for those six IDs. Resolution files must match the fetched batch. Complete imports before the app takes ownership of the data.

Development databases that applied the earlier foundation migrations need their migration history reconciled before using this combined migration.

### Migrate existing photos to S3

If photos were imported earlier as JSON columns, re-fetch attachments from Airtable (CDN links expire), stage them in `_uploads/`, and attach rows with `setAsset`.

```bash
npm run photos:migrate:dry          # report only
npm run photos:migrate              # download + upload + insert photo rows
npm run photos:migrate -- --limit=5 # smoke-test a few records per table
npm run photos:migrate -- --force   # re-upload even if photo rows already exist
```

Same Airtable + S3 env vars as above. `DATABASE_URL` is always required (including `--dry-run`, so skip counts are accurate). S3 is not required for `--dry-run`.

Re-running import or migrate skips parents that already have photo rows. Use `--force` on the migrator to replace them; previous S3 objects for those rows are removed after a successful rewrite or clear.

## Learn More

To learn Fastify, check out the [Fastify documentation](https://fastify.dev/docs/latest/).

## Photo upload retention and reconciliation

Upload issuance requires an active signed-in user. The explicit development-only
anonymous garden opt-in also enables anonymous local photo uploads; production
never honors that opt-in. Issuance is limited to 30 URLs per hour per user (per IP
for anonymous development) using a bounded in-process cache. This limit applies
per server process; a multi-process deployment needs a shared limiter or matching
edge limits for one global allowance.

Uploads must declare a positive integer `byteSize` up to **10 MiB** and one of
`image/jpeg`, `image/png`, `image/webp`, `image/gif`. The signed PUT binds both
Content-Type and Content-Length; browsers supply Content-Length from the File.
Before attaching an upload, shared photo/profile handling checks actual object
size and image signature bytes using a 16-byte range read. The read and copy are
conditional on the object's ETag to reject concurrent source replacement. This
checks supported format signatures, not full image decoding or malware scanning.
SVG, HTML and other active-content formats are not accepted. Trusted imports
without MIME metadata must still contain a supported image within the size limit.

`PHOTO_UPLOAD_RETENTION_DAYS` defaults to **7** (integer 1–365). Use the same value
in the application, cleanup job and native `_uploads/` bucket policy. Signed PUTs
last 15 minutes. Tokens expire from issuance; storage expiration uses object age.
Changing retention does not rewrite existing token expiry. Late PUTs are collected
by repeated cleanup. Permanent paths are excluded from staging expiration.

Garden saves replay successful submissions before checking staging. A missing or
expired photo returns a `Photos` field error; users can reattach or continue
without it while keeping their draft identity and other fields. Recent uploads
survive failed saves; staging deletion failure does not turn a saved garden into
a failed save.

Copy reconciliation checks exact committed photo references and skips active
saves. It tracks garden-create copies only; unknown/imported permanent objects
are never scanned. See [ADR 0006](../docs/adr/0006-photo-copy-intents-survive-save-transactions.md)
for the durability and locking decision. Copy intents and upload-token records
remain as tombstones: **do not prune them**, because storage writes can finish
late. Budget for their database growth. Upload rows and copy targets are prepared
before the save transaction so saves never need a second pooled connection.

### Inspect and schedule cleanup

With the intended database/storage environment loaded, run from the repository
root:

```sh
npm run photos:cleanup:dry -w server
# Default is also dry-run. Execute deletion only after reviewing its output:
npm run photos:cleanup -w server -- --apply
```

The command prints its endpoint, bucket, versioning, retention and object
decisions. Dry-run changes no database records or storage objects. Cleanup uses
pagination and handles versioned/suspended buckets, including noncurrent versions
and delete markers. It deletes exact keys and preserves recent import staging.

Schedule `node bin/reconcile-photos.js --apply` hourly from the deployed server
workspace, with the application's database, storage and retention environment.
Confirm the image's working directory before configuring a Dokku scheduler. Use
one worker, retain logs and alert on nonzero exits. Copy intents become due after
one hour, then daily after successful checks; failures stay due. Database outages
retain objects. Storage/object-lock/permission failures are retryable.

Inspect copy failures with:

```sql
SELECT "key", "retired", "checks", "lastError", "nextCheckAt"
FROM "PhotoCopyIntent" ORDER BY "nextCheckAt", "key";
```

### Prepare storage policy and deploy

Back up the target database, apply migration
`20261113000000_photo_upload_lifecycle`, generate Prisma and deploy the matching
server/client code. Keep uploads disabled until cleanup and retention are verified.
Keep the additive ledger tables if rolling back the application.

To prepare native expiration, download and back up the bucket's current lifecycle
configuration, then generate a merged proposal from the repository root:

```sh
aws s3api get-bucket-lifecycle-configuration --bucket "$BUCKET" > existing-lifecycle.json
PHOTO_UPLOAD_RETENTION_DAYS=7 node server/bin/photo-lifecycle-policy.js existing-lifecycle.json > proposed-lifecycle.json
diff -u existing-lifecycle.json proposed-lifecycle.json
```

For compatible storage, supply the correct `--endpoint-url`. Start with
`{"Rules":[]}` only if the provider explicitly reports `NoSuchLifecycleConfiguration`;
an access/network failure is not an empty policy. The generator never contacts
storage and preserves unrelated rules, replacing only its two owned rule IDs.
Verify all added filters are exactly `_uploads/`, current/noncurrent retention
matches the application, and delete-marker/multipart cleanup is scoped correctly.

After reviewing the proposal, re-download current rules and regenerate if they
changed. Install and read back the merged configuration as a separate operator
step:

```sh
aws s3api put-bucket-lifecycle-configuration --bucket "$BUCKET" --lifecycle-configuration file://proposed-lifecycle.json
aws s3api get-bucket-lifecycle-configuration --bucket "$BUCKET"
```

Verify in a disposable bucket first, including versioned objects and delete
markers. Native expiry is asynchronous; noncurrent retention starts when a
version becomes noncurrent. If native lifecycle is unsupported, the scheduled
server job also expires staging. Reconciliation is required either way to collect
unreferenced permanent copies. See [AWS lifecycle configuration](https://docs.aws.amazon.com/AmazonS3/latest/userguide/how-to-set-lifecycle-configuration-intro.html)
and [versioned expiration](https://docs.aws.amazon.com/AmazonS3/latest/userguide/lifecycle-expire-general-considerations.html).

Before enabling production uploads, verify dry-run targets, abandonment, failed
saves, retry behavior and preservation of committed photos on nonproduction.
Production migration, policy installation, scheduling and provider permissions
require separate execution; native lifecycle timing has not been validated here.
