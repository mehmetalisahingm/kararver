-- #183 yüksek hacimli toplu moderasyon için ikinci onay. Eşik aşılınca toplu işlem uygulanmaz; bu tabloda bekleyen bir talep olur.
-- Başlatandan farklı bir ADMIN+ (MFA step-up ile) onaylayınca parti, başlatan adına mevcut toplu işlem yolundan uygulanır.
-- Başlatan ile onaylayan ayrılığı ve durum geçişleri CHECK ile veritabanında da zorlanır.
BEGIN;

CREATE TABLE "moderation_bulk_approvals" (
  "id" UUID NOT NULL,
  "kind" "moderation_batch_kind" NOT NULL,
  "action" "moderation_action_type" NOT NULL,
  "reason" VARCHAR(500) NOT NULL,
  -- Talep anındaki önizleme özeti: onay anında yeniden hesaplanır, farklıysa uygulanmaz (preview_stale).
  "digest" CHAR(64) NOT NULL,
  "ids" UUID[] NOT NULL,
  "will_change" INTEGER NOT NULL,
  "initiator_id" UUID NOT NULL,
  "status" VARCHAR(20) NOT NULL DEFAULT 'PENDING',
  "request_id" UUID,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "expires_at" TIMESTAMPTZ(3) NOT NULL,
  "decided_by_id" UUID,
  "decided_at" TIMESTAMPTZ(3),
  "decision_reason" VARCHAR(500),
  "batch_id" UUID,
  CONSTRAINT "moderation_bulk_approvals_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "moderation_bulk_approvals_initiator_id_fkey" FOREIGN KEY ("initiator_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "moderation_bulk_approvals_decided_by_id_fkey" FOREIGN KEY ("decided_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "moderation_bulk_approvals_batch_id_fkey" FOREIGN KEY ("batch_id") REFERENCES "moderation_batches"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "moderation_bulk_approvals_action_check" CHECK ("action" IN ('HIDE', 'REMOVE', 'RESTORE')),
  CONSTRAINT "moderation_bulk_approvals_status_check" CHECK ("status" IN ('PENDING', 'APPROVED', 'REJECTED', 'CANCELED')),
  CONSTRAINT "moderation_bulk_approvals_reason_check" CHECK (length(btrim("reason")) >= 3),
  CONSTRAINT "moderation_bulk_approvals_ids_check" CHECK (cardinality("ids") BETWEEN 1 AND 50 AND "will_change" BETWEEN 1 AND cardinality("ids")),
  CONSTRAINT "moderation_bulk_approvals_time_check" CHECK ("expires_at" > "created_at"),
  -- Bekleyen talepte karar alanları boş; karar verilmiş talepte zorunlu.
  CONSTRAINT "moderation_bulk_approvals_decision_check" CHECK (
    ("status" = 'PENDING' AND "decided_by_id" IS NULL AND "decided_at" IS NULL AND "decision_reason" IS NULL AND "batch_id" IS NULL)
    OR ("status" <> 'PENDING' AND "decided_by_id" IS NOT NULL AND "decided_at" IS NOT NULL AND length(btrim("decision_reason")) >= 3)
  ),
  -- İkinci onay: başlatan kendi talebini onaylayamaz/reddedemez; geri çekmeyi yalnız başlatan yapar. Parti yalnız onayda oluşur.
  CONSTRAINT "moderation_bulk_approvals_actor_check" CHECK (
    ("status" IN ('APPROVED', 'REJECTED') AND "decided_by_id" <> "initiator_id")
    OR ("status" = 'CANCELED' AND "decided_by_id" = "initiator_id")
    OR "status" = 'PENDING'
  ),
  CONSTRAINT "moderation_bulk_approvals_batch_check" CHECK (("status" = 'APPROVED') = ("batch_id" IS NOT NULL))
);
CREATE UNIQUE INDEX "moderation_bulk_approvals_batch_id_key" ON "moderation_bulk_approvals"("batch_id");
CREATE INDEX "moderation_bulk_approvals_initiator_id_created_at_idx" ON "moderation_bulk_approvals"("initiator_id", "created_at" DESC);
CREATE INDEX "moderation_bulk_approvals_status_created_at_idx" ON "moderation_bulk_approvals"("status", "created_at" DESC);

COMMIT;
