-- ═══════════════════════════════════════════════════════════════════════
-- KV-02 · Sahip: Faruk · İlk migration: core + trends + Mert için iskelet tablolar
-- 1. BÖLÜM: prisma migrate diff --from-empty çıktısı (elle değiştirilmedi)
-- 2. BÖLÜM: Prisma schema'da ifade edilemeyen kısımlar (elle, en altta)
-- Açıklamalar: docs/DATA_MODEL.md
-- ═══════════════════════════════════════════════════════════════════════

-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "user_status" AS ENUM ('ACTIVE', 'RESTRICTED', 'SUSPENDED', 'BANNED');

-- CreateEnum
CREATE TYPE "content_status" AS ENUM ('ACTIVE', 'HIDDEN', 'UNDER_REVIEW', 'LOCKED', 'REMOVED');

-- CreateEnum
CREATE TYPE "results_visibility" AS ENUM ('ALWAYS', 'AFTER_VOTE');

-- CreateEnum
CREATE TYPE "auth_token_purpose" AS ENUM ('EMAIL_VERIFICATION', 'PASSWORD_RESET');

-- CreateEnum
CREATE TYPE "comment_kind" AS ENUM ('COMMENT', 'ALTERNATIVE');

-- CreateEnum
CREATE TYPE "vote_event_type" AS ENUM ('CAST', 'CHANGE', 'INVALIDATE', 'RESTORE');

-- CreateEnum
CREATE TYPE "media_status" AS ENUM ('PENDING', 'APPROVED', 'QUARANTINED', 'REJECTED');

-- CreateEnum
CREATE TYPE "trend_format" AS ENUM ('DAILY_RISING', 'WEEKLY_RISING', 'WEEKLY_MOST_VOTED', 'WEEKLY_MOST_DISCUSSED', 'WEEKLY_MOVERS');

-- CreateEnum
CREATE TYPE "trend_run_status" AS ENUM ('RUNNING', 'SUCCEEDED', 'FAILED');

