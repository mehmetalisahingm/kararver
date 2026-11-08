-- V1 #290: append-only in-app DELIVERY evidence for prepublication
-- human rejection notices. Clock starts from committed inbox insertion,
-- NEVER from moderation action timestamp or queued domain event time.
-- Legal hold and erasure lifecycle are handled by #181/#285/#290.
BEGIN;

CREATE TABLE moderation_appeal_notice_receipts (
  moderation_action_id UUID PRIMARY KEY REFERENCES moderation_actions(id) ON DELETE RESTRICT,
  recipient_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  notification_id UUID NOT NULL UNIQUE,
  delivered_at TIMESTAMPTZ(3) NOT NULL,
  appeal_deadline_at TIMESTAMPTZ(3) NOT NULL,
  created_at TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT moderation_appeal_notice_window_check
    CHECK (appeal_deadline_at = delivered_at + INTERVAL '720 hours')
);

CREATE INDEX moderation_appeal_notice_receipts_recipient_idx
  ON moderation_appeal_notice_receipts(recipient_id, appeal_deadline_at);

-- Immutable timestamps during the retention window. DELETE is intentionally
-- not forbidden forever: only an approved, audited retention/erasure job may
-- remove records once every timely appeal and legal hold is resolved (#181).
-- Retention duration must be legally approved before production rollout.
CREATE OR REPLACE FUNCTION moderation_appeal_notice_receipts_immutable()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'APPEND_ONLY: moderation appeal delivery evidence cannot be changed';
END;
$$;

CREATE TRIGGER moderation_appeal_notice_receipts_immutable_trigger
BEFORE UPDATE ON moderation_appeal_notice_receipts
FOR EACH ROW EXECUTE FUNCTION moderation_appeal_notice_receipts_immutable();

COMMIT;
