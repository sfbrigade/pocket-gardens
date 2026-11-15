# Maintenance records: implementation plan

Status: scope confirmed by the user in Q20 after all Q1–Q19 decisions were recorded; consolidated into seven focused PRs at the user's request. Ready to guide implementation after the plot submission stack merges. Implementation authorized locally; nothing is to be pushed to GitHub.

## Goal and baseline

Let someone open a garden, see its maintenance history, and create, edit, or delete maintenance records through a general update form or a photo shortcut. Split implementation into small, sequential branches following the existing `feat/plot-submission/NN-description` convention.

Local implementation starts from `feat/plot-submission/09-carer-assignment` at `72e790d` because the prerequisite stack is not merged yet; rebase the maintenance stack onto merged `main` afterward. Do not base this feature on today's `main`, or treat the last plot feature branch as the permanent base. Recheck the merged contracts before implementation: local inspection used `main` at `107094c` and `feat/plot-submission/08-photo-upload-lifecycle` at `57feee2`.

Design references supplied with this request:

- `image.png`: garden Updates tab, empty history, and Care / Photo update / Add an update actions.
- `pocket-gardens-field38-form-navigation.html`: garden tabs and actions around lines 3201–3250; photo and planting flows around 3309–3365; unified update composer and confirmation around 3993–4310.

The HTML is a behavior reference, not production source. The final definitions of functions matter because the prototype contains older flows alongside the newer composer.

## Existing capabilities and implementation gaps

| Area | Already present | Needed or unresolved |
| --- | --- | --- |
| Persistence | `MaintenanceRecord`, ordered photos, linked directory plants and optional quantities; imported records may have missing dates, plots, or volunteers. | Structured observations, submission/mutation recovery, correction version/marker, soft-deletion metadata, and separate account actor where known. Preserve imported records. |
| API | `GET /api/maintenance-records`, `GET /:id`, `POST /`, and `PATCH /:id`; date/plot/volunteer filters; offset pagination; photo ownership validation. | Permit photo/note/observation-only updates; make access policy explicit; return safe display data needed by history; add deletion and robust correction semantics. |
| Plot identity | Plot APIs accept a public Airtable/synthetic ID as well as internal UUIDs. Garden detail responses expose the public ID. | Maintenance input/filter currently accepts only UUID `plotId`. Resolve the garden's public ID server-side, or supply a deliberate ID bridge; never derive a UUID from `pg_...`. |
| Client | Plot stack provides routed garden details, React Query, directory search/selection, form recovery patterns, and abortable/retryable photo upload infrastructure. | Maintenance API adapter, history query/rendering, update draft/composer, photo shortcut, successful-save navigation. |
| Identity/access | Existing maintenance GET/POST/PATCH routes have no route-level user guard. `Person` volunteer records and `User` accounts remain separate; people listing is admin-only. | Active administrators can write outside development; an explicit development capability allows account-free writes. Non-deleted history is public with the agreed credit labels. Ordinary community writes await Better Auth; do not expose contact details or infer volunteer identity from typed names. |
| Current plants | Plot stack adds one `PlotPlant` per plot/directory-plant pair, with current/planned state. Maintenance records have their own plant links. | Agreed: maintenance records describe history and do not change inventory. Prototype batches, replanting, and removals are deferred. |
| Corrections | PATCH updates supplied fields and replaces related plant/photo lists; no maintenance DELETE route, revision precondition, deletion marker, or correction UI exists. | Content corrections within the same garden, soft deletion, Edited marker, concurrent-change protection, and mutation recovery. Explicit photo removal during a saved edit permanently erases that photo; record deletion retains attached photos internally. |
| Summaries | Plot fields retain imported last-visit/water/weed/mulch/plant values and next-visit/alert information. | Agreed: this milestone changes history only. Do not present stale imported values as live calculations. |

