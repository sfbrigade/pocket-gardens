ALTER TABLE "Plot" ADD COLUMN "submissionId" UUID, ADD COLUMN "submissionFingerprint" TEXT;
CREATE UNIQUE INDEX "Plot_submissionId_key" ON "Plot"("submissionId");
