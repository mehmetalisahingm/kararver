-- #181 KVKK veri dışa aktarma talepleri.
-- Paket (AES-256-GCM, şifreli) private bucket'ta durur; anahtar yalnız bu satırdadır ve süre dolunca/başarısızlıkta silinir
-- (anahtar silinince nesne okunamaz). İndirme bağlantısı token'ı yalnız SHA-256 özetiyle saklanır.
BEGIN;

CREATE TYPE "data_export_status" AS ENUM ('PENDING', 'PROCESSING', 'READY', 'FAILED', 'EXPIRED');

CREATE TABLE "data_exports" (
  "id" UUID NOT NULL,
  "user_id" UUID NOT NULL,
  "requested_by_id" UUID NOT NULL,
  "status" "data_export_status" NOT NULL DEFAULT 'PENDING',
  "object_key" VARCHAR(512),
  "size_bytes" INTEGER,
  "enc_key" BYTEA,
  "claimed_at" TIMESTAMPTZ(3),
  "ready_at" TIMESTAMPTZ(3),
  "expires_at" TIMESTAMPTZ(3),
  "failure" VARCHAR(60),
  "token_hash" CHAR(64),
  "token_expires_at" TIMESTAMPTZ(3),
  "delivered_at" TIMESTAMPTZ(3),
  "download_count" SMALLINT NOT NULL DEFAULT 0,
  "last_downloaded_at" TIMESTAMPTZ(3),
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "data_exports_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "data_exports_token_hash_key" UNIQUE ("token_hash"),
  CONSTRAINT "data_exports_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "data_exports_requested_by_id_fkey" FOREIGN KEY ("requested_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  -- READY paketin nesnesi, anahtarı, boyutu ve silinme zamanı vardır.
  CONSTRAINT "data_exports_ready_check" CHECK (
    "status" <> 'READY' OR ("object_key" IS NOT NULL AND "enc_key" IS NOT NULL AND "size_bytes" IS NOT NULL AND "expires_at" IS NOT NULL)
  ),
  -- Süresi dolan veya başarısız talepte anahtar ve indirme token'ı kalmaz.
  CONSTRAINT "data_exports_closed_check" CHECK (
    "status" IN ('PENDING', 'PROCESSING', 'READY') OR ("enc_key" IS NULL AND "token_hash" IS NULL)
  ),
  CONSTRAINT "data_exports_download_count_check" CHECK ("download_count" >= 0)
);

-- Hesap başına en çok bir açık talep (idempotency): eşzamanlı iki istek yarışırsa yalnız biri yazılır.
CREATE UNIQUE INDEX "data_exports_one_open_per_user_key" ON "data_exports"("user_id") WHERE "status" IN ('PENDING', 'PROCESSING', 'READY');
CREATE INDEX "data_exports_user_id_created_at_idx" ON "data_exports"("user_id", "created_at" DESC);
-- Worker: bekleyen/takılmış talepler ve süresi dolan paketler.
CREATE INDEX "data_exports_status_created_at_idx" ON "data_exports"("status", "created_at");

COMMIT;