Evidence: `server/models/maintenance-record.js`, `server/routes/api/maintenance-records/`, `server/prisma/schema.prisma`, and `server/test/routes/api/maintenance-records.test.js`. Post-plot-stack evidence: `client/src/Plots/PlotDetails.jsx`, `client/src/Plots/PlantPicker.jsx`, `client/src/Plots/plot-submission.js`, `server/models/plot.js`, and `server/lib/photos.js` on branch 08.

The merged feature should retain the plot stack's decisions in `docs/adr/0001`–`0005`: preserve volunteer identities, use the shared plant directory, let the app own data after Airtable cutover, recover retries, and keep garden stage independent of permission. Do not reintroduce ongoing Airtable synchronization or change garden stage as a side effect of logging a visit.

## Clarification and decision register

All Q1–Q19 decisions below reflect the user's answers. The branch split and implementation approach apply those decisions; there are no remaining product questions in this plan.

| ID | Decision | Agreed outcome | Status |
| --- | --- | --- | --- |
| Q1 | What counts as a maintenance record? | One visit/update, allowing any nonempty combination of activities, observations, photos, or a note. Photo shortcut creates the same entity. | Accepted |
| Q2 | Development milestone versus production identity/access | Follow plot submission's explicitly enabled account-free development milestone; production attribution/permissions depend on the separate Better Auth work. | Accepted |
| Q3 | Planting history versus inventory mutation | Record planting activities and optional directory links/quantities; defer inventory changes, removals, and replacement batches. | Accepted |
| Q4 | Care and wider prototype workflows | Defer carer joining, help requests, jobs/task completion, reminders, and moderation. | Accepted |
| Q5 | Corrections | Include editing and deletion in this milestone, alongside creating and viewing. | Accepted; expanded from initial recommendation |
| Q6 | Sensitive observations | Use public-safe categories; defer private incidents and their separate photo-access/public-redaction requirements. | Accepted |
| Q7 | Correction permissions | Development capability permits writes to any record, including imports; existing active administrators can also create/edit/delete outside development. Ordinary community writes await Better Auth. | Accepted; expanded from recommendation |
| Q8 | Deletion retention | Hide deleted records from history but retain their data/photos internally; explicit confirmation, no restore UI initially. | Accepted |
| Q9 | Editing behavior | Edit date/content/plants/photos within the same garden; Edited marker, no revision-history screen; preserve missing imported information. | Accepted |
| Q10 | Lifecycle eligibility | All supported updates on potential/preparing/active; observations/notes/photos only on paused; no new updates on archived/unknown. Corrections allowed at any stage. | Accepted |
| Q11 | Dates and ordering | Local today default, valid backdates, no future dates; occurrence-date order with stable tie-breaker, undated imports last. | Accepted |
| Q12 | Recovery and concurrent edits | Same-tab create/edit field recovery, photo-reattachment messaging, safe repeat saves, conflict detection; offline synchronization deferred. | Accepted |
| Q13 | Garden summaries | History-only changes; defer live last-watered/last-visit summaries, alerts, and visit scheduling. | Accepted |
| Q14 | Taxonomy and limits | Public-safe prototype choices excluding replant/removal; four photos using existing validation; no next-visit scheduling controls. | Accepted |
| Q15 | Plant names | Reuse directory selection, multiple plant types and optional quantities; create new known names on successful save; unknown names need no fake directory entry. | Accepted |
| Q16 | History filters | One paginated timeline first; defer All / Care / Observations / Photos filters. | Accepted |
| Q17 | Public visibility and retained-photo links | Keep non-deleted history public; stop normal record/photo access after deletion, allowing already-issued signed links to expire within 15 minutes. | Accepted |
| Q18 | Credit labels | Imported volunteer display names when available; Pocket Gardens team for new admin-created records; Anonymous for account-free development records. No name input or volunteer reassignment. | Accepted |
| Q19 | Photos removed during edits | Permanently erase photos explicitly removed during a saved edit. Record deletion still retains the photos attached at deletion time. | Accepted; changed from retention recommendation |

