# Getting Started with [Fastify-CLI](https://www.npmjs.com/package/fastify-cli)

This project was bootstrapped with Fastify-CLI.

## Available Scripts

In the project directory, you can run:

### `npm run dev`

To start the app in dev mode.\
Open [http://localhost:3000](http://localhost:3000) to view it in the browser.

### `npm start`

Applies pending Prisma migrations, then starts the app in production mode. If migration fails, the server does not start. Restarts check migration history and leave already-applied migrations in place. The deployment build generates Prisma Client before startup.

### `npm run test`

Run the test cases. See the [authentication reference](../docs/authentication.md) for Better Auth setup, the existing-account migration, and disposable test database behavior.

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

`POST /api/plots` requires a verified, unbanned account with the `user` or `admin` role. To test account-free creation locally, explicitly set both `NODE_ENV=development` and `ALLOW_ANONYMOUS_PLOT_SUBMISSION=true` in the server environment. Anonymous creation stays disabled in production even if the flag is set. `PATCH /api/plots/:id` remains administrator-only.

`GET /api/plots/capabilities` reports `canCreatePlot` and `canAssignCarers` for the current session. Use these capabilities to display the form entry and enable registered-user selection. Only active administrators can assign carers, including when anonymous development creation is enabled.

Staff can search verified, unbanned registered users by name or email with `GET /api/plots/carers?search=...`. The response contains user IDs, display names, and email addresses, with `X-Next-Offset` pagination. Send selected account IDs in the optional `carerUserIds` array on `POST /api/plots`; duplicate, unknown, unverified, and banned users are rejected. Assignments save in the same transaction as the plot and reuse explicit account-to-volunteer links while preserving imported volunteer identities. Public plot details expose assigned volunteer IDs and display names without contact information.

If a draft contains carers and the current session cannot assign them, the form keeps those selections visible and allows removal. Creation requires removing them or signing in with a staff account. Restoring the draft preserves its submission identity and any previous save attempt.

Creation requires `Location Description` and valid coordinates. `stage` defaults to `potential`; `permissionStatus` defaults to `unknown`. Permission is independent of garden stage. `firstPlanted` uses `YYYY-MM-DD` and can be set for active gardens. See `/api/reference` for the full field contract.

Environmental notes can be included in normal plot submissions. Supplying the legacy `Seth's Notes` field, including an empty value, requires an administrator even when anonymous development creation is enabled. Existing legacy notes are retained.

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

### Maintenance updates

Maintenance history is public. Active administrators can create and correct visits; set `ALLOW_ANONYMOUS_MAINTENANCE_WRITES=true` with `NODE_ENV=development` for account-free local testing. Production ignores that flag. Garden stages restrict new visits, while historical corrections remain available to writers at any stage. Maintenance dates use the San Francisco calendar (`America/Los_Angeles`), supplied to the client in capabilities.

Edits require the loaded `version` and a new `mutationId`. Keep that payload unchanged when retrying an uncertain save. Stale/superseded edits return 409 and require review; they never silently overwrite another edit. Imported missing/legacy fields can be preserved by omitting unchanged fields. The client offers no volunteer reassignment and never changes current garden planting inventory or care summaries.

Removing a saved photo through an edit permanently erases it after the edit commits. If storage is unavailable, its row stays pending, hidden from galleries and new signed links. Retry pending rows with:

```sh
npm run maintenance:cleanup-photos --workspace server
```

The command processes up to 100 rows per invocation (including photos whose parent is later soft-deleted), exits nonzero while rows remain pending, and is safe to repeat. Run manually during local development; production must schedule this command periodically, for example every five minutes through the deployment host's scheduler, before enabling photo-removal UI. No additional queue service is needed. Previously issued signed links can remain usable for up to 15 minutes; maintenance redirects use private/no-store caching. Keep Airtable imports disabled after app cutover so imports cannot overwrite corrections or restore erased evidence.
