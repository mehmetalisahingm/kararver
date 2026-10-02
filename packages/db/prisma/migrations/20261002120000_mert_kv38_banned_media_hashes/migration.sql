-- KV-38 · Sahip: Mert · yasaklı görsel parmak izleri
-- media_assets.perceptual_hash: işlenmiş kopyanın 64 bit dHash'i (worker yazar). banned_media_hashes: kaldırılmış
-- görselin sha256 + dHash'i; worker aynı dosyayı reddeder, çok benzerini incelemeye alır.

-- AlterTable
ALTER TABLE "media_assets" ADD COLUMN     "perceptual_hash" CHAR(16);

-- CreateTable
CREATE TABLE "banned_media_hashes" (
    "id" UUID NOT NULL,
    "content_sha256" CHAR(64),
    "perceptual_hash" CHAR(16),
    "source_media_id" UUID NOT NULL,
    "reason" VARCHAR(500) NOT NULL,
    "created_by_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "banned_media_hashes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "banned_media_hashes_content_sha256_key" ON "banned_media_hashes"("content_sha256");

-- CreateIndex
CREATE UNIQUE INDEX "banned_media_hashes_source_media_id_key" ON "banned_media_hashes"("source_media_id");

-- CreateIndex
CREATE INDEX "banned_media_hashes_perceptual_hash_idx" ON "banned_media_hashes"("perceptual_hash");

-- AddForeignKey
ALTER TABLE "banned_media_hashes" ADD CONSTRAINT "banned_media_hashes_source_media_id_fkey" FOREIGN KEY ("source_media_id") REFERENCES "media_assets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "banned_media_hashes" ADD CONSTRAINT "banned_media_hashes_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ═══════════════════════════════════════════════════════════════════════
-- Elle yazılan kısıtlar (Prisma şemada ifade edilemez)
-- ═══════════════════════════════════════════════════════════════════════

ALTER TABLE "media_assets"
  ADD CONSTRAINT "media_assets_perceptual_hash_check"
    CHECK ("perceptual_hash" IS NULL OR "perceptual_hash" ~ '^[0-9a-f]{16}$');

-- Boş parmak izi hiçbir şeyi engellemez; biçimsiz değer eşleşme hatasına yol açar.
ALTER TABLE "banned_media_hashes"
  ADD CONSTRAINT "banned_media_hashes_fingerprint_check"
    CHECK (num_nonnulls("content_sha256", "perceptual_hash") >= 1),
  ADD CONSTRAINT "banned_media_hashes_sha256_check"
    CHECK ("content_sha256" IS NULL OR "content_sha256" ~ '^[0-9a-f]{64}$'),
  ADD CONSTRAINT "banned_media_hashes_perceptual_hash_check"
    CHECK ("perceptual_hash" IS NULL OR "perceptual_hash" ~ '^[0-9a-f]{16}$'),
  ADD CONSTRAINT "banned_media_hashes_reason_check"
    CHECK (length(btrim("reason")) > 0);
