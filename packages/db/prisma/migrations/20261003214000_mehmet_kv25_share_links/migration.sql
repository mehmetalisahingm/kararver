-- KV-25 (#27) · Mehmet · kaynak ölçümlü paylaşım linkleri
-- URL'ye yalnız opak share UUID'si yazılır; kullanıcı/oturum/kişisel veri tutulmaz.
BEGIN;

CREATE TABLE "share_links" (
    "id" UUID NOT NULL,
    "poll_id" UUID NOT NULL,
    "channel" VARCHAR(20) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "share_links_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "share_links_channel_check" CHECK ("channel" IN ('x', 'whatsapp', 'copy', 'other'))
);

CREATE INDEX "share_links_poll_id_created_at_idx"
    ON "share_links"("poll_id", "created_at" DESC);
CREATE INDEX "share_links_created_at_idx" ON "share_links"("created_at" DESC);

COMMIT;
