-- Phase 2 Step 2 only: additive schema for services, skills, branch hours, attendance
-- and leave, plus the Phase 2 permission codes. No catalog rows, branches, hours or
-- other business data are seeded. Phase 0/1 tables and rows are preserved.
-- SQL-only constraints are intentional and must be retained in future migrations.

-- CreateEnum
CREATE TYPE "LeaveStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'CANCELLED');

-- Rebuild PermissionCode with the Phase 2 codes. Labels added by ALTER TYPE ... ADD
-- VALUE cannot be used in the transaction that adds them, and the catalog CHECK below
-- must name them, so the type is rebuilt in place. permissions.code is its only
-- column; rows, ids and the unique index are preserved (the column is cast by label).
ALTER TABLE "permissions" DROP CONSTRAINT "permissions_phase1_catalog_semantics";
ALTER TYPE "PermissionCode" RENAME TO "PermissionCode_phase1";
CREATE TYPE "PermissionCode" AS ENUM ('VIEW_EMPLOYEES', 'CREATE_EMPLOYEES', 'UPDATE_EMPLOYEES', 'MANAGE_EMPLOYEE_STATUS', 'MANAGE_EMPLOYEE_ACCESS', 'MANAGE_EMPLOYEE_SCOPE', 'VIEW_EMPLOYEE_PAY', 'MANAGE_EMPLOYEE_PAY', 'MANAGE_PERMISSIONS', 'VIEW_AUDIT_LOG', 'MANAGE_BRANCHES', 'MANAGE_SERVICES', 'MANAGE_SERVICE_PRICES', 'MANAGE_SKILLS', 'VIEW_ATTENDANCE', 'MANAGE_ATTENDANCE', 'APPROVE_LEAVE');
ALTER TABLE "permissions" ALTER COLUMN "code" TYPE "PermissionCode" USING ("code"::text::"PermissionCode");
DROP TYPE "PermissionCode_phase1";

-- CreateTable
CREATE TABLE "service_categories" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "code" TEXT NOT NULL,
    "name_vi" TEXT NOT NULL,
    "name_en" TEXT NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "row_version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "service_categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "services" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "code" TEXT NOT NULL,
    "category_id" UUID NOT NULL,
    "name_vi" TEXT NOT NULL,
    "name_en" TEXT NOT NULL,
    "description_vi" TEXT,
    "description_en" TEXT,
    "price_vnd" BIGINT NOT NULL,
    "duration_minutes" INTEGER NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "row_version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "services_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "skills" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "code" TEXT NOT NULL,
    "name_vi" TEXT NOT NULL,
    "name_en" TEXT NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "row_version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "skills_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "service_skills" (
    "service_id" UUID NOT NULL,
    "skill_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "service_skills_pkey" PRIMARY KEY ("service_id","skill_id")
);

-- CreateTable
CREATE TABLE "service_branch_availability" (
    "service_id" UUID NOT NULL,
    "branch_id" UUID NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "row_version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "service_branch_availability_pkey" PRIMARY KEY ("service_id","branch_id")
);

-- CreateTable
CREATE TABLE "employee_skills" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "employee_user_id" UUID NOT NULL,
    "skill_id" UUID NOT NULL,
    "granted_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revoked_at" TIMESTAMPTZ(3),
    "granted_by_user_id" UUID NOT NULL,

    CONSTRAINT "employee_skills_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "branch_operating_hours" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "branch_id" UUID NOT NULL,
    "iso_weekday" SMALLINT NOT NULL,
    "is_closed" BOOLEAN NOT NULL DEFAULT false,
    "opens_at_minute" SMALLINT,
    "closes_at_minute" SMALLINT,
    "row_version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "branch_operating_hours_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "attendance_records" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "employee_user_id" UUID NOT NULL,
    "branch_id" UUID NOT NULL,
    "business_date" DATE NOT NULL,
    "check_in_at" TIMESTAMPTZ(3) NOT NULL,
    "check_out_at" TIMESTAMPTZ(3),
    "row_version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "attendance_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "leave_requests" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "employee_user_id" UUID NOT NULL,
    "start_date" DATE NOT NULL,
    "end_date" DATE NOT NULL,
    "reason" TEXT NOT NULL,
    "status" "LeaveStatus" NOT NULL DEFAULT 'PENDING',
    "requested_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decided_by_user_id" UUID,
    "decided_at" TIMESTAMPTZ(3),
    "decision_reason" TEXT,
    "cancelled_by_user_id" UUID,
    "cancelled_at" TIMESTAMPTZ(3),
    "cancellation_reason" TEXT,
    "row_version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "leave_requests_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "service_categories_code_key" ON "service_categories"("code");

