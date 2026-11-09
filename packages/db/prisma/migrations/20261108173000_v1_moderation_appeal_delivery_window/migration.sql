-- KararVer V1 #290: 30-day moderation appeal filing from actual inbox delivery.
-- created_at on notifications is EVENT time, not delivery time; never use it
-- to start the clock. This row is created only when the private notification
-- is durably written for the rightful recipient. Repeated worker retries keep
-- the first receipt (ON CONFLICT DO NOTHING).
CREATE TABLE moderation_appeal_windows (
  rejection_action_id uuid PRIMARY KEY REFERENCES moderation_actions(id) ON DELETE RESTRICT,
  recipient_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  notification_id uuid NOT NULL,
  delivered_at timestamptz(3) NOT NULL,
  deadline_at timestamptz(3) NOT NULL,
  filed_at timestamptz(3),
  filed_reason varchar(1000),
  created_at timestamptz(3) NOT NULL DEFAULT now(),
  CONSTRAINT appeal_receipt_deadline_exact_30_days CHECK (deadline_at = delivered_at + INTERVAL '30 days'),
  CONSTRAINT appeal_filing_pair CHECK ((filed_at IS NULL) = (filed_reason IS NULL)),
  CONSTRAINT appeal_filing_in_window CHECK (filed_at IS NULL OR (filed_at >= delivered_at AND filed_at <= deadline_at))
);
CREATE INDEX moderation_appeal_windows_recipient_delivered_idx
  ON moderation_appeal_windows (recipient_id, delivered_at DESC);
CREATE INDEX moderation_appeal_windows_deadline_idx
  ON moderation_appeal_windows (deadline_at);

-- Don't allow a second/earlier receipt to reset the clock or alter the
-- submitted appeal, even if a direct DB job accidentally issues UPDATE.
CREATE OR REPLACE FUNCTION reject_appeal_window_deadline_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (OLD.rejection_action_id, OLD.recipient_id, OLD.notification_id, OLD.delivered_at, OLD.deadline_at)
    IS DISTINCT FROM (NEW.rejection_action_id, NEW.recipient_id, NEW.notification_id, NEW.delivered_at, NEW.deadline_at)
  THEN
    RAISE EXCEPTION 'APPEAL_RECEIPT_IMMUTABLE';
  END IF;
  IF OLD.filed_at IS NOT NULL AND
     (OLD.filed_at, OLD.filed_reason) IS DISTINCT FROM (NEW.filed_at, NEW.filed_reason)
  THEN
    RAISE EXCEPTION 'APPEAL_FILING_IMMUTABLE';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER moderation_appeal_windows_immutable_receipt
  BEFORE UPDATE ON moderation_appeal_windows
  FOR EACH ROW EXECUTE FUNCTION reject_appeal_window_deadline_mutation();
