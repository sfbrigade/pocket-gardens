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

When importing Plots (default), also requires S3 credentials so Photo / Photos attachments are downloaded and stored in the bucket instead of keeping Airtable CDN URLs:

- `AWS_S3_ACCESS_KEY_ID`
- `AWS_S3_SECRET_ACCESS_KEY`
- `AWS_S3_BUCKET`
- `AWS_S3_REGION`
- `AWS_S3_ENDPOINT` (optional; used for MinIO / path-style endpoints)

```bash
npx prisma migrate deploy
npm run airtable:import:dry   # report only (Plot photo estimates work without DATABASE_URL; set it to refine skip counts)
npm run airtable:import       # upsert into Postgres; Plot photos → S3
```

Plot `photo` / `photos` columns store JSON arrays of asset paths such as `/api/assets/plots/{uuid}/photos/{file}.jpg`. These are returned on Plot API responses as `Photo` / `Photos` and served via `GET /api/assets/*`. Re-running import skips plots whose photo fields are already migrated.

Plot↔Neighborhood is many-to-many (`PlotNeighborhood`) because some Airtable plots link to multiple neighborhoods.
API plot `id` is the Airtable record id when present; plots created via the API use a synthetic `pg_<uuid>` id. Internal UUIDs are also accepted on GET/PATCH.

### Migrate existing Plot photos to S3

If Plots were imported earlier (raw Airtable attachment JSON still in `photo` / `photos`), run the one-shot migrator. It re-fetches fresh attachment URLs from Airtable (CDN links expire), uploads to S3, and rewrites the columns.

```bash
npm run plots:migrate-photos:dry          # report only
npm run plots:migrate-photos              # download + upload + update DB
npm run plots:migrate-photos -- --limit=5 # smoke-test a few plots
npm run plots:migrate-photos -- --force   # re-upload even if already migrated
```

Same Airtable + S3 env vars as above. `DATABASE_URL` is always required (including `--dry-run`, so skip counts are accurate). S3 is not required for `--dry-run`.

Re-running import or migrate skips columns that already store `/api/assets/...` path arrays. Use `--force` on the migrator to re-upload; previous asset objects for that attribute are removed after a successful rewrite or clear.

## Learn More

To learn Fastify, check out the [Fastify documentation](https://fastify.dev/docs/latest/).
