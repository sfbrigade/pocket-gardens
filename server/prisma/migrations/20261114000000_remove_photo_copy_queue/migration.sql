-- Garden saves now attempt cleanup directly, without scheduled reconciliation.
-- Preserve prior migration history for databases that already applied it.
DROP TABLE "PhotoCopyIntent";
