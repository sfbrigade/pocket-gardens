CREATE TABLE "AssetUpload" (
    "filename" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AssetUpload_pkey" PRIMARY KEY ("filename")
);
CREATE INDEX "AssetUpload_expiresAt_idx" ON "AssetUpload"("expiresAt");

CREATE TABLE "PhotoCopyIntent" (
    "key" TEXT NOT NULL,
    "upload" TEXT NOT NULL,
    "retired" BOOLEAN NOT NULL DEFAULT false,
    "checks" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "nextCheckAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PhotoCopyIntent_pkey" PRIMARY KEY ("key")
);
CREATE INDEX "PhotoCopyIntent_nextCheckAt_idx" ON "PhotoCopyIntent"("nextCheckAt");
