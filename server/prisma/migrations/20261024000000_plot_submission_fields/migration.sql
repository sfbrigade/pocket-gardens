BEGIN;
LOCK TABLE "Plot" IN ACCESS EXCLUSIVE MODE;

-- Lifecycle and site facts remain nullable when no source value is known.
ALTER TABLE "Plot"
ADD COLUMN "stage" TEXT,
ADD COLUMN "permissionStatus" TEXT,
ADD COLUMN "sunExposure" TEXT,
ADD COLUMN "environmentalNotes" TEXT;

CREATE INDEX "Plot_stage_idx" ON "Plot"("stage");

UPDATE "Plot" SET stage = CASE btrim(status)
  WHEN 'Planted' THEN 'active'
  WHEN 'Not Yet Planted' THEN 'potential'
END
WHERE btrim(status) IN ('Planted', 'Not Yet Planted');

-- These six plots have an explicit paused-stage decision. Declined permission
-- alone does not establish a stage for any other plot.
UPDATE "Plot" SET stage = 'paused', "permissionStatus" = 'not_granted'
WHERE btrim(status) = 'Residents Declined' AND "airtableId" IN (
  'rec87crQlQLX2wSdC',
  'recfTnZp3A2pPPV8G',
  'recgqSd4PpKQSjP2W',
  'rectjw1tcU6XdF7NK',
  'recVhA0CGGBh4bG1i',
  'recyxppURE0mZZdpf'
);

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM "Plot"
    WHERE (stage IS NULL AND NULLIF(btrim(status), '') IS NOT NULL)
      OR (btrim(status) = 'Residents Declined' AND "permissionStatus" IS DISTINCT FROM 'not_granted')
  ) THEN
    RAISE EXCEPTION 'Unresolved plot lifecycle data. Review exceptional statuses and add explicit per-plot resolutions to this migration before retrying.';
  END IF;
END $$;

DROP INDEX "Plot_status_idx";
ALTER TABLE "Plot" DROP COLUMN status;
COMMIT;
