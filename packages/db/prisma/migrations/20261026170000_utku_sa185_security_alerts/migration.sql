-- #185 kritik güvenlik alarmları (dilim 1). Worker security.alerts audit_logs'u kurallara göre tarar
-- (contracts security-alerts.ts) ve eşik aşılınca alarm açar. Aynı kural ve kapsam (aktör kimliği ya da '*') için en
-- fazla bir açık alarm vardır (kısmi UNIQUE): tekrar çalışan job yeni alarm ya da bildirim üretmez. Durum sürerse
-- last_seen_at ve peak_count güncellenir; sayı eşiğin altına inince RESOLVED olur. Kişisel veri yok (kural, kapsam, sayı).
-- Açılış olayı security.alert.opened → SECURITY_ALERT bildirimi (yalnız SUPER_ADMIN, kapatılamaz).
BEGIN;

CREATE TABLE "security_alerts" (
  "id" UUID NOT NULL,
  "rule" VARCHAR(60) NOT NULL,
  "severity" VARCHAR(10) NOT NULL,
  "scope_key" VARCHAR(64) NOT NULL,
  "status" VARCHAR(10) NOT NULL DEFAULT 'OPEN',
  "peak_count" INTEGER NOT NULL,
  "opened_at" TIMESTAMPTZ(3) NOT NULL,
  "last_seen_at" TIMESTAMPTZ(3) NOT NULL,
  "resolved_at" TIMESTAMPTZ(3),
  CONSTRAINT "security_alerts_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "security_alerts_severity_check" CHECK ("severity" IN ('HIGH', 'CRITICAL')),
  CONSTRAINT "security_alerts_status_check" CHECK ("status" IN ('OPEN', 'RESOLVED')),
  CONSTRAINT "security_alerts_resolved_check" CHECK (("status" = 'RESOLVED') = ("resolved_at" IS NOT NULL)),
  CONSTRAINT "security_alerts_peak_check" CHECK ("peak_count" > 0),
  CONSTRAINT "security_alerts_seen_check" CHECK ("last_seen_at" >= "opened_at")
);
-- Kural + kapsam başına tek açık alarm (idempotent açılış).
CREATE UNIQUE INDEX "security_alerts_open_key" ON "security_alerts" ("rule", "scope_key") WHERE "status" = 'OPEN';
-- Ops paneli: açıklar ve son 24 saatte kapananlar, en yeni önce.
CREATE INDEX "security_alerts_status_opened_at_idx" ON "security_alerts" ("status", "opened_at" DESC);

ALTER TYPE "notification_type" ADD VALUE IF NOT EXISTS 'SECURITY_ALERT';

ALTER TABLE "notifications" DROP CONSTRAINT "notifications_subject_type_check";
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_subject_type_check"
  CHECK ("subject_type" IN ('POLL', 'COMMENT', 'COMMUNITY', 'USER', 'ANNOUNCEMENT', 'SECURITY_ALERT'));

ALTER TABLE "domain_events" DROP CONSTRAINT "domain_events_subject_check";
ALTER TABLE "domain_events" ADD CONSTRAINT "domain_events_subject_check"
  CHECK ("subject_type" IN ('USER', 'POLL', 'COMMENT', 'COMMUNITY', 'REPORT', 'ANNOUNCEMENT', 'SETTING', 'SECURITY_ALERT') AND length("subject_id") > 0);

COMMIT;
