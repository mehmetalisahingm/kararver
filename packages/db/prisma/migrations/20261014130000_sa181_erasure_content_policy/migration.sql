-- Product decision: account erasure removes authored content and its media.
-- Voting statistics have no account ID, old vote/event ID, actor or reason.
CREATE TABLE anonymous_vote_groups (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  poll_id uuid NOT NULL REFERENCES polls(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  option_id uuid NOT NULL,
  created_at timestamptz(3) NOT NULL,
  invalidated_at timestamptz(3),
  history jsonb NOT NULL CHECK (jsonb_typeof(history) = 'array'),
  fingerprint char(32) NOT NULL,
  multiplicity integer NOT NULL DEFAULT 1 CHECK (multiplicity > 0),
  UNIQUE (poll_id, fingerprint),
  FOREIGN KEY (poll_id, option_id) REFERENCES poll_options(poll_id, id) ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX anonymous_vote_groups_window_idx ON anonymous_vote_groups(poll_id, created_at, invalidated_at);

-- Read-only statistical sources preserve the existing trend and snapshot formulae.
-- Synthetic IDs exist only in these views and are independent for each poll group.
CREATE VIEW statistical_votes AS
SELECT id, poll_id, option_id, user_id, created_at, invalidated_at FROM votes
UNION ALL
SELECT md5(g.id::text || ':' || n)::uuid, g.poll_id, g.option_id,
       md5(g.id::text || ':' || n)::uuid, g.created_at, g.invalidated_at
FROM anonymous_vote_groups g CROSS JOIN LATERAL generate_series(1, g.multiplicity) n;

CREATE VIEW statistical_vote_events AS
SELECT id, vote_id, poll_id, user_id, type, from_option_id, to_option_id, occurred_at FROM vote_events
UNION ALL
SELECT (left(md5(g.id::text || ':' || n),24) || lpad(to_hex(e.ordinality),8,'0'))::uuid,
       md5(g.id::text || ':' || n)::uuid, g.poll_id, md5(g.id::text || ':' || n)::uuid,
       (e.value->>'type')::vote_event_type, (e.value->>'from')::uuid,
       (e.value->>'to')::uuid, (e.value->>'at')::timestamptz
FROM anonymous_vote_groups g CROSS JOIN LATERAL generate_series(1, g.multiplicity) n
CROSS JOIN LATERAL jsonb_array_elements(g.history) WITH ORDINALITY e;

CREATE FUNCTION kv_erasing_account(subject uuid) RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT coalesce(current_setting('kararver.erasure_user',true),'') = subject::text
    AND EXISTS (SELECT 1 FROM account_erasures a JOIN users u ON u.id=a.user_id
      WHERE a.user_id=subject AND u.deleted_at IS NOT NULL)
$$;

CREATE OR REPLACE FUNCTION kv_vote_events_append_only() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='DELETE' AND kv_erasing_account(OLD.user_id) THEN RETURN OLD; END IF;
  RAISE EXCEPTION 'KV_VOTE_EVENTS_APPEND_ONLY: vote_events satırları güncellenemez veya silinemez' USING ERRCODE='P0001';
END $$;

CREATE OR REPLACE FUNCTION kv_revisions_append_only() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE subject uuid;
BEGIN
  IF TG_OP='DELETE' THEN
    IF TG_TABLE_NAME='poll_revisions' THEN SELECT author_id INTO subject FROM polls WHERE id=OLD.poll_id;
    ELSE SELECT author_id INTO subject FROM comments WHERE id=OLD.comment_id; END IF;
    IF kv_erasing_account(subject) THEN RETURN OLD; END IF;
  END IF;
  RAISE EXCEPTION 'KV_REVISIONS_APPEND_ONLY: içerik sürüm geçmişi değiştirilemez ve silinemez (%)',TG_TABLE_NAME USING ERRCODE='P0001';
END $$;

CREATE OR REPLACE FUNCTION kv_polls_guard_locked() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.first_valid_vote_at IS NOT NULL THEN
    IF NEW.first_valid_vote_at IS DISTINCT FROM OLD.first_valid_vote_at THEN
      RAISE EXCEPTION 'KV_POLL_CONTENT_LOCKED: first_valid_vote_at değiştirilemez' USING ERRCODE='P0001';
    END IF;
    IF NEW.title IS DISTINCT FROM OLD.title OR NEW.description IS DISTINCT FROM OLD.description
      OR NEW.results_visibility IS DISTINCT FROM OLD.results_visibility THEN
      IF NOT (kv_erasing_account(OLD.author_id) AND NEW.author_id=OLD.author_id
        AND NEW.title='Silinmiş içerik' AND NEW.description IS NULL AND NEW.extra_info IS NULL
        AND NEW.price_amount IS NULL AND NEW.price_currency IS NULL AND NEW.status='REMOVED'
        AND NEW.deleted_at IS NOT NULL AND NEW.results_visibility IS NOT DISTINCT FROM OLD.results_visibility) THEN
        RAISE EXCEPTION 'KV_POLL_CONTENT_LOCKED: ilk geçerli oydan sonra içerik değiştirilemez' USING ERRCODE='P0001';
      END IF;
    END IF;
  END IF;
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION kv_poll_options_guard_locked() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE target_poll uuid; locked_at timestamptz; subject uuid;
BEGIN
  IF TG_OP='UPDATE' AND NEW.poll_id=OLD.poll_id AND NEW.label=OLD.label AND NEW.position=OLD.position THEN RETURN NEW; END IF;
  target_poll := CASE WHEN TG_OP='DELETE' THEN OLD.poll_id ELSE NEW.poll_id END;
  SELECT first_valid_vote_at,author_id INTO locked_at,subject FROM polls WHERE id=target_poll FOR SHARE;
  IF locked_at IS NOT NULL AND NOT (TG_OP='UPDATE' AND NEW.poll_id=OLD.poll_id
    AND NEW.position=OLD.position AND NEW.label='Silinmiş seçenek' AND kv_erasing_account(subject)) THEN
    RAISE EXCEPTION 'KV_POLL_CONTENT_LOCKED: ilk geçerli oydan sonra seçenekler değiştirilemez' USING ERRCODE='P0001';
  END IF;
  IF TG_OP='DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END $$;

-- A completed erasure cannot be undone by moderation or a bulk job.
CREATE FUNCTION kv_erased_content_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.deleted_at IS NOT NULL AND EXISTS (SELECT 1 FROM account_erasures WHERE user_id=OLD.author_id)
    AND (NEW.status<>'REMOVED' OR NEW.deleted_at IS NULL) THEN
    RAISE EXCEPTION 'KV_ERASED_CONTENT: hesap silme sonrası içerik geri yüklenemez' USING ERRCODE='P0001';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER polls_erased_content_guard BEFORE UPDATE ON polls FOR EACH ROW EXECUTE FUNCTION kv_erased_content_guard();
CREATE TRIGGER comments_erased_content_guard BEFORE UPDATE ON comments FOR EACH ROW EXECUTE FUNCTION kv_erased_content_guard();
