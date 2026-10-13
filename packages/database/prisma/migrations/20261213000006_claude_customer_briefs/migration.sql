-- Claude integration Wave D (CI-S2 and CI-S3, design sections 7.2 and 7.3): the cache of the two things the staff member serving a visit may
-- see on the work screen: the short summary of the notes staff wrote about the customer, and up to three product talking points. One row
-- per visit participant and kind; the content is generated on demand and kept until 7 days after the service, then deleted by the worker
-- (OQ-CI-10). No customer name, phone or e-mail is stored here: the row is tied to the visit and the participant.
CREATE TABLE "ai_customer_briefs" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "visit_id" UUID NOT NULL,
    "participant_id" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "input_hash" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "model" TEXT NOT NULL,
    "cost_micro_usd" BIGINT NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT clock_timestamp(),
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "ai_customer_briefs_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "ai_customer_briefs_kind" CHECK ("kind" IN ('BRIEF', 'SUGGESTIONS')),
    CONSTRAINT "ai_customer_briefs_cost" CHECK ("cost_micro_usd" >= 0),
    CONSTRAINT "ai_customer_briefs_expiry" CHECK ("expires_at" > "created_at")
);
ALTER TABLE "ai_customer_briefs" ADD CONSTRAINT "ai_customer_briefs_visit_fkey" FOREIGN KEY ("visit_id")
  REFERENCES "visits"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ai_customer_briefs" ADD CONSTRAINT "ai_customer_briefs_participant_fkey" FOREIGN KEY ("participant_id")
  REFERENCES "visit_participants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE UNIQUE INDEX "ai_customer_briefs_key" ON "ai_customer_briefs"("visit_id", "participant_id", "kind");
CREATE INDEX "ai_customer_briefs_expiry_idx" ON "ai_customer_briefs"("expires_at");
