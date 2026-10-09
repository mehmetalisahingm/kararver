-- ═══════════════════════════════════════════════════════════════════════
-- KV-21 (#23) PR-4a · Sahip: Utku · domain_events: süre dolumu olayı index'i
-- 1. BÖLÜM: prisma migrate diff çıktısı yok (schema değişmedi)
-- 2. BÖLÜM: Prisma schema'da ifade edilemeyen kısımlar (elle)
-- Açıklamalar: docs/KV-21_NOTIFICATIONS.md §7 · docs/DATA_MODEL.md §9.4
-- Dosya BEGIN; … COMMIT; ile sarılıdır: hata olursa hiçbir şey uygulanmaz (KV-48).
-- ═══════════════════════════════════════════════════════════════════════

BEGIN;

-- ═══════════════════════════════════════════════════════════════════════
-- 2. BÖLÜM — ELLE EKLENENLER
-- Prisma bunları yönetmez ve sonraki migration'larda silmeye çalışmaz.
-- Bu dosya merge edildikten sonra değiştirilmez.
-- ═══════════════════════════════════════════════════════════════════════

-- ─── polls.expire alt sınırı ───
-- Worker polls.expire her dakika en eski süre dolumu olayını (poll.closed, aktör NULL) okur: deploy öncesi kapanışlar
-- olay üretmesin diye adayların alt sınırıdır. Partial index (DATA_MODEL §10.4): yalnız bu satırlar, min() anında.
CREATE INDEX "domain_events_poll_expired_idx" ON "domain_events" ("occurred_at")
  WHERE "type" = 'poll.closed' AND "actor_id" IS NULL;

COMMIT;