-- CreateIndex
CREATE INDEX "service_categories_active_order_idx" ON "service_categories"("is_active", "sort_order", "id");

-- CreateIndex
CREATE UNIQUE INDEX "services_code_key" ON "services"("code");

-- CreateIndex
CREATE INDEX "services_category_idx" ON "services"("category_id", "is_active", "id");

-- CreateIndex
CREATE UNIQUE INDEX "skills_code_key" ON "skills"("code");

-- CreateIndex
CREATE INDEX "service_skills_skill_idx" ON "service_skills"("skill_id");

-- CreateIndex
CREATE INDEX "service_branch_availability_branch_idx" ON "service_branch_availability"("branch_id", "is_active", "service_id");

-- CreateIndex
CREATE INDEX "employee_skills_employee_idx" ON "employee_skills"("employee_user_id", "revoked_at", "skill_id");

-- CreateIndex
CREATE INDEX "employee_skills_skill_idx" ON "employee_skills"("skill_id", "revoked_at", "employee_user_id");

-- CreateIndex
CREATE INDEX "employee_skills_grantor_idx" ON "employee_skills"("granted_by_user_id");

-- CreateIndex
CREATE UNIQUE INDEX "branch_operating_hours_branch_weekday_key" ON "branch_operating_hours"("branch_id", "iso_weekday");

-- CreateIndex
CREATE INDEX "attendance_records_branch_date_idx" ON "attendance_records"("branch_id", "business_date", "employee_user_id");

-- CreateIndex
CREATE INDEX "attendance_records_employee_open_idx" ON "attendance_records"("employee_user_id", "check_out_at");

-- CreateIndex
CREATE UNIQUE INDEX "attendance_records_employee_branch_date_key" ON "attendance_records"("employee_user_id", "branch_id", "business_date");

-- CreateIndex
CREATE INDEX "leave_requests_employee_idx" ON "leave_requests"("employee_user_id", "status", "start_date");

-- CreateIndex
CREATE INDEX "leave_requests_status_dates_idx" ON "leave_requests"("status", "start_date", "end_date");

-- CreateIndex
CREATE INDEX "leave_requests_decider_idx" ON "leave_requests"("decided_by_user_id");

-- CreateIndex
CREATE INDEX "leave_requests_canceller_idx" ON "leave_requests"("cancelled_by_user_id");

