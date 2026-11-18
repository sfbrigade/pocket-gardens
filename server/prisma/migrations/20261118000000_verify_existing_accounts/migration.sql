-- Trust pre-Better Auth Pocket Gardens accounts as verified during cutover.
-- The old schema required hashedPassword for every account, even when passwords
-- were not used. Better Auth accounts leave this retained legacy column NULL.
-- This identifies existing accounts without verifying newer pending signups.
-- Credentials are not imported, and role/ban state remains unchanged.
UPDATE "User"
SET "emailVerified" = true
WHERE "hashedPassword" IS NOT NULL AND "emailVerified" = false;
