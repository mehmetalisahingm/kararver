-- KV-28 (#30) trend motoru.
-- 1) polls.trend_excluded_at: doluysa anket algoritmik trend listelerine girmez. Yazan: EXCLUDE_FROM_TRENDS /
--    INCLUDE_IN_TRENDS moderasyon işlemi (KV-37, #39, Mert). Görünürlüğü etkilemez.
-- 2) votes (created_at), comments (created_at): trend pencereleri (son 24 saat / 7 gün) aralık taraması.

-- AlterTable
ALTER TABLE "polls" ADD COLUMN     "trend_excluded_at" TIMESTAMPTZ(3);

-- CreateIndex
CREATE INDEX "comments_created_at_idx" ON "comments"("created_at");

-- CreateIndex
CREATE INDEX "votes_created_at_idx" ON "votes"("created_at");