The stack groups related API and UI work by user workflow. Account-free production intake, ordinary community author attribution/ownership, private incidents, inventory mutation, full revision/restore screens, offline synchronization, timeline filters, and live garden summaries remain outside this milestone. Existing active-administrator writes are included and use current account authentication rather than waiting for Better Auth.

## Agreed behavior

- Garden details have Info and Updates tabs. Preserve the selected garden, map position, and return context when switching tabs or opening/canceling the composer.
- History has loading, error/retry, empty, populated, and load-more states. One visit remains one item even when it has several activities and photos. Show the occurrence date, safe author label when available, activities, observations, note, directory plant names/quantities, and attached photos.
- The composer carries the selected garden; it does not ask the user to select it again. Activity and observation choices preserve typed notes and selected photos. `Nothing stood out` excludes other observations; an empty observation list means nothing was recorded about observations.
- Whitespace-only notes do not satisfy the content requirement. Activities-only, observations-only, notes-only, and photos-only are valid. Quick photo requires a photo and can expand into the full form without losing work.
- Confirmation reflects the saved server response and says what actually changed. Returning opens the same garden's Updates tab; starting another update creates a new draft identity.
- Keep garden reference photos separate from visit evidence. Logging a photo does not replace a garden's reference gallery.
- Edit content within the same garden and show an Edited marker. Soft delete with confirmation, retaining data/photos internally and providing no restore screen. Both operations apply to existing imported records, respect concurrent changes, and leave current/planned inventory unchanged.
- Removing a photo from an edit draft does nothing permanent until the edit saves. After a successful save, hide that photo from normal links and permanently erase its stored object through reliable cleanup. A failed or canceled edit must leave existing photos intact. Deleting the whole update retains its still-attached photos internally instead.

### Access and stage rules

All mutation permissions are enforced by the server and reflected in UI capabilities. With the explicit development capability disabled, only active administrators can create/edit/delete; anonymous and ordinary signed-in accounts cannot. With that capability enabled in the intended development deployment, account-free writes can target any record. Capture an authenticated administrator's account ID when known, separately from a volunteer relationship; do not infer a Person/account link. Production community ownership and attribution remain deferred.

Non-deleted records are publicly readable. Public credit uses an imported volunteer's existing display name when available, Pocket Gardens team for administrator-created records, and Anonymous for account-free development records. Preserve creation credit through later edits rather than replacing it with the last editor's identity. Use a neutral Contributor fallback for legacy records whose origin/name is unavailable; do not invent account links. No free-text name input or volunteer reassignment is included, and actor account IDs/contact details are not public response fields.

Soft-deleted records and their photos are excluded from normal record/photo access. Stop issuing photo links as soon as the deletion commits and remove shared redirect caching for maintenance photos. Previously issued signed links can remain usable for up to 15 minutes, as agreed. No public restore/retained-photo browser is added.

| Garden stage | Create supported updates | Edit/delete existing records |
| --- | --- | --- |
| Potential, preparing, active | Activities, observations, notes, photos, optional planting links | Allowed when write capability permits |
| Paused | Observations, notes, photos; no activity selections or plant links | Allowed when write capability permits; retain/correct historical activities |
| Archived or unknown | Unavailable | Allowed when write capability permits |

Stage/permission are independent. Read the current stage when committing a new record, but recognize an already-committed retry before applying a now-changed stage restriction. Corrections do not become new visits. Legacy records without a linked garden remain preserved by the API; a garden-specific history is not a new global orphan-record administration screen. Inactive accounts must never gain administrator writes merely because `isAdmin` remains true; reuse the current active-administrator guard rather than inventing a second interpretation.

### Content, dates, and correction rules

