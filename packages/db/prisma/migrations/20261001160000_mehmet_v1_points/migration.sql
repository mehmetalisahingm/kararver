-- V1 #67 — ilk giriş +20, başarılı yayın -10. Puan güven/itibar puanı değildir.
CREATE TYPE "point_ledger_reason" AS ENUM ('INITIAL_GRANT', 'PUBLISH', 'ADMIN_ADJUSTMENT', 'MODERATION_REFUND');

CREATE TABLE "point_accounts" (
    "user_id" UUID NOT NULL,
    "balance" INTEGER NOT NULL DEFAULT 0,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "point_accounts_pkey" PRIMARY KEY ("user_id"),
    CONSTRAINT "point_accounts_nonnegative" CHECK ("balance" >= 0)
);

CREATE TABLE "point_ledger_entries" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "delta" INTEGER NOT NULL,
    "balance_after" INTEGER NOT NULL,
    "reason" "point_ledger_reason" NOT NULL,
    "reference_id" UUID,
    "idempotency_key" VARCHAR(200) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "point_ledger_entries_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "point_ledger_delta_nonzero" CHECK ("delta" <> 0),
    CONSTRAINT "point_ledger_balance_nonnegative" CHECK ("balance_after" >= 0)
);

CREATE UNIQUE INDEX "point_ledger_entries_user_id_idempotency_key_key"
  ON "point_ledger_entries"("user_id", "idempotency_key");
CREATE INDEX "point_ledger_entries_user_id_created_at_id_idx"
  ON "point_ledger_entries"("user_id", "created_at" DESC, "id" DESC);

ALTER TABLE "point_accounts"
  ADD CONSTRAINT "point_accounts_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "point_ledger_entries"
  ADD CONSTRAINT "point_ledger_entries_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Ledger finansal/audit benzeri bir geçmiş olduğu için uygulama seviyesindeki hata UPDATE/DELETE'i delemez.
CREATE OR REPLACE FUNCTION kv_point_ledger_immutable()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'KV_POINT_LEDGER_APPEND_ONLY';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "point_ledger_entries_append_only"
BEFORE UPDATE OR DELETE ON "point_ledger_entries"
FOR EACH ROW EXECUTE FUNCTION kv_point_ledger_immutable();
