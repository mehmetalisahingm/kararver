-- KV-42 (#44): öne çıkarma ve zamanlanmış duyurular.
BEGIN;

CREATE TYPE "featured_surface" AS ENUM (
  'HOME_SPOTLIGHT',
  'FEED_TOP',
  'DAILY_PICK',
  'CATEGORY',
  'COMMUNITY',
  'EDITORS_CHOICE'
);

CREATE TYPE "announcement_level" AS ENUM ('INFO', 'WARNING');
CREATE TYPE "announcement_audience" AS ENUM ('ALL', 'AUTHENTICATED');

CREATE TABLE "featured_placements" (
  "id" UUID NOT NULL,
  "poll_id" UUID NOT NULL,
  "surface" "featured_surface" NOT NULL,
  "scope_id" UUID,
  "priority" INTEGER NOT NULL DEFAULT 0,
  "badge" VARCHAR(30),
  "starts_at" TIMESTAMPTZ(3) NOT NULL,
  "ends_at" TIMESTAMPTZ(3) NOT NULL,
  "created_by" UUID NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "featured_placements_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "featured_placements_time_check" CHECK ("ends_at" > "starts_at"),
  CONSTRAINT "featured_placements_scope_check" CHECK (
    (surface IN ('CATEGORY','COMMUNITY') AND scope_id IS NOT NULL)
    OR
    (surface NOT IN ('CATEGORY','COMMUNITY') AND scope_id IS NULL)
  )
);

CREATE INDEX "featured_placements_surface_scope_time_priority_idx"
  ON "featured_placements"("surface", "scope_id", "starts_at", "ends_at", "priority");
CREATE INDEX "featured_placements_poll_id_idx" ON "featured_placements"("poll_id");
CREATE INDEX "featured_placements_created_at_id_idx" ON "featured_placements"("created_at" DESC, "id" DESC);

CREATE TABLE "announcements" (
  "id" UUID NOT NULL,
  "title" VARCHAR(120) NOT NULL,
  "body" VARCHAR(2000) NOT NULL,
  "level" "announcement_level" NOT NULL DEFAULT 'INFO',
  "audience" "announcement_audience" NOT NULL DEFAULT 'ALL',
  "starts_at" TIMESTAMPTZ(3) NOT NULL,
  "ends_at" TIMESTAMPTZ(3),
  "created_by" UUID NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "announcements_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "announcements_time_check" CHECK ("ends_at" IS NULL OR "ends_at" > "starts_at")
);

CREATE INDEX "announcements_starts_at_ends_at_idx" ON "announcements"("starts_at", "ends_at");
CREATE INDEX "announcements_created_at_id_idx" ON "announcements"("created_at" DESC, "id" DESC);

COMMIT;
