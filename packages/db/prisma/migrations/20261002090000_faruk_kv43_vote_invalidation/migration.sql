-- KV-43 (#45) · Sahip: Faruk · Oy geçersiz sayma / geri alma (DATA_MODEL §5.4, admin.votes.*).
-- 1) vote_events.actor_id: INVALIDATE/RESTORE'u yapan yönetici. Audit tablosu (KV-39, Utku) gelene kadar "kim yaptı"
--    izi buradadır; olay append-only olduğu için değiştirilemez.
-- 2) polls.snapshots_stale_since: oy düzeltmesinden etkilenen günlük snapshot'lar bu andan itibaren yeniden üretilecek.
--    Worker (trends.refresh her 5 dk, snapshots.daily) üretip temizler.

-- AlterTable
ALTER TABLE "polls" ADD COLUMN     "snapshots_stale_since" TIMESTAMPTZ(3);

-- AlterTable
ALTER TABLE "vote_events" ADD COLUMN     "actor_id" UUID;

-- AddForeignKey
ALTER TABLE "vote_events" ADD CONSTRAINT "vote_events_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ─── ELLE: CHECK ───
-- INVALIDATE/RESTORE yetkili ve gerekçeli işlemdir: aktör ve gerekçe zorunlu. CAST/CHANGE'i oyu veren yapar (user_id),
-- aktör alanı boştur. NOT VALID: yeni satırlarda zorunlu; bu migration'dan önce test ortamlarında aktörsüz yazılmış
-- INVALIDATE satırları migration'ı kırmasın (üretimde geçersiz sayma işlemi bu migration'la gelir, eski satır yoktur).
ALTER TABLE "vote_events"
  ADD CONSTRAINT "vote_events_actor_check" CHECK (
    CASE
      WHEN "type" IN ('INVALIDATE', 'RESTORE') THEN "actor_id" IS NOT NULL AND "reason" IS NOT NULL
      ELSE "actor_id" IS NULL
    END
  ) NOT VALID;

-- Düzeltme bekleyen anketleri worker hızlı bulsun.
CREATE INDEX "polls_snapshots_stale_idx" ON "polls" ("snapshots_stale_since") WHERE "snapshots_stale_since" IS NOT NULL;
