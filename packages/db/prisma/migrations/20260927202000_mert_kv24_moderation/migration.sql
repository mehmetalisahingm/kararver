-- ═══════════════════════════════════════════════════════════════════════
-- KV-24 · Sahip: Mert · reports + moderation_actions
-- 1. BÖLÜM: prisma migrate diff çıktısı (elle değiştirilmedi)
-- 2. BÖLÜM: Prisma schema'da ifade edilemeyen kısımlar (elle, en altta)
-- Açıklamalar: docs/DATA_MODEL.md §9
-- ═══════════════════════════════════════════════════════════════════════

-- CreateEnum
CREATE TYPE "report_reason" AS ENUM ('SPAM', 'HARASSMENT', 'INAPPROPRIATE', 'HATE_SPEECH', 'PERSONAL_INFO', 'MISLEADING', 'COPYRIGHT', 'OTHER');

-- CreateEnum
CREATE TYPE "report_status" AS ENUM ('OPEN', 'ACTIONED', 'DISMISSED');

-- CreateEnum
CREATE TYPE "moderation_action_type" AS ENUM ('APPROVE', 'HIDE', 'REMOVE', 'RESTORE', 'LOCK', 'UNLOCK', 'WARN_USER', 'DISMISS_REPORT');

-- CreateTable
CREATE TABLE "reports" (
    "id" UUID NOT NULL,
    "reporter_id" UUID NOT NULL,
    "poll_id" UUID,
    "comment_id" UUID,
    "media_id" UUID,
    "reported_user_id" UUID,
    "reason" "report_reason" NOT NULL,
    "details" VARCHAR(1000),
    "status" "report_status" NOT NULL DEFAULT 'OPEN',
    "resolved_by_id" UUID,
    "resolved_at" TIMESTAMPTZ(3),
    "resolution_note" VARCHAR(1000),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "reports_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "moderation_actions" (
    "id" UUID NOT NULL,
    "actor_id" UUID NOT NULL,
    "action" "moderation_action_type" NOT NULL,
    "poll_id" UUID,
    "comment_id" UUID,
    "media_id" UUID,
    "target_user_id" UUID,
    "report_id" UUID,
    "from_status" VARCHAR(20),
    "to_status" VARCHAR(20),
    "reason" VARCHAR(1000) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "moderation_actions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "reports_status_created_at_idx" ON "reports"("status", "created_at");

-- CreateIndex
CREATE INDEX "reports_poll_id_idx" ON "reports"("poll_id");

-- CreateIndex
CREATE INDEX "reports_comment_id_idx" ON "reports"("comment_id");

-- CreateIndex
CREATE INDEX "reports_media_id_idx" ON "reports"("media_id");

-- CreateIndex
CREATE INDEX "reports_reported_user_id_idx" ON "reports"("reported_user_id");

-- CreateIndex
CREATE UNIQUE INDEX "reports_reporter_id_poll_id_key" ON "reports"("reporter_id", "poll_id");

-- CreateIndex
CREATE UNIQUE INDEX "reports_reporter_id_comment_id_key" ON "reports"("reporter_id", "comment_id");

-- CreateIndex
CREATE UNIQUE INDEX "reports_reporter_id_media_id_key" ON "reports"("reporter_id", "media_id");

-- CreateIndex
CREATE UNIQUE INDEX "reports_reporter_id_reported_user_id_key" ON "reports"("reporter_id", "reported_user_id");

-- CreateIndex
CREATE INDEX "moderation_actions_poll_id_created_at_idx" ON "moderation_actions"("poll_id", "created_at");

-- CreateIndex
CREATE INDEX "moderation_actions_comment_id_created_at_idx" ON "moderation_actions"("comment_id", "created_at");

-- CreateIndex
CREATE INDEX "moderation_actions_media_id_created_at_idx" ON "moderation_actions"("media_id", "created_at");

-- CreateIndex
CREATE INDEX "moderation_actions_target_user_id_created_at_idx" ON "moderation_actions"("target_user_id", "created_at");

-- CreateIndex
CREATE INDEX "moderation_actions_actor_id_created_at_idx" ON "moderation_actions"("actor_id", "created_at");

-- CreateIndex
CREATE INDEX "moderation_actions_report_id_idx" ON "moderation_actions"("report_id");

-- AddForeignKey
ALTER TABLE "reports" ADD CONSTRAINT "reports_reporter_id_fkey" FOREIGN KEY ("reporter_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reports" ADD CONSTRAINT "reports_poll_id_fkey" FOREIGN KEY ("poll_id") REFERENCES "polls"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reports" ADD CONSTRAINT "reports_comment_id_fkey" FOREIGN KEY ("comment_id") REFERENCES "comments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reports" ADD CONSTRAINT "reports_media_id_fkey" FOREIGN KEY ("media_id") REFERENCES "media_assets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reports" ADD CONSTRAINT "reports_reported_user_id_fkey" FOREIGN KEY ("reported_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reports" ADD CONSTRAINT "reports_resolved_by_id_fkey" FOREIGN KEY ("resolved_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "moderation_actions" ADD CONSTRAINT "moderation_actions_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "moderation_actions" ADD CONSTRAINT "moderation_actions_poll_id_fkey" FOREIGN KEY ("poll_id") REFERENCES "polls"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "moderation_actions" ADD CONSTRAINT "moderation_actions_comment_id_fkey" FOREIGN KEY ("comment_id") REFERENCES "comments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "moderation_actions" ADD CONSTRAINT "moderation_actions_media_id_fkey" FOREIGN KEY ("media_id") REFERENCES "media_assets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "moderation_actions" ADD CONSTRAINT "moderation_actions_target_user_id_fkey" FOREIGN KEY ("target_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "moderation_actions" ADD CONSTRAINT "moderation_actions_report_id_fkey" FOREIGN KEY ("report_id") REFERENCES "reports"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- ═══════════════════════════════════════════════════════════════════════
-- 2. BÖLÜM — ELLE EKLENENLER
-- Prisma bunları yönetmez ve sonraki migration'larda silmeye çalışmaz.
-- Bu dosya merge edildikten sonra değiştirilmez.
-- ═══════════════════════════════════════════════════════════════════════

-- ─── Tek hedef (DATA_MODEL §9: target_type/target_id yerine ayrı FK'ler) ───
ALTER TABLE "reports"
  ADD CONSTRAINT "reports_single_target_check"
    CHECK (num_nonnulls("poll_id", "comment_id", "media_id", "reported_user_id") = 1),
  ADD CONSTRAINT "reports_not_self_check"
    CHECK ("reported_user_id" IS NULL OR "reported_user_id" <> "reporter_id"),
  -- OPEN rapor sonuçlandırılmamıştır; ACTIONED/DISMISSED rapor kimin ve ne zaman kapattığını taşır.
  ADD CONSTRAINT "reports_resolution_check"
    CHECK (
      ("status" = 'OPEN' AND "resolved_by_id" IS NULL AND "resolved_at" IS NULL)
      OR ("status" <> 'OPEN' AND "resolved_by_id" IS NOT NULL AND "resolved_at" IS NOT NULL)
    );

ALTER TABLE "moderation_actions"
  ADD CONSTRAINT "moderation_actions_single_target_check"
    CHECK (num_nonnulls("poll_id", "comment_id", "media_id", "target_user_id") = 1),
  ADD CONSTRAINT "moderation_actions_reason_check"
    CHECK (length(btrim("reason")) > 0);

-- ─── Moderasyon geçmişi append-only ───
CREATE FUNCTION kv_moderation_actions_append_only() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'KV_MODERATION_ACTIONS_APPEND_ONLY: moderation_actions satırları güncellenemez veya silinemez'
    USING ERRCODE = 'P0001';
END $$;

CREATE TRIGGER "moderation_actions_append_only"
  BEFORE UPDATE OR DELETE ON "moderation_actions"
  FOR EACH ROW EXECUTE FUNCTION kv_moderation_actions_append_only();
