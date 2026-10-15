-- Codes are random 128-bit values; only account-bound HMAC digests are retained.
CREATE TABLE mfa_recovery_codes (
  user_id uuid NOT NULL REFERENCES user_mfa_credentials(user_id) ON DELETE CASCADE ON UPDATE CASCADE,
  code_hash char(64) NOT NULL,
  created_at timestamptz(6) NOT NULL,
  used_at timestamptz(6),
  PRIMARY KEY (user_id, code_hash)
);
