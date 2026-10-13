-- #181 e-posta değişimi: hesap sahipliği kanıtı + yeni adresin doğrulanması + (kullanıcı başlatmalıysa) eski adresin onayı.
-- Doğrulamayı atlayan yol yoktur: e-posta yalnız iki taraflı (veya yönetici başlatmasında yeni adres) token tıklamasıyla değişir.
BEGIN;

CREATE TYPE "email_change_status" AS ENUM ('OPEN', 'COMPLETED', 'CANCELLED', 'DENIED', 'EXPIRED', 'FAILED');
CREATE TYPE "email_change_origin" AS ENUM ('USER', 'ADMIN');

CREATE TABLE "email_change_requests" (
  "id" UUID NOT NULL,
  "user_id" UUID NOT NULL,
  "origin" "email_change_origin" NOT NULL,
  "requested_by_id" UUID NOT NULL,
  "reason" VARCHAR(500),
  "status" "email_change_status" NOT NULL DEFAULT 'OPEN',
  -- Yalnız açıkken tutulur; sonlanınca silinir (aşağıdaki CHECK).
  "new_email" VARCHAR(254),
  "new_email_normalized" VARCHAR(254),
  -- sha256(token + pepper); ham token yalnız e-postada. Sonlanma sonrası da kalır (tekrar tıklama idempotent yanıtlanır).
  "new_token_hash" CHAR(64) NOT NULL,
  "old_token_hash" CHAR(64) NOT NULL,
  "requires_old" BOOLEAN NOT NULL,
  "new_confirmed_at" TIMESTAMPTZ(3),
  "old_confirmed_at" TIMESTAMPTZ(3),
  "expires_at" TIMESTAMPTZ(3) NOT NULL,
  "finished_at" TIMESTAMPTZ(3),
  "failure" VARCHAR(60),
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "email_change_requests_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "email_change_requests_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "email_change_requests_requested_by_id_fkey" FOREIGN KEY ("requested_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "email_change_requests_new_token_hash_key" UNIQUE ("new_token_hash"),
  CONSTRAINT "email_change_requests_old_token_hash_key" UNIQUE ("old_token_hash"),
  CONSTRAINT "email_change_requests_tokens_distinct_check" CHECK ("new_token_hash" <> "old_token_hash"),
  -- Açık talep yeni adresi taşır; sonlanmış talepte kişisel veri kalmaz.
  CONSTRAINT "email_change_requests_email_check" CHECK (
    ("status" = 'OPEN' AND "new_email" IS NOT NULL AND "new_email_normalized" IS NOT NULL AND "finished_at" IS NULL)
    OR ("status" <> 'OPEN' AND "new_email" IS NULL AND "new_email_normalized" IS NULL AND "finished_at" IS NOT NULL)
  ),
  -- Yönetici başlatması gerekçeli ve eski adres onayı istemez; kullanıcı başlatması eski adres onayı ister.
  CONSTRAINT "email_change_requests_origin_check" CHECK (
    ("origin" = 'ADMIN' AND "reason" IS NOT NULL AND length(btrim("reason")) >= 3 AND NOT "requires_old")
    OR ("origin" = 'USER' AND "requires_old" AND "requested_by_id" = "user_id")
  ),
  CONSTRAINT "email_change_requests_failure_check" CHECK ("failure" IS NULL OR "status" IN ('FAILED', 'CANCELLED')),
  -- Tamamlanan talep gereken onayların ikisini de taşır.
  CONSTRAINT "email_change_requests_completed_check" CHECK (
    "status" <> 'COMPLETED' OR ("new_confirmed_at" IS NOT NULL AND (NOT "requires_old" OR "old_confirmed_at" IS NOT NULL))
  )
);

-- Hesap başına en çok bir açık talep: eşzamanlı iki istekten yalnız biri yazılır.
CREATE UNIQUE INDEX "email_change_requests_one_open_per_user_key" ON "email_change_requests"("user_id") WHERE "status" = 'OPEN';
CREATE INDEX "email_change_requests_user_id_created_at_idx" ON "email_change_requests"("user_id", "created_at" DESC);
CREATE INDEX "email_change_requests_status_expires_at_idx" ON "email_change_requests"("status", "expires_at");

COMMIT;
