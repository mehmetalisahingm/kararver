-- SA #180: encrypted TOTP credentials; session-bound five-minute step-up.
-- No MFA enforcement is enabled solely by this migration.
CREATE TABLE user_mfa_credentials (
  user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE ON UPDATE CASCADE,
  secret_cipher bytea NOT NULL,
  setup_session_id uuid NOT NULL,
  pending_expires_at timestamptz NOT NULL,
  enabled_at timestamptz NULL,
  last_accepted_step bigint NOT NULL DEFAULT -1,
  failed_attempts integer NOT NULL DEFAULT 0 CHECK (failed_attempts >= 0 AND failed_attempts <= 5),
  locked_until timestamptz NULL
);
CREATE INDEX user_mfa_credentials_enabled_idx ON user_mfa_credentials (enabled_at);
CREATE TABLE session_mfa_stepups (
  session_id uuid PRIMARY KEY REFERENCES sessions(id) ON DELETE CASCADE ON UPDATE CASCADE,
  verified_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz NULL,
  CONSTRAINT stepup_time_valid CHECK (expires_at > verified_at)
);
