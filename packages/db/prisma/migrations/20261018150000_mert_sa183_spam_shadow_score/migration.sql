-- #183 / KV-37 S1: spam uyarı puanı gölge modu. Hesap başına tek satır; yalnız spam.shadowScoring.enabled açıkken worker yazar.
-- Sinyaller yalnız sayaçtır (JSON). Kullanıcı satırı silinirse puan da silinir (CASCADE).
BEGIN;

CREATE TABLE "spam_account_scores" (
  "user_id" UUID NOT NULL,
  "score" INTEGER NOT NULL,
  "signals" JSONB NOT NULL,
  "computed_at" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "spam_account_scores_pkey" PRIMARY KEY ("user_id"),
  CONSTRAINT "spam_account_scores_score_check" CHECK ("score" >= 0 AND "score" <= 100),
  CONSTRAINT "spam_account_scores_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "spam_account_scores_score_user_id_idx" ON "spam_account_scores"("score" DESC, "user_id");

COMMIT;
