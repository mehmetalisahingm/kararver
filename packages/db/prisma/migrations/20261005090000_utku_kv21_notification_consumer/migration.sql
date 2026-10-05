-- ═══════════════════════════════════════════════════════════════════════
-- KV-21 (#23) PR-3 · Sahip: Utku · notifications: SANCTION_APPLIED ve saklama index'i
-- 1. BÖLÜM: prisma migrate diff çıktısı (elle değiştirilmedi)
-- 2. BÖLÜM: Prisma schema'da ifade edilemeyen kısımlar (elle, en altta)
-- Açıklamalar: docs/KV-21_NOTIFICATIONS.md §6 · docs/DATA_MODEL.md §9.3
-- Dosya BEGIN; … COMMIT; ile sarılıdır: hata olursa hiçbir şey uygulanmaz (KV-48). PostgreSQL 12+ ALTER TYPE … ADD VALUE'yu
-- transaction içinde çalıştırır; yeni değer bu transaction'da kullanılmaz.
-- ═══════════════════════════════════════════════════════════════════════

BEGIN;

-- AlterEnum
ALTER TYPE "notification_type" ADD VALUE 'SANCTION_APPLIED';




-- ═══════════════════════════════════════════════════════════════════════
-- 2. BÖLÜM — ELLE EKLENENLER
-- Prisma bunları yönetmez ve sonraki migration'larda silmeye çalışmaz.
-- Bu dosya merge edildikten sonra değiştirilmez.
-- ═══════════════════════════════════════════════════════════════════════

-- ─── notifications saklaması ───
-- Okunmuş bildirim 90 gün sonra silinir (worker notifications.cleanup). Partial index Prisma schema'sında yazılamaz
-- (DATA_MODEL §10.4; emsal: notifications_unread_idx). Silinmiş hesabın bildirimleri recipient_id index'iyle silinir.
CREATE INDEX "notifications_read_at_idx" ON "notifications" ("read_at") WHERE "read_at" IS NOT NULL;

COMMIT;
