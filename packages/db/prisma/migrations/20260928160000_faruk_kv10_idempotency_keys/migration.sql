-- KV-10 (#12) · Sahip: Faruk · Idempotency-Key kayıtları (API_CONTRACTS.md §4.5, §6)
-- 1. BÖLÜM: prisma migrate diff çıktısı (elle değiştirilmedi)

-- CreateTable
CREATE TABLE "idempotency_keys" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "route" VARCHAR(80) NOT NULL,
    "key" VARCHAR(128) NOT NULL,
    "request_hash" CHAR(64) NOT NULL,
    "response_status" SMALLINT NOT NULL,
    "resource_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "idempotency_keys_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "idempotency_keys_expires_at_idx" ON "idempotency_keys"("expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "idempotency_keys_user_id_route_key_key" ON "idempotency_keys"("user_id", "route", "key");

-- AddForeignKey
ALTER TABLE "idempotency_keys" ADD CONSTRAINT "idempotency_keys_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- 2. BÖLÜM — ELLE EKLENENLER
ALTER TABLE "idempotency_keys"
  ADD CONSTRAINT "idempotency_keys_status_check" CHECK ("response_status" BETWEEN 200 AND 299),
  ADD CONSTRAINT "idempotency_keys_expiry_check" CHECK ("expires_at" > "created_at"),
  ADD CONSTRAINT "idempotency_keys_key_check" CHECK ("key" ~ '^[A-Za-z0-9_-]{8,128}$');
