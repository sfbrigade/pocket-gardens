# Airtable → Postgres / Prisma Migration

This project is moving domain data (Plots, Plants, People, Suppliers|Partners, Maintenance Records, Neighborhoods, Zip Codes) from Airtable into PostgreSQL via Prisma. Auth models (`User`, `Invite`) were already on Postgres.

## Prerequisites

1. `DATABASE_URL` pointing at Postgres
2. `AIRTABLE_API_KEY` and `AIRTABLE_BASE_ID`
3. Token scope: `data.records:read`

## Tooling

| Script | Purpose |
|--------|---------|
| `npm run airtable:import:dry` | Dry-run import report (no writes) |
| `npm run airtable:import` | Two-pass idempotent import into Postgres |

Entrypoint: [`bin/airtable-import.js`](../bin/airtable-import.js)

## Modeling decisions

- Every migrated row has a UUID primary key plus unique `airtableId` (`rec…`).
- Plot API responses still expose `id` as the Airtable record id during the transition.
- Canonical plot coordinates are `latitude` / `longitude`, derived from Airtable **Map Coordinates** (`"lat, lng"`). Separate Latitude/Longitude Airtable fields are not present in the live base.
- Linked records use foreign keys or join tables (`PlotAssignedVolunteer`, `NeighborhoodZipCode`, `PersonZipCode`, `MaintenanceRecordPlant`).
- Attachments and other structured values are stored as `Json`.
- Lookup / rollup / formula fields are generally not persisted as first-class columns (recompute in app or snapshot later if needed).
- Airtable table **Suppliers|Partners** maps to Prisma model `Partner` (org/contact scalars only; no links to other tables).

## Recommended cutover steps

1. Apply migrations: `npx prisma migrate deploy`
2. Dry-run import: `npm run airtable:import:dry` — review `unresolvedLinks` / `errors`
3. Import: `npm run airtable:import`
4. Reconcile counts (Airtable vs Postgres). Expected from a successful dry-run against the current base:

| Table | Count |
|-------|------:|
| Neighborhoods | 38 |
| Zip Codes | 27 |
| People | 7 |
| Plants | 33 |
| Suppliers\|Partners | 4 |
| Plots | 78 |
| Maintenance Records | 100 |

```bash
node --input-type=module -e "
import './config.js';
import prisma from '#prisma/client.js';
const counts = {
  plots: await prisma.plot.count(),
  plants: await prisma.plant.count(),
  people: await prisma.person.count(),
  partners: await prisma.partner.count(),
  neighborhoods: await prisma.neighborhood.count(),
  zipCodes: await prisma.zipCode.count(),
  maintenanceRecords: await prisma.maintenanceRecord.count(),
};
console.log(counts);
await prisma.\$disconnect();
"
```

5. Smoke-test Plot API (`GET /api/plots` with viewport bounds).
6. Keep Airtable read-only for a soak period, then revoke write access / decommission.

Dry-run on 2026-07-18 reported **0 unresolved links** and **0 errors** across all readable tables.

## Rollback

- Application: redeploy a revision that still calls Airtable for Plots (git history prior to Prisma cutover).
- Database: domain tables can be dropped by reverting migration `20260718000000_airtable_domain_models` **only if** no production writes depend on them. Prefer keeping tables and pointing the app back at Airtable instead of destructive rollback.
- Re-import is safe: upserts are keyed by `airtableId`.

## Verification checklist

- [ ] Dry-run report has acceptable unresolved-link count
- [ ] Row counts match Airtable
- [ ] Plot viewport filter returns expected beds
- [ ] Create/patch Plot writes to Postgres
- [ ] Idempotent second import does not duplicate join rows
