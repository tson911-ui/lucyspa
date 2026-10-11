-- Phase 7 P7-12 (monthly payroll run: draft, preview, items; design `PHASE7_PAYROLL_FUNDS.md` 4.3, P7-T3, P7-T11, P7-T14; Owner answers 5 and 10).
--
-- Additive: three new tables, all empty, and two enums. A run is one calendar month for the whole shop; its states are DRAFT -> CLOSED -> PAID
-- and never go back (closing and paying come with P7-14; the columns for them exist now so the state shape is fixed once). While DRAFT the
-- generated items (base salary, tour, commission, CTV work, tips) are rebuilt from the sources on refresh and the manual items (bonus,
-- adjustment, deduction) are kept; a manual item is voided with a reason, never edited or deleted. Once the run leaves DRAFT nothing under it
-- can change. Nothing here pays anyone and nothing is created until a person with the payroll permission presses the button.

CREATE TYPE "PayRunStatus" AS ENUM ('DRAFT', 'CLOSED', 'PAID');
CREATE TYPE "PayRunItemKind" AS ENUM (
  'BASE_SALARY', 'TOUR', 'COMMISSION', 'CTV_WORK', 'TIP', 'BONUS', 'ADJUSTMENT', 'DEDUCTION', 'ADVANCE_RECOVERY'
);

CREATE TABLE "pay_runs" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "period_month" DATE NOT NULL,
    "status" "PayRunStatus" NOT NULL DEFAULT 'DRAFT',
    "payment_day" DATE,
    "row_version" INTEGER NOT NULL DEFAULT 1,
    "created_by_user_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT clock_timestamp(),
    "refreshed_at" TIMESTAMPTZ(3),
    "refreshed_by_user_id" UUID,
    "closed_at" TIMESTAMPTZ(3),
    "closed_by_user_id" UUID,
    "paid_at" TIMESTAMPTZ(3),
    CONSTRAINT "pay_runs_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "pay_runs_month_start" CHECK (EXTRACT(DAY FROM "period_month") = 1),
    CONSTRAINT "pay_runs_state_shape" CHECK (
      ("status" = 'DRAFT' AND "closed_at" IS NULL AND "closed_by_user_id" IS NULL AND "paid_at" IS NULL)
      OR ("status" = 'CLOSED' AND "closed_at" IS NOT NULL AND "closed_by_user_id" IS NOT NULL AND "paid_at" IS NULL AND "payment_day" IS NOT NULL)
      OR ("status" = 'PAID' AND "closed_at" IS NOT NULL AND "closed_by_user_id" IS NOT NULL AND "paid_at" IS NOT NULL AND "payment_day" IS NOT NULL))
);
CREATE UNIQUE INDEX "pay_runs_month_key" ON "pay_runs"("period_month");
CREATE INDEX "pay_runs_creator_idx" ON "pay_runs"("created_by_user_id");
ALTER TABLE "pay_runs" ADD CONSTRAINT "pay_runs_creator_fkey" FOREIGN KEY ("created_by_user_id")
  REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "pay_runs" ADD CONSTRAINT "pay_runs_refresher_fkey" FOREIGN KEY ("refreshed_by_user_id")
  REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "pay_runs" ADD CONSTRAINT "pay_runs_closer_fkey" FOREIGN KEY ("closed_by_user_id")
  REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

CREATE TABLE "pay_run_lines" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "run_id" UUID NOT NULL,
    "employee_user_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT "pay_run_lines_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "pay_run_lines_person_key" ON "pay_run_lines"("run_id", "employee_user_id");
CREATE INDEX "pay_run_lines_employee_idx" ON "pay_run_lines"("employee_user_id");
ALTER TABLE "pay_run_lines" ADD CONSTRAINT "pay_run_lines_run_fkey" FOREIGN KEY ("run_id")
  REFERENCES "pay_runs"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "pay_run_lines" ADD CONSTRAINT "pay_run_lines_employee_fkey" FOREIGN KEY ("employee_user_id")
  REFERENCES "employee_profiles"("user_id") ON DELETE RESTRICT ON UPDATE RESTRICT;

