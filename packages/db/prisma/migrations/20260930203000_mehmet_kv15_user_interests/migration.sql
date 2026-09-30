-- KV-15 (#17) ilgi alanı / onboarding veri temeli.
-- user_interests Mehmet'in growth.prisma tablosudur; KV-27 (#29) "Senin İçin" feed'i bu tabloyu okur.
-- Kullanıcı silinirse tercihler de silinir; kategori hard-delete edilmez/pasife alınır, bu yüzden RESTRICT.
--
-- Açık KV-27 dalıyla şema çakışmasını azaltmak için o dalın ihtiyaç duyduğu iki salt-okuma index'i de
-- burada açılır. Faruk #95'i bu migration üzerine rebase ettiğinde kendi duplicate migration'ını düşürmelidir.

CREATE TABLE "user_interests" (
    "user_id" UUID NOT NULL,
    "category_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "user_interests_pkey" PRIMARY KEY ("user_id", "category_id")
);

CREATE INDEX "user_interests_category_id_idx" ON "user_interests"("category_id");
CREATE INDEX "polls_opens_at_id_idx" ON "polls"("opens_at" DESC, "id" DESC);
CREATE INDEX "votes_poll_id_created_at_invalidated_at_idx" ON "votes"("poll_id", "created_at", "invalidated_at");

ALTER TABLE "user_interests"
  ADD CONSTRAINT "user_interests_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "user_interests"
  ADD CONSTRAINT "user_interests_category_id_fkey"
  FOREIGN KEY ("category_id") REFERENCES "categories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
