-- ═══════════════════════════════════════════════════════════════════════
-- KV-16 · Sahip: Mert · media_assets iskeletini tamamlar
-- 1. BÖLÜM: prisma migrate diff çıktısı (elle değiştirilmedi)
-- 2. BÖLÜM: Prisma schema'da ifade edilemeyen kısımlar (elle, en altta)
-- Açıklamalar: docs/MEDIA_MODERATION.md, docs/DATA_MODEL.md §9
--
-- NOT NULL kolonlar varsayılansız eklenir: media_assets'e yazan bir uygulama
-- henüz yok, tablo her ortamda boştur. Doluysa bu migration bilerek başarısız olur.
-- ═══════════════════════════════════════════════════════════════════════

-- CreateEnum
CREATE TYPE "media_purpose" AS ENUM ('POLL_IMAGE', 'AVATAR', 'COMMUNITY_IMAGE');

-- CreateEnum
CREATE TYPE "media_risk_level" AS ENUM ('LOW', 'MEDIUM', 'HIGH');

-- AlterTable
ALTER TABLE "media_assets" ADD COLUMN     "content_sha256" CHAR(64),
ADD COLUMN     "height" INTEGER,
ADD COLUMN     "moderated_at" TIMESTAMPTZ(3),
ADD COLUMN     "moderation_labels" JSONB,
ADD COLUMN     "moderation_model" VARCHAR(60),
ADD COLUMN     "original_mime_type" VARCHAR(100),
ADD COLUMN     "original_object_key" VARCHAR(512) NOT NULL,
ADD COLUMN     "original_size_bytes" INTEGER,
ADD COLUMN     "processed_object_key" VARCHAR(512),
ADD COLUMN     "processed_size_bytes" INTEGER,
ADD COLUMN     "processing_attempts" SMALLINT NOT NULL DEFAULT 0,
ADD COLUMN     "processing_error" VARCHAR(60),
ADD COLUMN     "public_object_key" VARCHAR(512),
ADD COLUMN     "purpose" "media_purpose" NOT NULL,
ADD COLUMN     "review_note" VARCHAR(500),
ADD COLUMN     "reviewed_at" TIMESTAMPTZ(3),
ADD COLUMN     "reviewed_by_id" UUID,
ADD COLUMN     "risk_level" "media_risk_level",
ADD COLUMN     "risk_score" REAL,
ADD COLUMN     "updated_at" TIMESTAMPTZ(3) NOT NULL,
ADD COLUMN     "uploader_id" UUID NOT NULL,
ADD COLUMN     "width" INTEGER;

-- CreateIndex
CREATE UNIQUE INDEX "media_assets_original_object_key_key" ON "media_assets"("original_object_key");

-- CreateIndex
CREATE UNIQUE INDEX "media_assets_processed_object_key_key" ON "media_assets"("processed_object_key");

-- CreateIndex
CREATE UNIQUE INDEX "media_assets_public_object_key_key" ON "media_assets"("public_object_key");

-- CreateIndex
CREATE INDEX "media_assets_status_created_at_idx" ON "media_assets"("status", "created_at");

-- CreateIndex
CREATE INDEX "media_assets_uploader_id_created_at_idx" ON "media_assets"("uploader_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "media_assets_content_sha256_idx" ON "media_assets"("content_sha256");

-- AddForeignKey
ALTER TABLE "media_assets" ADD CONSTRAINT "media_assets_uploader_id_fkey" FOREIGN KEY ("uploader_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "media_assets" ADD CONSTRAINT "media_assets_reviewed_by_id_fkey" FOREIGN KEY ("reviewed_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- ═══════════════════════════════════════════════════════════════════════
-- 2. BÖLÜM — ELLE EKLENENLER
-- Prisma bunları yönetmez ve sonraki migration'larda silmeye çalışmaz.
-- Bu dosya merge edildikten sonra değiştirilmez.
-- ═══════════════════════════════════════════════════════════════════════

-- İncelenmemiş/reddedilmiş medya asla public anahtar taşımaz (KV-16 kabul koşulu).
-- Onaydan sonra kaldırılan görselin public anahtarı aynı UPDATE'te boşaltılmak zorundadır.
ALTER TABLE "media_assets"
  ADD CONSTRAINT "media_assets_public_key_check"
    CHECK (("status" = 'APPROVED') = ("public_object_key" IS NOT NULL)),
  ADD CONSTRAINT "media_assets_approved_processed_check"
    CHECK ("status" <> 'APPROVED' OR "processed_object_key" IS NOT NULL),
  ADD CONSTRAINT "media_assets_risk_score_check"
    CHECK ("risk_score" IS NULL OR ("risk_score" >= 0 AND "risk_score" <= 1)),
  ADD CONSTRAINT "media_assets_sizes_check"
    CHECK (
      ("original_size_bytes" IS NULL OR "original_size_bytes" >= 0)
      AND ("processed_size_bytes" IS NULL OR "processed_size_bytes" >= 0)
      AND ("width" IS NULL OR "width" > 0)
      AND ("height" IS NULL OR "height" > 0)
      AND "processing_attempts" >= 0
    ),
  ADD CONSTRAINT "media_assets_sha256_check"
    CHECK ("content_sha256" IS NULL OR "content_sha256" ~ '^[0-9a-f]{64}$'),
  ADD CONSTRAINT "media_assets_review_check"
    CHECK (("reviewed_at" IS NULL) = ("reviewed_by_id" IS NULL));
