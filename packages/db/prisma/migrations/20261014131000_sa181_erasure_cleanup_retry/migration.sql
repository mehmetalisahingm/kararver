ALTER TABLE account_erasures ADD COLUMN storage_cleanup_attempts integer NOT NULL DEFAULT 0 CHECK(storage_cleanup_attempts >= 0),
  ADD COLUMN storage_next_attempt_at timestamptz(3);
CREATE INDEX account_erasures_retry_idx ON account_erasures(storage_cleaned_at,storage_next_attempt_at,created_at);
