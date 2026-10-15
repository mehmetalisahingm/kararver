-- #181 kullanıcının kendi hesap silme talebi: parola (+MFA) ve yazılı teyitle açılır, e-postadaki bağlantıyla onaylanır.
-- Talep kişisel veri taşımaz; silmenin kendisi account_erasures / anonimleştirme transaction'ındadır.
BEGIN;

CREATE TYPE "account_deletion_status" AS ENUM ('OPEN', 'COMPLETED', 'CANCELLED', 'EXPIRED', 'FAILED');

CREATE TABLE "account_deletion_requests" (
  "id" UUID NOT NULL,
  "user_id" UUID NOT NULL,
  "status" "account_deletion_status" NOT NULL DEFAULT 'OPEN',
  -- sha256(token + pepper); ham token yalnız e-postada. Sonlanma sonrası da kalır (tekrar tıklama idempotent yanıtlanır).
  "token_hash" CHAR(64) NOT NULL,
  "expires_at" TIMESTAMPTZ(3) NOT NULL,
  "finished_at" TIMESTAMPTZ(3),
  "failure" VARCHAR(60),
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "account_deletion_requests_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "account_deletion_requests_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "account_deletion_requests_token_hash_key" UNIQUE ("token_hash"),
  -- Açık talep sonlanma zamanı taşımaz; sonlanmış talep taşır.
  CONSTRAINT "account_deletion_requests_finished_check" CHECK (("status" = 'OPEN') = ("finished_at" IS NULL)),
  CONSTRAINT "account_deletion_requests_failure_check" CHECK ("failure" IS NULL OR "status" IN ('CANCELLED', 'FAILED'))
);

-- Hesap başına en çok bir açık talep: eşzamanlı iki istekten yalnız biri yazılır.
CREATE UNIQUE INDEX "account_deletion_requests_one_open_per_user_key" ON "account_deletion_requests"("user_id") WHERE "status" = 'OPEN';
CREATE INDEX "account_deletion_requests_user_id_created_at_idx" ON "account_deletion_requests"("user_id", "created_at" DESC);
CREATE INDEX "account_deletion_requests_status_expires_at_idx" ON "account_deletion_requests"("status", "expires_at");

COMMIT;