- New activity choices: Watered, Weeded, Planted, Mulched, Cleared litter, Just had a look, Something else. Preserve multiple selected activities as structured data.
- Observation choices: Nothing stood out; Plants look dry; Gaps, or plants missing; Weeds taking over; Litter or dog waste; Something broken; Something else. Do not expose the deferred person-related incident choice.
- Up to four attached photos per new record; JPEG/PNG/GIF/WebP, actual file-byte validation, and the existing 10 MiB limit per file. Imported records exceeding new limits must remain readable and allow unrelated corrections without silently dropping evidence.
- Allow multiple directory plants with optional positive integer quantities within the database integer range. New known names are added transactionally with a successful record create/edit; selecting Planted with an explanatory note and no plant link can represent an unknown name. Do not create an Unknown directory entry. No replant/removal inventory controls or next-visit scheduling controls.
- Default occurrence date to today, allow backdates, reject future dates. Use a shared, explicit calendar/time-zone policy for client defaults and server validation; do not parse date-only values as UTC instants for display. Show recorded time separately when useful, place undated imported records last, and use a stable tie-breaker for equal dates.
- Preserve original recorded time across edits. Set a dedicated correction marker/time for user edits rather than inferring Edited from import-created timestamp differences. Do not add a full revision-history screen.
- Require meaningful content after an edit to a valid record, but permit unchanged legacy omissions. Restored create/edit drafts survive same-tab refresh; files can require reattachment. Offline synchronization is deferred.

Permanent photo removal is a distinct operation from soft deletion. The removal policy applies to saved photo edits, including imported photos; it does not turn record deletion into erasure or add a full revision-history feature.

Prototype inconsistencies to resolve deliberately: the composer selects many activities but the stored prototype record retains only the first activity key; the history inserts by save order even for backdated planting; the general form lacks the planting form's date picker; private-looking incident rows can still expose attached photos. Do not reproduce these behaviors accidentally.

## Implementation choices and limits

The agreed scope stays unchanged. The first draft split related API/UI changes too finely and left room for more retry and cleanup infrastructure than this feature requires. Use the following smaller designs:

- **Create recovery:** keep the unique submission ID and original payload fingerprint on the maintenance record, following plot submission. Soft deletion retains that row and its retry identity, so a separate submission ledger or tombstone table is unnecessary.
- **Edit recovery and conflicts:** use a record version checked atomically with all changes, plus the most recent successful mutation ID/fingerprint on that record. Repeating that mutation can return the current result without reapplying it. If a later edit has superseded it, preserve the draft and return a conflict for review. Do not build arbitrary historical mutation replay, a revision ledger, automatic merging, or full version snapshots.
- **Permanent photo removal:** mark the photo row as pending removal in the saved edit's transaction, immediately exclude it from galleries/signing, and erase its object only after commit. Keep that row until erasure succeeds; it is the durable retry work. Attempt cleanup immediately and supply one maintenance-specific command that retries pending rows, including after restart. Document a lightweight recurring invocation in deployment. A separate jobs table, queue service, or continuously running worker is unnecessary.
- **Cleanup status:** return a simple pending/completed indication to the editor and report command failures for retry. Do not introduce a cleanup dashboard, notifications, live polling, or a separate public status API. Record deletion does not mark still-attached photos for removal, and does not cancel removal already committed by an edit.
- **Uploads and catalogue:** reuse the plot stack's upload validation/lifecycle, plant picker, and transactional new-plant behavior. Reuse small helpers where they fit; do not create a new upload service, form framework, image transformation pipeline, or asset reference graph. Remove the photo's known object and any known exclusively owned staging copy using the existing lifecycle; do not scan unrelated storage.
- **Reading and imported data:** keep the existing bounded offset pagination, restarting loaded pages after mutations. No cursor/snapshot pagination system is needed. Submit changed fields for legacy corrections and preserve untouched values; no broad legacy-data cleanup or separate legacy editor is needed.
- **Integration:** each user-facing PR includes its confirmation, navigation, cache changes, and relevant tests. There is no separate integration or hardening PR that accumulates unfinished behavior.