-- CreateTable
CREATE TABLE "communities" (
    "id" UUID NOT NULL,
    "status" "content_status" NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "communities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL,
    "email" VARCHAR(254) NOT NULL,
    "email_normalized" VARCHAR(254) NOT NULL,
    "username" VARCHAR(30) NOT NULL,
    "username_normalized" VARCHAR(30) NOT NULL,
    "display_name" VARCHAR(60) NOT NULL,
    "password_hash" TEXT NOT NULL,
    "status" "user_status" NOT NULL DEFAULT 'ACTIVE',
    "email_verified_at" TIMESTAMPTZ(3),
    "bio" VARCHAR(300),
    "avatar_media_id" UUID,
    "last_login_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "deleted_at" TIMESTAMPTZ(3),

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sessions" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "token_hash" CHAR(64) NOT NULL,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "last_seen_at" TIMESTAMPTZ(3),
    "revoked_at" TIMESTAMPTZ(3),
    "ip_address" VARCHAR(45),
    "user_agent" VARCHAR(512),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "auth_tokens" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "purpose" "auth_token_purpose" NOT NULL,
    "token_hash" CHAR(64) NOT NULL,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "used_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "auth_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "categories" (
    "id" UUID NOT NULL,
    "slug" VARCHAR(60) NOT NULL,
    "name" VARCHAR(60) NOT NULL,
    "description" VARCHAR(300),
    "icon_key" VARCHAR(60),
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tags" (
    "id" UUID NOT NULL,
    "slug" VARCHAR(40) NOT NULL,
    "name" VARCHAR(40) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tags_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "poll_tags" (
    "poll_id" UUID NOT NULL,
    "tag_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "poll_tags_pkey" PRIMARY KEY ("poll_id","tag_id")
);

-- CreateTable
CREATE TABLE "polls" (
    "id" UUID NOT NULL,
    "public_id" VARCHAR(12) NOT NULL,
    "slug" VARCHAR(120) NOT NULL,
    "author_id" UUID NOT NULL,
    "category_id" UUID NOT NULL,
    "community_id" UUID,
    "title" VARCHAR(200) NOT NULL,
    "description" TEXT,
    "price_amount" DECIMAL(14,2),
    "price_currency" CHAR(3),
    "extra_info" TEXT,
    "status" "content_status" NOT NULL DEFAULT 'ACTIVE',
    "results_visibility" "results_visibility" NOT NULL DEFAULT 'ALWAYS',
    "allow_comments" BOOLEAN NOT NULL DEFAULT true,
    "opens_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closes_at" TIMESTAMPTZ(3) NOT NULL,
    "closed_at" TIMESTAMPTZ(3),
    "first_valid_vote_at" TIMESTAMPTZ(3),
    "vote_count" INTEGER NOT NULL DEFAULT 0,
    "comment_count" INTEGER NOT NULL DEFAULT 0,
    "save_count" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "deleted_at" TIMESTAMPTZ(3),

    CONSTRAINT "polls_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "poll_options" (
    "id" UUID NOT NULL,
    "poll_id" UUID NOT NULL,
    "position" SMALLINT NOT NULL,
    "label" VARCHAR(120) NOT NULL,
    "vote_count" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "poll_options_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "poll_addenda" (
    "id" UUID NOT NULL,
    "poll_id" UUID NOT NULL,
    "body" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "poll_addenda_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "poll_media" (
    "poll_id" UUID NOT NULL,
    "media_id" UUID NOT NULL,
    "position" SMALLINT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "poll_media_pkey" PRIMARY KEY ("poll_id","media_id")
);

-- CreateTable
CREATE TABLE "votes" (
    "id" UUID NOT NULL,
    "poll_id" UUID NOT NULL,
    "option_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "change_count" INTEGER NOT NULL DEFAULT 0,
    "invalidated_at" TIMESTAMPTZ(3),
    "invalidation_reason" VARCHAR(500),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "votes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vote_events" (
    "id" UUID NOT NULL,
    "vote_id" UUID NOT NULL,
    "poll_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "type" "vote_event_type" NOT NULL,
    "from_option_id" UUID,
    "to_option_id" UUID,
    "reason" VARCHAR(500),
    "occurred_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "vote_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "comments" (
    "id" UUID NOT NULL,
    "poll_id" UUID NOT NULL,
    "author_id" UUID NOT NULL,
    "parent_id" UUID,
    "kind" "comment_kind" NOT NULL DEFAULT 'COMMENT',
    "body" TEXT NOT NULL,
    "status" "content_status" NOT NULL DEFAULT 'ACTIVE',
    "like_count" INTEGER NOT NULL DEFAULT 0,
    "reply_count" INTEGER NOT NULL DEFAULT 0,
    "edited_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "deleted_at" TIMESTAMPTZ(3),

    CONSTRAINT "comments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "comment_likes" (
    "comment_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "comment_likes_pkey" PRIMARY KEY ("comment_id","user_id")
);

-- CreateTable
CREATE TABLE "media_assets" (
    "id" UUID NOT NULL,
    "status" "media_status" NOT NULL DEFAULT 'PENDING',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "media_assets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "poll_daily_snapshots" (
    "poll_id" UUID NOT NULL,
    "local_date" DATE NOT NULL,
    "poll_day" SMALLINT NOT NULL,
    "cutoff_at" TIMESTAMPTZ(3) NOT NULL,
    "total_valid_votes" INTEGER NOT NULL,
    "calculation_version" SMALLINT NOT NULL,
    "computed_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "poll_daily_snapshots_pkey" PRIMARY KEY ("poll_id","local_date")
);

-- CreateTable
CREATE TABLE "poll_option_daily_snapshots" (
    "poll_id" UUID NOT NULL,
    "option_id" UUID NOT NULL,
    "local_date" DATE NOT NULL,
    "valid_vote_count" INTEGER NOT NULL,

    CONSTRAINT "poll_option_daily_snapshots_pkey" PRIMARY KEY ("poll_id","option_id","local_date")
);

-- CreateTable
CREATE TABLE "trend_runs" (
    "id" UUID NOT NULL,
    "format" "trend_format" NOT NULL,
    "calculation_version" SMALLINT NOT NULL,
    "status" "trend_run_status" NOT NULL DEFAULT 'RUNNING',
    "window_start" TIMESTAMPTZ(3) NOT NULL,
    "window_end" TIMESTAMPTZ(3) NOT NULL,
    "started_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finished_at" TIMESTAMPTZ(3),
    "error" TEXT,

    CONSTRAINT "trend_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "trend_scores" (
    "run_id" UUID NOT NULL,
    "poll_id" UUID NOT NULL,
    "rank" INTEGER NOT NULL,
    "score" DOUBLE PRECISION NOT NULL,
    "components" JSONB NOT NULL,

    CONSTRAINT "trend_scores_pkey" PRIMARY KEY ("run_id","poll_id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_normalized_key" ON "users"("email_normalized");

-- CreateIndex
CREATE UNIQUE INDEX "users_username_normalized_key" ON "users"("username_normalized");

-- CreateIndex
CREATE INDEX "users_status_idx" ON "users"("status");

-- CreateIndex
CREATE UNIQUE INDEX "sessions_token_hash_key" ON "sessions"("token_hash");

-- CreateIndex
CREATE INDEX "sessions_user_id_idx" ON "sessions"("user_id");

-- CreateIndex
CREATE INDEX "sessions_expires_at_idx" ON "sessions"("expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "auth_tokens_token_hash_key" ON "auth_tokens"("token_hash");

-- CreateIndex
CREATE INDEX "auth_tokens_user_id_purpose_idx" ON "auth_tokens"("user_id", "purpose");

-- CreateIndex
CREATE UNIQUE INDEX "categories_slug_key" ON "categories"("slug");

-- CreateIndex
CREATE INDEX "categories_is_active_sort_order_idx" ON "categories"("is_active", "sort_order");

-- CreateIndex
CREATE UNIQUE INDEX "tags_slug_key" ON "tags"("slug");

-- CreateIndex
CREATE INDEX "poll_tags_tag_id_idx" ON "poll_tags"("tag_id");

-- CreateIndex
CREATE UNIQUE INDEX "polls_public_id_key" ON "polls"("public_id");

-- CreateIndex
CREATE INDEX "polls_status_created_at_idx" ON "polls"("status", "created_at" DESC);

-- CreateIndex
CREATE INDEX "polls_category_id_status_created_at_idx" ON "polls"("category_id", "status", "created_at" DESC);

-- CreateIndex
CREATE INDEX "polls_community_id_status_created_at_idx" ON "polls"("community_id", "status", "created_at" DESC);

-- CreateIndex
CREATE INDEX "polls_author_id_created_at_idx" ON "polls"("author_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "polls_status_vote_count_idx" ON "polls"("status", "vote_count" DESC);

-- CreateIndex
CREATE INDEX "polls_closes_at_idx" ON "polls"("closes_at");

-- CreateIndex
CREATE UNIQUE INDEX "poll_options_poll_id_position_key" ON "poll_options"("poll_id", "position");

-- CreateIndex
CREATE UNIQUE INDEX "poll_options_poll_id_id_key" ON "poll_options"("poll_id", "id");

-- CreateIndex
CREATE INDEX "poll_addenda_poll_id_created_at_idx" ON "poll_addenda"("poll_id", "created_at");

-- CreateIndex
CREATE INDEX "poll_media_media_id_idx" ON "poll_media"("media_id");

-- CreateIndex
CREATE UNIQUE INDEX "poll_media_poll_id_position_key" ON "poll_media"("poll_id", "position");

-- CreateIndex
CREATE INDEX "votes_poll_id_option_id_idx" ON "votes"("poll_id", "option_id");

-- CreateIndex
CREATE INDEX "votes_user_id_created_at_idx" ON "votes"("user_id", "created_at" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "votes_poll_id_user_id_key" ON "votes"("poll_id", "user_id");

-- CreateIndex
CREATE INDEX "vote_events_poll_id_occurred_at_idx" ON "vote_events"("poll_id", "occurred_at");

-- CreateIndex
CREATE INDEX "vote_events_vote_id_occurred_at_idx" ON "vote_events"("vote_id", "occurred_at");

-- CreateIndex
CREATE INDEX "vote_events_user_id_occurred_at_idx" ON "vote_events"("user_id", "occurred_at");

-- CreateIndex
CREATE INDEX "comments_poll_id_parent_id_created_at_idx" ON "comments"("poll_id", "parent_id", "created_at");

-- CreateIndex
CREATE INDEX "comments_poll_id_kind_like_count_idx" ON "comments"("poll_id", "kind", "like_count" DESC);

-- CreateIndex
CREATE INDEX "comments_author_id_created_at_idx" ON "comments"("author_id", "created_at" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "comments_poll_id_id_key" ON "comments"("poll_id", "id");

-- CreateIndex
CREATE INDEX "comment_likes_user_id_idx" ON "comment_likes"("user_id");

-- CreateIndex
CREATE INDEX "poll_daily_snapshots_local_date_idx" ON "poll_daily_snapshots"("local_date");

-- CreateIndex
CREATE UNIQUE INDEX "poll_daily_snapshots_poll_id_poll_day_key" ON "poll_daily_snapshots"("poll_id", "poll_day");

-- CreateIndex
CREATE INDEX "trend_runs_format_status_finished_at_idx" ON "trend_runs"("format", "status", "finished_at" DESC);

-- CreateIndex
CREATE INDEX "trend_scores_poll_id_idx" ON "trend_scores"("poll_id");

-- CreateIndex
CREATE UNIQUE INDEX "trend_scores_run_id_rank_key" ON "trend_scores"("run_id", "rank");

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_avatar_media_id_fkey" FOREIGN KEY ("avatar_media_id") REFERENCES "media_assets"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "auth_tokens" ADD CONSTRAINT "auth_tokens_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "poll_tags" ADD CONSTRAINT "poll_tags_poll_id_fkey" FOREIGN KEY ("poll_id") REFERENCES "polls"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "poll_tags" ADD CONSTRAINT "poll_tags_tag_id_fkey" FOREIGN KEY ("tag_id") REFERENCES "tags"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "polls" ADD CONSTRAINT "polls_author_id_fkey" FOREIGN KEY ("author_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "polls" ADD CONSTRAINT "polls_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "categories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "polls" ADD CONSTRAINT "polls_community_id_fkey" FOREIGN KEY ("community_id") REFERENCES "communities"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "poll_options" ADD CONSTRAINT "poll_options_poll_id_fkey" FOREIGN KEY ("poll_id") REFERENCES "polls"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "poll_addenda" ADD CONSTRAINT "poll_addenda_poll_id_fkey" FOREIGN KEY ("poll_id") REFERENCES "polls"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "poll_media" ADD CONSTRAINT "poll_media_poll_id_fkey" FOREIGN KEY ("poll_id") REFERENCES "polls"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "poll_media" ADD CONSTRAINT "poll_media_media_id_fkey" FOREIGN KEY ("media_id") REFERENCES "media_assets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "votes" ADD CONSTRAINT "votes_poll_id_fkey" FOREIGN KEY ("poll_id") REFERENCES "polls"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "votes" ADD CONSTRAINT "votes_poll_id_option_id_fkey" FOREIGN KEY ("poll_id", "option_id") REFERENCES "poll_options"("poll_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "votes" ADD CONSTRAINT "votes_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vote_events" ADD CONSTRAINT "vote_events_vote_id_fkey" FOREIGN KEY ("vote_id") REFERENCES "votes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vote_events" ADD CONSTRAINT "vote_events_poll_id_fkey" FOREIGN KEY ("poll_id") REFERENCES "polls"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vote_events" ADD CONSTRAINT "vote_events_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vote_events" ADD CONSTRAINT "vote_events_from_option_id_fkey" FOREIGN KEY ("from_option_id") REFERENCES "poll_options"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vote_events" ADD CONSTRAINT "vote_events_to_option_id_fkey" FOREIGN KEY ("to_option_id") REFERENCES "poll_options"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "comments" ADD CONSTRAINT "comments_poll_id_fkey" FOREIGN KEY ("poll_id") REFERENCES "polls"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "comments" ADD CONSTRAINT "comments_author_id_fkey" FOREIGN KEY ("author_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "comments" ADD CONSTRAINT "comments_poll_id_parent_id_fkey" FOREIGN KEY ("poll_id", "parent_id") REFERENCES "comments"("poll_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "comment_likes" ADD CONSTRAINT "comment_likes_comment_id_fkey" FOREIGN KEY ("comment_id") REFERENCES "comments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "comment_likes" ADD CONSTRAINT "comment_likes_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "poll_daily_snapshots" ADD CONSTRAINT "poll_daily_snapshots_poll_id_fkey" FOREIGN KEY ("poll_id") REFERENCES "polls"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "poll_option_daily_snapshots" ADD CONSTRAINT "poll_option_daily_snapshots_poll_id_local_date_fkey" FOREIGN KEY ("poll_id", "local_date") REFERENCES "poll_daily_snapshots"("poll_id", "local_date") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "poll_option_daily_snapshots" ADD CONSTRAINT "poll_option_daily_snapshots_poll_id_option_id_fkey" FOREIGN KEY ("poll_id", "option_id") REFERENCES "poll_options"("poll_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trend_scores" ADD CONSTRAINT "trend_scores_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "trend_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trend_scores" ADD CONSTRAINT "trend_scores_poll_id_fkey" FOREIGN KEY ("poll_id") REFERENCES "polls"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- ═══════════════════════════════════════════════════════════════════════
-- 2. BÖLÜM — ELLE EKLENENLER
-- Prisma bunları yönetmez ve sonraki migration'larda silmeye çalışmaz
-- (CHECK, fonksiyon, trigger, extension). Değiştirmek için yeni bir
-- migration yazılır; bu dosya merge edildikten sonra değiştirilmez.
-- ═══════════════════════════════════════════════════════════════════════

-- ─── Extension'lar ve Türkçe arama normalizasyonu (TECH_DECISIONS §3.9) ───
CREATE EXTENSION IF NOT EXISTS unaccent;
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- Önce unaccent (ş→s, ı→i, İ→I, ğ→g, ç→c, ö→o, ü→u), sonra ICU kök
-- collation'ı ile lower. Böylece sonuç veritabanının locale'ine bağlı değildir.
-- IMMUTABLE olduğu için expression index'lerde kullanılabilir (KV-26).
CREATE FUNCTION kv_normalize(input text) RETURNS text
LANGUAGE sql IMMUTABLE STRICT PARALLEL SAFE
AS $$
  SELECT lower(public.unaccent('public.unaccent'::regdictionary, input) COLLATE "und-x-icu")
$$;

-- ─── CHECK kısıtları ───
ALTER TABLE "polls"
  ADD CONSTRAINT "polls_counts_check" CHECK ("vote_count" >= 0 AND "comment_count" >= 0 AND "save_count" >= 0),
  ADD CONSTRAINT "polls_window_check" CHECK ("closes_at" > "opens_at"),
  ADD CONSTRAINT "polls_closed_at_check" CHECK ("closed_at" IS NULL OR "closed_at" >= "opens_at"),
  ADD CONSTRAINT "polls_price_check" CHECK (
    ("price_amount" IS NULL AND "price_currency" IS NULL)
    OR ("price_amount" >= 0 AND "price_currency" IS NOT NULL)
  );

ALTER TABLE "poll_options"
  ADD CONSTRAINT "poll_options_position_check" CHECK ("position" BETWEEN 0 AND 5),
  ADD CONSTRAINT "poll_options_vote_count_check" CHECK ("vote_count" >= 0);

ALTER TABLE "poll_media"
  ADD CONSTRAINT "poll_media_position_check" CHECK ("position" >= 0);

ALTER TABLE "votes"
  ADD CONSTRAINT "votes_change_count_check" CHECK ("change_count" >= 0),
  ADD CONSTRAINT "votes_invalidation_check" CHECK (("invalidated_at" IS NULL) = ("invalidation_reason" IS NULL));

ALTER TABLE "vote_events"
  ADD CONSTRAINT "vote_events_shape_check" CHECK (
    CASE "type"
      WHEN 'CAST'       THEN "from_option_id" IS NULL     AND "to_option_id" IS NOT NULL
      WHEN 'RESTORE'    THEN "from_option_id" IS NULL     AND "to_option_id" IS NOT NULL
      WHEN 'CHANGE'     THEN "from_option_id" IS NOT NULL AND "to_option_id" IS NOT NULL
                             AND "from_option_id" <> "to_option_id"
      WHEN 'INVALIDATE' THEN "from_option_id" IS NOT NULL AND "to_option_id" IS NULL
    END
  );

ALTER TABLE "comments"
  ADD CONSTRAINT "comments_counts_check" CHECK ("like_count" >= 0 AND "reply_count" >= 0),
  ADD CONSTRAINT "comments_alternative_top_level_check" CHECK ("kind" = 'COMMENT' OR "parent_id" IS NULL),
  ADD CONSTRAINT "comments_not_self_parent_check" CHECK ("parent_id" IS NULL OR "parent_id" <> "id");

ALTER TABLE "poll_daily_snapshots"
  ADD CONSTRAINT "poll_daily_snapshots_values_check" CHECK ("poll_day" >= 0 AND "total_valid_votes" >= 0);

ALTER TABLE "poll_option_daily_snapshots"
  ADD CONSTRAINT "poll_option_daily_snapshots_values_check" CHECK ("valid_vote_count" >= 0);

ALTER TABLE "trend_scores"
  ADD CONSTRAINT "trend_scores_rank_check" CHECK ("rank" >= 1);

-- ─── İlk geçerli oydan sonra anket içeriği kilidi (KV-10) ───
-- (a) İlk geçerli oy eklendiğinde polls.first_valid_vote_at bir kez dolar.
CREATE FUNCTION kv_votes_mark_first_valid() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."invalidated_at" IS NULL THEN
    UPDATE "polls" SET "first_valid_vote_at" = now()
     WHERE "id" = NEW."poll_id" AND "first_valid_vote_at" IS NULL;
  END IF;
  RETURN NULL;
END $$;

CREATE TRIGGER "votes_mark_first_valid"
  AFTER INSERT ON "votes"
  FOR EACH ROW EXECUTE FUNCTION kv_votes_mark_first_valid();

-- (b) Kilitli ankette başlık, açıklama ve sonuç görünürlüğü değişmez; kilit geri
--     alınamaz. Sonradan bilgi eklemek için poll_addenda kullanılır.
CREATE FUNCTION kv_polls_guard_locked() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF OLD."first_valid_vote_at" IS NOT NULL THEN
    IF NEW."first_valid_vote_at" IS DISTINCT FROM OLD."first_valid_vote_at" THEN
      RAISE EXCEPTION 'KV_POLL_CONTENT_LOCKED: first_valid_vote_at değiştirilemez (poll %)', OLD."id"
        USING ERRCODE = 'P0001';
    END IF;
    IF NEW."title" IS DISTINCT FROM OLD."title"
       OR NEW."description" IS DISTINCT FROM OLD."description"
       OR NEW."results_visibility" IS DISTINCT FROM OLD."results_visibility" THEN
      RAISE EXCEPTION 'KV_POLL_CONTENT_LOCKED: ilk geçerli oydan sonra başlık, açıklama ve sonuç görünürlüğü değiştirilemez (poll %)', OLD."id"
        USING ERRCODE = 'P0001';
    END IF;
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER "polls_guard_locked"
  BEFORE UPDATE ON "polls"
  FOR EACH ROW EXECUTE FUNCTION kv_polls_guard_locked();

-- (c) Kilitli ankette seçenek eklenemez, silinemez, metni/sırası değişmez.
--     Sadece vote_count güncellemesine izin verilir. FOR SHARE, eşzamanlı ilk oy
--     ile seçenek düzenlemesini sıraya sokar (DATA_MODEL.md → "Yarış durumu").
CREATE FUNCTION kv_poll_options_guard_locked() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  target_poll uuid;
  locked_at   timestamptz;
BEGIN
  IF TG_OP = 'UPDATE'
     AND NEW."poll_id" = OLD."poll_id"
     AND NEW."label" = OLD."label"
     AND NEW."position" = OLD."position" THEN
    RETURN NEW;
  END IF;

  target_poll := CASE WHEN TG_OP = 'DELETE' THEN OLD."poll_id" ELSE NEW."poll_id" END;
  SELECT "first_valid_vote_at" INTO locked_at FROM "polls" WHERE "id" = target_poll FOR SHARE;

  IF locked_at IS NOT NULL THEN
    RAISE EXCEPTION 'KV_POLL_CONTENT_LOCKED: ilk geçerli oydan sonra seçenekler değiştirilemez (poll %)', target_poll
      USING ERRCODE = 'P0001';
  END IF;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER "poll_options_guard_locked"
  BEFORE INSERT OR UPDATE OR DELETE ON "poll_options"
  FOR EACH ROW EXECUTE FUNCTION kv_poll_options_guard_locked();

-- ─── Oy satırının kimliği değişmez ───
CREATE FUNCTION kv_votes_guard_identity() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."poll_id" <> OLD."poll_id" OR NEW."user_id" <> OLD."user_id" THEN
    RAISE EXCEPTION 'KV_VOTE_IDENTITY_IMMUTABLE: oyun anketi ve kullanıcısı değiştirilemez (vote %)', OLD."id"
      USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER "votes_guard_identity"
  BEFORE UPDATE ON "votes"
  FOR EACH ROW EXECUTE FUNCTION kv_votes_guard_identity();

-- ─── Oy geçmişi append-only ───
CREATE FUNCTION kv_vote_events_append_only() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'KV_VOTE_EVENTS_APPEND_ONLY: vote_events satırları güncellenemez veya silinemez'
    USING ERRCODE = 'P0001';
END $$;

CREATE TRIGGER "vote_events_append_only"
  BEFORE UPDATE OR DELETE ON "vote_events"
  FOR EACH ROW EXECUTE FUNCTION kv_vote_events_append_only();

-- ─── Yorumlarda tek seviye cevap ───
-- Aynı anket şartı bileşik FK ile, "cevabın cevabı olmaz" şartı burada sağlanır.
CREATE FUNCTION kv_comments_single_level() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  grandparent uuid;
BEGIN
  IF NEW."parent_id" IS NULL THEN
    RETURN NEW;
  END IF;
  SELECT "parent_id" INTO grandparent FROM "comments"
   WHERE "poll_id" = NEW."poll_id" AND "id" = NEW."parent_id";
  IF grandparent IS NOT NULL THEN
    RAISE EXCEPTION 'KV_COMMENT_DEPTH: cevaplara cevap verilemez (parent %)', NEW."parent_id"
      USING ERRCODE = 'P0001';
  END IF;
  -- Cevapları olan bir yorum başka bir yorumun cevabına dönüştürülemez.
  IF TG_OP = 'UPDATE' AND EXISTS (SELECT 1 FROM "comments" WHERE "parent_id" = NEW."id") THEN
    RAISE EXCEPTION 'KV_COMMENT_DEPTH: cevabı olan yorum cevaba dönüştürülemez (comment %)', NEW."id"
      USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER "comments_single_level"
  BEFORE INSERT OR UPDATE OF "parent_id" ON "comments"
  FOR EACH ROW EXECUTE FUNCTION kv_comments_single_level();
