BEGIN;

ALTER TABLE "Plot" RENAME COLUMN "sethsNotes" TO "staffPermissionNotes";
ALTER TABLE "Plot"
  ADD COLUMN "gardenCareNote" TEXT,
  ADD COLUMN "permissionAdditionalNote" TEXT;

COMMIT;