The safeguards that remain are tied to agreed behavior: lost-save recovery, concurrent-edit detection, photo-link visibility after soft deletion, and retryable permanent photo erasure. Removing them would weaken Q8/Q12/Q17/Q19 rather than simplify an implementation choice.

## Proposed branch stack

Seven focused PRs, with one branch per PR. These are future branches; none have been created. Each starts from and initially targets its immediate predecessor; the first starts from merged `main`.

Match plot submission's `feat/<feature>/<two-digit-order>-<kebab-case-slice>` convention, using `maintenance-records` and restarting at `01`. For example, `feat/maintenance-records/02-history` starts from and initially targets `feat/maintenance-records/01-foundation`.

| Order | Branch | Review focus | Base |
| --- | --- | --- | --- |
| 01 | `feat/maintenance-records/01-foundation` | Minimal schema additions, domain rules, and access | Merged `main` |
| 02 | `feat/maintenance-records/02-history` | Read API and public garden history tab | `feat/maintenance-records/01-foundation` |
| 03 | `feat/maintenance-records/03-create-update` | Core composer, create API, draft recovery, confirmation | `feat/maintenance-records/02-history` |
| 04 | `feat/maintenance-records/04-photo-updates` | Photos, quick-photo flow, and checked asset access | `feat/maintenance-records/03-create-update` |
| 05 | `feat/maintenance-records/05-planting-history` | Directory-linked planting records, including new names | `feat/maintenance-records/04-photo-updates` |
| 06 | `feat/maintenance-records/06-edit-updates` | Complete editing flow, conflicts, and permanent photo removal | `feat/maintenance-records/05-planting-history` |
| 07 | `feat/maintenance-records/07-delete-updates` | Soft-delete API/UI, retained evidence, and replay rules | `feat/maintenance-records/06-edit-updates` |

### 01 — Foundation and access

Add the minimal fields needed for structured observations, submission identity/fingerprint, record version and most recent mutation identity, explicit edit/deletion markers, creation credit, known account actors, and a pending-removal marker on photos. Keep these on the existing record/photo models. Preserve imported nulls and activity strings through additive migrations.

Define the activity/observation choices, nonempty-content rule, date/stage policy, and legacy-value handling in focused maintenance helpers. Use existing active-administrator authentication plus the explicit account-free development capability. Keep account actors separate from volunteer identity; no free-text identity or volunteer reassignment. Protect existing PATCH as well as new writes.

Acceptance: migrations preserve existing fixtures without schema repair; anonymous, ordinary-user, inactive-admin, active-admin, and development-capability behavior is covered. Old records remain readable. No authentication migration, revision history, or separate job/receipt persistence is introduced.

### 02 — Readable garden history

Extend the existing list/detail API to accept the selected garden's public ID, resolving it once to the internal UUID. Support imported `rec...`, synthetic `pg_...`, and internal UUID references consistently. Keep maintenance record IDs as UUIDs. Return the agreed public credit label, plant display names, structured content, and photos without contact details or actor account IDs.

Exclude soft-deleted records and pending-removal photos. Preserve unknown activities and missing dates; order by occurrence date with a stable tie-breaker and undated records last. Keep existing API filters compatible, but add no history-category filter UI.

Add the client API adapter, garden-scoped query keys, and accessible Info/Updates tabs with one paginated timeline. Cover loading, retry, empty, populated, load-more failure, missing content, and broken photos. Preserve garden/map context and use routing consistent with existing garden details.

Acceptance: garden histories never mix; equal/null dates and pagination work; switching gardens cancels/ignores stale results; public labels and deleted/pending-photo exclusion are correct. Include keyboard/mobile checks with this UI rather than postponing them.

### 03 — Create an update and recover the draft

Extend existing POST for activity-only, observation-only, note-only, and later photo-only records, with locked garden context and the agreed dates/stage rules. Build the text/activity/observation composer with local-today default, backdating, mutually exclusive Nothing stood out, and whitespace validation. Check current garden eligibility inside the save path, after recognizing an already-committed retry.

