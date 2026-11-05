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

`GET /api/plots/capabilities` reports `canCreatePlot` for the current session and `canAssignCarers: false` while the account-linking integration is deferred. Use this response to decide whether to display the development form entry.

Creation requires `Location Description` and either a valid `Latitude`/`Longitude` pair or a valid `Map Coordinates` string. `stage` defaults to `potential`; `permissionStatus` defaults to `unknown`. Additional writable fields include `sunExposure`, `environmentalNotes`, and `firstPlanted` (`YYYY-MM-DD`, active plots only), plus the existing address, name, bed, soil, area, and uploaded-photo fields. Permission is independent of stage: an active garden with unknown permission can be recorded. Empty names receive a fallback containing the public plot ID.

Map list responses contain marker information and photos. Detail responses also include site conditions, the first-planted date, and imported `assignedVolunteers` as IDs/display names; private notes and volunteer contact details are excluded. `stage` is the only lifecycle field. `Status` is rejected on POST/PATCH and omitted from responses. Imported rows with no source status may have a null stage. Lifecycle labels are displayed from stage, independently of permission.

For an existing database, complete the stage conversion below before deploying the guarded status-removal migration. Development startup stops if migration fails and never runs `db push --accept-data-loss`. Integration tests initialize their disposable databases from committed migrations alone, without schema repair.

### Convert existing plot statuses

Back up the target database and stop application writers before conversion. The additive stage/permission migration must already be applied; if needed, apply the pre-removal foundation revision's migrations first. Fresh empty databases can apply the full migration chain directly.

From the server workspace, export a read-only preflight report before making changes:

```sh
npm run plots:migrate-stages > /secure/path/plot-stage-before.json
npm run plots:migrate-stages -- --resolutions=prisma/plot-stage-resolutions.json
npm run plots:migrate-stages -- --apply --resolutions=prisma/plot-stage-resolutions.json
npx prisma migrate deploy
npm run prisma:generate
```

The [resolution file](prisma/plot-stage-resolutions.json) records the maintainer's provisional paused stage for six specific Residents Declined plots; permission becomes not granted. Use a file matching the target dataset: unresolved statuses, unmatched IDs, and conflicts with existing stages or permission values block application. Preflight exits nonzero when unresolved records exist, while still writing its JSON report. Keep database exports outside the repository.

Conversion preserves existing canonical stages and planting history. The removal migration backfills recognized statuses and refuses to drop the old column while exceptional records remain unresolved. If a prior failed attempt is recorded, fix the data and mark only that rolled-back attempt with `npx prisma migrate resolve --rolled-back 20261104000000_plot_stage_only` before retrying deployment. Verify migration status, plot reads, and authorized writes before restarting traffic. Restore the database backup and previous application revision together if rollback is needed; raw statuses cannot be reconstructed from stage alone.

For subsequent Airtable imports, pass `--plot-stage-resolutions=prisma/plot-stage-resolutions.json` from the server workspace when that file matches the complete fetched plot batch.

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
