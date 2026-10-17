-- #183 tekil moderasyon kararının geri alınması. Telafi kararı moderation_actions'a YENİ satır olarak eklenir ve geri aldığı kararı
-- gösterir (undo_of_id); eski satırlar değişmez (tablo append-only, UPDATE/DELETE tetikleyicisi yerinde). UNIQUE: bir karar en çok bir
-- kez geri alınır (eşzamanlı iki geri alma yarışında ikincisi veritabanında da reddedilir). Geri almanın geri alması uygulama
-- katmanında engellidir (undo_of_id dolu satır geri alınamaz).
BEGIN;

ALTER TABLE "moderation_actions" ADD COLUMN "undo_of_id" UUID;
ALTER TABLE "moderation_actions"
  ADD CONSTRAINT "moderation_actions_undo_of_id_fkey" FOREIGN KEY ("undo_of_id") REFERENCES "moderation_actions"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "moderation_actions_undo_self_check" CHECK ("undo_of_id" IS NULL OR "undo_of_id" <> "id");
CREATE UNIQUE INDEX "moderation_actions_undo_of_id_key" ON "moderation_actions"("undo_of_id");

COMMIT;
