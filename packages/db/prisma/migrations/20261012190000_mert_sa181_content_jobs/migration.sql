-- #181 kullanıcıya ait içeriğin toplu gizlenmesi/kaldırılması: önizleme → gerekçe → ayrı onay → kuyruk. İş ve öğe kayıtları
-- geri almanın (UNDO) tek kaynağıdır: hangi içerik hangi durumdan hangi duruma, hangi sonuçla geçti.
BEGIN;

CREATE TYPE "content_job_kind" AS ENUM ('HIDE', 'REMOVE', 'UNDO');
CREATE TYPE "content_job_status" AS ENUM ('QUEUED', 'PROCESSING', 'DONE', 'FAILED', 'CANCELLED');
CREATE TYPE "content_job_item_result" AS ENUM ('APPLIED', 'UNCHANGED', 'FAILED', 'SKIPPED');

CREATE TABLE "content_jobs" (
  "id" UUID NOT NULL,
  "user_id" UUID NOT NULL,
  "requested_by_id" UUID NOT NULL,
  "kind" "content_job_kind" NOT NULL,
  "status" "content_job_status" NOT NULL DEFAULT 'QUEUED',
  "reason" VARCHAR(500) NOT NULL,
  "include_polls" BOOLEAN NOT NULL,
  "include_comments" BOOLEAN NOT NULL,
  -- Yalnız bu andan önce oluşturulan içerik işlenir: önizleme ile işlem arasında yazılan yeni içerik etkilenmez.
  "cutoff_at" TIMESTAMPTZ(3) NOT NULL,
  "expected_polls" INTEGER NOT NULL DEFAULT 0,
  "expected_comments" INTEGER NOT NULL DEFAULT 0,
  "undo_of_id" UUID,
  "applied" INTEGER NOT NULL DEFAULT 0,
  "unchanged" INTEGER NOT NULL DEFAULT 0,
  "failed" INTEGER NOT NULL DEFAULT 0,
  "skipped" INTEGER NOT NULL DEFAULT 0,
  "failure" VARCHAR(60),
  "claimed_at" TIMESTAMPTZ(3),
  "started_at" TIMESTAMPTZ(3),
  "finished_at" TIMESTAMPTZ(3),
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "content_jobs_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "content_jobs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "content_jobs_requested_by_id_fkey" FOREIGN KEY ("requested_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "content_jobs_undo_of_id_fkey" FOREIGN KEY ("undo_of_id") REFERENCES "content_jobs"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  -- Bir işin en çok bir geri alması olur (çift geri alma yok).
  CONSTRAINT "content_jobs_undo_of_id_key" UNIQUE ("undo_of_id"),
  CONSTRAINT "content_jobs_undo_shape_check" CHECK (("kind" = 'UNDO') = ("undo_of_id" IS NOT NULL)),
  CONSTRAINT "content_jobs_scope_check" CHECK ("include_polls" OR "include_comments"),
  CONSTRAINT "content_jobs_counts_check" CHECK (
    "expected_polls" >= 0 AND "expected_comments" >= 0 AND "applied" >= 0 AND "unchanged" >= 0 AND "failed" >= 0 AND "skipped" >= 0
  ),
  CONSTRAINT "content_jobs_reason_check" CHECK (length(btrim("reason")) >= 3)
);

-- Hesap başına en çok bir açık iş: eşzamanlı iki onay yarışırsa yalnız biri yazılır.
CREATE UNIQUE INDEX "content_jobs_one_open_per_user_key" ON "content_jobs"("user_id") WHERE "status" IN ('QUEUED', 'PROCESSING');
CREATE INDEX "content_jobs_user_id_created_at_idx" ON "content_jobs"("user_id", "created_at" DESC);
CREATE INDEX "content_jobs_status_created_at_idx" ON "content_jobs"("status", "created_at");

CREATE TABLE "content_job_items" (
  "job_id" UUID NOT NULL,
  "target_type" VARCHAR(10) NOT NULL,
  "target_id" UUID NOT NULL,
  "from_status" VARCHAR(20),
  "to_status" VARCHAR(20),
  "result" "content_job_item_result" NOT NULL,
  "detail" VARCHAR(60),
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "content_job_items_pkey" PRIMARY KEY ("job_id", "target_type", "target_id"),
  CONSTRAINT "content_job_items_job_id_fkey" FOREIGN KEY ("job_id") REFERENCES "content_jobs"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "content_job_items_target_type_check" CHECK ("target_type" IN ('POLL', 'COMMENT'))
);

COMMIT;
