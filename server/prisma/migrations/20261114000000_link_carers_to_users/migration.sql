ALTER TABLE "Person" ADD COLUMN "userId" UUID;
CREATE UNIQUE INDEX "Person_userId_key" ON "Person"("userId");
ALTER TABLE "Person" ADD CONSTRAINT "Person_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
