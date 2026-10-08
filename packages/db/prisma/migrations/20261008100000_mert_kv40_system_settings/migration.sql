-- KV-40 (#42): system_settings. Yalnız yeni tablo (expand): önceki uygulama sürümüyle uyumlu.
BEGIN;

-- CreateTable
CREATE TABLE "system_settings" (
    "key" VARCHAR(80) NOT NULL,
    "value" JSONB NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "updated_by_id" UUID,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "system_settings_pkey" PRIMARY KEY ("key")
);

-- AddForeignKey
ALTER TABLE "system_settings" ADD CONSTRAINT "system_settings_updated_by_id_fkey" FOREIGN KEY ("updated_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Elle: anahtar biçimi (contracts Setting.key ile aynı) ve sürüm alt sınırı
ALTER TABLE "system_settings"
  ADD CONSTRAINT "system_settings_key_check" CHECK ("key" ~ '^[a-z]+(\.[a-zA-Z]+)+$'),
  ADD CONSTRAINT "system_settings_version_check" CHECK ("version" >= 1);

COMMIT;
