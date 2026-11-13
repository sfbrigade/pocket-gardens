# Photo copy intents survive garden transactions

Write each new garden photo's destination to a durable intent before copying,
outside the garden transaction so rollback or process death cannot erase it.
The save holds a lock on that intent until its database transaction finishes;
reconciliation takes the same lock before checking authoritative photo references
and deleting unreferenced targets. A lease alone would allow a slow save to commit
after cleanup. Failed database reads retain objects for retry.

Retired intents remain as tombstones and are revisited: a storage operation may
finish after its database transaction is interrupted. A retired intent fences
future copies, while repeated deletion collects late completions. Existing
untracked permanent assets are never scanned or backfilled. This deliberately
limits copy tracking to garden creation; shared user, gallery and import flows
keep their existing contracts.

Temporary uploads expire after a configurable seven-day default. Signed PUTs last
15 minutes, and cleanup repeatedly lists staging with pagination, including late
PUTs. The server validates staged photos only after submission replay, preserving
ADR 0004 when a successful save has already removed its source upload.
