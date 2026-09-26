-- Phase 3 Step 2: Booking & Visits database foundation (docs/PHASE3_BOOKING_VISITS_DESIGN.md).
-- Additive only. Tables and invariants for bookings, recipients, booking and visit service
-- lines, visits, participants, service executions, KTV assignment history, the derived KTV
-- occupancy with a btree_gist overlap backstop (O9), the configuration registry (section 18)
-- and the catalog rule for the new GLOBAL_ONLY permission. No application behavior, and no
-- billing columns: the catalog snapshot on lines is historical reference only (O5).

-- Overlap backstop (O9). Trusted extension (PostgreSQL 13+); bundled with postgres:17-alpine.
CREATE EXTENSION IF NOT EXISTS btree_gist;

-- CreateEnum
CREATE TYPE "BookingStatus" AS ENUM ('CONFIRMED', 'CHECKED_IN', 'CANCELLED', 'NO_SHOW');

-- CreateEnum
CREATE TYPE "BookingChannel" AS ENUM ('ONLINE', 'DESK');

-- CreateEnum
CREATE TYPE "BookingRecipientRelation" AS ENUM ('SELF', 'CHILD', 'FAMILY', 'OTHER');

-- CreateEnum
CREATE TYPE "KtvAssignmentMode" AS ENUM ('SPECIFIC', 'ANY');

-- CreateEnum
CREATE TYPE "AssignmentConflict" AS ENUM ('LEAVE');

-- CreateEnum
CREATE TYPE "AssignmentChangeReason" AS ENUM ('LEAVE', 'CUSTOMER_CHOICE', 'MANAGER');

-- CreateEnum
CREATE TYPE "VisitOrigin" AS ENUM ('BOOKING', 'WALK_IN');

