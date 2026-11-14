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

## Photo uploads and temporary retention

Garden photos stay local until **Create garden** is pressed. Unsubmitted files
need reattachment after refresh; other fields recover. Once uploaded, the filename
and exact payload are saved in the draft so a failed or lost save response can be
retried without uploading again. Profile/gallery inputs still upload immediately.

Issuance requires an active signed-in user, except the explicit development-only
anonymous garden opt-in. Production never honors that opt-in. The limit is 30 URLs
per hour per user (per IP in anonymous development), per server process. Multiple
processes need a shared/edge limiter for a single global allowance.

Uploads declare `byteSize` up to **10 MiB** and one of `image/jpeg`, `image/png`,
`image/webp`, `image/gif`. Signed PUTs bind Content-Type and Content-Length and last
15 minutes. Attachment checks actual size and signature bytes with a 16-byte
range read, then pins the copy to the object's ETag. This is format-signature
validation, not full image decoding or malware scanning. SVG/HTML are not accepted.
Direct imports without MIME metadata must still contain a supported image.

### Storage setup

Temporary cleanup uses the storage provider's native lifecycle expiration. The
example below assumes an **unversioned S3-compatible bucket**; it does not provide
cleanup of historical versions in a versioned bucket.

`PHOTO_UPLOAD_RETENTION_DAYS` defaults to **7** (integer 1–365). Apply the same age
in the bucket's native rule. The server checks the object's LastModified value.
Existing successful submissions replay before any staging checks.
Expired/missing photos return a field error for reattachment.
Late PUTs eventually expire based on their new object age. Native expiry is
asynchronous, so server rejection may precede physical object deletion.

Before enabling uploads, use the provider's management UI to verify versioning is
disabled and append this prefix-scoped rule, adjusting Days to match the server:

```json
{
  "ID": "pocket-gardens-staging-expiration",
  "Status": "Enabled",
  "Filter": { "Prefix": "_uploads/" },
  "Expiration": { "Days": 7 }
}
```

Preserve unrelated bucket rules and verify the saved configuration; this example
is one rule, not a replacement for the entire bucket policy. Permanent paths must
not receive this blanket expiry. See [AWS lifecycle configuration](https://docs.aws.amazon.com/AmazonS3/latest/userguide/how-to-set-lifecycle-configuration-intro.html).

### Save cleanup

Successful saves attempt to delete their temporary uploads. Failed save
transactions attempt to delete their permanent copy targets while retaining
staging for retry. Cleanup errors are logged and do not turn a committed garden
save into a failure. An uncertain commit retains both copies until a retry can
recover the saved garden.

Cleanup is best effort: a crash, failed deletion or unresolved commit may leave an
unreferenced permanent object. Cleanup failures are logged for manual investigation.
