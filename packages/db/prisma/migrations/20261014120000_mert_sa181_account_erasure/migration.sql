-- #181 hesap anonimleştirme: kalıcı kayıt (account_erasures) ve yasal saklama (user_legal_holds). Kişisel veri temizliğinin
-- kendisi uygulama transaction'ındadır; bu tablolar yalnız kişisel veri içermeyen izi ve engeli taşır.
BEGIN;

CREATE TABLE "account_erasures" (
  "id" UUID NOT NULL,
  "user_id" UUID NOT NULL,
  "requested_by_id" UUID NOT NULL,
  "reason" VARCHAR(500) NOT NULL,
  -- Yalnız sayılar (silinen/korunan kayıt adetleri); ad, e-posta, içerik yok.
  "summary" JSONB NOT NULL,
  "storage_cleaned_at" TIMESTAMPTZ(3),
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "account_erasures_pkey" PRIMARY KEY ("id"),
  -- Hesap başına tek kayıt: ikinci istek yeni anonimleştirme üretemez.
  CONSTRAINT "account_erasures_user_id_key" UNIQUE ("user_id"),
  CONSTRAINT "account_erasures_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "account_erasures_requested_by_id_fkey" FOREIGN KEY ("requested_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "account_erasures_reason_check" CHECK (length(btrim("reason")) >= 3),
  CONSTRAINT "account_erasures_summary_check" CHECK (jsonb_typeof("summary") = 'object')
);
CREATE INDEX "account_erasures_storage_cleaned_at_created_at_idx" ON "account_erasures"("storage_cleaned_at", "created_at");

CREATE TABLE "user_legal_holds" (
  "id" UUID NOT NULL,
  "user_id" UUID NOT NULL,
  "reason" VARCHAR(500) NOT NULL,
  "placed_by_id" UUID NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "released_by_id" UUID,
  "released_reason" VARCHAR(500),
  "released_at" TIMESTAMPTZ(3),
  CONSTRAINT "user_legal_holds_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "user_legal_holds_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "user_legal_holds_placed_by_id_fkey" FOREIGN KEY ("placed_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "user_legal_holds_released_by_id_fkey" FOREIGN KEY ("released_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "user_legal_holds_reason_check" CHECK (length(btrim("reason")) >= 3),
  -- Bırakma üç alanı birlikte doldurur.
  CONSTRAINT "user_legal_holds_release_check" CHECK (
    ("released_at" IS NULL AND "released_by_id" IS NULL AND "released_reason" IS NULL)
    OR ("released_at" IS NOT NULL AND "released_by_id" IS NOT NULL AND length(btrim("released_reason")) >= 3)
  )
);
-- Hesap başına en çok bir açık yasal saklama: eşzamanlı iki koyma isteğinden yalnız biri yazılır.
CREATE UNIQUE INDEX "user_legal_holds_one_open_per_user_key" ON "user_legal_holds"("user_id") WHERE "released_at" IS NULL;
CREATE INDEX "user_legal_holds_user_id_created_at_idx" ON "user_legal_holds"("user_id", "created_at" DESC);

COMMIT;
