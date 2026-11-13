# Photo upload lifecycle — implementation handoff

## Objective and authorization

Implement reliable cleanup and recovery for garden photos before production uploads are enabled. The user confirms there have been no production photo uploads, so no historical orphan scan/backfill is required. Future abandoned uploads and failed saves still need safe handling.

Make logical LOCAL commits. DO NOT push branches or tags, create/update PRs or issues/comments, merge, deploy, run production migrations, or change a production bucket. Read-only GitHub inspection is allowed if needed. Do not use a CI push as a substitute for local validation. Production infrastructure steps must be prepared and documented for later execution.

## Stack and workspace

Repository: sfbrigade/pocket-gardens.
This is dependent work ABOVE PR #55 (https://github.com/sfbrigade/pocket-gardens/pull/55).
Base branch: feat/plot-submission/07-map-interactions.
Pinned local base: 5d2fabef4ae91ef72a9f7b67522c2b84e4342d6f.
New branch: feat/plot-submission/08-photo-upload-lifecycle.
Use the worktree provided by T3; do not create shell worktrees or change another checkout.
PR #55 targets feat/plot-submission/06-address-suggestions; preserve all earlier stack layers.
The user's main testing checkout has branch 07 checked out. Do not switch it, move its branch ref, or edit its files.

Agreed scope boundary: the draft-replacement upload bug belongs in #55; storage lifecycle work belongs in a separate top stack layer. For isolated implementation, make that photo-safety fix as the FIRST separate local prerequisite commit on this new branch and clearly identify its SHA as intended for #55. Place lifecycle commits above it. Do not rewrite/move branch 07 or attempt to push/cherry-pick into the user's checkout. The owner can place the prerequisite appropriately when preparing the stack.

## Verified current behavior

- React/Mantine frontend; Fastify/Prisma/PostgreSQL backend; S3-compatible storage (RustFS locally).
- Selecting a file immediately calls POST /api/assets for a signed upload URL, then PUTs to _uploads/{random UUID filename}.
- A completed upload's filename is stored in the session draft; an in-flight File is not recoverable after refresh and the UI asks for reattachment.
- The upload endpoint currently does not create a durable upload lifecycle record.
- Create garden creates plot/photo DB records and copies temporary files to permanent paths inside a transaction callback. Temporary objects are retained until commit recovery is settled, then deletion is attempted.
- Definite callback failure attempts to delete copied permanent targets while preserving staging for retry.
- Uncertain commit outcomes deliberately retain staging and permanent copies to avoid deleting potentially committed photos.
- cleanupSubmissionObjects uses Promise.allSettled and logs deletion failures; no durable retry/scheduled reconciliation is implemented.
- Remove/discard/unmount aborts client work and revokes local previews; it does not delete completed remote objects.
- No automatic staging expiration policy or orphan sweeper was found in the repo. Production bucket settings have not been inspected.
- Current base passes 63 client tests, workspace lint, client/SSR builds and CI Test. Physical-device performance is unmeasured.
- ADR 0004 requires stable draft submission identity and replay of an already successful save, including after refresh/lost responses.

## Implementation plan

### 1. Inspect, document and preserve contracts

Read applicable AGENTS.md/CONTEXT.md, GLOSSARY.md, relevant ADRs (especially docs/adr/0004-retries-recover-the-same-plot.md), and storage/upload/save/recovery tests.
Persist this plan under docs/plans/08-photo-upload-lifecycle.md in the new checkout, updating it as implementation choices settle.
Trace shared consumers of _uploads and Base.setAsset (user pictures, plant/maintenance photos and imports as well as plots). Do not break those flows.
Choose the smallest explicit lifecycle design that safely distinguishes pending uploads, active saves, committed references, expired/abandoned work, and uncertain outcomes. Record material decisions in an appropriate ADR using relevant skills.
Seven days is a proposed starting retention window, NOT a user-set requirement. Make the actual policy explicit/configurable and coordinate its server/UI/infrastructure interpretation.

### 2. Separate prerequisite: protect draft identity at the photo seam

Reproduce and add a permanent regression for:
1. Recover an unfinished draft through an incoming different map pin, displaying the choice prompt.
2. Drop a file on the form while that prompt is visible.
3. Choose "Discard draft and start here".
4. A late upload must not attach to the new draft or mutate its fields.

