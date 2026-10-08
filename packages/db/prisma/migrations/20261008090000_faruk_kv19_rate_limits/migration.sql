-- ═══════════════════════════════════════════════════════════════════════
-- KV-19 (#21) · Sahip: Faruk (Utku'dan geçici devir) · rate_limit_counters
-- 1. BÖLÜM: prisma migrate diff çıktısı (elle değiştirilmedi)
-- 2. BÖLÜM: Prisma schema'da ifade edilemeyen kısımlar (elle, en altta)
-- Açıklamalar: docs/KV-19_RATE_LIMIT.md
-- Dosya BEGIN; … COMMIT; ile sarılıdır: hata olursa hiçbir şey uygulanmaz (KV-48).
-- ═══════════════════════════════════════════════════════════════════════

BEGIN;

-- CreateTable
CREATE TABLE "rate_limit_counters" (
    "key" VARCHAR(120) NOT NULL,
    "window_start" TIMESTAMPTZ(3) NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 0,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "rate_limit_counters_pkey" PRIMARY KEY ("key","window_start")
);

-- CreateIndex
CREATE INDEX "rate_limit_counters_expires_at_idx" ON "rate_limit_counters"("expires_at");

-- ═══════════════════════════════════════════════════════════════════════
-- 2. BÖLÜM — ELLE EKLENENLER
-- Prisma bunları yönetmez ve sonraki migration'larda silmeye çalışmaz.
-- Bu dosya merge edildikten sonra değiştirilmez.
-- ═══════════════════════════════════════════════════════════════════════

-- Sayaç negatif olamaz; pencere bitişi başlangıçtan sonradır.
ALTER TABLE "rate_limit_counters"
  ADD CONSTRAINT "rate_limit_counters_count_check" CHECK ("count" >= 0),
  ADD CONSTRAINT "rate_limit_counters_window_check" CHECK ("expires_at" > "window_start");

COMMIT;
