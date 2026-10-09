-- Extend #172 schema without changing the checksum of an existing migration.
BEGIN;
CREATE UNIQUE INDEX "community_requests_pending_slug_key" ON "community_requests" ("slug") WHERE status = 'PENDING';
ALTER TABLE "community_requests" ADD CONSTRAINT "community_requests_category_id_fkey"
  FOREIGN KEY ("category_id") REFERENCES "categories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX "community_requests_community_id_idx" ON "community_requests" ("community_id");
COMMIT;
