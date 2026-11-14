# Resolve garden photo copies once

Record each garden photo destination before its external copy, outside the save
transaction, and lock that intent through commit/rollback. Cleanup uses the same
lock to skip active saves and check committed references. Unreferenced targets
are durably retired before deletion so a waiting save cannot copy into them.
Database/storage failures retain retryable work.

Confirmed references and successfully deleted orphans leave the queue. We accept
an occasional orphan if a storage write completes exceptionally late, after its
cleanup record was resolved, instead of retaining tombstones and checking all
historical photos indefinitely. Pending checks start after one hour, while saves
have a 60-second transaction timeout. Unknown permanent assets are never scanned.

Temporary uploads use native prefix-scoped expiration on an unversioned bucket,
with the same configurable object-age cutoff checked by the server. There is no
upload-token table, policy merger or version-aware fallback sweeper. Submission
replay still precedes storage validation, preserving ADR 0004 after staging is gone.
