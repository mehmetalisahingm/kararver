-- ═══════════════════════════════════════════════════════════════════════
-- KV-34 (#36) · Sahip: Faruk (Utku'dan geçici devir) · bildirim tercihleri ve anket sessizi
-- 1. BÖLÜM: prisma migrate diff çıktısı (elle değiştirilmedi)
-- 2. BÖLÜM: Prisma schema'da ifade edilemeyen kısımlar (elle, en altta)
-- Açıklamalar: docs/KV-21_NOTIFICATIONS.md §8
-- Dosya BEGIN; … COMMIT; ile sarılıdır: hata olursa hiçbir şey uygulanmaz (KV-48).
-- ═══════════════════════════════════════════════════════════════════════

BEGIN;

-- CreateTable
CREATE TABLE "notification_type_opt_outs" (
    "user_id" UUID NOT NULL,
    "type" "notification_type" NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notification_type_opt_outs_pkey" PRIMARY KEY ("user_id","type")
);

-- CreateTable
CREATE TABLE "notification_poll_mutes" (
    "user_id" UUID NOT NULL,
    "poll_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notification_poll_mutes_pkey" PRIMARY KEY ("user_id","poll_id")
);

-- CreateIndex
CREATE INDEX "notification_poll_mutes_poll_id_user_id_idx" ON "notification_poll_mutes"("poll_id", "user_id");

-- AddForeignKey
ALTER TABLE "notification_type_opt_outs" ADD CONSTRAINT "notification_type_opt_outs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification_poll_mutes" ADD CONSTRAINT "notification_poll_mutes_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification_poll_mutes" ADD CONSTRAINT "notification_poll_mutes_poll_id_fkey" FOREIGN KEY ("poll_id") REFERENCES "polls"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ═══════════════════════════════════════════════════════════════════════
-- 2. BÖLÜM — ELLE EKLENENLER
-- Prisma bunları yönetmez ve sonraki migration'larda silmeye çalışmaz.
-- Bu dosya merge edildikten sonra değiştirilmez.
-- ═══════════════════════════════════════════════════════════════════════

-- Kapatılamayan tipler (contracts MANDATORY_NOTIFICATION_TYPES): moderasyon ve yaptırım bildirimi kapatılamaz.
-- API 400 VALIDATION_ERROR döner; bu kısıt kod hatasına karşı son savunmadır.
ALTER TABLE "notification_type_opt_outs"
  ADD CONSTRAINT "notification_type_opt_outs_mandatory_check" CHECK ("type" NOT IN ('MODERATION_APPLIED', 'SANCTION_APPLIED'));

COMMIT;
