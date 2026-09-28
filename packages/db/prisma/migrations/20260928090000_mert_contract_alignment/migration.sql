-- ═══════════════════════════════════════════════════════════════════════
-- KV-16 / KV-24 · Sahip: Mert · Enum değerlerini API sözleşmesine hizalar (KV-03)
-- Açıklamalar: docs/DATA_MODEL.md §9, packages/contracts/src/domains/{media,moderation}.ts
--
-- İstisna: Bu dosya `prisma migrate diff` çıktısı değildir. Prisma değer adlandırmayı
-- "yeni tip oluştur + ::text cast + eskisini sil" olarak üretir; bu, eski değerle yazılmış
-- bir satır varsa başarısız olur. RENAME VALUE veriyi korur. Yeni değerler schema'daki
-- sırayla (AFTER) eklenir. Sonucun schema ile aynı olduğunu `pnpm db:test` içindeki
-- "schema ile veritabanı arasında fark yok" testi doğrular.
-- ═══════════════════════════════════════════════════════════════════════

-- media_purpose: sözleşmedeki MediaPurpose adları
ALTER TYPE "media_purpose" RENAME VALUE 'POLL_IMAGE' TO 'POLL';
ALTER TYPE "media_purpose" RENAME VALUE 'COMMUNITY_IMAGE' TO 'COMMUNITY';

-- report_reason: sözleşmedeki ReportReason adı
ALTER TYPE "report_reason" RENAME VALUE 'HATE_SPEECH' TO 'HATE';

-- moderation_action_type: medya reddi ve trend dışı bırakma işlemleri
ALTER TYPE "moderation_action_type" ADD VALUE 'REJECT' AFTER 'APPROVE';
ALTER TYPE "moderation_action_type" ADD VALUE 'EXCLUDE_FROM_TRENDS' AFTER 'UNLOCK';
ALTER TYPE "moderation_action_type" ADD VALUE 'INCLUDE_IN_TRENDS' AFTER 'EXCLUDE_FROM_TRENDS';
