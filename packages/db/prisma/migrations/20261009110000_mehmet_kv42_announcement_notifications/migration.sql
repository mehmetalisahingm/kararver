-- KV-42: announcement notifications are optional and target active accounts.
-- Existing rows are unchanged. The type becomes available after migration.
ALTER TYPE "notification_type" ADD VALUE IF NOT EXISTS 'ANNOUNCEMENT_PUBLISHED';

ALTER TABLE "notifications" DROP CONSTRAINT "notifications_subject_type_check";
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_subject_type_check"
  CHECK ("subject_type" IN ('POLL', 'COMMENT', 'COMMUNITY', 'USER', 'ANNOUNCEMENT'));
