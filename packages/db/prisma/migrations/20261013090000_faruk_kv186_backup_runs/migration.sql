-- KV-186 (#186) operasyon merkezi: başarılı veritabanı yedeklerinin kaydı. `db:backup` (KV-48) döküm ve manifest
-- yazıldıktan sonra bir satır ekler; /admin/ops "son yedek" alanını buradan okur. Dosya yolu, bucket adresi ya da
-- bağlantı bilgisi tutulmaz: yalnız hedef etiketi (ör. "local", "r2"), boyut, sha256 ve süre.
BEGIN;

CREATE TABLE "ops_backup_runs" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "finished_at" TIMESTAMPTZ(3) NOT NULL,
  "destination" VARCHAR(40) NOT NULL,
  "size_bytes" BIGINT NOT NULL,
  "sha256" CHAR(64) NOT NULL,
  "duration_ms" INTEGER NOT NULL,
  "server_version" VARCHAR(40) NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ops_backup_runs_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ops_backup_runs_destination_check" CHECK ("destination" ~ '^[a-z0-9][a-z0-9_-]{0,39}$'),
  CONSTRAINT "ops_backup_runs_sha256_check" CHECK ("sha256" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "ops_backup_runs_size_check" CHECK ("size_bytes" > 0 AND "duration_ms" >= 0)
);

CREATE INDEX "ops_backup_runs_finished_at_idx" ON "ops_backup_runs"("finished_at" DESC);

COMMIT;
