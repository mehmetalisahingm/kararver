-- V1 #290: internal human-review workload / 14 calendar day target.
-- This is a foundation table. The authenticated user appeal intake endpoint
-- must be implemented and independently reviewed before production GO.
-- Never auto-close cases on resolution_due_at.
BEGIN;
CREATE TABLE moderation_appeal_cases (
  id UUID NOT NULL PRIMARY KEY,
  rejection_action_id UUID NOT NULL REFERENCES moderation_appeal_notice_receipts(moderation_action_id) ON DELETE RESTRICT ON UPDATE CASCADE,
  appellant_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  submitted_at TIMESTAMPTZ(3) NOT NULL,
  resolution_due_at TIMESTAMPTZ(3) NOT NULL,
  status VARCHAR(12) NOT NULL DEFAULT 'OPEN',
  resolved_at TIMESTAMPTZ(3),
  outcome VARCHAR(10),
  resolved_by_id UUID REFERENCES users(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  created_at TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT moderation_appeal_cases_deadline_check
    CHECK (resolution_due_at = submitted_at + INTERVAL '336 hours'),
  CONSTRAINT moderation_appeal_cases_state_check
    CHECK ((status IN ('OPEN','IN_REVIEW') AND resolved_at IS NULL AND outcome IS NULL AND resolved_by_id IS NULL)
      OR (status = 'RESOLVED' AND resolved_at IS NOT NULL AND resolved_at >= submitted_at
          AND outcome IN ('ACCEPTED','REJECTED') AND resolved_by_id IS NOT NULL)),
  CONSTRAINT moderation_appeal_cases_unique_author_action
    UNIQUE (rejection_action_id, appellant_id)
);
CREATE INDEX moderation_appeal_cases_status_resolution_due_at_idx
  ON moderation_appeal_cases(status, resolution_due_at);
CREATE INDEX moderation_appeal_cases_appellant_id_submitted_at_idx
  ON moderation_appeal_cases(appellant_id, submitted_at DESC);

-- Defense in depth: even privileged migration-compatible callers cannot
-- file an appeal for someone else's delivered rejection. The API must still
-- enforce authenticated ownership and server-time limits before INSERT.
CREATE OR REPLACE FUNCTION moderation_appeal_cases_guard()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM moderation_appeal_notice_receipts r
    WHERE r.moderation_action_id = NEW.rejection_action_id
      AND r.recipient_id = NEW.appellant_id
      AND NEW.submitted_at <= r.appeal_deadline_at
      AND NEW.submitted_at >= r.delivered_at
  ) THEN
    RAISE EXCEPTION 'INVALID_APPEAL_RECEIPT: the claim must match the recipient and filing window';
  END IF;
  IF TG_OP = 'UPDATE' AND
     (NEW.rejection_action_id IS DISTINCT FROM OLD.rejection_action_id OR
      NEW.appellant_id IS DISTINCT FROM OLD.appellant_id OR
      NEW.submitted_at IS DISTINCT FROM OLD.submitted_at OR
      NEW.resolution_due_at IS DISTINCT FROM OLD.resolution_due_at) THEN
    RAISE EXCEPTION 'IMMUTABLE_APPEAL_FILING: claim identity and deadline cannot be changed';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER moderation_appeal_cases_guard_trigger
  BEFORE INSERT OR UPDATE ON moderation_appeal_cases
  FOR EACH ROW EXECUTE FUNCTION moderation_appeal_cases_guard();
COMMIT;
