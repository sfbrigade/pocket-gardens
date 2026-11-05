BEGIN;
LOCK TABLE "Plot" IN ACCESS EXCLUSIVE MODE;

-- Recognized values can be converted without inventing lifecycle information.
UPDATE "Plot" SET stage = CASE btrim(status)
  WHEN 'Planted' THEN 'active'
  WHEN 'Not Yet Planted' THEN 'potential'
END
WHERE stage IS NULL AND btrim(status) IN ('Planted', 'Not Yet Planted');

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM "Plot"
    WHERE (stage IS NULL AND NULLIF(btrim(status), '') IS NOT NULL)
      OR (stage IS NOT NULL AND stage NOT IN ('potential', 'preparing', 'active', 'paused', 'archived'))
      OR (btrim(status) = 'Residents Declined' AND "permissionStatus" IS DISTINCT FROM 'not_granted')
  ) THEN
    RAISE EXCEPTION 'Unresolved plot lifecycle data. Run npm run plots:migrate-stages with reviewed per-plot resolutions before deploying this migration.';
  END IF;
END $$;

DROP INDEX "Plot_status_idx";
ALTER TABLE "Plot" DROP COLUMN status;
COMMIT;