Verified root cause: Fieldset.disabled does not disable dropzone div handlers. PhotoInput only receives mutation.isPending, and replacing values leaves the same mounted uploader alive.
Disable the uploader while the choice is pending; key/reset its lifecycle by submissionId and reject/abort stale callbacks. Preserve completed-photo recovery and the normal pending-save guard.
Test both choices, late success/failure, aborted transport that still resolves, refresh, and preview cleanup.
Keep this in its own local commit, labeled as the prerequisite intended for PR #55.

A diagnostic already reproduces the bug at /tmp/pocket-gardens-pr55-draft-upload-review.test.mjs if it still exists. Do not depend on temporary files; put the meaningful regression in the repo.

### 3. Temporary-upload expiration and user recovery

Keep immediate uploads unless evidence requires changing that UX.
Prepare a prefix-scoped storage lifecycle policy for _uploads/ with a defined retention window. Permanent assets must not be subject to this blanket expiry. If a storage implementation cannot support the policy, provide an equivalent server cleanup command/job.
Do not apply the policy to live storage. Document safe installation/verification, and preserve unrelated bucket rules if preparing an installer.
Account for versioned buckets where applicable, and paginate object listing if implementing cleanup; the existing broad deleteObjects helper lists only one page and is not a sufficient sweeper.
Do not rely on browser remove/discard/unload events for eventual cleanup. Immediate delete-on-remove is optional and requires server-side ownership checks; no unauthenticated arbitrary-key deletion endpoint.
Align signed-upload URL lifetime and cleanup eligibility so a late/in-flight PUT cannot escape eventual cleanup.

On plot save:
- Recover/replay an already successful submission FIRST. Successful saves may already have deleted their staging objects.
- Otherwise detect missing/expired temporary photos and return a structured photo-field error rather than an unexplained 500.
- Preserve all other fields, draft submission identity, manual address/title overrides and retry safety.
- Let users reattach a photo or explicitly continue without it.
- Preserve legitimate recent staging uploads for retry after save failure.

### 4. Reliable permanent-copy cleanup/reconciliation

Temporary expiry alone does not resolve permanent copies left after rollback, deletion failure, or uncertain commit recovery.
Implement the minimum durable tracking/reconciliation needed for future copy targets and failed cleanup. With no prior uploads, there is no need to infer ownership/backfill unknown historical objects.
Record cleanup-relevant intent before external storage writes so process interruption cannot leave an untracked permanent copy. Reuse recorded data when practical; avoid a large generic workflow framework.
Coordinate cleanup eligibility with active/finalizing saves (claims/locks/leases or an equally safe mechanism). "No DB reference at this instant" is insufficient while a save transaction can still commit.
Keep files referenced by committed photo records. Reconcile uncertain outcomes against authoritative DB state; if that state is unavailable, retain and retry rather than guessing.
Make deletes and retries idempotent; keep failed tasks retryable and observable. A successful garden save must not be reported as failed solely because post-commit garbage collection failed.
Provide dry-run/operational inspection and document scheduling/deployment steps. Never apply destructive cleanup against production during this task.

### 5. Validation and logical commits

Use the existing real form/DOM harness, not implementation-mirroring tests.
Cover:
- Remove, discard, tab closure/abandonment and late completion: no cross-draft attachment, eventual staging eligibility.
- Completed-photo refresh recovery inside retention; expired-photo refresh/save recovery without losing other fields.
- Same submission retries after lost responses when staging is already gone: replay the original saved garden.
- Definite rollback, partial copying, ambiguous commit, process interruption and transient storage/database cleanup failures.
- Cleanup must retain actively saving photos and committed references, survive repeated runs, and retry failures.
- Scope/list pagination and cutoff boundaries; imported/permanent objects remain protected.
- Shared asset consumers and authorization for any new cleanup/deletion surface.

Run appropriate client tests, server storage/recovery integration tests, workspace lint, Prisma generation/migration checks if changed, and client/SSR builds.
Commands: npm test -w client; npm run lint:check; npm run build -w client; npm run prisma:generate -w server; npm test -w server (with the required local Docker/services/test configuration).
If server infrastructure is unavailable, report the exact missing validation and do not claim full readiness. Do not push to obtain CI.

