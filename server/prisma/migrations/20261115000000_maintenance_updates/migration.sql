ALTER TABLE "MaintenanceRecord"
  ADD COLUMN "observations" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN "version" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN "editedAt" TIMESTAMP(3),
  ADD COLUMN "deletedAt" TIMESTAMP(3),
  ADD COLUMN "submissionId" UUID,
  ADD COLUMN "submissionFingerprint" TEXT,
  ADD COLUMN "lastMutationId" UUID,
  ADD COLUMN "lastMutationFingerprint" TEXT,
  ADD COLUMN "creditKind" TEXT NOT NULL DEFAULT 'legacy',
  ADD COLUMN "createdById" UUID REFERENCES "User"("id") ON DELETE SET NULL,
  ADD COLUMN "lastChangedById" UUID REFERENCES "User"("id") ON DELETE SET NULL;
CREATE UNIQUE INDEX "MaintenanceRecord_submissionId_key" ON "MaintenanceRecord"("submissionId");
ALTER TABLE "MaintenanceRecordPhoto" ADD COLUMN "pendingRemovalAt" TIMESTAMP(3);
CREATE INDEX "MaintenanceRecordPhoto_pendingRemovalAt_idx" ON "MaintenanceRecordPhoto"("pendingRemovalAt");
