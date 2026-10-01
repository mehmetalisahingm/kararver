-- KV-22 (#24) · Mehmet · private bookmarks
-- User/Poll çekirdek modelleri başka modül sahibi olduğu için bookmark ilişkileri Prisma'da scalar tutulur.
-- Uygulama yalnız görünür mevcut poll/user kimlikleriyle yazar; proje içerik/hesap silmeyi soft-delete ile yapar.
CREATE TABLE "bookmarks" (
    "user_id" UUID NOT NULL,
    "poll_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "bookmarks_pkey" PRIMARY KEY ("user_id", "poll_id")
);

CREATE INDEX "bookmarks_user_id_created_at_poll_id_idx"
    ON "bookmarks"("user_id", "created_at" DESC, "poll_id" DESC);
CREATE INDEX "bookmarks_poll_id_idx" ON "bookmarks"("poll_id");