Use a stable draft submission ID and immutable attempted payload. The unique ID/fingerprint on the saved row handles concurrent creates and lost acknowledgments; differing reuse conflicts, and distinct same-day visits remain distinct. Include a lookup that recognizes soft-deleted rows so a delayed original request can never recreate one when deletion arrives in PR 07.

Reuse same-tab draft recovery conventions. Keep notes/selections through failures, chip changes, refresh, and cancel/Back flows; prevent a late save from clearing a newer draft. Include server-confirmed success, return to the same garden's Updates tab, and timeline cache reset in this PR.

Acceptance: each supported single-content case, empty input, invalid dates, stage restrictions, duplicate clicks/concurrent saves, lost response, same-tab refresh, garden switch, and late completion are covered. Full offline synchronization remains deferred.

### 04 — Photos and the quick-photo flow

Reuse the shared uploader for multiple maintenance photos: preview, upload, retry, remove-before-save, cancel, and ignore obsolete results. Enforce four photos and existing JPEG/PNG/GIF/WebP actual-byte validation with a 10 MiB limit. Preserve unchanged legacy galleries exceeding new limits during later unrelated edits.

Add the photo-only shortcut using the same draft/save path; switching to full details retains work. Adapt maintenance photo attachment to the plot stack's retained-staging and uncertain-commit handling rather than assuming the shared helper already provides maintenance recovery. Keep the `{ upload }` and retained `{ id }` API distinctions.

Before signing maintenance photo URLs, verify the exact photo ID/file and parent visibility; pending-removal or soft-deleted-parent photos cannot obtain new links. Remove shared redirect caching for this path and retain the agreed up-to-15-minute lifetime of already-issued links. Keep other asset families/imports compatible. Garden reference photos remain separate from update evidence.

Acceptance: photo-only create, partial upload failures, refresh reattachment messages, obsolete callbacks, repeat saves, storage/commit uncertainty, and mismatched/hidden photo paths are covered. Include photo confirmation and navigation in this PR. Permanent removal of already-saved photos belongs to editing in PR 06.

### 05 — Planting history and directory selection

Reuse the directory picker for multiple plant types with optional positive integer quantities. Extend maintenance input with existing plant IDs or explicitly new known-name entries. Create new directory entries and maintenance links in the successful record transaction, integrating submission replay so retries do not duplicate plants. Opening or canceling the form creates nothing in the directory.

Provide the agreed unknown-name path: Planted plus a note and no plant link, with no fake Unknown directory entry. Keep the record writer reusable by the existing PATCH path that PR 06 completes. Imported repeated plants/invalid old quantities remain unchanged during unrelated corrections.

Acceptance: search pagination, explicit new-name selection, quantity validation, duplicate selections, transaction failure, and retry round-trips are covered. No `PlotPlant` changes, replant/removal inventory controls, garden stage changes, or current-inventory claims. Include saved plant display in history/confirmation here.

### 06 — Edit updates and permanently remove selected photos

Reuse the composer for editing all supported fields/photos/plants within a fixed garden, retaining record-scoped draft recovery. Extend existing PATCH to preserve untouched legacy omissions and collections, distinguish omission from explicit clearing, and validate meaningful resulting content for previously valid records. Preserve original recorded time/credit and set a dedicated Edited marker; no revision-history screen.

Use an atomic version precondition for scalar and related-row changes, with the most recent mutation ID/fingerprint to recover its successful replay. A superseded request returns a conflict for review with the draft intact. No automatic merge or historical operation-replay engine is required. Permit historical corrections at any garden stage.

For saved photo removal, mark the photo row pending removal in the same edit transaction and filter it from reads/signing. After confirmed commit, attempt permanent object deletion and remove the pending row only after success. Retry failures using the same pending rows through one focused cleanup command; missing objects are successful cleanup. On uncertain commit, re-read committed state before any erasure. Cancellation, validation failure, rollback, or a stale edit must preserve existing photo objects.

