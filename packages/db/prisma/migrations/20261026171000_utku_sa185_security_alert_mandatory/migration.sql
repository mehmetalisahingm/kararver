-- #185 SECURITY_ALERT kapatılamaz (contracts MANDATORY_NOTIFICATION_TYPES): tercih satırı yazılamaz. Ayrı dosyada:
-- PostgreSQL yeni enum değerinin, eklendiği transaction içinde kullanılmasına izin vermez (değer 20261026170000'de eklendi).
BEGIN;

ALTER TABLE "notification_type_opt_outs" DROP CONSTRAINT "notification_type_opt_outs_mandatory_check";
ALTER TABLE "notification_type_opt_outs" ADD CONSTRAINT "notification_type_opt_outs_mandatory_check"
  CHECK ("type" NOT IN ('MODERATION_APPLIED', 'SANCTION_APPLIED', 'SECURITY_ALERT'));

COMMIT;
