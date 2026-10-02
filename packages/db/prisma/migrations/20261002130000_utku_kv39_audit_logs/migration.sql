-- ═══════════════════════════════════════════════════════════════════════
-- KV-39 (#41) · Sahip: Utku · audit_logs
-- 1. BÖLÜM: prisma migrate diff çıktısı (elle değiştirilmedi)
-- 2. BÖLÜM: Prisma schema'da ifade edilemeyen kısımlar (elle, en altta)
-- Açıklamalar: docs/DATA_MODEL.md §9.2 · Sözleşme: packages/contracts/src/audit.ts
-- ═══════════════════════════════════════════════════════════════════════

-- CreateEnum
CREATE TYPE "audit_source" AS ENUM ('API', 'CLI', 'WORKER');

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" UUID NOT NULL,
    "actor_id" UUID,
    "source" "audit_source" NOT NULL,
    "action" VARCHAR(80) NOT NULL,
    "operation" VARCHAR(40) NOT NULL,
    "target_type" VARCHAR(40) NOT NULL,
    "target_id" VARCHAR(64) NOT NULL,
    "reason" VARCHAR(500),
    "before" JSONB,
    "after" JSONB,
    "request_id" VARCHAR(128),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "audit_logs_target_type_target_id_created_at_idx" ON "audit_logs"("target_type", "target_id", "created_at");

-- CreateIndex
CREATE INDEX "audit_logs_actor_id_created_at_idx" ON "audit_logs"("actor_id", "created_at");

-- CreateIndex
CREATE INDEX "audit_logs_action_operation_created_at_idx" ON "audit_logs"("action", "operation", "created_at");

-- CreateIndex
CREATE INDEX "audit_logs_created_at_idx" ON "audit_logs"("created_at");

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;



-- ═══════════════════════════════════════════════════════════════════════
-- 2. BÖLÜM — ELLE EKLENENLER
-- Prisma bunları yönetmez ve sonraki migration'larda silmeye çalışmaz.
-- Bu dosya merge edildikten sonra değiştirilmez.
-- ═══════════════════════════════════════════════════════════════════════

-- ─── audit_logs ───
-- Hangi işlemin gerekçe istediği, izinli operation değerleri ve hassas alan yasağı işleme bağlıdır;
-- DB bunları bilemez, contracts assertAuditEntry zorlar. DB yalnız biçimi ve aktör/kaynak tutarlılığını zorlar.
ALTER TABLE "audit_logs"
  -- API kaydının aktörü vardır; CLI/worker kaydı aktörsüzdür (actor_id NULL = sistem).
  ADD CONSTRAINT "audit_logs_actor_source_check"
    CHECK (("source" = 'API') = ("actor_id" IS NOT NULL)),
  -- API kaydı istekle (X-Request-Id) eşlenir.
  ADD CONSTRAINT "audit_logs_request_id_check"
    CHECK (("source" <> 'API' OR "request_id" IS NOT NULL) AND ("request_id" IS NULL OR length("request_id") > 0)),
  -- KV-04 işlem kimliği biçimi (ör. user.sanction.lift, account.verifyEmail, user.status.sync).
  ADD CONSTRAINT "audit_logs_action_check"
    CHECK ("action" ~ '^[a-z]+(\.[a-z][a-zA-Z]*)+$'),
  ADD CONSTRAINT "audit_logs_operation_check"
    CHECK ("operation" ~ '^[a-z][a-z_]*$'),
  ADD CONSTRAINT "audit_logs_target_check"
    CHECK ("target_type" ~ '^[A-Z][A-Z_]*$' AND length("target_id") > 0),
  -- Gerekçe varsa sanctions ile aynı kural: en az 3 anlamlı karakter.
  ADD CONSTRAINT "audit_logs_reason_check"
    CHECK ("reason" IS NULL OR length(btrim("reason")) >= 3),
  -- Özet ya yoktur (SQL NULL) ya bir JSON nesnesidir.
  ADD CONSTRAINT "audit_logs_summary_check"
    CHECK (("before" IS NULL OR jsonb_typeof("before") = 'object') AND ("after" IS NULL OR jsonb_typeof("after") = 'object'));

-- ─── Audit append-only ───
-- Kimse (SUPER_ADMIN ve uygulama dahil) audit kaydını silemez veya değiştiremez (FOUNDATION yetki matrisi).
-- Satır trigger'ı UPDATE/DELETE'i, statement trigger'ı TRUNCATE'i reddeder. Test veritabanı sıfırlaması
-- (prisma migrate reset) tabloyu düşürür, TRUNCATE kullanmaz.
CREATE FUNCTION kv_audit_logs_append_only() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'KV_AUDIT_LOGS_APPEND_ONLY: audit kaydı değiştirilemez veya silinemez (%)', TG_OP
    USING ERRCODE = 'P0001';
END $$;

CREATE TRIGGER "audit_logs_append_only"
  BEFORE UPDATE OR DELETE ON "audit_logs"
  FOR EACH ROW EXECUTE FUNCTION kv_audit_logs_append_only();

CREATE TRIGGER "audit_logs_no_truncate"
  BEFORE TRUNCATE ON "audit_logs"
  FOR EACH STATEMENT EXECUTE FUNCTION kv_audit_logs_append_only();
