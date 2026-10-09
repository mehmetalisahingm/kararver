-- Community creation request lifecycle for V1 (#172)
CREATE TYPE "community_request_status" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'CLOSED');
CREATE TABLE "community_requests" (
  "id" UUID NOT NULL,
  "requester_id" UUID NOT NULL,
  "community_id" UUID,
  "name" VARCHAR(80) NOT NULL,
  "slug" VARCHAR(60) NOT NULL,
  "description" VARCHAR(1000),
  "category_id" UUID,
  "status" "community_request_status" NOT NULL DEFAULT 'PENDING',
  "rejection_reason" VARCHAR(500),
  "approved_at" TIMESTAMPTZ(3),
  "approval_deadline" TIMESTAMPTZ(3),
  "closed_at" TIMESTAMPTZ(3),
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "community_requests_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "community_requests_community_id_key" UNIQUE ("community_id"),
  CONSTRAINT "community_requests_requester_id_fkey" FOREIGN KEY ("requester_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "community_requests_community_id_fkey" FOREIGN KEY ("community_id") REFERENCES "communities"("id") ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE INDEX "community_requests_requester_id_status_created_at_idx" ON "community_requests"("requester_id", "status", "created_at" DESC);
CREATE INDEX "community_requests_status_approval_deadline_idx" ON "community_requests"("status", "approval_deadline");

-- Prevent two live pending proposals for the same slug. Archived/decided requests remain history.
CREATE UNIQUE INDEX "community_requests_pending_slug_key" ON "community_requests" ("slug") WHERE status = 'PENDING';
ALTER TABLE "community_requests" ADD CONSTRAINT "community_requests_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "categories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX "community_requests_community_id_idx" ON "community_requests" ("community_id");
