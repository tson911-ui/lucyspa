-- Follow-up Step 6: collaborator (CTV) work occurrences with manually agreed pay.
-- One row per scheduled occurrence; rows are never deleted (cancellation keeps history).
-- agreed_pay_vnd is the single economic source amount for later payroll and branch cost
-- reporting (personnel/operating cost, never depreciation). Times are minutes of the
-- branch-local work date (no overnight). FULL_DAY stores a snapshot of the branch hours.

-- CreateEnum
CREATE TYPE "CollaboratorWorkMode" AS ENUM ('SHIFT', 'FULL_DAY');

-- CreateEnum
CREATE TYPE "CollaboratorWorkStatus" AS ENUM ('SCHEDULED', 'CANCELLED');

-- CreateTable
CREATE TABLE "collaborator_work_occurrences" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "employee_user_id" UUID NOT NULL,
    "branch_id" UUID NOT NULL,
    "work_date" DATE NOT NULL,
    "mode" "CollaboratorWorkMode" NOT NULL,
    "start_minute" SMALLINT NOT NULL,
    "end_minute" SMALLINT NOT NULL,
    "agreed_pay_vnd" BIGINT,
    "status" "CollaboratorWorkStatus" NOT NULL DEFAULT 'SCHEDULED',
    "note" TEXT,
    "created_by_user_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_by_user_id" UUID NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "cancelled_by_user_id" UUID,
    "cancelled_at" TIMESTAMPTZ(3),
    "cancel_reason" TEXT,
    "row_version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "collaborator_work_occurrences_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "collaborator_work_employee_date_idx" ON "collaborator_work_occurrences"("employee_user_id", "work_date", "status");

-- CreateIndex
CREATE INDEX "collaborator_work_branch_date_idx" ON "collaborator_work_occurrences"("branch_id", "work_date", "status");

-- CreateIndex
CREATE INDEX "collaborator_work_creator_idx" ON "collaborator_work_occurrences"("created_by_user_id");

-- CreateIndex
CREATE INDEX "collaborator_work_updater_idx" ON "collaborator_work_occurrences"("updated_by_user_id");

-- CreateIndex
CREATE INDEX "collaborator_work_canceller_idx" ON "collaborator_work_occurrences"("cancelled_by_user_id");

-- AddForeignKey
ALTER TABLE "collaborator_work_occurrences" ADD CONSTRAINT "collaborator_work_occurrences_employee_user_id_fkey" FOREIGN KEY ("employee_user_id") REFERENCES "employee_profiles"("user_id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "collaborator_work_occurrences" ADD CONSTRAINT "collaborator_work_occurrences_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "collaborator_work_occurrences" ADD CONSTRAINT "collaborator_work_occurrences_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "collaborator_work_occurrences" ADD CONSTRAINT "collaborator_work_occurrences_updated_by_user_id_fkey" FOREIGN KEY ("updated_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "collaborator_work_occurrences" ADD CONSTRAINT "collaborator_work_occurrences_cancelled_by_user_id_fkey" FOREIGN KEY ("cancelled_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- SQL-only shape rules (the API enforces classification, assignment, hours and overlap).
ALTER TABLE "collaborator_work_occurrences"
  ADD CONSTRAINT "collaborator_work_minutes" CHECK (
    "start_minute" >= 0 AND "end_minute" <= 1440 AND "start_minute" < "end_minute"
  ),
  ADD CONSTRAINT "collaborator_work_pay_nonnegative" CHECK (
    "agreed_pay_vnd" IS NULL OR "agreed_pay_vnd" >= 0
  ),
  ADD CONSTRAINT "collaborator_work_cancellation" CHECK (
    ("status" = 'SCHEDULED' AND "cancelled_by_user_id" IS NULL AND "cancelled_at" IS NULL
      AND "cancel_reason" IS NULL)
    OR ("status" = 'CANCELLED' AND "cancelled_by_user_id" IS NOT NULL AND "cancelled_at" IS NOT NULL
      AND "cancel_reason" IS NOT NULL AND length(btrim("cancel_reason")) > 0)
  ),
  ADD CONSTRAINT "collaborator_work_version_positive" CHECK ("row_version" > 0);

-- Backstop: a FULL_DAY occurrence is the collaborator's only scheduled work that date.
CREATE UNIQUE INDEX "collaborator_work_full_day_key"
  ON "collaborator_work_occurrences" ("employee_user_id", "work_date")
  WHERE "status" = 'SCHEDULED' AND "mode" = 'FULL_DAY';

-- History guard: no deletes; identity and creation are immutable; a cancelled occurrence
-- is final; every change bumps row_version by exactly one; new rows start SCHEDULED.
CREATE FUNCTION lucy_guard_collaborator_work() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Collaborator work occurrences are never deleted';
  ELSIF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'SCHEDULED' OR NEW.row_version <> 1 THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'A collaborator work occurrence starts SCHEDULED at version 1';
    END IF;
  ELSE
    IF (NEW.id, NEW.employee_user_id, NEW.created_by_user_id, NEW.created_at)
        IS DISTINCT FROM (OLD.id, OLD.employee_user_id, OLD.created_by_user_id, OLD.created_at)
      OR (OLD.status = 'CANCELLED' AND NEW IS DISTINCT FROM OLD)
      OR (NEW IS DISTINCT FROM OLD AND NEW.row_version <> OLD.row_version + 1) THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Collaborator work identity, history and version cannot be rewritten';
    END IF;
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$;
CREATE TRIGGER "collaborator_work_occurrences_guard"
BEFORE INSERT OR UPDATE OR DELETE ON "collaborator_work_occurrences"
FOR EACH ROW EXECUTE FUNCTION lucy_guard_collaborator_work();

-- Function hardening (the Phase 1 convention): a fixed search_path and no PUBLIC execute.
-- lucy_guard_auth_challenge is included because the Step 5 CREATE OR REPLACE reset its
-- search_path setting; this restores it without changing its body.
DO $$
DECLARE
  migration_schema text := current_schema();
  function_name text;
BEGIN
  FOREACH function_name IN ARRAY ARRAY['lucy_guard_collaborator_work', 'lucy_guard_auth_challenge'] LOOP
    EXECUTE format('ALTER FUNCTION %I.%I() SET search_path TO pg_catalog, %I, pg_temp',
      migration_schema, function_name, migration_schema);
    EXECUTE format('REVOKE ALL ON FUNCTION %I.%I() FROM PUBLIC', migration_schema, function_name);
  END LOOP;
END;
$$;
