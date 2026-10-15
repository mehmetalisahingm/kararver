-- #183 güvenli geri alma: parti-parti telafi. Geri alma yeni bir partidir (undo_of_id); öğe başına "geri alındı" işareti
-- (undone_by_batch_id) aynı kararın ikinci kez telafi edilmesini engeller. Audit append-only kalır: telafi kararları normal
-- moderasyon yolundan geçer ve her biri kendi audit/moderation_actions kaydını yazar.
BEGIN;

ALTER TABLE "moderation_batches" ADD COLUMN "undo_of_id" UUID;
ALTER TABLE "moderation_batches"
  ADD CONSTRAINT "moderation_batches_undo_of_id_fkey" FOREIGN KEY ("undo_of_id") REFERENCES "moderation_batches"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "moderation_batches_undo_self_check" CHECK ("undo_of_id" IS NULL OR "undo_of_id" <> "id");
CREATE INDEX "moderation_batches_undo_of_id_idx" ON "moderation_batches"("undo_of_id") WHERE "undo_of_id" IS NOT NULL;

ALTER TABLE "moderation_batch_items" ADD COLUMN "undone_by_batch_id" UUID;
ALTER TABLE "moderation_batch_items"
  ADD CONSTRAINT "moderation_batch_items_undone_by_batch_id_fkey" FOREIGN KEY ("undone_by_batch_id") REFERENCES "moderation_batches"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  -- Yalnız uygulanmış karar geri alınabilir.
  ADD CONSTRAINT "moderation_batch_items_undone_check" CHECK ("undone_by_batch_id" IS NULL OR "result" = 'APPLIED');
CREATE INDEX "moderation_batch_items_undone_by_batch_id_idx" ON "moderation_batch_items"("undone_by_batch_id") WHERE "undone_by_batch_id" IS NOT NULL;

COMMIT;
