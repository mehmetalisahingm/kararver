-- #66 · Sahip: Faruk · Anketsiz tartışma gönderileri ve gönderi beğeni/dislike'ı (V1_USER_FLOW, API_CONTRACTS §6).
-- Mevcut veri korunur: bütün mevcut satırlar kind = 'POLL' olur, süre ve sonuç görünürlüğü dolu kalır.

-- CreateEnum
CREATE TYPE "poll_kind" AS ENUM ('POLL', 'DISCUSSION');

-- AlterTable
ALTER TABLE "polls" ADD COLUMN     "dislike_count" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "kind" "poll_kind" NOT NULL DEFAULT 'POLL',
ADD COLUMN     "like_count" INTEGER NOT NULL DEFAULT 0,
ALTER COLUMN "results_visibility" DROP NOT NULL,
ALTER COLUMN "closes_at" DROP NOT NULL;

-- CreateTable
CREATE TABLE "poll_reactions" (
    "poll_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "value" "reaction_value" NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "poll_reactions_pkey" PRIMARY KEY ("poll_id","user_id")
);

-- CreateIndex
CREATE INDEX "poll_reactions_user_id_idx" ON "poll_reactions"("user_id");

-- AddForeignKey
ALTER TABLE "poll_reactions" ADD CONSTRAINT "poll_reactions_poll_id_fkey" FOREIGN KEY ("poll_id") REFERENCES "polls"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "poll_reactions" ADD CONSTRAINT "poll_reactions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ─── ELLE: CHECK ───
-- Anket: süre ve sonuç görünürlüğü zorunlu. Tartışma: süresiz, kapanmaz, sonucu yoktur.
ALTER TABLE "polls"
  ADD CONSTRAINT "polls_kind_shape_check" CHECK (
    ("kind" = 'POLL' AND "closes_at" IS NOT NULL AND "results_visibility" IS NOT NULL)
    OR ("kind" = 'DISCUSSION' AND "closes_at" IS NULL AND "results_visibility" IS NULL AND "closed_at" IS NULL)
  ),
  ADD CONSTRAINT "polls_reaction_counts_check" CHECK ("like_count" >= 0 AND "dislike_count" >= 0);

-- ─── ELLE: trigger'lar ───
-- Tür sonradan değişmez (seçenek/oy/sonuç tutarlılığı). Kod hatasıdır → INTERNAL_ERROR.
CREATE FUNCTION kv_polls_kind_immutable() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."kind" <> OLD."kind" THEN
    RAISE EXCEPTION 'KV_POLL_KIND_IMMUTABLE: gönderi türü değiştirilemez (poll %)', OLD."id" USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER "polls_kind_immutable"
  BEFORE UPDATE OF "kind" ON "polls"
  FOR EACH ROW EXECUTE FUNCTION kv_polls_kind_immutable();

-- Tartışmaya seçenek ve oy yazılamaz (API önce 409 NOT_A_POLL döner; bu, API'yi atlayan yazmaları da reddeder).
-- Trigger adları alfabetik sırada önce çalışacak şekilde seçildi: tartışmada sahibin oyu KV_SELF_VOTE değil
-- KV_NOT_A_POLL alır (sözleşmedeki hata sırası: NOT_A_POLL, SELF_VOTE_FORBIDDEN, ...).
CREATE FUNCTION kv_require_poll_kind() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM "polls" WHERE "id" = NEW."poll_id" AND "kind" <> 'POLL') THEN
    RAISE EXCEPTION 'KV_NOT_A_POLL: tartışma gönderisinde seçenek ve oy yoktur (poll %)', NEW."poll_id" USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER "votes_check_kind"
  BEFORE INSERT ON "votes"
  FOR EACH ROW EXECUTE FUNCTION kv_require_poll_kind();

CREATE TRIGGER "poll_options_check_kind"
  BEFORE INSERT ON "poll_options"
  FOR EACH ROW EXECUTE FUNCTION kv_require_poll_kind();
