-- KV-17 (#19) · Sahip: Faruk · Yorum tepkileri (beğeni/dislike), comment_likes'ın yerine (API_CONTRACTS §6)
-- Prisma diff'i önce tabloyu siliyordu; burada sıra elle düzenlendi: önce yeni tablo, sonra mevcut
-- beğenilerin LIKE olarak kopyalanması, en son eski tablonun silinmesi. comment_likes'ı kullanan kod yoktu.

-- CreateEnum
CREATE TYPE "reaction_value" AS ENUM ('LIKE', 'DISLIKE');

-- AlterTable
ALTER TABLE "comments" ADD COLUMN     "dislike_count" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "comment_reactions" (
    "comment_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "value" "reaction_value" NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "comment_reactions_pkey" PRIMARY KEY ("comment_id","user_id")
);

-- CreateIndex
CREATE INDEX "comment_reactions_user_id_idx" ON "comment_reactions"("user_id");

-- AddForeignKey
ALTER TABLE "comment_reactions" ADD CONSTRAINT "comment_reactions_comment_id_fkey" FOREIGN KEY ("comment_id") REFERENCES "comments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "comment_reactions" ADD CONSTRAINT "comment_reactions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ─── ELLE: veri taşıma ───
INSERT INTO "comment_reactions" ("comment_id", "user_id", "value", "created_at", "updated_at")
SELECT "comment_id", "user_id", 'LIKE', "created_at", "created_at" FROM "comment_likes";

-- DropTable (FK'ler tabloyla birlikte düşer)
DROP TABLE "comment_likes";

-- ─── ELLE: CHECK ───
ALTER TABLE "comments"
  ADD CONSTRAINT "comments_dislike_count_check" CHECK ("dislike_count" >= 0);
