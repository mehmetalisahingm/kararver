-- #66 · Sahip: Faruk · İçerik sürüm geçmişi (V1_USER_FLOW "Kullanıcı ve admin logları"; admin.revisions.*).
-- Her oluşturma ve düzenlemede içeriğin o anki hali yeni sürüm olarak yazılır (sürüm 1 = ilk paylaşım).
-- Anlık görüntü biçimi tek yerde: kv_poll_snapshot / kv_comment_snapshot. Uygulama da bunları çağırır.

-- CreateTable
CREATE TABLE "poll_revisions" (
    "id" UUID NOT NULL,
    "poll_id" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "editor_id" UUID NOT NULL,
    "edited_at" TIMESTAMPTZ(3) NOT NULL,
    "snapshot" JSONB NOT NULL,

    CONSTRAINT "poll_revisions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "comment_revisions" (
    "id" UUID NOT NULL,
    "comment_id" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "editor_id" UUID NOT NULL,
    "edited_at" TIMESTAMPTZ(3) NOT NULL,
    "snapshot" JSONB NOT NULL,

    CONSTRAINT "comment_revisions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "poll_revisions_poll_id_version_key" ON "poll_revisions"("poll_id", "version");

-- CreateIndex
CREATE UNIQUE INDEX "comment_revisions_comment_id_version_key" ON "comment_revisions"("comment_id", "version");

-- AddForeignKey
ALTER TABLE "poll_revisions" ADD CONSTRAINT "poll_revisions_poll_id_fkey" FOREIGN KEY ("poll_id") REFERENCES "polls"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "poll_revisions" ADD CONSTRAINT "poll_revisions_editor_id_fkey" FOREIGN KEY ("editor_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "comment_revisions" ADD CONSTRAINT "comment_revisions_comment_id_fkey" FOREIGN KEY ("comment_id") REFERENCES "comments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "comment_revisions" ADD CONSTRAINT "comment_revisions_editor_id_fkey" FOREIGN KEY ("editor_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ─── ELLE: CHECK ───
ALTER TABLE "poll_revisions" ADD CONSTRAINT "poll_revisions_version_check" CHECK ("version" >= 1);
ALTER TABLE "comment_revisions" ADD CONSTRAINT "comment_revisions_version_check" CHECK ("version" >= 1);

-- ─── ELLE: anlık görüntü fonksiyonları ───
-- Kullanıcının düzenleyebildiği alanlar (polls.update / comments.update). Sayaçlar, durum ve moderasyon alanları
-- içerik değildir; onların izi moderation_actions ve olaylardadır.
CREATE FUNCTION kv_poll_snapshot(p_id uuid) RETURNS jsonb
LANGUAGE sql STABLE AS $$
  SELECT jsonb_build_object(
    'kind', p."kind",
    'title', p."title",
    'description', p."description",
    'categoryId', p."category_id",
    'communityId', p."community_id",
    'tags', coalesce((SELECT jsonb_agg(t."slug" ORDER BY t."slug") FROM "poll_tags" pt JOIN "tags" t ON t."id" = pt."tag_id" WHERE pt."poll_id" = p."id"), '[]'::jsonb),
    'price', CASE WHEN p."price_amount" IS NULL THEN NULL
                  ELSE jsonb_build_object('amount', to_char(p."price_amount", 'FM999999999990.00'), 'currency', p."price_currency") END,
    'extraInfo', p."extra_info",
    'allowComments', p."allow_comments",
    'resultsVisibility', p."results_visibility",
    'closesAt', p."closes_at",
    'options', coalesce((SELECT jsonb_agg(jsonb_build_object('id', o."id", 'label', o."label", 'position', o."position") ORDER BY o."position")
                         FROM "poll_options" o WHERE o."poll_id" = p."id"), '[]'::jsonb),
    'mediaIds', coalesce((SELECT jsonb_agg(pm."media_id" ORDER BY pm."position") FROM "poll_media" pm WHERE pm."poll_id" = p."id"), '[]'::jsonb)
  )
  FROM "polls" p WHERE p."id" = p_id
$$;

CREATE FUNCTION kv_comment_snapshot(c_id uuid) RETURNS jsonb
LANGUAGE sql STABLE AS $$
  SELECT jsonb_build_object('kind', c."kind", 'body', c."body", 'parentId', c."parent_id")
  FROM "comments" c WHERE c."id" = c_id
$$;

-- ─── ELLE: append-only ───
CREATE FUNCTION kv_revisions_append_only() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'KV_REVISIONS_APPEND_ONLY: içerik sürüm geçmişi değiştirilemez ve silinemez (%)', TG_TABLE_NAME
    USING ERRCODE = 'P0001';
END $$;

CREATE TRIGGER "poll_revisions_append_only"
  BEFORE UPDATE OR DELETE ON "poll_revisions"
  FOR EACH ROW EXECUTE FUNCTION kv_revisions_append_only();

CREATE TRIGGER "comment_revisions_append_only"
  BEFORE UPDATE OR DELETE ON "comment_revisions"
  FOR EACH ROW EXECUTE FUNCTION kv_revisions_append_only();

-- ─── ELLE: mevcut içerik ───
-- Bu migration'dan önceki düzenlemelerin geçmişi yoktur. Mevcut her içerik için şu anki hali sürüm 1 olarak yazılır
-- (editör = yazar). Zaman: anket için oluşturma anı, yorum için son düzenleme veya oluşturma anı. Belge: KV-66.
INSERT INTO "poll_revisions" ("id", "poll_id", "version", "editor_id", "edited_at", "snapshot")
SELECT gen_random_uuid(), p."id", 1, p."author_id", p."created_at", kv_poll_snapshot(p."id") FROM "polls" p;

INSERT INTO "comment_revisions" ("id", "comment_id", "version", "editor_id", "edited_at", "snapshot")
SELECT gen_random_uuid(), c."id", 1, c."author_id", coalesce(c."edited_at", c."created_at"), kv_comment_snapshot(c."id") FROM "comments" c;
