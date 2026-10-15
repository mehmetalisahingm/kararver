-- #183 toplu moderasyon: parti kaydı (özet) ve parti öğeleri. İçerik başına gerçek karar moderation_actions + audit + olayda kalır;
-- bu tablolar toplu işlemin geçmişini, sonucunu ve (sonraki dilimde) güvenli geri almanın hedefini tutar.
BEGIN;

CREATE TYPE "moderation_batch_kind" AS ENUM ('POLLS', 'COMMENTS');
CREATE TYPE "moderation_batch_item_result" AS ENUM ('APPLIED', 'UNCHANGED', 'FAILED');

CREATE TABLE "moderation_batches" (
  "id" UUID NOT NULL,
  "actor_id" UUID NOT NULL,
  "kind" "moderation_batch_kind" NOT NULL,
  "action" "moderation_action_type" NOT NULL,
  "reason" VARCHAR(500) NOT NULL,
  "digest" CHAR(64) NOT NULL,
  "request_id" UUID,
  "total" INTEGER NOT NULL,
  "applied" INTEGER NOT NULL DEFAULT 0,
  "unchanged" INTEGER NOT NULL DEFAULT 0,
  "failed" INTEGER NOT NULL DEFAULT 0,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "finished_at" TIMESTAMPTZ(3),
  CONSTRAINT "moderation_batches_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "moderation_batches_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  -- Toplu işlem yalnız görünürlük kararlarıdır.
  CONSTRAINT "moderation_batches_action_check" CHECK ("action" IN ('HIDE', 'REMOVE', 'RESTORE')),
  CONSTRAINT "moderation_batches_reason_check" CHECK (length(btrim("reason")) >= 3),
  CONSTRAINT "moderation_batches_counts_check" CHECK (
    "total" BETWEEN 1 AND 50 AND "applied" >= 0 AND "unchanged" >= 0 AND "failed" >= 0
    AND "applied" + "unchanged" + "failed" <= "total"
  ),
  -- Bitmiş partide sayılar toplamı eksiksiz tutar.
  CONSTRAINT "moderation_batches_finished_check" CHECK ("finished_at" IS NULL OR "applied" + "unchanged" + "failed" = "total")
);
CREATE INDEX "moderation_batches_actor_id_created_at_idx" ON "moderation_batches"("actor_id", "created_at" DESC);
CREATE INDEX "moderation_batches_created_at_idx" ON "moderation_batches"("created_at" DESC);

CREATE TABLE "moderation_batch_items" (
  "batch_id" UUID NOT NULL,
  "target_id" UUID NOT NULL,
  "community_id" UUID,
  "result" "moderation_batch_item_result" NOT NULL,
  "detail" VARCHAR(40),
  "from_status" VARCHAR(20),
  "to_status" VARCHAR(20),
  "moderation_action_id" UUID,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "moderation_batch_items_pkey" PRIMARY KEY ("batch_id", "target_id"),
  CONSTRAINT "moderation_batch_items_batch_id_fkey" FOREIGN KEY ("batch_id") REFERENCES "moderation_batches"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "moderation_batch_items_moderation_action_id_fkey" FOREIGN KEY ("moderation_action_id") REFERENCES "moderation_actions"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  -- Karar kaydı yalnız uygulanmış öğede; başarısız öğe neden taşır.
  CONSTRAINT "moderation_batch_items_result_check" CHECK (
    ("result" = 'APPLIED' AND "moderation_action_id" IS NOT NULL AND "detail" IS NULL)
    OR ("result" = 'UNCHANGED' AND "moderation_action_id" IS NULL AND "detail" IS NULL)
    OR ("result" = 'FAILED' AND "moderation_action_id" IS NULL AND "detail" IS NOT NULL)
  )
);
CREATE INDEX "moderation_batch_items_target_id_created_at_idx" ON "moderation_batch_items"("target_id", "created_at");

COMMIT;
