-- KV-22 (#24) · Mehmet · private bookmarks
CREATE TABLE "bookmarks" (
    "user_id" UUID NOT NULL,
    "poll_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "bookmarks_pkey" PRIMARY KEY ("user_id", "poll_id")
);

CREATE INDEX "bookmarks_user_id_created_at_poll_id_idx"
    ON "bookmarks"("user_id", "created_at" DESC, "poll_id" DESC);
CREATE INDEX "bookmarks_poll_id_idx" ON "bookmarks"("poll_id");

ALTER TABLE "bookmarks"
    ADD CONSTRAINT "bookmarks_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "bookmarks"
    ADD CONSTRAINT "bookmarks_poll_id_fkey"
    FOREIGN KEY ("poll_id") REFERENCES "polls"("id") ON DELETE CASCADE ON UPDATE CASCADE;
