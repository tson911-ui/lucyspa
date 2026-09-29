-- Phase 4 Step 3 (staff-added service): replay protection for adding a service line to an existing visit.
-- Additive only: one new append-only table; no existing table, column or guard is changed. The client
-- supplies a UUID key that is unique per actor (the booking/walk-in idempotency pattern); the created
-- visit service line is the stored outcome of that key.

CREATE TABLE "visit_line_add_requests" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "actor_user_id" UUID NOT NULL,
    "idempotency_key" UUID NOT NULL,
    "visit_service_line_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "visit_line_add_requests_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "visit_line_add_requests_actor_key" ON "visit_line_add_requests"("actor_user_id", "idempotency_key");
CREATE UNIQUE INDEX "visit_line_add_requests_line_key" ON "visit_line_add_requests"("visit_service_line_id");

ALTER TABLE "visit_line_add_requests" ADD CONSTRAINT "visit_line_add_requests_actor_user_id_fkey" FOREIGN KEY ("actor_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "visit_line_add_requests" ADD CONSTRAINT "visit_line_add_requests_visit_service_line_id_fkey" FOREIGN KEY ("visit_service_line_id") REFERENCES "visit_service_lines"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- Permanent history: never updated, deleted or truncated (the existing Phase 1 helper).
CREATE TRIGGER "visit_line_add_requests_append_only" BEFORE UPDATE OR DELETE ON "visit_line_add_requests"
FOR EACH ROW EXECUTE FUNCTION lucy_reject_permanent_history_mutation();
CREATE TRIGGER "visit_line_add_requests_no_truncate" BEFORE TRUNCATE ON "visit_line_add_requests"
FOR EACH STATEMENT EXECUTE FUNCTION lucy_reject_permanent_history_mutation();
