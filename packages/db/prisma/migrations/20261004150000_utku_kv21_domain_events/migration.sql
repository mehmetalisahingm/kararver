-- ═══════════════════════════════════════════════════════════════════════
-- KV-21 (#23) PR-2 · Sahip: Utku · domain_events, domain_event_deliveries (olay outbox'ı)
-- 1. BÖLÜM: prisma migrate diff çıktısı (elle değiştirilmedi)
-- 2. BÖLÜM: Prisma schema'da ifade edilemeyen kısımlar (elle, en altta)
-- Açıklamalar: docs/KV-21_NOTIFICATIONS.md §5 · docs/DATA_MODEL.md §9.4
-- Dosya BEGIN; … COMMIT; ile sarılıdır: hata olursa hiçbir şey uygulanmaz (KV-48).
-- ═══════════════════════════════════════════════════════════════════════

BEGIN;
-- CreateEnum
CREATE TYPE "event_delivery_status" AS ENUM ('PENDING', 'DONE', 'DEAD');

-- CreateTable
CREATE TABLE "domain_events" (
    "id" UUID NOT NULL,
    "type" VARCHAR(64) NOT NULL,
    "version" SMALLINT NOT NULL,
    "occurred_at" TIMESTAMPTZ(3) NOT NULL,
    "actor_id" UUID,
    "subject_type" VARCHAR(20) NOT NULL,
    "subject_id" VARCHAR(100) NOT NULL,
    "payload" JSONB NOT NULL,
    "natural_key" VARCHAR(250),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "dispatched_at" TIMESTAMPTZ(3),
    "dispatch_error" VARCHAR(1000),

    CONSTRAINT "domain_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "domain_event_deliveries" (
    "event_id" UUID NOT NULL,
    "consumer" VARCHAR(64) NOT NULL,
    "status" "event_delivery_status" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "next_attempt_at" TIMESTAMPTZ(3) NOT NULL,
    "last_error" VARCHAR(1000),
    "processed_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "domain_event_deliveries_pkey" PRIMARY KEY ("event_id","consumer")
);

-- CreateIndex
CREATE UNIQUE INDEX "domain_events_natural_key_key" ON "domain_events"("natural_key");

-- AddForeignKey
ALTER TABLE "domain_event_deliveries" ADD CONSTRAINT "domain_event_deliveries_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "domain_events"("id") ON DELETE CASCADE ON UPDATE CASCADE;





-- ═══════════════════════════════════════════════════════════════════════
-- 2. BÖLÜM — ELLE EKLENENLER
-- Prisma bunları yönetmez ve sonraki migration'larda silmeye çalışmaz.
-- Bu dosya merge edildikten sonra değiştirilmez.
-- ═══════════════════════════════════════════════════════════════════════

-- ─── domain_events ───
-- Payload şeması, aktör kuralı ve konu tipinin olay tipine uygunluğu contracts parseEvent'tedir (writeEvent yazmadan
-- önce doğrular). DB yalnız biçimi zorlar.
ALTER TABLE "domain_events"
  ADD CONSTRAINT "domain_events_version_check"
    CHECK ("version" = 1),
  -- contracts eventTypes biçimi (ör. sanction.applied, poll.milestone).
  ADD CONSTRAINT "domain_events_type_check"
    CHECK ("type" ~ '^[a-z]+(\.[a-z][a-zA-Z]*)+$'),
  -- contracts EventSubjectType ile aynı küme.
  ADD CONSTRAINT "domain_events_subject_check"
    CHECK ("subject_type" IN ('USER', 'POLL', 'COMMENT', 'COMMUNITY', 'REPORT', 'ANNOUNCEMENT', 'SETTING') AND length("subject_id") > 0),
  ADD CONSTRAINT "domain_events_payload_object_check"
    CHECK (jsonb_typeof("payload") = 'object'),
  ADD CONSTRAINT "domain_events_natural_key_check"
    CHECK ("natural_key" IS NULL OR length("natural_key") > 0),
  -- Ayrıştırma hatası yalnız dağıtım denemesinde yazılır.
  ADD CONSTRAINT "domain_events_dispatch_error_check"
    CHECK ("dispatch_error" IS NULL OR "dispatched_at" IS NOT NULL);

-- ─── domain_event_deliveries ───
ALTER TABLE "domain_event_deliveries"
  -- contracts dedupeKey handler adı kuralı.
  ADD CONSTRAINT "domain_event_deliveries_consumer_check"
    CHECK ("consumer" ~ '^[a-z][a-z0-9.-]*$'),
  ADD CONSTRAINT "domain_event_deliveries_attempts_check"
    CHECK ("attempts" >= 0),
  -- DONE ⇔ işlenme anı dolu (saklama süresi bu andan sayılır).
  ADD CONSTRAINT "domain_event_deliveries_processed_check"
    CHECK (("status" = 'DONE') = ("processed_at" IS NOT NULL));

-- ─── Kuyruk index'leri ───
-- Partial index Prisma schema'sında yazılamaz (DATA_MODEL §10.4; emsal: notifications_unread_idx, KV-21 PR-1).
-- Dağıtma: dağıtılmamış olaylar, id (UUIDv7 ≈ zaman) sırasıyla.
CREATE INDEX "domain_events_undispatched_idx" ON "domain_events" ("id") WHERE "dispatched_at" IS NULL;
-- Saklama: dağıtılmış ve ayrıştırılabilmiş olaylar, dağıtım zamanıyla.
CREATE INDEX "domain_events_dispatched_at_idx" ON "domain_events" ("dispatched_at")
  WHERE "dispatched_at" IS NOT NULL AND "dispatch_error" IS NULL;
-- İşleme: vadesi gelen teslimler.
CREATE INDEX "domain_event_deliveries_due_idx" ON "domain_event_deliveries" ("next_attempt_at") WHERE "status" = 'PENDING';
-- İzleme: DEAD teslimler (az sayıda; elle yeniden kuyruğa alma).
CREATE INDEX "domain_event_deliveries_dead_idx" ON "domain_event_deliveries" ("event_id") WHERE "status" = 'DEAD';

-- ─── Zarf değişmezliği ───
-- Olay yazıldıktan sonra zarfı (kimlik, tip, zaman, aktör, konu, payload, doğal anahtar) değişmez; dağıtıcı yalnız
-- dispatched_at / dispatch_error'u doldurur. DELETE serbesttir: saklama işlenmiş olayları siler (§9.4).
CREATE FUNCTION kv_domain_events_immutable() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF (NEW."id", NEW."type", NEW."version", NEW."occurred_at", NEW."actor_id", NEW."subject_type", NEW."subject_id",
      NEW."payload", NEW."natural_key", NEW."created_at")
     IS DISTINCT FROM
     (OLD."id", OLD."type", OLD."version", OLD."occurred_at", OLD."actor_id", OLD."subject_type", OLD."subject_id",
      OLD."payload", OLD."natural_key", OLD."created_at") THEN
    RAISE EXCEPTION 'KV_DOMAIN_EVENTS_IMMUTABLE: olay zarfı değiştirilemez'
      USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER "domain_events_immutable"
  BEFORE UPDATE ON "domain_events"
  FOR EACH ROW EXECUTE FUNCTION kv_domain_events_immutable();

COMMIT;
