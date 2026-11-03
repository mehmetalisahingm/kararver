-- #185 kritik güvenlik alarmları, dilim 2.
-- (1) admin_access_denials: yönetici uçlarında (admin.*) reddedilen istekler (401/403), dakikalık sayaç. İstek başına satır
--     yoktur; aynı dakika + uç + durum + hesap tek satırda sayılır, bu yüzden istek seli tabloyu büyütmez. Veri minimizasyonu:
--     IP, cihaz, sorgu dizesi yok; hesap yalnız 403'te (oturumlu) tutulur, 401'de '*'. Saklama 30 gün (worker security.alerts
--     siler, contracts ADMIN_DENIAL_RETENTION_DAYS). Kural kaynağı: contracts security-alerts.ts (source: "denials").
-- (2) security_alerts onayı (admin.securityAlerts.ack): kim, ne zaman inceledi. Onay alarmı kapatmaz.
BEGIN;

CREATE TABLE "admin_access_denials" (
  "bucket" TIMESTAMPTZ(0) NOT NULL,
  "endpoint" VARCHAR(80) NOT NULL,
  "status" SMALLINT NOT NULL,
  "actor_key" VARCHAR(36) NOT NULL,
  "count" INTEGER NOT NULL DEFAULT 1,
  CONSTRAINT "admin_access_denials_pkey" PRIMARY KEY ("bucket", "endpoint", "status", "actor_key"),
  CONSTRAINT "admin_access_denials_status_check" CHECK ("status" IN (401, 403)),
  CONSTRAINT "admin_access_denials_count_check" CHECK ("count" > 0),
  CONSTRAINT "admin_access_denials_bucket_check" CHECK (date_trunc('minute', "bucket") = "bucket"),
  CONSTRAINT "admin_access_denials_actor_check" CHECK (
    "actor_key" = '*' OR "actor_key" ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'),
  CONSTRAINT "admin_access_denials_endpoint_check" CHECK ("endpoint" LIKE 'admin.%')
);
-- Pencere sayımı ve saklama temizliği zaman aralığıyla okur.
CREATE INDEX "admin_access_denials_bucket_idx" ON "admin_access_denials" ("bucket");

ALTER TABLE "security_alerts" ADD COLUMN "acknowledged_at" TIMESTAMPTZ(3);
ALTER TABLE "security_alerts" ADD COLUMN "acknowledged_by_id" UUID;
ALTER TABLE "security_alerts" ADD CONSTRAINT "security_alerts_acknowledged_by_id_fkey"
  FOREIGN KEY ("acknowledged_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "security_alerts" ADD CONSTRAINT "security_alerts_ack_check"
  CHECK (("acknowledged_at" IS NULL) = ("acknowledged_by_id" IS NULL));

COMMIT;
