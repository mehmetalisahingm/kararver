-- #44: Activation state is durable even when the outbox is cleaned after 30 days.
-- Existing immediate placements were notified at creation in previous versions.
-- Backfill past/current records to avoid re-notifying existing users during deployment.
ALTER TABLE "featured_placements" ADD COLUMN "activated_at" TIMESTAMPTZ(3);
ALTER TABLE "announcements" ADD COLUMN "activated_at" TIMESTAMPTZ(3);

UPDATE "featured_placements"
SET "activated_at" = "created_at"
WHERE "starts_at" <= CURRENT_TIMESTAMP;

-- Announcements previously had no emitted event. Preserve already-visible items without
-- broadcasting old announcements to users on deploy. Newly scheduled items stay NULL.
UPDATE "announcements"
SET "activated_at" = "created_at"
WHERE "starts_at" <= CURRENT_TIMESTAMP;

CREATE INDEX "featured_placements_activation_due_idx"
  ON "featured_placements" ("starts_at", "ends_at", "id")
  WHERE "activated_at" IS NULL;
CREATE INDEX "announcements_activation_due_idx"
  ON "announcements" ("starts_at", "ends_at", "id")
  WHERE "activated_at" IS NULL;
