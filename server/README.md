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
```

Photos live on `PlotPhoto`, `PlantPhoto`, and `MaintenanceRecordPhoto` (many-to-one). Each row stores a filename; public URLs look like `/api/assets/plot_photos/{photoId}/file/{filename}` and are served via `GET /api/assets/*`. Plot API responses expose a single merged `Photos` array (Airtable `Photo` + `Photos`). Re-running import skips parents that already have photo rows.

Plot↔Neighborhood is many-to-many (`PlotNeighborhood`) because some Airtable plots link to multiple neighborhoods.
API plot `id` is the Airtable record id when present; plots created via the API use a synthetic `pg_<uuid>` id. Internal UUIDs are also accepted on GET/PATCH.

## Plot submission API

`POST /api/plots` requires an administrator session. To test account-free creation locally, explicitly set both `NODE_ENV=development` and `ALLOW_ANONYMOUS_PLOT_SUBMISSION=true` in the server environment. Anonymous creation stays disabled in production even if the flag is set. `PATCH /api/plots/:id` remains administrator-only.

`GET /api/plots/capabilities` reports `canCreatePlot` for the current session and `canAssignCarers: false` while the account-linking integration is deferred. Use this response to decide whether to display the development form entry.

Creation requires `Location Description` and either a valid `Latitude`/`Longitude` pair or a valid `Map Coordinates` string. `stage` defaults to `potential`; `permissionStatus` defaults to `unknown`. Additional writable fields include `sunExposure`, `environmentalNotes`, and `firstPlanted` (`YYYY-MM-DD`, active plots only), plus the existing address, name, bed, soil, area, and uploaded-photo fields. Permission is independent of stage: an active garden with unknown permission can be recorded. Empty names receive a fallback containing the public plot ID.

Map list responses contain marker information and photos. Detail responses also include site conditions, the first-planted date, and imported `assignedVolunteers` as IDs/display names; private notes and volunteer contact details are excluded. `stage` is authoritative for new records. Legacy `Status` is preserved for imports and exposed compatibly for new stages. A matching legacy status update preserves `preparing`; a changed recognized status maps to its corresponding stage. Unknown imported statuses remain readable without an invented stage.

Apply committed Prisma migrations before deploying code that needs them. Integration tests now initialize their disposable databases from migrations alone, without `db push`, so missing migrations cannot be silently repaired during testing.

The accepted scope and remaining dependent PRs are described in [the submission plan](../docs/plans/new-plot-submission.md).

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
