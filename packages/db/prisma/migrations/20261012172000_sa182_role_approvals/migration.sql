-- SA #182 — two distinct SUPER_ADMIN approvals before changing a SUPER_ADMIN role.
CREATE TABLE role_change_approvals (
  id uuid PRIMARY KEY,
  target_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  initiator_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  approved_by_id uuid NULL REFERENCES users(id) ON DELETE RESTRICT,
  expected_role varchar(20) NOT NULL,
  expected_updated_at timestamptz NULL,
  requested_role varchar(20) NOT NULL,
  reason varchar(500) NOT NULL,
  status varchar(20) NOT NULL DEFAULT 'PENDING',
  created_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  approved_at timestamptz NULL,
  consumed_at timestamptz NULL,
  CONSTRAINT role_approval_actor_distinct CHECK (approved_by_id IS NULL OR (approved_by_id <> initiator_id AND approved_by_id <> target_user_id)),
  CONSTRAINT role_approval_status CHECK (status IN ('PENDING', 'APPROVED', 'EXPIRED', 'CONSUMED', 'REJECTED')),
  CONSTRAINT role_approval_valid_time CHECK (expires_at > created_at AND expires_at <= created_at + interval '10 minutes')
);
CREATE INDEX role_change_approvals_target_idx ON role_change_approvals(target_user_id, created_at DESC);
CREATE INDEX role_change_approvals_expiry_idx ON role_change_approvals(status, expires_at);