-- AddForeignKey
ALTER TABLE "services" ADD CONSTRAINT "services_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "service_categories"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "service_skills" ADD CONSTRAINT "service_skills_service_id_fkey" FOREIGN KEY ("service_id") REFERENCES "services"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "service_skills" ADD CONSTRAINT "service_skills_skill_id_fkey" FOREIGN KEY ("skill_id") REFERENCES "skills"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "service_branch_availability" ADD CONSTRAINT "service_branch_availability_service_id_fkey" FOREIGN KEY ("service_id") REFERENCES "services"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "service_branch_availability" ADD CONSTRAINT "service_branch_availability_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "employee_skills" ADD CONSTRAINT "employee_skills_employee_user_id_fkey" FOREIGN KEY ("employee_user_id") REFERENCES "employee_profiles"("user_id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "employee_skills" ADD CONSTRAINT "employee_skills_skill_id_fkey" FOREIGN KEY ("skill_id") REFERENCES "skills"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "employee_skills" ADD CONSTRAINT "employee_skills_granted_by_user_id_fkey" FOREIGN KEY ("granted_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "branch_operating_hours" ADD CONSTRAINT "branch_operating_hours_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "attendance_records" ADD CONSTRAINT "attendance_records_employee_user_id_fkey" FOREIGN KEY ("employee_user_id") REFERENCES "employee_profiles"("user_id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "attendance_records" ADD CONSTRAINT "attendance_records_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "leave_requests" ADD CONSTRAINT "leave_requests_employee_user_id_fkey" FOREIGN KEY ("employee_user_id") REFERENCES "employee_profiles"("user_id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "leave_requests" ADD CONSTRAINT "leave_requests_decided_by_user_id_fkey" FOREIGN KEY ("decided_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "leave_requests" ADD CONSTRAINT "leave_requests_cancelled_by_user_id_fkey" FOREIGN KEY ("cancelled_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- ---------------------------------------------------------------------------
-- SQL-only invariants (not expressible in Prisma)

-- Permission catalog semantics. MANAGE_SERVICE_PRICES is the only GLOBAL_ONLY code:
-- a service has one price for every branch. Every other code stays BRANCH_CAPABLE
-- (catalog-wide actions still require GLOBAL grants in the engine). Only the two
-- pay codes are EMPLOYEE_PAY data.
ALTER TABLE "permissions"
  ADD CONSTRAINT "permissions_catalog_semantics" CHECK (
    (("code" = 'MANAGE_SERVICE_PRICES' AND "scope_capability" = 'GLOBAL_ONLY')
      OR ("code" <> 'MANAGE_SERVICE_PRICES' AND "scope_capability" = 'BRANCH_CAPABLE'))
    AND (("code" IN ('VIEW_EMPLOYEE_PAY', 'MANAGE_EMPLOYEE_PAY') AND "data_classification" = 'EMPLOYEE_PAY')
      OR ("code" NOT IN ('VIEW_EMPLOYEE_PAY', 'MANAGE_EMPLOYEE_PAY') AND "data_classification" = 'STANDARD'))
  );

-- A GLOBAL_ONLY permission cannot be overridden at branch scope: such a row could never
-- take effect and would misrepresent authority.
CREATE FUNCTION lucy_check_override_scope_capability() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.scope_kind = 'BRANCH' AND EXISTS (
    SELECT 1 FROM permissions WHERE id = NEW.permission_id AND scope_capability = 'GLOBAL_ONLY'
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'A GLOBAL_ONLY permission cannot be overridden at branch scope';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "user_permission_overrides_scope_capability" BEFORE INSERT OR UPDATE ON "user_permission_overrides"
FOR EACH ROW EXECUTE FUNCTION lucy_check_override_scope_capability();

-- Catalog codes are canonical uppercase identifiers; names are never blank.
ALTER TABLE "service_categories"
  ADD CONSTRAINT "service_categories_code_canonical" CHECK ("code" ~ '^[A-Z][A-Z0-9_]{0,63}$'),
  ADD CONSTRAINT "service_categories_names_nonblank" CHECK ("name_vi" !~ '^[[:space:]]*$' AND "name_en" !~ '^[[:space:]]*$'),
  ADD CONSTRAINT "service_categories_sort_order_nonnegative" CHECK ("sort_order" >= 0),
  ADD CONSTRAINT "service_categories_version_positive" CHECK ("row_version" > 0);

-- VND is an integer amount; one concrete internal duration of 1 minute to 24 hours.
ALTER TABLE "services"
  ADD CONSTRAINT "services_code_canonical" CHECK ("code" ~ '^[A-Z][A-Z0-9_]{0,63}$'),
  ADD CONSTRAINT "services_names_nonblank" CHECK ("name_vi" !~ '^[[:space:]]*$' AND "name_en" !~ '^[[:space:]]*$'),
  ADD CONSTRAINT "services_descriptions_nonblank" CHECK (
    ("description_vi" IS NULL OR "description_vi" !~ '^[[:space:]]*$')
    AND ("description_en" IS NULL OR "description_en" !~ '^[[:space:]]*$')
  ),
  ADD CONSTRAINT "services_price_nonnegative" CHECK ("price_vnd" >= 0),
  ADD CONSTRAINT "services_duration_positive" CHECK ("duration_minutes" BETWEEN 1 AND 1440),
  ADD CONSTRAINT "services_version_positive" CHECK ("row_version" > 0);

ALTER TABLE "skills"
  ADD CONSTRAINT "skills_code_canonical" CHECK ("code" ~ '^[A-Z][A-Z0-9_]{0,63}$'),
  ADD CONSTRAINT "skills_names_nonblank" CHECK ("name_vi" !~ '^[[:space:]]*$' AND "name_en" !~ '^[[:space:]]*$'),
  ADD CONSTRAINT "skills_version_positive" CHECK ("row_version" > 0);

ALTER TABLE "service_branch_availability"
  ADD CONSTRAINT "service_branch_availability_version_positive" CHECK ("row_version" > 0);

-- Employee skills keep history like branch memberships: one active pair, one-way
-- revocation, immutable grant facts, no deletion.
ALTER TABLE "employee_skills"
  ADD CONSTRAINT "employee_skills_revocation_order" CHECK ("revoked_at" IS NULL OR "revoked_at" >= "granted_at");
CREATE UNIQUE INDEX "employee_skills_active_key"
  ON "employee_skills" ("employee_user_id", "skill_id") WHERE "revoked_at" IS NULL;
CREATE FUNCTION lucy_guard_employee_skill_history() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Employee skill history cannot be deleted';
  END IF;
  IF (NEW.id, NEW.employee_user_id, NEW.skill_id, NEW.granted_at, NEW.granted_by_user_id)
    IS DISTINCT FROM (OLD.id, OLD.employee_user_id, OLD.skill_id, OLD.granted_at, OLD.granted_by_user_id)
    OR (OLD.revoked_at IS NOT NULL AND NEW.revoked_at IS DISTINCT FROM OLD.revoked_at) THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Employee skill grant history and completed revocation are immutable';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "employee_skills_history_guard" BEFORE UPDATE OR DELETE ON "employee_skills"
FOR EACH ROW EXECUTE FUNCTION lucy_guard_employee_skill_history();
CREATE TRIGGER "employee_skills_no_truncate" BEFORE TRUNCATE ON "employee_skills"
FOR EACH STATEMENT EXECUTE FUNCTION lucy_reject_permanent_history_mutation();

-- Wall-clock minutes in branch-local time. Open days need 0 <= open < close <= 1440;
-- closed days carry no times.
ALTER TABLE "branch_operating_hours"
  ADD CONSTRAINT "branch_operating_hours_iso_weekday" CHECK ("iso_weekday" BETWEEN 1 AND 7),
  ADD CONSTRAINT "branch_operating_hours_times" CHECK (
    ("is_closed" AND "opens_at_minute" IS NULL AND "closes_at_minute" IS NULL)
    OR (NOT "is_closed" AND "opens_at_minute" IS NOT NULL AND "closes_at_minute" IS NOT NULL
      AND "opens_at_minute" >= 0 AND "closes_at_minute" <= 1440
      AND "opens_at_minute" < "closes_at_minute")
  ),
  ADD CONSTRAINT "branch_operating_hours_version_positive" CHECK ("row_version" > 0);

-- Attendance: check-out strictly after check-in; business_date is the check-in's
-- calendar date in the branch timezone; a record never moves to another employee.
ALTER TABLE "attendance_records"
  ADD CONSTRAINT "attendance_records_check_out_order" CHECK ("check_out_at" IS NULL OR "check_out_at" > "check_in_at"),
  ADD CONSTRAINT "attendance_records_timestamps_finite" CHECK (isfinite("check_in_at") AND ("check_out_at" IS NULL OR isfinite("check_out_at"))),
  ADD CONSTRAINT "attendance_records_version_positive" CHECK ("row_version" > 0);
CREATE FUNCTION lucy_check_attendance_record() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  zone text;
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.employee_user_id IS DISTINCT FROM OLD.employee_user_id THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'An attendance record cannot move to another employee';
  END IF;
  SELECT timezone INTO zone FROM branches WHERE id = NEW.branch_id;
  IF FOUND AND NEW.business_date IS DISTINCT FROM (NEW.check_in_at AT TIME ZONE zone)::date THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Attendance business date must be the check-in date in the branch timezone';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "attendance_records_guard" BEFORE INSERT OR UPDATE ON "attendance_records"
FOR EACH ROW EXECUTE FUNCTION lucy_check_attendance_record();
CREATE TRIGGER "attendance_records_no_truncate" BEFORE TRUNCATE ON "attendance_records"
FOR EACH STATEMENT EXECUTE FUNCTION lucy_reject_permanent_history_mutation();

-- Leave: whole calendar days; decision/cancellation facts match the status; a decision
-- is never made by the requesting employee.
ALTER TABLE "leave_requests"
  ADD CONSTRAINT "leave_requests_date_order" CHECK ("end_date" >= "start_date"),
  ADD CONSTRAINT "leave_requests_dates_finite" CHECK (isfinite("start_date") AND isfinite("end_date")),
  ADD CONSTRAINT "leave_requests_text_nonblank" CHECK (
    "reason" !~ '^[[:space:]]*$'
    AND ("decision_reason" IS NULL OR "decision_reason" !~ '^[[:space:]]*$')
    AND ("cancellation_reason" IS NULL OR "cancellation_reason" !~ '^[[:space:]]*$')
  ),
  ADD CONSTRAINT "leave_requests_status_facts" CHECK (
    (("decided_by_user_id" IS NULL) = ("decided_at" IS NULL))
    AND (("cancelled_by_user_id" IS NULL) = ("cancelled_at" IS NULL))
    AND (
      ("status" = 'PENDING' AND "decided_at" IS NULL AND "decision_reason" IS NULL
        AND "cancelled_at" IS NULL AND "cancellation_reason" IS NULL)
      OR ("status" IN ('APPROVED', 'REJECTED') AND "decided_at" IS NOT NULL
        AND "cancelled_at" IS NULL AND "cancellation_reason" IS NULL)
      OR ("status" = 'CANCELLED' AND "cancelled_at" IS NOT NULL
        AND ("decided_at" IS NOT NULL OR "decision_reason" IS NULL))
    )
  ),
  ADD CONSTRAINT "leave_requests_no_self_decision" CHECK ("decided_by_user_id" IS DISTINCT FROM "employee_user_id"),
  ADD CONSTRAINT "leave_requests_timeline" CHECK (
    ("decided_at" IS NULL OR "decided_at" >= "requested_at")
    AND ("cancelled_at" IS NULL OR "cancelled_at" >= "requested_at")
    AND ("cancelled_at" IS NULL OR "decided_at" IS NULL OR "cancelled_at" >= "decided_at")
  ),
  ADD CONSTRAINT "leave_requests_version_positive" CHECK ("row_version" > 0);

-- Allowed transitions: PENDING -> PENDING (the request itself may be edited), APPROVED,
-- REJECTED or CANCELLED; APPROVED -> CANCELLED (a later authorized workflow). REJECTED
-- and CANCELLED are terminal. Request and decision facts are frozen once decided, and
-- history is never deleted.
CREATE FUNCTION lucy_guard_leave_request() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Leave request history cannot be deleted';
  END IF;
  IF (NEW.id, NEW.employee_user_id, NEW.requested_at, NEW.created_at)
    IS DISTINCT FROM (OLD.id, OLD.employee_user_id, OLD.requested_at, OLD.created_at)
    OR (OLD.status IN ('REJECTED', 'CANCELLED') AND NEW IS DISTINCT FROM OLD)
    OR (OLD.status = 'APPROVED' AND NEW.status NOT IN ('APPROVED', 'CANCELLED'))
    OR (OLD.status <> 'PENDING' AND (NEW.start_date, NEW.end_date, NEW.reason,
        NEW.decided_by_user_id, NEW.decided_at, NEW.decision_reason)
      IS DISTINCT FROM (OLD.start_date, OLD.end_date, OLD.reason,
        OLD.decided_by_user_id, OLD.decided_at, OLD.decision_reason))
    OR (OLD.status = 'PENDING' AND NEW.status <> 'PENDING'
      AND (NEW.start_date, NEW.end_date, NEW.reason)
        IS DISTINCT FROM (OLD.start_date, OLD.end_date, OLD.reason)) THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Leave request transition or history rewrite is not allowed';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "leave_requests_lifecycle_guard" BEFORE UPDATE OR DELETE ON "leave_requests"
FOR EACH ROW EXECUTE FUNCTION lucy_guard_leave_request();
CREATE TRIGGER "leave_requests_no_truncate" BEFORE TRUNCATE ON "leave_requests"
FOR EACH STATEMENT EXECUTE FUNCTION lucy_reject_permanent_history_mutation();
