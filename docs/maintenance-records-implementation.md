# Local maintenance-record implementation

The seven layers in [the feature plan](maintenance-records-plan.md) are implemented as local branches. Nothing has been pushed to GitHub and no PRs have been opened.

## Branches and prerequisite

The current checkout is the final layer, `feat/maintenance-records/07-delete-updates`. The first layer starts from local `feat/plot-submission/09-carer-assignment` at `72e790d`, since the plot stack has not merged into `main`. Rebase this stack after that prerequisite merges; do not independently merge the plot stack as part of maintenance review.

1. `feat/maintenance-records/01-foundation`: additive migration, glossary/ADRs, domain choices, development capability, active-administrator write guards.
2. `feat/maintenance-records/02-history`: public history API, garden ID resolution, Info/Updates tabs, paginated timeline.
3. `feat/maintenance-records/03-create-update`: unified composer, occurrence dates, creation replay, same-tab draft recovery, confirmation.
4. `feat/maintenance-records/04-photo-updates`: multiple uploads, quick-photo flow, upload recovery, checked/private-cache photo redirects.
5. `feat/maintenance-records/05-planting-history`: shared catalogue picker and transactional new names, without changing garden inventory.
6. `feat/maintenance-records/06-edit-updates`: partial corrections, record-version conflicts, latest-mutation replay, permanent photo removal with durable retry.
7. `feat/maintenance-records/07-delete-updates`: soft-delete API/UI, retained evidence, race/replay protection, final documentation.

Each branch contains its predecessor. Review a layer with `git diff <preceding-branch>..<layer-branch>`; layer 01's predecessor is the plot branch above. Switch to the last layer to run the complete feature.

## Using the feature locally

Apply the Prisma migrations and generate the server client using the repository's usual setup. No package dependencies were added. Use an active administrator account to write records, or explicitly set `NODE_ENV=development` and `ALLOW_ANONYMOUS_MAINTENANCE_WRITES=true` for account-free testing. Production ignores that development flag.

Open a garden and select Updates. New records can contain an activity, observation, note, photo, or their combination. Paused gardens accept observations/notes/photos; archived and unknown-stage gardens do not accept new records. Existing records can be corrected/deleted by a writer at any stage. Dates use the San Francisco calendar consistently in server capabilities and client defaults.

New and edit drafts survive refresh in the same tab. Unfinished uploads may require reattachment; completed upload references are preserved. Returning from the form restores the selected garden and saved map viewport. Explicitly discarding the local draft starts fresh without deleting any saved update. After an uncertain save, retry the unchanged attempt. A conflicting edit keeps the unsaved draft for review and offers an explicit reload of the latest saved record.

Deleting an update retains its data and still-attached photos internally, hiding normal record/photo reads. Explicitly removing an existing photo while saving an edit permanently erases it after the database commit. Failed erasure leaves a hidden pending photo row; no queue service or separate worker is required. Run:

```sh
npm run maintenance:cleanup-photos --workspace server
```

Schedule that command periodically in production before enabling photo removal. It retries up to 100 pending rows per invocation, including rows on soft-deleted records. Old signed links can remain usable for up to 15 minutes. See [server operations](../server/README.md) for the API/cleanup contract.

## Validation

The implementation adds real Postgres/RustFS route coverage for permissions, contributions, concurrent/repeated saves, lost-response recovery, stage rules, plant transactions, legacy corrections, edit conflicts, rejected replacements, durable erasure retries, and soft deletion. Rendered client tests cover tab navigation, draft restoration, quick photos, catalogue selection, partial editing, conflict review, photo-removal confirmation, and delete confirmation/history refresh.

Validation passed: workspace lint; all 118 client tests; all 205 server tests with Testcontainers; Prisma client generation; and both production client and SSR builds. Test databases are migrated without schema repair. This task does not deploy, change the user's application data, or configure a production cleanup schedule.
