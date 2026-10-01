-- #67 schema/migration hizalaması.
-- Growth şeması, çekirdek User modelini modül sahipliği dışında büyütmemek için user_id'leri scalar tutuyor.
-- Kullanıcı silme ürün akışında soft-delete; puan servisleri yalnız mevcut oturum kullanıcısı için yazar.
ALTER TABLE "point_accounts" DROP CONSTRAINT IF EXISTS "point_accounts_user_id_fkey";
ALTER TABLE "point_ledger_entries" DROP CONSTRAINT IF EXISTS "point_ledger_entries_user_id_fkey";

-- Append-only koruması ilk #67 migration'ındaki DB trigger'ında kalır.
-- Bu migration yalnız Prisma şeması ile fiziksel şemayı hizalar; güvenlik davranışını değiştirmez.
