BEGIN;
CREATE TABLE poll_follows (
 user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 poll_id uuid NOT NULL REFERENCES polls(id) ON DELETE CASCADE,
 created_at timestamptz(3) NOT NULL DEFAULT now(), PRIMARY KEY(user_id, poll_id)
);
CREATE INDEX poll_follows_poll_id_created_at_user_id_idx ON poll_follows(poll_id, created_at, user_id);
CREATE TABLE poll_decisions (
 poll_id uuid PRIMARY KEY REFERENCES polls(id) ON DELETE RESTRICT,
 chosen_option_id uuid,
 note varchar(1000) NOT NULL CHECK(length(trim(note)) BETWEEN 1 AND 1000),
 updated_at timestamptz(3) NOT NULL,
 FOREIGN KEY(poll_id, chosen_option_id) REFERENCES poll_options(poll_id, id) ON DELETE RESTRICT
);

-- Add decision to snapshots without removing or renaming the existing function.
CREATE OR REPLACE FUNCTION kv_poll_snapshot(p_id uuid) RETURNS jsonb
LANGUAGE sql STABLE AS $$
  SELECT jsonb_build_object(
    'decision', (SELECT jsonb_build_object('chosenOptionId', d.chosen_option_id, 'note', d.note, 'updatedAt', d.updated_at) FROM poll_decisions d WHERE d.poll_id = p.id),
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

COMMIT;
