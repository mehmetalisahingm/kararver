-- #290: one human rejection outcome on the canonical receipt; no free text.
BEGIN;
ALTER TABLE moderation_appeal_windows
  ADD COLUMN rejected_at timestamptz(3),
  ADD COLUMN rejection_reason_code varchar(40),
  ADD CONSTRAINT appeal_rejection_pair CHECK (
    (rejected_at IS NULL AND rejection_reason_code IS NULL) OR
    (rejected_at IS NOT NULL AND rejection_reason_code IS NOT NULL AND filed_at IS NOT NULL
      AND rejected_at >= filed_at AND rejection_reason_code IN ('SENSITIVE_DATA_REQUEST','CONTENT_POLICY_VIOLATION','ORIGINAL_DECISION_UPHELD'))
  );
CREATE OR REPLACE FUNCTION guard_appeal_rejection_outcome() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.rejected_at IS NOT NULL AND
     (OLD.rejected_at, OLD.rejection_reason_code) IS DISTINCT FROM (NEW.rejected_at, NEW.rejection_reason_code) THEN
    RAISE EXCEPTION 'APPEAL_REJECTION_IMMUTABLE';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER moderation_appeal_windows_immutable_rejection
  BEFORE UPDATE ON moderation_appeal_windows FOR EACH ROW EXECUTE FUNCTION guard_appeal_rejection_outcome();
COMMIT;
