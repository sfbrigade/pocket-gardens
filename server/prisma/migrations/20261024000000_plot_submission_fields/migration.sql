-- Keep imported records unchanged: new plot lifecycle and site facts are nullable.
ALTER TABLE "Plot"
ADD COLUMN "stage" TEXT,
ADD COLUMN "permissionStatus" TEXT,
ADD COLUMN "sunExposure" TEXT,
ADD COLUMN "environmentalNotes" TEXT;

CREATE INDEX "Plot_stage_idx" ON "Plot"("stage");