-- CreateEnum
CREATE TYPE "VisitStatus" AS ENUM ('OPEN', 'IN_SERVICE', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "VisitParticipantKind" AS ENUM ('MEMBER', 'GUEST', 'CHILD');

-- CreateEnum
CREATE TYPE "VisitServiceLineStatus" AS ENUM ('PLANNED', 'IN_PROGRESS', 'DONE', 'CANCELLED');

-- CreateEnum
CREATE TYPE "ServiceExecutionStatus" AS ENUM ('IN_PROGRESS', 'ENDED');

-- CreateEnum
CREATE TYPE "ServiceExecutionEndKind" AS ENUM ('NORMAL', 'MANAGER_RESOLVED');

-- CreateTable
CREATE TABLE "bookings" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "code" TEXT NOT NULL,
    "branch_id" UUID NOT NULL,
    "owner_user_id" UUID NOT NULL,
    "status" "BookingStatus" NOT NULL DEFAULT 'CONFIRMED',
    "channel" "BookingChannel" NOT NULL,
    "starts_at" TIMESTAMPTZ(3) NOT NULL,
    "ends_at" TIMESTAMPTZ(3) NOT NULL,
    "service_date" DATE NOT NULL,
    "idempotency_key" UUID NOT NULL,
    "created_by_user_id" UUID NOT NULL,
    "checked_in_at" TIMESTAMPTZ(3),
    "checked_in_by_user_id" UUID,
    "cancelled_at" TIMESTAMPTZ(3),
    "cancelled_by_user_id" UUID,
    "cancel_reason" TEXT,
    "cancelled_late" BOOLEAN,
    "no_show_at" TIMESTAMPTZ(3),
    "no_show_by_user_id" UUID,
    "no_show_reason" TEXT,
    "row_version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "bookings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "booking_recipients" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "booking_id" UUID NOT NULL,
    "relation" "BookingRecipientRelation" NOT NULL,
    "display_name" TEXT,
    "phone" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "booking_recipients_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "booking_service_lines" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "booking_id" UUID NOT NULL,
    "sequence" SMALLINT NOT NULL,
    "recipient_id" UUID NOT NULL,
    "service_id" UUID NOT NULL,
    "employee_user_id" UUID NOT NULL,
    "assignment_mode" "KtvAssignmentMode" NOT NULL,
    "planned_start_at" TIMESTAMPTZ(3) NOT NULL,
    "planned_end_at" TIMESTAMPTZ(3) NOT NULL,
    "duration_minutes" INTEGER NOT NULL,
    "buffer_minutes" INTEGER NOT NULL,
    "service_code" TEXT NOT NULL,
    "service_name_vi" TEXT NOT NULL,
    "service_name_en" TEXT NOT NULL,
    "catalog_price_min_vnd" BIGINT NOT NULL,
    "catalog_price_max_vnd" BIGINT NOT NULL,
    "catalog_pricing_unit" "ServicePricingUnit" NOT NULL,
    "assignment_conflict" "AssignmentConflict",
    "row_version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "booking_service_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "visits" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "code" TEXT NOT NULL,
    "branch_id" UUID NOT NULL,
    "origin" "VisitOrigin" NOT NULL,
    "booking_id" UUID,
    "owner_user_id" UUID,
    "status" "VisitStatus" NOT NULL DEFAULT 'OPEN',
    "service_date" DATE NOT NULL,
    "arrived_at" TIMESTAMPTZ(3) NOT NULL,
    "completed_at" TIMESTAMPTZ(3),
    "cancelled_at" TIMESTAMPTZ(3),
    "cancelled_by_user_id" UUID,
    "cancel_reason" TEXT,
    "queue_override_at" TIMESTAMPTZ(3),
    "queue_override_by_user_id" UUID,
    "created_by_user_id" UUID NOT NULL,
    "idempotency_key" UUID,
    "row_version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "visits_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "visit_participants" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "visit_id" UUID NOT NULL,
    "kind" "VisitParticipantKind" NOT NULL,
    "customer_user_id" UUID,
    "display_name" TEXT,
    "phone" TEXT,
    "note" TEXT,
    "guardian_participant_id" UUID,
    "booking_recipient_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "visit_participants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "visit_service_lines" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "visit_id" UUID NOT NULL,
    "participant_id" UUID NOT NULL,
    "sequence" SMALLINT NOT NULL,
    "booking_service_line_id" UUID,
    "service_id" UUID NOT NULL,
    "employee_user_id" UUID NOT NULL,
    "assignment_mode" "KtvAssignmentMode" NOT NULL,
    "status" "VisitServiceLineStatus" NOT NULL DEFAULT 'PLANNED',
    "planned_start_at" TIMESTAMPTZ(3) NOT NULL,
    "planned_end_at" TIMESTAMPTZ(3) NOT NULL,
    "duration_minutes" INTEGER NOT NULL,
    "buffer_minutes" INTEGER NOT NULL,
    "service_code" TEXT NOT NULL,
    "service_name_vi" TEXT NOT NULL,
    "service_name_en" TEXT NOT NULL,
    "catalog_price_min_vnd" BIGINT NOT NULL,
    "catalog_price_max_vnd" BIGINT NOT NULL,
    "catalog_pricing_unit" "ServicePricingUnit" NOT NULL,
    "added_on_behalf" BOOLEAN NOT NULL DEFAULT false,
    "added_by_user_id" UUID,
    "added_at" TIMESTAMPTZ(3),
    "cancelled_at" TIMESTAMPTZ(3),
    "cancelled_by_user_id" UUID,
    "cancel_reason" TEXT,
    "assignment_conflict" "AssignmentConflict",
    "start_overdue_warned_at" TIMESTAMPTZ(3),
    "row_version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "visit_service_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "service_executions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "visit_service_line_id" UUID NOT NULL,
    "employee_user_id" UUID NOT NULL,
    "status" "ServiceExecutionStatus" NOT NULL DEFAULT 'IN_PROGRESS',
    "started_at" TIMESTAMPTZ(3) NOT NULL,
    "expected_end_at" TIMESTAMPTZ(3) NOT NULL,
    "ended_at" TIMESTAMPTZ(3),
    "end_kind" "ServiceExecutionEndKind",
    "ended_by_user_id" UUID,
    "resolution_reason" TEXT,
    "pre_end_warned_at" TIMESTAMPTZ(3),
    "end_overdue_warned_at" TIMESTAMPTZ(3),
    "row_version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "service_executions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "service_line_assignment_changes" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "booking_service_line_id" UUID,
    "visit_service_line_id" UUID,
    "from_employee_user_id" UUID NOT NULL,
    "to_employee_user_id" UUID NOT NULL,
    "reason" "AssignmentChangeReason" NOT NULL,
    "note" TEXT,
    "actor_user_id" UUID NOT NULL,
    "occurred_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "service_line_assignment_changes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "app_settings" (
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "row_version" INTEGER NOT NULL DEFAULT 1,
    "updated_by_user_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "app_settings_pkey" PRIMARY KEY ("key")
);

-- CreateTable (derived; maintained only by the triggers below)
CREATE TABLE "ktv_occupancies" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "employee_user_id" UUID NOT NULL,
    "period" tstzrange NOT NULL,
    "booking_service_line_id" UUID,
    "visit_service_line_id" UUID,

    CONSTRAINT "ktv_occupancies_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "bookings_code_key" ON "bookings"("code");
CREATE UNIQUE INDEX "bookings_creator_idempotency_key" ON "bookings"("created_by_user_id", "idempotency_key");
CREATE INDEX "bookings_branch_date_idx" ON "bookings"("branch_id", "service_date", "status");
CREATE INDEX "bookings_owner_idx" ON "bookings"("owner_user_id", "starts_at");
CREATE INDEX "bookings_checked_in_by_idx" ON "bookings"("checked_in_by_user_id");
CREATE INDEX "bookings_cancelled_by_idx" ON "bookings"("cancelled_by_user_id");
CREATE INDEX "bookings_no_show_by_idx" ON "bookings"("no_show_by_user_id");
CREATE UNIQUE INDEX "booking_recipients_booking_id_id_key" ON "booking_recipients"("booking_id", "id");
CREATE UNIQUE INDEX "booking_service_lines_booking_sequence_key" ON "booking_service_lines"("booking_id", "sequence");
CREATE INDEX "booking_service_lines_employee_idx" ON "booking_service_lines"("employee_user_id", "planned_start_at");
CREATE INDEX "booking_service_lines_service_idx" ON "booking_service_lines"("service_id");
CREATE INDEX "booking_service_lines_recipient_idx" ON "booking_service_lines"("booking_id", "recipient_id");
CREATE UNIQUE INDEX "visits_code_key" ON "visits"("code");
CREATE UNIQUE INDEX "visits_booking_id_key" ON "visits"("booking_id");
CREATE UNIQUE INDEX "visits_creator_idempotency_key" ON "visits"("created_by_user_id", "idempotency_key");
CREATE INDEX "visits_branch_date_idx" ON "visits"("branch_id", "service_date", "status");
CREATE INDEX "visits_owner_idx" ON "visits"("owner_user_id");
CREATE INDEX "visits_cancelled_by_idx" ON "visits"("cancelled_by_user_id");
CREATE INDEX "visits_queue_override_by_idx" ON "visits"("queue_override_by_user_id");
CREATE UNIQUE INDEX "visit_participants_visit_id_id_key" ON "visit_participants"("visit_id", "id");
CREATE UNIQUE INDEX "visit_participants_booking_recipient_id_key" ON "visit_participants"("booking_recipient_id");
CREATE INDEX "visit_participants_customer_idx" ON "visit_participants"("customer_user_id");
CREATE INDEX "visit_participants_guardian_idx" ON "visit_participants"("visit_id", "guardian_participant_id");
CREATE UNIQUE INDEX "visit_service_lines_booking_service_line_id_key" ON "visit_service_lines"("booking_service_line_id");
CREATE UNIQUE INDEX "visit_service_lines_participant_sequence_key" ON "visit_service_lines"("participant_id", "sequence");
CREATE INDEX "visit_service_lines_visit_idx" ON "visit_service_lines"("visit_id", "participant_id");
CREATE INDEX "visit_service_lines_employee_idx" ON "visit_service_lines"("employee_user_id", "planned_start_at");
CREATE INDEX "visit_service_lines_service_idx" ON "visit_service_lines"("service_id");
CREATE INDEX "visit_service_lines_added_by_idx" ON "visit_service_lines"("added_by_user_id");
CREATE INDEX "visit_service_lines_cancelled_by_idx" ON "visit_service_lines"("cancelled_by_user_id");
CREATE UNIQUE INDEX "service_executions_visit_service_line_id_key" ON "service_executions"("visit_service_line_id");
CREATE INDEX "service_executions_employee_idx" ON "service_executions"("employee_user_id", "status");
CREATE INDEX "service_executions_ended_by_idx" ON "service_executions"("ended_by_user_id");
CREATE INDEX "assignment_changes_booking_line_idx" ON "service_line_assignment_changes"("booking_service_line_id", "occurred_at");
CREATE INDEX "assignment_changes_visit_line_idx" ON "service_line_assignment_changes"("visit_service_line_id", "occurred_at");
CREATE INDEX "assignment_changes_from_idx" ON "service_line_assignment_changes"("from_employee_user_id");
CREATE INDEX "assignment_changes_to_idx" ON "service_line_assignment_changes"("to_employee_user_id");
CREATE INDEX "assignment_changes_actor_idx" ON "service_line_assignment_changes"("actor_user_id");
CREATE INDEX "app_settings_updated_by_idx" ON "app_settings"("updated_by_user_id");
CREATE UNIQUE INDEX "ktv_occupancies_booking_service_line_id_key" ON "ktv_occupancies"("booking_service_line_id");
CREATE UNIQUE INDEX "ktv_occupancies_visit_service_line_id_key" ON "ktv_occupancies"("visit_service_line_id");

-- AddForeignKey
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_owner_user_id_fkey" FOREIGN KEY ("owner_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_checked_in_by_user_id_fkey" FOREIGN KEY ("checked_in_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_cancelled_by_user_id_fkey" FOREIGN KEY ("cancelled_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_no_show_by_user_id_fkey" FOREIGN KEY ("no_show_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "booking_recipients" ADD CONSTRAINT "booking_recipients_booking_id_fkey" FOREIGN KEY ("booking_id") REFERENCES "bookings"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "booking_service_lines" ADD CONSTRAINT "booking_service_lines_booking_id_fkey" FOREIGN KEY ("booking_id") REFERENCES "bookings"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "booking_service_lines" ADD CONSTRAINT "booking_service_lines_booking_id_recipient_id_fkey" FOREIGN KEY ("booking_id", "recipient_id") REFERENCES "booking_recipients"("booking_id", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "booking_service_lines" ADD CONSTRAINT "booking_service_lines_service_id_fkey" FOREIGN KEY ("service_id") REFERENCES "services"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "booking_service_lines" ADD CONSTRAINT "booking_service_lines_employee_user_id_fkey" FOREIGN KEY ("employee_user_id") REFERENCES "employee_profiles"("user_id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "visits" ADD CONSTRAINT "visits_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "visits" ADD CONSTRAINT "visits_booking_id_fkey" FOREIGN KEY ("booking_id") REFERENCES "bookings"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "visits" ADD CONSTRAINT "visits_owner_user_id_fkey" FOREIGN KEY ("owner_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "visits" ADD CONSTRAINT "visits_cancelled_by_user_id_fkey" FOREIGN KEY ("cancelled_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "visits" ADD CONSTRAINT "visits_queue_override_by_user_id_fkey" FOREIGN KEY ("queue_override_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "visits" ADD CONSTRAINT "visits_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "visit_participants" ADD CONSTRAINT "visit_participants_visit_id_fkey" FOREIGN KEY ("visit_id") REFERENCES "visits"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "visit_participants" ADD CONSTRAINT "visit_participants_customer_user_id_fkey" FOREIGN KEY ("customer_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "visit_participants" ADD CONSTRAINT "visit_participants_visit_id_guardian_participant_id_fkey" FOREIGN KEY ("visit_id", "guardian_participant_id") REFERENCES "visit_participants"("visit_id", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "visit_participants" ADD CONSTRAINT "visit_participants_booking_recipient_id_fkey" FOREIGN KEY ("booking_recipient_id") REFERENCES "booking_recipients"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "visit_service_lines" ADD CONSTRAINT "visit_service_lines_visit_id_fkey" FOREIGN KEY ("visit_id") REFERENCES "visits"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "visit_service_lines" ADD CONSTRAINT "visit_service_lines_visit_id_participant_id_fkey" FOREIGN KEY ("visit_id", "participant_id") REFERENCES "visit_participants"("visit_id", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "visit_service_lines" ADD CONSTRAINT "visit_service_lines_booking_service_line_id_fkey" FOREIGN KEY ("booking_service_line_id") REFERENCES "booking_service_lines"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "visit_service_lines" ADD CONSTRAINT "visit_service_lines_service_id_fkey" FOREIGN KEY ("service_id") REFERENCES "services"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "visit_service_lines" ADD CONSTRAINT "visit_service_lines_employee_user_id_fkey" FOREIGN KEY ("employee_user_id") REFERENCES "employee_profiles"("user_id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "visit_service_lines" ADD CONSTRAINT "visit_service_lines_added_by_user_id_fkey" FOREIGN KEY ("added_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "visit_service_lines" ADD CONSTRAINT "visit_service_lines_cancelled_by_user_id_fkey" FOREIGN KEY ("cancelled_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "service_executions" ADD CONSTRAINT "service_executions_visit_service_line_id_fkey" FOREIGN KEY ("visit_service_line_id") REFERENCES "visit_service_lines"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "service_executions" ADD CONSTRAINT "service_executions_employee_user_id_fkey" FOREIGN KEY ("employee_user_id") REFERENCES "employee_profiles"("user_id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "service_executions" ADD CONSTRAINT "service_executions_ended_by_user_id_fkey" FOREIGN KEY ("ended_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "service_line_assignment_changes" ADD CONSTRAINT "service_line_assignment_changes_booking_service_line_id_fkey" FOREIGN KEY ("booking_service_line_id") REFERENCES "booking_service_lines"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "service_line_assignment_changes" ADD CONSTRAINT "service_line_assignment_changes_visit_service_line_id_fkey" FOREIGN KEY ("visit_service_line_id") REFERENCES "visit_service_lines"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "service_line_assignment_changes" ADD CONSTRAINT "service_line_assignment_changes_from_employee_user_id_fkey" FOREIGN KEY ("from_employee_user_id") REFERENCES "employee_profiles"("user_id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "service_line_assignment_changes" ADD CONSTRAINT "service_line_assignment_changes_to_employee_user_id_fkey" FOREIGN KEY ("to_employee_user_id") REFERENCES "employee_profiles"("user_id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "service_line_assignment_changes" ADD CONSTRAINT "service_line_assignment_changes_actor_user_id_fkey" FOREIGN KEY ("actor_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "app_settings" ADD CONSTRAINT "app_settings_updated_by_user_id_fkey" FOREIGN KEY ("updated_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- ---------------------------------------------------------------- SQL-only shape rules

ALTER TABLE "bookings"
  ADD CONSTRAINT "bookings_code_format" CHECK ("code" ~ '^[A-Z0-9][A-Z0-9-]{3,31}$'),
  ADD CONSTRAINT "bookings_time_order" CHECK ("ends_at" > "starts_at"),
  ADD CONSTRAINT "bookings_version_positive" CHECK ("row_version" > 0),
  -- Status facts: exactly the facts of the current status are set (one stored status).
  ADD CONSTRAINT "bookings_status_facts" CHECK (
    ("status" = 'CONFIRMED' AND "checked_in_at" IS NULL AND "checked_in_by_user_id" IS NULL
      AND "cancelled_at" IS NULL AND "cancelled_by_user_id" IS NULL AND "cancel_reason" IS NULL
      AND "cancelled_late" IS NULL AND "no_show_at" IS NULL AND "no_show_by_user_id" IS NULL
      AND "no_show_reason" IS NULL)
    OR ("status" = 'CHECKED_IN' AND "checked_in_at" IS NOT NULL AND "checked_in_by_user_id" IS NOT NULL
      AND "cancelled_at" IS NULL AND "cancelled_by_user_id" IS NULL AND "cancel_reason" IS NULL
      AND "cancelled_late" IS NULL AND "no_show_at" IS NULL AND "no_show_by_user_id" IS NULL
      AND "no_show_reason" IS NULL)
    OR ("status" = 'CANCELLED' AND "cancelled_at" IS NOT NULL AND "cancelled_by_user_id" IS NOT NULL
      AND "cancelled_late" IS NOT NULL AND "checked_in_at" IS NULL AND "checked_in_by_user_id" IS NULL
      AND "no_show_at" IS NULL AND "no_show_by_user_id" IS NULL AND "no_show_reason" IS NULL)
    OR ("status" = 'NO_SHOW' AND "no_show_at" IS NOT NULL AND "no_show_by_user_id" IS NOT NULL
      AND "checked_in_at" IS NULL AND "checked_in_by_user_id" IS NULL AND "cancelled_at" IS NULL
      AND "cancelled_by_user_id" IS NULL AND "cancel_reason" IS NULL AND "cancelled_late" IS NULL)
  ),
  ADD CONSTRAINT "bookings_reasons_nonblank" CHECK (
    ("cancel_reason" IS NULL OR "cancel_reason" !~ '^[[:space:]]*$')
    AND ("no_show_reason" IS NULL OR "no_show_reason" !~ '^[[:space:]]*$')
  );

ALTER TABLE "booking_recipients"
  -- SELF is the booking owner; any other recipient is named and never an account (O11).
  ADD CONSTRAINT "booking_recipients_shape" CHECK (
    ("relation" = 'SELF' AND "display_name" IS NULL AND "phone" IS NULL)
    OR ("relation" <> 'SELF' AND "display_name" IS NOT NULL AND "display_name" !~ '^[[:space:]]*$'
      AND char_length("display_name") <= 200)
  ),
  ADD CONSTRAINT "booking_recipients_phone" CHECK ("phone" IS NULL OR "phone" ~ '^\+?[0-9]{6,20}$');
CREATE UNIQUE INDEX "booking_recipients_one_self_key" ON "booking_recipients" ("booking_id") WHERE "relation" = 'SELF';

ALTER TABLE "booking_service_lines"
  ADD CONSTRAINT "booking_service_lines_shape" CHECK (
    "sequence" >= 1 AND "duration_minutes" > 0 AND "buffer_minutes" >= 0
    AND "planned_end_at" = "planned_start_at" + make_interval(mins => "duration_minutes")
    AND "row_version" > 0
  ),
  ADD CONSTRAINT "booking_service_lines_snapshot" CHECK (
    "service_code" !~ '^[[:space:]]*$' AND "service_name_vi" !~ '^[[:space:]]*$'
    AND "service_name_en" !~ '^[[:space:]]*$'
    AND "catalog_price_min_vnd" >= 0 AND "catalog_price_max_vnd" >= "catalog_price_min_vnd"
  );

ALTER TABLE "visits"
  ADD CONSTRAINT "visits_code_format" CHECK ("code" ~ '^[A-Z0-9][A-Z0-9-]{3,31}$'),
  ADD CONSTRAINT "visits_origin" CHECK (("origin" = 'BOOKING') = ("booking_id" IS NOT NULL)),
  ADD CONSTRAINT "visits_version_positive" CHECK ("row_version" > 0),
  ADD CONSTRAINT "visits_status_facts" CHECK (
    ("status" IN ('OPEN', 'IN_SERVICE') AND "completed_at" IS NULL AND "cancelled_at" IS NULL
      AND "cancelled_by_user_id" IS NULL AND "cancel_reason" IS NULL)
    OR ("status" = 'COMPLETED' AND "completed_at" IS NOT NULL AND "cancelled_at" IS NULL
      AND "cancelled_by_user_id" IS NULL AND "cancel_reason" IS NULL)
    OR ("status" = 'CANCELLED' AND "cancelled_at" IS NOT NULL AND "cancelled_by_user_id" IS NOT NULL
      AND "completed_at" IS NULL)
  ),
  ADD CONSTRAINT "visits_queue_override" CHECK (("queue_override_at" IS NULL) = ("queue_override_by_user_id" IS NULL)),
  ADD CONSTRAINT "visits_reason_nonblank" CHECK ("cancel_reason" IS NULL OR "cancel_reason" !~ '^[[:space:]]*$');

ALTER TABLE "visit_participants"
  -- A member is a customer account; guests and children never are (no stand-in accounts).
  ADD CONSTRAINT "visit_participants_shape" CHECK (
    ("kind" = 'MEMBER' AND "customer_user_id" IS NOT NULL AND "guardian_participant_id" IS NULL)
    OR ("kind" = 'GUEST' AND "customer_user_id" IS NULL AND "guardian_participant_id" IS NULL
      AND "display_name" IS NOT NULL AND "display_name" !~ '^[[:space:]]*$')
    OR ("kind" = 'CHILD' AND "customer_user_id" IS NULL AND "guardian_participant_id" IS NOT NULL
      AND "guardian_participant_id" <> "id"
      AND "display_name" IS NOT NULL AND "display_name" !~ '^[[:space:]]*$')
  ),
  ADD CONSTRAINT "visit_participants_phone" CHECK ("phone" IS NULL OR "phone" ~ '^\+?[0-9]{6,20}$'),
  ADD CONSTRAINT "visit_participants_lengths" CHECK (
    ("display_name" IS NULL OR char_length("display_name") <= 200)
    AND ("note" IS NULL OR char_length("note") <= 500)
  );
CREATE UNIQUE INDEX "visit_participants_one_member_key" ON "visit_participants" ("visit_id", "customer_user_id") WHERE "kind" = 'MEMBER';

ALTER TABLE "visit_service_lines"
  ADD CONSTRAINT "visit_service_lines_shape" CHECK (
    "sequence" >= 1 AND "duration_minutes" > 0 AND "buffer_minutes" >= 0
    AND "planned_end_at" = "planned_start_at" + make_interval(mins => "duration_minutes")
    AND "row_version" > 0
  ),
  ADD CONSTRAINT "visit_service_lines_snapshot" CHECK (
    "service_code" !~ '^[[:space:]]*$' AND "service_name_vi" !~ '^[[:space:]]*$'
    AND "service_name_en" !~ '^[[:space:]]*$'
    AND "catalog_price_min_vnd" >= 0 AND "catalog_price_max_vnd" >= "catalog_price_min_vnd"
  ),
  ADD CONSTRAINT "visit_service_lines_on_behalf" CHECK (
    ("added_on_behalf" AND "added_by_user_id" IS NOT NULL AND "added_at" IS NOT NULL)
    OR (NOT "added_on_behalf" AND "added_by_user_id" IS NULL AND "added_at" IS NULL)
  ),
  ADD CONSTRAINT "visit_service_lines_cancellation" CHECK (
    ("status" = 'CANCELLED') = ("cancelled_at" IS NOT NULL AND "cancelled_by_user_id" IS NOT NULL)
    AND ("status" = 'CANCELLED' OR "cancel_reason" IS NULL)
    AND ("cancel_reason" IS NULL OR "cancel_reason" !~ '^[[:space:]]*$')
  );
-- A participant is served one service at a time (no parallel service).
CREATE UNIQUE INDEX "visit_service_lines_one_in_progress_key" ON "visit_service_lines" ("participant_id") WHERE "status" = 'IN_PROGRESS';

ALTER TABLE "service_executions"
  ADD CONSTRAINT "service_executions_shape" CHECK (
    "expected_end_at" > "started_at" AND "row_version" > 0
    AND ("ended_at" IS NULL OR "ended_at" >= "started_at")
  ),
  -- No auto-END: ENDED always carries who ended it and how; a Manager resolution needs a reason.
  ADD CONSTRAINT "service_executions_status_facts" CHECK (
    ("status" = 'IN_PROGRESS' AND "ended_at" IS NULL AND "end_kind" IS NULL
      AND "ended_by_user_id" IS NULL AND "resolution_reason" IS NULL)
    OR ("status" = 'ENDED' AND "ended_at" IS NOT NULL AND "end_kind" IS NOT NULL
      AND "ended_by_user_id" IS NOT NULL
      AND (("end_kind" = 'NORMAL' AND "resolution_reason" IS NULL)
        OR ("end_kind" = 'MANAGER_RESOLVED' AND "resolution_reason" IS NOT NULL
          AND "resolution_reason" !~ '^[[:space:]]*$')))
  );
-- A KTV has at most one open execution (occupied until END or resolution).
CREATE UNIQUE INDEX "service_executions_one_open_per_employee_key" ON "service_executions" ("employee_user_id") WHERE "status" = 'IN_PROGRESS';

ALTER TABLE "service_line_assignment_changes"
  ADD CONSTRAINT "assignment_changes_shape" CHECK (
    num_nonnulls("booking_service_line_id", "visit_service_line_id") = 1
    AND "from_employee_user_id" <> "to_employee_user_id"
    AND ("note" IS NULL OR ("note" !~ '^[[:space:]]*$' AND char_length("note") <= 500))
  );

-- Configuration registry (design section 18): code-owned keys, integer values in range.
ALTER TABLE "app_settings"
  ADD CONSTRAINT "app_settings_version_positive" CHECK ("row_version" > 0),
  ADD CONSTRAINT "app_settings_known_values" CHECK (
    jsonb_typeof("value") = 'number' AND ("value"::text) ~ '^[0-9]+$'
    AND CASE "key"
      WHEN 'booking.maxAdvanceDays' THEN ("value"::text)::integer BETWEEN 1 AND 365
      WHEN 'booking.slotIntervalMinutes' THEN ("value"::text)::integer BETWEEN 5 AND 60
        AND 60 % ("value"::text)::integer = 0
      WHEN 'booking.lateHoldMinutes' THEN ("value"::text)::integer BETWEEN 0 AND 120
      WHEN 'booking.lateCancelAlertMinutes' THEN ("value"::text)::integer BETWEEN 0 AND 1440
      WHEN 'service.warningLeadMinutes' THEN ("value"::text)::integer BETWEEN 1 AND 60
      WHEN 'service.startOverdueMinutes' THEN ("value"::text)::integer BETWEEN 1 AND 60
      WHEN 'service.endOverdueMinutes' THEN ("value"::text)::integer BETWEEN 1 AND 60
      WHEN 'booking.checkInWindowMinutes' THEN ("value"::text)::integer BETWEEN 0 AND 1440
      WHEN 'booking.serviceBufferMinutes' THEN ("value"::text)::integer BETWEEN 0 AND 60
      ELSE false
    END
  );

INSERT INTO "app_settings" ("key", "value") VALUES
  ('booking.maxAdvanceDays', '60'),
  ('booking.slotIntervalMinutes', '15'),
  ('booking.lateHoldMinutes', '20'),
  ('booking.lateCancelAlertMinutes', '15'),
  ('service.warningLeadMinutes', '5'),
  ('service.startOverdueMinutes', '5'),
  ('service.endOverdueMinutes', '5'),
  ('booking.checkInWindowMinutes', '60'),
  ('booking.serviceBufferMinutes', '0');

-- The new GLOBAL_ONLY permission (MANAGE_BOOKING_SETTINGS) joins MANAGE_SERVICE_PRICES in the
-- catalog semantics rule; every other code stays BRANCH_CAPABLE, and only the two pay codes
-- are EMPLOYEE_PAY data.
ALTER TABLE "permissions" DROP CONSTRAINT "permissions_catalog_semantics";
ALTER TABLE "permissions"
  ADD CONSTRAINT "permissions_catalog_semantics" CHECK (
    (("code" IN ('MANAGE_SERVICE_PRICES', 'MANAGE_BOOKING_SETTINGS') AND "scope_capability" = 'GLOBAL_ONLY')
      OR ("code" NOT IN ('MANAGE_SERVICE_PRICES', 'MANAGE_BOOKING_SETTINGS') AND "scope_capability" = 'BRANCH_CAPABLE'))
    AND (("code" IN ('VIEW_EMPLOYEE_PAY', 'MANAGE_EMPLOYEE_PAY') AND "data_classification" = 'EMPLOYEE_PAY')
      OR ("code" NOT IN ('VIEW_EMPLOYEE_PAY', 'MANAGE_EMPLOYEE_PAY') AND "data_classification" = 'STANDARD'))
  );

-- ---------------------------------------------------------------- KTV overlap backstop (O9)
-- One row per occupying service line: a CONFIRMED booking's lines, and PLANNED or
-- IN_PROGRESS visit lines, over [planned start, planned end + buffer). The exclusion
-- constraint rejects any overlap for the same KTV, across branches and across both sources.
-- It backs up, and never replaces, the application's locking and availability re-checks.
ALTER TABLE "ktv_occupancies"
  ADD CONSTRAINT "ktv_occupancies_source" CHECK (num_nonnulls("booking_service_line_id", "visit_service_line_id") = 1),
  ADD CONSTRAINT "ktv_occupancies_period" CHECK (NOT isempty("period") AND lower_inc("period") AND NOT upper_inc("period")),
  ADD CONSTRAINT "ktv_occupancies_no_overlap" EXCLUDE USING gist ("employee_user_id" WITH =, "period" WITH &&);

CREATE FUNCTION lucy_sync_booking_line_occupancy() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  occupying boolean;
BEGIN
  SELECT status = 'CONFIRMED' INTO occupying FROM bookings WHERE id = NEW.booking_id;
  -- A line already carried over to a visit is occupied through that visit line instead.
  IF occupying AND NOT EXISTS (SELECT 1 FROM visit_service_lines WHERE booking_service_line_id = NEW.id) THEN
    INSERT INTO ktv_occupancies (employee_user_id, period, booking_service_line_id)
    VALUES (NEW.employee_user_id,
      tstzrange(NEW.planned_start_at, NEW.planned_end_at + make_interval(mins => NEW.buffer_minutes), '[)'),
      NEW.id)
    ON CONFLICT (booking_service_line_id) DO UPDATE
      SET employee_user_id = EXCLUDED.employee_user_id, period = EXCLUDED.period;
  ELSE
    DELETE FROM ktv_occupancies WHERE booking_service_line_id = NEW.id;
  END IF;
  RETURN NULL;
END;
$$;
CREATE TRIGGER "booking_service_lines_occupancy" AFTER INSERT OR UPDATE ON "booking_service_lines"
FOR EACH ROW EXECUTE FUNCTION lucy_sync_booking_line_occupancy();

CREATE FUNCTION lucy_release_booking_occupancy() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.status <> 'CONFIRMED' THEN
    DELETE FROM ktv_occupancies o USING booking_service_lines l
      WHERE o.booking_service_line_id = l.id AND l.booking_id = NEW.id;
  END IF;
  RETURN NULL;
END;
$$;
CREATE TRIGGER "bookings_occupancy" AFTER UPDATE OF "status" ON "bookings"
FOR EACH ROW EXECUTE FUNCTION lucy_release_booking_occupancy();

CREATE FUNCTION lucy_sync_visit_line_occupancy() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  -- Check-in carries a booking line over: its booking occupancy moves to the visit line.
  IF NEW.booking_service_line_id IS NOT NULL THEN
    DELETE FROM ktv_occupancies WHERE booking_service_line_id = NEW.booking_service_line_id;
  END IF;
  IF NEW.status IN ('PLANNED', 'IN_PROGRESS') THEN
    INSERT INTO ktv_occupancies (employee_user_id, period, visit_service_line_id)
    VALUES (NEW.employee_user_id,
      tstzrange(NEW.planned_start_at, NEW.planned_end_at + make_interval(mins => NEW.buffer_minutes), '[)'),
      NEW.id)
    ON CONFLICT (visit_service_line_id) DO UPDATE
      SET employee_user_id = EXCLUDED.employee_user_id, period = EXCLUDED.period;
  ELSE
    DELETE FROM ktv_occupancies WHERE visit_service_line_id = NEW.id;
  END IF;
  RETURN NULL;
END;
$$;
CREATE TRIGGER "visit_service_lines_occupancy" AFTER INSERT OR UPDATE ON "visit_service_lines"
FOR EACH ROW EXECUTE FUNCTION lucy_sync_visit_line_occupancy();

-- ---------------------------------------------------------------- lifecycle and history guards

CREATE FUNCTION lucy_reject_phase3_delete() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Booking and visit history is never deleted';
END;
$$;
CREATE TRIGGER "bookings_no_delete" BEFORE DELETE ON "bookings" FOR EACH ROW EXECUTE FUNCTION lucy_reject_phase3_delete();
CREATE TRIGGER "booking_recipients_no_delete" BEFORE DELETE ON "booking_recipients" FOR EACH ROW EXECUTE FUNCTION lucy_reject_phase3_delete();
CREATE TRIGGER "booking_service_lines_no_delete" BEFORE DELETE ON "booking_service_lines" FOR EACH ROW EXECUTE FUNCTION lucy_reject_phase3_delete();
CREATE TRIGGER "visits_no_delete" BEFORE DELETE ON "visits" FOR EACH ROW EXECUTE FUNCTION lucy_reject_phase3_delete();
CREATE TRIGGER "visit_participants_no_delete" BEFORE DELETE ON "visit_participants" FOR EACH ROW EXECUTE FUNCTION lucy_reject_phase3_delete();
CREATE TRIGGER "visit_service_lines_no_delete" BEFORE DELETE ON "visit_service_lines" FOR EACH ROW EXECUTE FUNCTION lucy_reject_phase3_delete();
CREATE TRIGGER "service_executions_no_delete" BEFORE DELETE ON "service_executions" FOR EACH ROW EXECUTE FUNCTION lucy_reject_phase3_delete();
CREATE TRIGGER "assignment_changes_no_delete" BEFORE DELETE ON "service_line_assignment_changes" FOR EACH ROW EXECUTE FUNCTION lucy_reject_phase3_delete();
CREATE TRIGGER "app_settings_no_delete" BEFORE DELETE ON "app_settings" FOR EACH ROW EXECUTE FUNCTION lucy_reject_phase3_delete();
CREATE TRIGGER "bookings_no_truncate" BEFORE TRUNCATE ON "bookings" FOR EACH STATEMENT EXECUTE FUNCTION lucy_reject_permanent_history_mutation();
CREATE TRIGGER "visits_no_truncate" BEFORE TRUNCATE ON "visits" FOR EACH STATEMENT EXECUTE FUNCTION lucy_reject_permanent_history_mutation();
CREATE TRIGGER "service_executions_no_truncate" BEFORE TRUNCATE ON "service_executions" FOR EACH STATEMENT EXECUTE FUNCTION lucy_reject_permanent_history_mutation();
CREATE TRIGGER "assignment_changes_no_truncate" BEFORE TRUNCATE ON "service_line_assignment_changes" FOR EACH STATEMENT EXECUTE FUNCTION lucy_reject_permanent_history_mutation();

-- Branch-local business date of an instant (the attendance convention).
CREATE FUNCTION lucy_branch_local_date(branch uuid, instant timestamptz) RETURNS date
LANGUAGE sql STABLE AS $$
  SELECT (instant AT TIME ZONE b.timezone)::date FROM branches b WHERE b.id = branch
$$;

CREATE FUNCTION lucy_guard_booking() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  owner_kind "UserKind";
BEGIN
  IF TG_OP = 'INSERT' THEN
    -- Auto-confirmed only (O4): no PENDING state exists.
    IF NEW.status <> 'CONFIRMED' OR NEW.row_version <> 1 THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'A booking starts CONFIRMED at version 1';
    END IF;
    SELECT kind INTO owner_kind FROM users WHERE id = NEW.owner_user_id;
    IF owner_kind IS DISTINCT FROM 'CUSTOMER' THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'A booking owner is a customer account';
    END IF;
  ELSE
    IF (NEW.id, NEW.code, NEW.branch_id, NEW.owner_user_id, NEW.channel, NEW.idempotency_key,
        NEW.created_by_user_id, NEW.created_at)
      IS DISTINCT FROM (OLD.id, OLD.code, OLD.branch_id, OLD.owner_user_id, OLD.channel,
        OLD.idempotency_key, OLD.created_by_user_id, OLD.created_at)
      OR (OLD.status <> 'CONFIRMED' AND NEW IS DISTINCT FROM OLD)
      OR (NEW.status <> OLD.status AND NOT (OLD.status = 'CONFIRMED'
        AND NEW.status IN ('CHECKED_IN', 'CANCELLED', 'NO_SHOW')))
      OR (NEW IS DISTINCT FROM OLD AND NEW.row_version <> OLD.row_version + 1) THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Booking identity, final states and version cannot be rewritten';
    END IF;
  END IF;
  IF NEW.service_date IS DISTINCT FROM lucy_branch_local_date(NEW.branch_id, NEW.starts_at) THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Booking service date must be the branch-local date of its start';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "bookings_guard" BEFORE INSERT OR UPDATE ON "bookings"
FOR EACH ROW EXECUTE FUNCTION lucy_guard_booking();

CREATE FUNCTION lucy_guard_booking_child() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  booking_status "BookingStatus";
BEGIN
  SELECT status INTO booking_status FROM bookings WHERE id = NEW.booking_id;
  IF TG_TABLE_NAME = 'booking_recipients' THEN
    IF TG_OP = 'UPDATE' THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Booking recipients are recorded once';
    END IF;
    IF booking_status IS DISTINCT FROM 'CONFIRMED' THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Recipients can only be added to a confirmed booking';
    END IF;
    RETURN NEW;
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF booking_status IS DISTINCT FROM 'CONFIRMED' OR NEW.row_version <> 1 THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Lines are added to a confirmed booking at version 1';
    END IF;
  ELSE
    -- Only a confirmed booking's lines may be reassigned or replanned; the catalog snapshot,
    -- service, recipient and order are fixed.
    IF booking_status IS DISTINCT FROM 'CONFIRMED'
      OR (NEW.id, NEW.booking_id, NEW.sequence, NEW.recipient_id, NEW.service_id, NEW.service_code,
          NEW.service_name_vi, NEW.service_name_en, NEW.catalog_price_min_vnd,
          NEW.catalog_price_max_vnd, NEW.catalog_pricing_unit, NEW.created_at)
        IS DISTINCT FROM (OLD.id, OLD.booking_id, OLD.sequence, OLD.recipient_id, OLD.service_id,
          OLD.service_code, OLD.service_name_vi, OLD.service_name_en, OLD.catalog_price_min_vnd,
          OLD.catalog_price_max_vnd, OLD.catalog_pricing_unit, OLD.created_at)
      OR (NEW IS DISTINCT FROM OLD AND NEW.row_version <> OLD.row_version + 1) THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Booking line snapshot, order and version cannot be rewritten';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "booking_recipients_guard" BEFORE INSERT OR UPDATE ON "booking_recipients"
FOR EACH ROW EXECUTE FUNCTION lucy_guard_booking_child();
CREATE TRIGGER "booking_service_lines_guard" BEFORE INSERT OR UPDATE ON "booking_service_lines"
FOR EACH ROW EXECUTE FUNCTION lucy_guard_booking_child();

CREATE FUNCTION lucy_guard_visit() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  owner_kind "UserKind";
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'OPEN' OR NEW.row_version <> 1 THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'A visit starts OPEN at version 1';
    END IF;
    IF NEW.owner_user_id IS NOT NULL THEN
      SELECT kind INTO owner_kind FROM users WHERE id = NEW.owner_user_id;
      IF owner_kind IS DISTINCT FROM 'CUSTOMER' THEN
        RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'A visit owner is a customer account';
      END IF;
    END IF;
    IF NEW.booking_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM bookings b WHERE b.id = NEW.booking_id AND b.branch_id = NEW.branch_id
        AND b.owner_user_id IS NOT DISTINCT FROM NEW.owner_user_id) THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'A booking visit keeps the booking branch and owner';
    END IF;
  ELSE
    IF (NEW.id, NEW.code, NEW.branch_id, NEW.origin, NEW.booking_id, NEW.owner_user_id,
        NEW.service_date, NEW.arrived_at, NEW.created_by_user_id, NEW.idempotency_key, NEW.created_at)
      IS DISTINCT FROM (OLD.id, OLD.code, OLD.branch_id, OLD.origin, OLD.booking_id, OLD.owner_user_id,
        OLD.service_date, OLD.arrived_at, OLD.created_by_user_id, OLD.idempotency_key, OLD.created_at)
      OR (OLD.status IN ('COMPLETED', 'CANCELLED') AND NEW IS DISTINCT FROM OLD)
      OR (NEW.status <> OLD.status AND NOT (
        (OLD.status = 'OPEN' AND NEW.status IN ('IN_SERVICE', 'CANCELLED'))
        OR (OLD.status = 'IN_SERVICE' AND NEW.status = 'COMPLETED')))
      OR (NEW IS DISTINCT FROM OLD AND NEW.row_version <> OLD.row_version + 1) THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Visit identity, final states and version cannot be rewritten';
    END IF;
  END IF;
  IF NEW.service_date IS DISTINCT FROM lucy_branch_local_date(NEW.branch_id, NEW.arrived_at) THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Visit service date must be the branch-local date of arrival';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "visits_guard" BEFORE INSERT OR UPDATE ON "visits"
FOR EACH ROW EXECUTE FUNCTION lucy_guard_visit();

CREATE FUNCTION lucy_guard_visit_participant() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  member_kind "UserKind";
BEGIN
  IF TG_OP = 'UPDATE' THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Visit participants are recorded once';
  END IF;
  IF NEW.customer_user_id IS NOT NULL THEN
    SELECT kind INTO member_kind FROM users WHERE id = NEW.customer_user_id;
    IF member_kind IS DISTINCT FROM 'CUSTOMER' THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'A member participant is a customer account';
    END IF;
  END IF;
  IF NEW.booking_recipient_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM booking_recipients r JOIN visits v ON v.booking_id = r.booking_id
    WHERE r.id = NEW.booking_recipient_id AND v.id = NEW.visit_id) THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'A participant maps a recipient of the same booking';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "visit_participants_guard" BEFORE INSERT OR UPDATE ON "visit_participants"
FOR EACH ROW EXECUTE FUNCTION lucy_guard_visit_participant();

CREATE FUNCTION lucy_guard_visit_service_line() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'PLANNED' OR NEW.row_version <> 1 OR NEW.start_overdue_warned_at IS NOT NULL THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'A visit line starts PLANNED at version 1';
    END IF;
    IF NEW.booking_service_line_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM booking_service_lines l JOIN visits v ON v.booking_id = l.booking_id
      WHERE l.id = NEW.booking_service_line_id AND v.id = NEW.visit_id) THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'A visit line carries over a line of the same booking';
    END IF;
  ELSE
    IF (NEW.id, NEW.visit_id, NEW.participant_id, NEW.sequence, NEW.booking_service_line_id,
        NEW.service_id, NEW.service_code, NEW.service_name_vi, NEW.service_name_en,
        NEW.catalog_price_min_vnd, NEW.catalog_price_max_vnd, NEW.catalog_pricing_unit,
        NEW.added_on_behalf, NEW.added_by_user_id, NEW.added_at, NEW.created_at)
      IS DISTINCT FROM (OLD.id, OLD.visit_id, OLD.participant_id, OLD.sequence,
        OLD.booking_service_line_id, OLD.service_id, OLD.service_code, OLD.service_name_vi,
        OLD.service_name_en, OLD.catalog_price_min_vnd, OLD.catalog_price_max_vnd,
        OLD.catalog_pricing_unit, OLD.added_on_behalf, OLD.added_by_user_id, OLD.added_at,
        OLD.created_at)
      OR (OLD.status IN ('DONE', 'CANCELLED') AND NEW IS DISTINCT FROM OLD)
      OR (NEW.status <> OLD.status AND NOT (
        (OLD.status = 'PLANNED' AND NEW.status IN ('IN_PROGRESS', 'CANCELLED'))
        OR (OLD.status = 'IN_PROGRESS' AND NEW.status = 'DONE')))
      -- The KTV is fixed once the service has started (reassignment is for planned lines).
      OR (OLD.status <> 'PLANNED' AND NEW.employee_user_id IS DISTINCT FROM OLD.employee_user_id)
      -- A warning fact is written once.
      OR (OLD.start_overdue_warned_at IS NOT NULL
        AND NEW.start_overdue_warned_at IS DISTINCT FROM OLD.start_overdue_warned_at)
      OR (NEW IS DISTINCT FROM OLD AND NEW.row_version <> OLD.row_version + 1) THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Visit line snapshot, final states, warning facts and version cannot be rewritten';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "visit_service_lines_guard" BEFORE INSERT OR UPDATE ON "visit_service_lines"
FOR EACH ROW EXECUTE FUNCTION lucy_guard_visit_service_line();

CREATE FUNCTION lucy_guard_service_execution() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'IN_PROGRESS' OR NEW.row_version <> 1
      OR NEW.pre_end_warned_at IS NOT NULL OR NEW.end_overdue_warned_at IS NOT NULL THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'An execution starts IN_PROGRESS at version 1';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM visit_service_lines l WHERE l.id = NEW.visit_service_line_id
        AND l.employee_user_id = NEW.employee_user_id) THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'An execution is performed by the line''s assigned KTV';
    END IF;
  ELSE
    IF (NEW.id, NEW.visit_service_line_id, NEW.employee_user_id, NEW.started_at, NEW.created_at)
        IS DISTINCT FROM (OLD.id, OLD.visit_service_line_id, OLD.employee_user_id, OLD.started_at,
          OLD.created_at)
      OR (OLD.status = 'ENDED' AND NEW IS DISTINCT FROM OLD)
      OR (OLD.pre_end_warned_at IS NOT NULL AND NEW.pre_end_warned_at IS DISTINCT FROM OLD.pre_end_warned_at)
      OR (OLD.end_overdue_warned_at IS NOT NULL
        AND NEW.end_overdue_warned_at IS DISTINCT FROM OLD.end_overdue_warned_at)
      OR (NEW IS DISTINCT FROM OLD AND NEW.row_version <> OLD.row_version + 1) THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Execution identity, end facts, warning facts and version cannot be rewritten';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "service_executions_guard" BEFORE INSERT OR UPDATE ON "service_executions"
FOR EACH ROW EXECUTE FUNCTION lucy_guard_service_execution();

CREATE FUNCTION lucy_reject_update() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'This history is append-only';
END;
$$;
CREATE TRIGGER "assignment_changes_append_only" BEFORE UPDATE ON "service_line_assignment_changes"
FOR EACH ROW EXECUTE FUNCTION lucy_reject_update();

CREATE FUNCTION lucy_guard_app_setting() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.key IS DISTINCT FROM OLD.key OR NEW.created_at IS DISTINCT FROM OLD.created_at
    OR (NEW IS DISTINCT FROM OLD AND NEW.row_version <> OLD.row_version + 1) THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Setting keys are code-owned; every change bumps the version';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "app_settings_guard" BEFORE UPDATE ON "app_settings"
FOR EACH ROW EXECUTE FUNCTION lucy_guard_app_setting();

-- Function hardening (the Phase 1 convention): a fixed search_path and no PUBLIC execute.
DO $$
DECLARE
  migration_schema text := current_schema();
  function_name text;
BEGIN
  FOREACH function_name IN ARRAY ARRAY[
    'lucy_sync_booking_line_occupancy', 'lucy_release_booking_occupancy',
    'lucy_sync_visit_line_occupancy', 'lucy_reject_phase3_delete', 'lucy_guard_booking',
    'lucy_guard_booking_child', 'lucy_guard_visit', 'lucy_guard_visit_participant',
    'lucy_guard_visit_service_line', 'lucy_guard_service_execution', 'lucy_reject_update',
    'lucy_guard_app_setting'
  ] LOOP
    EXECUTE format('ALTER FUNCTION %I.%I() SET search_path TO pg_catalog, %I, pg_temp',
      migration_schema, function_name, migration_schema);
    EXECUTE format('REVOKE ALL ON FUNCTION %I.%I() FROM PUBLIC', migration_schema, function_name);
  END LOOP;
  EXECUTE format('ALTER FUNCTION %I.lucy_branch_local_date(uuid, timestamptz) SET search_path TO pg_catalog, %I, pg_temp',
    migration_schema, migration_schema);
  EXECUTE format('REVOKE ALL ON FUNCTION %I.lucy_branch_local_date(uuid, timestamptz) FROM PUBLIC', migration_schema);
END;
$$;
