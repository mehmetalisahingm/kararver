-- ═══════════════════════════════════════════════════════════════════════
-- KV-21 (#23) PR-1 · Sahip: Utku · notifications
-- 1. BÖLÜM: prisma migrate diff çıktısı (elle değiştirilmedi)
-- 2. BÖLÜM: Prisma schema'da ifade edilemeyen kısımlar (elle, en altta)
-- Açıklamalar: docs/KV-21_NOTIFICATIONS.md · docs/DATA_MODEL.md §9.3
-- Dosya BEGIN; … COMMIT; ile sarılıdır: hata olursa hiçbir şey uygulanmaz (KV-48).
-- ═══════════════════════════════════════════════════════════════════════

BEGIN;

-- CreateEnum
CREATE TYPE "notification_type" AS ENUM ('COMMENT_ON_POLL', 'REPLY_TO_COMMENT', 'ALTERNATIVE_ON_POLL', 'POLL_MILESTONE', 'POLL_TRENDING', 'POLL_CLOSED', 'DECISION_UPDATED', 'MODERATION_APPLIED', 'COMMUNITY_FEATURED');

-- CreateTable
CREATE TABLE "notifications" (
    "id" UUID NOT NULL,
    "recipient_id" UUID NOT NULL,
    "type" "notification_type" NOT NULL,
    "event_id" UUID NOT NULL,
    "actor_id" UUID,
    "subject_type" VARCHAR(20) NOT NULL,
    "subject_id" UUID NOT NULL,
    "poll_id" UUID,
    "data" JSONB NOT NULL DEFAULT '{}',
    "dedupe_key" VARCHAR(250) NOT NULL,
    "read_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "notifications_recipient_id_created_at_id_idx" ON "notifications"("recipient_id", "created_at" DESC, "id" DESC);

-- CreateIndex
CREATE INDEX "notifications_poll_id_idx" ON "notifications"("poll_id");

-- CreateIndex
CREATE INDEX "notifications_actor_id_idx" ON "notifications"("actor_id");

-- CreateIndex
CREATE UNIQUE INDEX "notifications_recipient_id_dedupe_key_key" ON "notifications"("recipient_id", "dedupe_key");

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_recipient_id_fkey" FOREIGN KEY ("recipient_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_poll_id_fkey" FOREIGN KEY ("poll_id") REFERENCES "polls"("id") ON DELETE RESTRICT ON UPDATE CASCADE;




-- ═══════════════════════════════════════════════════════════════════════
-- 2. BÖLÜM — ELLE EKLENENLER
-- Prisma bunları yönetmez ve sonraki migration'larda silmeye çalışmaz.
-- Bu dosya merge edildikten sonra değiştirilmez.
-- ═══════════════════════════════════════════════════════════════════════

-- ─── notifications ───
ALTER TABLE "notifications"
  -- contracts NotificationView.subject.type ile aynı küme.
  ADD CONSTRAINT "notifications_subject_type_check"
    CHECK ("subject_type" IN ('POLL', 'COMMENT', 'COMMUNITY', 'USER')),
  -- data tipe göre küçük özet nesnesidir; dizi/skaler yazılamaz.
  ADD CONSTRAINT "notifications_data_object_check"
    CHECK (jsonb_typeof("data") = 'object'),
  -- Kimse kendi işlemi için bildirim almaz.
  ADD CONSTRAINT "notifications_actor_not_recipient_check"
    CHECK ("actor_id" IS NULL OR "actor_id" <> "recipient_id"),
  ADD CONSTRAINT "notifications_dedupe_key_check"
    CHECK (length("dedupe_key") > 0),
  ADD CONSTRAINT "notifications_read_after_created_check"
    CHECK ("read_at" IS NULL OR "read_at" >= "created_at");

-- Okunmamış rozeti (notifications.unreadCount) ve "hepsini okundu yap": yalnız okunmamış satırlar.
-- Partial index Prisma schema'sında yazılamaz (DATA_MODEL §10.4; emsal: polls_snapshots_stale_idx, KV-43).
CREATE INDEX "notifications_unread_idx" ON "notifications" ("recipient_id") WHERE "read_at" IS NULL;

COMMIT;