Suggested commit boundaries (adapt to actual final design):
1. Photo draft replacement safety + interaction regression (prerequisite for #55).
2. Upload/copy lifecycle tracking and server cleanup/recovery with necessary local migration and tests.
3. Expired-photo form recovery and tests.
4. Lifecycle policy, reconciliation operations, scheduling docs and remaining validation.

## Relevant code and tests

client/src/Components/DropzoneUploader.jsx
client/src/Components/PhotoInput.jsx
client/src/Plots/PlotForm.jsx
client/src/Plots/plot-form.js
client/src/Plots/plot-submission.js
client/src/Api.js
client/test/helpers/plot-harness.js
client/test/plot-upload.test.js
client/test/plot-map-draft.test.js
client/test/plot-save-navigation.test.js
server/routes/api/assets/create.js
server/routes/api/plots/create.js
server/lib/s3.js
server/lib/plot-submission.js
server/lib/photos.js
server/models/base.js
server/models/plot.js
server/models/plot-photo.js
server/prisma/schema.prisma
server/test/routes/api/plot-recovery.test.js
server/test/routes/api/assets.test.js
server/test/lib/photos.test.js
compose.yml, compose.override.yml, docs/dokku.md

Primary storage references to verify as needed:
https://docs.aws.amazon.com/AmazonS3/latest/userguide/how-to-set-lifecycle-configuration-intro.html
https://docs.aws.amazon.com/AmazonS3/latest/userguide/lifecycle-expire-general-considerations.html

## Out of scope and finish criteria

Do not implement garden editing, authentication migration, unrelated map optimizations, or legacy orphan backfills.
Two other #55 review observations (timer not cleared on movestart; refresh.current assigned during render) are outside this PHOTO task and remain follow-ups for #55.
No existing branch rewrites, GitHub writes/pushes, deployment, or production changes.

Finish with local commits, a clean working tree, test/build results and honest limitations. Report branch, commit SHAs/order, which prerequisite belongs in #55, lifecycle/retention decisions, and production rollout steps still needing execution. Keep the plan up to date. Do not push anything to GitHub.


## Execution record

- Working only in the provided branch 08 checkout at pinned base `5d2fabe`.
- No applicable AGENTS.md or CONTEXT.md was found in this checkout or its ancestors.
- Read the glossary and ADR 0004. Shared staging consumers include user pictures,
  plot/plant/maintenance galleries, and Airtable attachment imports.
- Prerequisite: real DOM regression reproduced file drops bypassing the disabled
  fieldset and upload controllers surviving draft replacement. Key PhotoInput by
  submission ID, disable choice-time interactions, and reject stale callbacks.
  Targeted upload/map-draft tests: 20 passed after reproducing the failures.
- Lifecycle implementation and final validation remain in progress.

### Settled lifecycle design

- `AssetUpload` records issued filename/expiry before returning a signed URL.
  `PHOTO_UPLOAD_RETENTION_DAYS` defaults to 7 (integer 1–365). PUT URLs last
  900 seconds; staging age and token expiry are checked during garden saves.
- `PhotoCopyIntent` records each garden-create target outside its save transaction
  before storage writes. The save locks the intent row until commit/rollback;
  cleanup uses `FOR UPDATE SKIP LOCKED` and checks exact committed references.
  Retired rows remain as repeatable cleanup tombstones for late external copies.
- Reconciliation starts one hour after intent creation and repeats daily; failures
  remain due and expose checks/lastError. No historical permanent-object scanning.
- Shared Base.setAsset awaits the optional copy hook; other consumers retain their
  API. Prefix-only staging sweeps include untracked imports once old enough.
- ADR 0006 captures the transaction/lock/tombstone tradeoff. Native storage policy
  and fallback cleanup remain separate operational steps, never applied here.

### Server validation so far

- Prisma generation and TypeScript compilation passed; new migration is applied
  only in disposable PostgreSQL test containers.
- Existing submission-recovery suite passed, including ambiguous commit cases.
- New lifecycle integration tests passed against disposable PostgreSQL/RustFS:
  durable intent before copy, partial writes/rollback, storage/delete outages,
  database unavailability, active-save locks, committed references, late copies,
  missing/expired uploads, same-submission replay, dry-run command, cutoff/scope,
  1,005-object pagination, and versioned objects/delete markers.
- Initial full server run lacked example registration/mail configuration; fixed
  the test configuration by copying example.env into this checkout's ignored
  .env, matching CI. Existing rollback test now stages a real source so injected
  copy failure still reaches the intended seam after adding missing-photo checks.

### Form recovery complete

- Completed-photo refresh still attempts save/replay first. A structured Photos
  error resets only the stale photo/uploader and attempted payload, preserves all
  other values/manual overrides and submission ID, and survives another refresh.
- Reattachment and explicit continue-without-photo both use the same submission
  identity. Local previews are released when the server rejects the source.
- Full client suite: 74 passed. Targeted regressions were first observed failing
  on stale attachments, then passed after the recovery change.

### Operational checks and pagination refinement

- Prepared `docs/photo-upload-operations.md`, dry-run-by-default cleanup, and a
  policy JSON merger that never contacts/mutates storage. Unrelated rules survive;
  current/noncurrent staging versions, delete markers and incomplete multipart
  uploads are covered. Installation/scheduling are documented for later execution.
- Added actual 1,005-version RustFS coverage. Version candidates are grouped by
  key so cleanup cannot invalidate a continuation marker mid-listing.
- A 105-intent reconciliation regression caught Prisma cursor/skip omitting one
  row after the prior batch's due times changed. Explicit `key > lastKey` keyset
  pagination fixes the issue. Re-run and final validation are in progress.

### Coordination update

The owner authorized separate map fixes on branch 07. This checkout does not edit
those files or touch the user's testing checkout. After the owner supplies the
updated 07 commit, rebase these logical photo commits onto that local tip at a
clean checkpoint, preserving the separate prerequisite (its SHA will change).

Reconciliation now commits its retirement fence before external deletion. This
also protects against deletion outlasting a lost database connection; a regression
checks that another connection sees retirement before deletion begins and that a
lost deletion acknowledgment remains retryable.

### Validation at the clean photo checkpoint

- `npm test -w client`: **74 passed**.
- `CI=true npm test -w server` with this checkout's example .env and disposable
  testcontainers: **182 passed**. Includes shared consumers and all new storage,
  version/pagination, rollback, ambiguous-commit and cleanup recovery seams.
- `npm run lint:check`: passed for both workspaces.
- `npm run build -w client`: client and SSR builds passed.
- `DATABASE_URL=postgresql://localhost/unused npm run prisma:generate -w server`:
  generation and TypeScript compilation passed.
- `prisma validate`: passed. Migrations deployed successfully to each disposable
  integration-test PostgreSQL database; no application/production DB was migrated.
- `git diff --check`: passed.

Native lifecycle execution/timing, production permissions and scheduler setup,
and physical-device performance remain unmeasured. Installation, migration and
scheduling must be executed later using the operations runbook. No GitHub writes,
pushes, production changes or changes to the user's branch 07 checkout occurred.
The coordinated rebase onto the owner's updated branch 07 is the remaining stack
step; validate the combined tree afterward.

### Final stack integration

- Rebased the four photo commits cleanly onto the owner's local branch 07 tip
  `72eaa34816ecdbdd0287bda357d4788210e94536`.
- Photo prerequisite intended for #55 is now `9ea2884` (originally `ce31116`).
  Lifecycle tracking follows at `c9bc04a`, form recovery at `d2c7448`, then the
  policy/operations/verification commit. All remain separate local commits.
- `git range-diff` confirmed all four photo patches were preserved by the rebase.
  Only this final execution record/runbook is updated afterward.
- Combined-tree validation: **76 client tests passed**, workspace lint passed,
  client and SSR builds passed. The server tree object is identical to the exact
  tree that passed **182 server tests**, Prisma generation/TypeScript compilation,
  schema validation and disposable migration deployment; those results remain
  applicable without an unnecessary repeat of unchanged server tests.
- Branch 08 adds no changes to LeafletContainer.jsx or map-interactions.test.js.
  Branch 07 remains at the owner-provided tip; the user's testing checkout was
  never edited by this work. No GitHub or production actions were performed.
- Implementation, local commits, operational preparation and stack integration
  are complete. Production rollout steps remain deliberately unexecuted.
