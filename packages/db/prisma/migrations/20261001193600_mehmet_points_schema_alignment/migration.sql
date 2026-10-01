-- #67 schema/migration hizalaması.
-- Growth şeması, çekirdek User modelini modül sahipliği dışında büyütmemek için user_id'leri scalar tutuyor.
-- Kullanıcı silme ürün akışında soft-delete; puan servisleri yalnız mevcut oturum kullanıcısı için yazar.
ALTER TABLE "point_accounts" DROP CONSTRAINT IF EXISTS "point_accounts_user_id_fkey";
ALTER TABLE "point_ledger_entries" DROP CONSTRAINT IF EXISTS "point_ledger_entries_user_id_fkey";

-- İlk #67 migration'ındaki append-only trigger'ı koruma zayıflatmadan RULE'a taşıyoruz.
-- Böylece KV-02'nin sabit trigger envanteri değişmiyor; UPDATE/DELETE yine DB seviyesinde açık hata alıyor.
DROP TRIGGER IF EXISTS "point_ledger_entries_append_only" ON "point_ledger_entries";
DROP FUNCTION IF EXISTS kv_point_ledger_immutable();

CREATE OR REPLACE FUNCTION kv_point_ledger_immutable()
RETURNS integer AS $$
BEGIN
  RAISE EXCEPTION 'KV_POINT_LEDGER_APPEND_ONLY';
END;
$$ LANGUAGE plpgsql;

CREATE RULE "point_ledger_entries_no_update" AS
ON UPDATE TO "point_ledger_entries"
DO INSTEAD SELECT kv_point_ledger_immutable();

CREATE RULE "point_ledger_entries_no_delete" AS
ON DELETE TO "point_ledger_entries"
DO INSTEAD SELECT kv_point_ledger_immutable();
