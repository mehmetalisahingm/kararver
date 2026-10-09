-- KV-37 (#39): gelişmiş admin içerik işlemleri.
-- 1) polls.comments_closed_at: yalnız yorumları moderasyonla kapatma (oy açık kalır).
-- 2) moderation_action_type: CLOSE_COMMENTS, OPEN_COMMENTS, MOVE (kategori/topluluk taşıma), SANCTION_USER.
-- 3) Yönetici yorum aramasının trigram index'i (anket başlığı için polls_title_search_idx zaten var).

BEGIN;

-- AlterEnum
ALTER TYPE "moderation_action_type" ADD VALUE 'CLOSE_COMMENTS';
ALTER TYPE "moderation_action_type" ADD VALUE 'OPEN_COMMENTS';
ALTER TYPE "moderation_action_type" ADD VALUE 'MOVE';
ALTER TYPE "moderation_action_type" ADD VALUE 'SANCTION_USER';

-- AlterTable
ALTER TABLE "polls" ADD COLUMN "comments_closed_at" TIMESTAMPTZ(3);

-- Elle: kv_normalize ifade index'i (docs/KV-26_CATEGORIES_SEARCH.md ile aynı kalıp)
CREATE INDEX "comments_body_trgm_idx" ON "comments" USING gin (kv_normalize("body") gin_trgm_ops);

COMMIT;