CREATE TABLE "pay_run_items" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "run_id" UUID NOT NULL,
    "line_id" UUID NOT NULL,
    "kind" "PayRunItemKind" NOT NULL,
    "amount_vnd" BIGINT NOT NULL,
    "generated" BOOLEAN NOT NULL,
    "quantity" INTEGER,
    "late_vnd" BIGINT NOT NULL DEFAULT 0,
    "flag" VARCHAR(24),
    "note" TEXT,
    "reason" TEXT,
    "client_request_id" UUID,
    "created_by_user_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT clock_timestamp(),
    "voided_at" TIMESTAMPTZ(3),
    "voided_by_user_id" UUID,
    "void_reason" TEXT,
    CONSTRAINT "pay_run_items_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "pay_run_items_amount_max" CHECK (abs("amount_vnd") <= 10000000000),
    CONSTRAINT "pay_run_items_origin" CHECK (
      ("generated" AND "kind" IN ('BASE_SALARY', 'TOUR', 'COMMISSION', 'CTV_WORK', 'TIP', 'ADVANCE_RECOVERY'))
      OR (NOT "generated" AND "kind" IN ('BONUS', 'ADJUSTMENT', 'DEDUCTION'))),
    CONSTRAINT "pay_run_items_sign" CHECK (
      ("kind" = 'BONUS' AND "amount_vnd" > 0)
      OR ("kind" = 'DEDUCTION' AND "amount_vnd" < 0)
      OR ("kind" = 'ADJUSTMENT' AND "amount_vnd" <> 0)
      OR ("kind" = 'ADVANCE_RECOVERY' AND "amount_vnd" <= 0)
      OR "kind" IN ('BASE_SALARY', 'TOUR', 'COMMISSION', 'CTV_WORK', 'TIP')),
    CONSTRAINT "pay_run_items_manual_reason" CHECK ("generated" OR length(btrim(coalesce("reason", ''))) > 0),
    CONSTRAINT "pay_run_items_void_shape" CHECK (
      ("voided_at" IS NULL AND "voided_by_user_id" IS NULL AND "void_reason" IS NULL)
      OR (NOT "generated" AND "voided_at" IS NOT NULL AND "voided_by_user_id" IS NOT NULL AND length(btrim(coalesce("void_reason", ''))) > 0))
);
CREATE UNIQUE INDEX "pay_run_items_request_key" ON "pay_run_items"("created_by_user_id", "client_request_id") WHERE "client_request_id" IS NOT NULL;
CREATE INDEX "pay_run_items_line_idx" ON "pay_run_items"("line_id");
CREATE INDEX "pay_run_items_run_idx" ON "pay_run_items"("run_id", "kind");
ALTER TABLE "pay_run_items" ADD CONSTRAINT "pay_run_items_run_fkey" FOREIGN KEY ("run_id")
  REFERENCES "pay_runs"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "pay_run_items" ADD CONSTRAINT "pay_run_items_line_fkey" FOREIGN KEY ("line_id")
  REFERENCES "pay_run_lines"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "pay_run_items" ADD CONSTRAINT "pay_run_items_creator_fkey" FOREIGN KEY ("created_by_user_id")
  REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "pay_run_items" ADD CONSTRAINT "pay_run_items_voider_fkey" FOREIGN KEY ("voided_by_user_id")
  REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- ------------------------------------------------------------------------------------------------------------------------ guards
-- A run: never deleted; the month never changes; the state only moves DRAFT -> CLOSED -> PAID; the payment day only changes while DRAFT;
-- every change bumps the version by one (so a person who saw the draft can be told it moved before they close it).
CREATE FUNCTION lucy_guard_pay_run() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'A payroll run is history and is never deleted';
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'DRAFT' THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'A payroll run starts as a draft';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.period_month <> OLD.period_month OR NEW.created_by_user_id <> OLD.created_by_user_id OR NEW.created_at <> OLD.created_at THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'A payroll run keeps its month and its author';
  END IF;
  IF NEW IS DISTINCT FROM OLD AND NEW.row_version <> OLD.row_version + 1 THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'A payroll run change bumps the version by one';
  END IF;
  IF OLD.status <> NEW.status AND NOT ((OLD.status = 'DRAFT' AND NEW.status = 'CLOSED') OR (OLD.status = 'CLOSED' AND NEW.status = 'PAID')) THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'A payroll run only moves forward: draft, closed, paid';
  END IF;
  IF OLD.status <> 'DRAFT' AND NEW.payment_day IS DISTINCT FROM OLD.payment_day THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'The payment day of a closed run never changes';
  END IF;
  IF OLD.status <> 'DRAFT' AND OLD.status = NEW.status AND (NEW.refreshed_at IS DISTINCT FROM OLD.refreshed_at) THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'A closed run is not refreshed';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER lucy_pay_runs_guard BEFORE INSERT OR UPDATE OR DELETE ON "pay_runs"
  FOR EACH ROW EXECUTE FUNCTION lucy_guard_pay_run();

-- Lines and items belong to a DRAFT run only. A line may be removed only while draft (a refresh drops people who no longer have anything).
CREATE FUNCTION lucy_guard_pay_run_line() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  parent TEXT;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'A payroll line never changes';
  END IF;
  SELECT status::text INTO parent FROM pay_runs WHERE id = (CASE WHEN TG_OP = 'DELETE' THEN OLD.run_id ELSE NEW.run_id END);
  IF parent IS DISTINCT FROM 'DRAFT' THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Nothing under a closed payroll run can change';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER lucy_pay_run_lines_guard BEFORE INSERT OR UPDATE OR DELETE ON "pay_run_lines"
  FOR EACH ROW EXECUTE FUNCTION lucy_guard_pay_run_line();

CREATE FUNCTION lucy_guard_pay_run_item() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  parent TEXT;
  owner_run UUID;
BEGIN
  SELECT status::text INTO parent FROM pay_runs WHERE id = (CASE WHEN TG_OP = 'DELETE' THEN OLD.run_id ELSE NEW.run_id END);
  IF parent IS DISTINCT FROM 'DRAFT' THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Nothing under a closed payroll run can change';
  END IF;
  IF TG_OP = 'INSERT' THEN
    SELECT run_id INTO owner_run FROM pay_run_lines WHERE id = NEW.line_id;
    IF owner_run IS DISTINCT FROM NEW.run_id THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'An item belongs to a line of its own run';
    END IF;
    RETURN NEW;
  END IF;
  IF TG_OP = 'DELETE' THEN
    IF NOT OLD.generated THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'A manual payroll item is voided with a reason, never deleted';
    END IF;
    RETURN OLD;
  END IF;
  IF OLD.generated OR OLD.voided_at IS NOT NULL OR NEW.voided_at IS NULL
     OR (to_jsonb(NEW) - 'voided_at' - 'voided_by_user_id' - 'void_reason') IS DISTINCT FROM (to_jsonb(OLD) - 'voided_at' - 'voided_by_user_id' - 'void_reason') THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'A manual payroll item is never edited; it is voided once, with a reason';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER lucy_pay_run_items_guard BEFORE INSERT OR UPDATE OR DELETE ON "pay_run_items"
  FOR EACH ROW EXECUTE FUNCTION lucy_guard_pay_run_item();