Explain the permanent removal at save time, distinguish saved-with-cleanup-pending from completed erasure, and include edit confirmation, cache resets/reordering, navigation, and conflict UI. Removing the last photo from an otherwise empty valid record fails validation; deleting that record with retention is the separate PR 07 action.

Acceptance: all field types, imported partial corrections, new plants in edits, retained/new/reordered/removed photos, content clearing, stale versions, concurrent edits, refresh/retry, rolled-back photo removals, process restart, and storage failure/retry are covered. The cleanup command also handles pending photo removals whose parent is later soft-deleted.

### 07 — Soft-delete updates

Add DELETE and its record-scoped confirmation UI using the same write capabilities and version checks. Soft-delete the existing row, retaining its submission identity, plant links, and still-attached photos. Public list/detail/photo paths already exclude that state; exercise them end to end here. Keep repeat DELETE harmless, and prevent edit/delete races or old create/edit retries from reviving or revealing deleted content.

Deleting the whole update does not enqueue erasure for its retained photos. It also does not cancel an earlier committed explicit photo removal. No restore screen or permanent-record-erasure API is added. Include return-to-history, handling an empty final page, selected-detail invalidation, and a clear terminal state for a draft whose record was deleted.

Acceptance: cancel/confirm/repeat deletion, lost response, stale version, edit/delete race, original-create replay after deletion, retained-photo link checks, and pending-photo-cleanup behavior are covered. Finish the full create/photo/plant/edit/delete journey and verify inventory/summaries stay unchanged; earlier PRs already include their own integration and tests.

## Verification and rollout

Each layer adds meaningful tests for its contract; do not defer all tests to the final branch. Use existing Node client tests and rendered-flow harnesses where appropriate, server route tests with Testcontainers/Postgres/RustFS, and migration checks without `db push` repair. Check the actual package scripts after merge. At stack completion run `npm run lint:check`, `npm test`, and `npm run build --workspace client`, then review mobile and keyboard flows.

Do not expose incomplete write flows as the stack merges. Apply additive migrations before callers and deploy the matching API/client. Document and enable a lightweight recurring invocation of the pending-photo cleanup command before enabling permanent photo removal; verify it drains persisted pending rows after restart. No separate worker service is needed, and erasure must not depend on the original request staying alive. Confirm imported histories remain viewable. After the app cutover, disable normal Airtable import writes rather than build a reconciliation system: reimports must not overwrite corrections, revive deleted records, or reattach erased photos.

Merge bottom to top. After a predecessor is merged, retarget/rebase remaining branches onto the updated base; handle squash merges so predecessor commits do not reappear in the next PR diff. Each PR description should identify its base/dependency, the behavior now available, deferred behavior, and focused validation. Each user-facing PR includes its own integration work; the final PR adds the soft-delete workflow rather than collecting unfinished behavior.

## Supporting documentation

`GLOSSARY.md` preserves the plot stack's definitions and adds maintenance record/update, activity, observation, occurrence date, recorded time, deleted maintenance record, and removed maintenance photo. It is seeded from plot-submission branch 08 because that glossary has not reached this checkout's `main`; reconcile against the actual merged glossary before implementation. Keep definitions free of implementation details.

`docs/adr/0006-maintenance-records-preserve-inventory.md` records the history/inventory boundary; `docs/adr/0007-retain-deleted-maintenance-records.md` records soft-deletion retention and permanent erasure for explicit photo removals. Numbering follows the plot stack's ADRs 0001–0005; recheck after merge. Routine form and implementation details belong in this plan, not ADRs.

All clarification decisions remain captured, now organized into seven focused PRs with acceptance criteria. Q20 confirmed the product scope, including soft deletion of records with retained evidence and permanent erasure of photos explicitly removed during editing; the subsequent consolidation simplifies implementation without changing those decisions. The planning interview is complete. Implementation is proceeding as local-only stacked branches, with no GitHub PRs or pushes.
