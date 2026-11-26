-- #290/#372: allow one-way redaction of free-text reason on completed account
-- erasure, not a new general evidence-retention policy. Existing receipt and
-- filing timestamps remain immutable. Never restore a redacted reason.
BEGIN;
ALTER TABLE moderation_appeal_windows DROP CONSTRAINT appeal_filing_pair;
ALTER TABLE moderation_appeal_windows ADD CONSTRAINT appeal_filing_pair
  CHECK (filed_at IS NOT NULL OR filed_reason IS NULL);

CREATE OR REPLACE FUNCTION reject_appeal_window_deadline_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (OLD.rejection_action_id, OLD.recipient_id, OLD.notification_id, OLD.delivered_at, OLD.deadline_at)
    IS DISTINCT FROM (NEW.rejection_action_id, NEW.recipient_id, NEW.notification_id, NEW.delivered_at, NEW.deadline_at)
  THEN
    RAISE EXCEPTION 'APPEAL_RECEIPT_IMMUTABLE';
  END IF;
  IF OLD.filed_at IS NOT NULL AND OLD.filed_at IS DISTINCT FROM NEW.filed_at THEN
    RAISE EXCEPTION 'APPEAL_FILING_IMMUTABLE';
  END IF;
  IF OLD.filed_at IS NOT NULL AND OLD.filed_reason IS DISTINCT FROM NEW.filed_reason THEN
    IF NOT (OLD.filed_reason IS NOT NULL AND NEW.filed_reason IS NULL AND EXISTS (
      SELECT 1 FROM users WHERE id = OLD.recipient_id AND deleted_at IS NOT NULL
    )) THEN
      RAISE EXCEPTION 'APPEAL_FILING_IMMUTABLE';
    END IF;
  END IF;
  IF OLD.filed_at IS NULL AND NEW.filed_at IS NOT NULL AND
     (NEW.filed_reason IS NULL OR NOT EXISTS (
       SELECT 1 FROM users WHERE id = NEW.recipient_id AND deleted_at IS NULL
     )) THEN
    RAISE EXCEPTION 'APPEAL_FILING_IMMUTABLE';
  END IF;
  RETURN NEW;
END $$;

-- Existing erased users on an upgraded test copy: redact only free text.
UPDATE moderation_appeal_windows w SET filed_reason = NULL
 WHERE filed_reason IS NOT NULL
   AND EXISTS (SELECT 1 FROM users u WHERE u.id = w.recipient_id AND u.deleted_at IS NOT NULL);
COMMIT;
