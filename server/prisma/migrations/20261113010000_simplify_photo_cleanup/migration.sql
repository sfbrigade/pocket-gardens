-- Temporary uploads are governed by native object-age expiration, not tokens.
DROP TABLE "AssetUpload";

-- Copy intents form a finite work queue; completed work is deleted at runtime.
ALTER TABLE "PhotoCopyIntent" DROP COLUMN "upload";
