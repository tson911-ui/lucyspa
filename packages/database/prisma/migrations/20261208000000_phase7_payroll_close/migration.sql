-- Phase 7 P7-14 (closing a payroll run, payslips, marking them paid; design `PHASE7_PAYROLL_FUNDS.md` 4.3, P7-T3, P7-T10, P7-T12).
--
-- Additive: one new table (empty), one enum, two foreign keys on the existing `run_id` columns of earnings and tips (always NULL until a run is
-- closed), and one nullable column on collaborator work. Closing a run (the Owner's approval, with a fresh password) freezes it: the earnings, tips and
-- collaborator work it took are marked with the run and a database guard refuses any later change to them (corrections are items of the next run).
-- A payslip stores its own printed totals. Marking a payslip paid is a manual act that writes the fund outflows in the same transaction; nothing is
-- paid by itself.

CREATE TYPE "PayslipStatus" AS ENUM ('PENDING', 'PAID', 'REVERSED');

CREATE TABLE "payslips" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "run_id" UUID NOT NULL,
    "line_id" UUID NOT NULL,
    "employee_user_id" UUID NOT NULL,
    "net_vnd" BIGINT NOT NULL,
    "tips_vnd" BIGINT NOT NULL,
    "status" "PayslipStatus" NOT NULL DEFAULT 'PENDING',
    "row_version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT clock_timestamp(),
    "paid_at" TIMESTAMPTZ(3),
    "paid_by_user_id" UUID,
    "paid_fund_id" UUID,
    "net_entry_id" UUID,
    "tips_entry_id" UUID,
    "reversed_at" TIMESTAMPTZ(3),
    "reversed_by_user_id" UUID,
    "reversal_reason" TEXT,
    CONSTRAINT "payslips_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "payslips_amounts" CHECK ("net_vnd" >= 0 AND "tips_vnd" >= 0 AND "net_vnd" <= 10000000000 AND "tips_vnd" <= 10000000000),
    CONSTRAINT "payslips_shape" CHECK (
      ("status" = 'PENDING' AND "paid_at" IS NULL AND "reversed_at" IS NULL)
      OR ("status" = 'PAID' AND "paid_at" IS NOT NULL AND "paid_by_user_id" IS NOT NULL AND "reversed_at" IS NULL
          AND (("net_vnd" = 0 AND "tips_vnd" = 0) OR "paid_fund_id" IS NOT NULL)
          AND ("net_vnd" = 0) = ("net_entry_id" IS NULL) AND ("tips_vnd" = 0) = ("tips_entry_id" IS NULL))
      OR ("status" = 'REVERSED' AND "paid_at" IS NOT NULL AND "reversed_at" IS NOT NULL AND "reversed_by_user_id" IS NOT NULL
          AND length(btrim(coalesce("reversal_reason", ''))) > 0)
    )
);
CREATE UNIQUE INDEX "payslips_person_key" ON "payslips"("run_id", "employee_user_id");
CREATE UNIQUE INDEX "payslips_line_key" ON "payslips"("line_id");
CREATE UNIQUE INDEX "payslips_net_entry_key" ON "payslips"("net_entry_id") WHERE "net_entry_id" IS NOT NULL;
CREATE UNIQUE INDEX "payslips_tips_entry_key" ON "payslips"("tips_entry_id") WHERE "tips_entry_id" IS NOT NULL;
CREATE INDEX "payslips_employee_idx" ON "payslips"("employee_user_id", "created_at");
CREATE INDEX "payslips_status_idx" ON "payslips"("run_id", "status");
ALTER TABLE "payslips" ADD CONSTRAINT "payslips_run_fkey" FOREIGN KEY ("run_id")
  REFERENCES "pay_runs"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "payslips" ADD CONSTRAINT "payslips_line_fkey" FOREIGN KEY ("line_id")
  REFERENCES "pay_run_lines"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "payslips" ADD CONSTRAINT "payslips_employee_fkey" FOREIGN KEY ("employee_user_id")
  REFERENCES "employee_profiles"("user_id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "payslips" ADD CONSTRAINT "payslips_payer_fkey" FOREIGN KEY ("paid_by_user_id")
  REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "payslips" ADD CONSTRAINT "payslips_fund_fkey" FOREIGN KEY ("paid_fund_id")
  REFERENCES "cash_funds"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "payslips" ADD CONSTRAINT "payslips_net_entry_fkey" FOREIGN KEY ("net_entry_id")
  REFERENCES "fund_entries"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "payslips" ADD CONSTRAINT "payslips_tips_entry_fkey" FOREIGN KEY ("tips_entry_id")
  REFERENCES "fund_entries"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "payslips" ADD CONSTRAINT "payslips_reverser_fkey" FOREIGN KEY ("reversed_by_user_id")
  REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- A payslip is made only for a closed run, never deleted, keeps its printed totals, only moves PENDING -> PAID -> REVERSED, and never forgets a stage.
CREATE FUNCTION lucy_guard_payslip() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  parent TEXT;
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'A payslip is history and is never deleted';
  END IF;
  IF TG_OP = 'INSERT' THEN
    SELECT status::text INTO parent FROM pay_runs WHERE id = NEW.run_id;
    IF parent IS DISTINCT FROM 'CLOSED' OR NEW.status <> 'PENDING' THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'A payslip is made when its run is closed, and starts pending';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.run_id <> OLD.run_id OR NEW.line_id <> OLD.line_id OR NEW.employee_user_id <> OLD.employee_user_id
     OR NEW.net_vnd <> OLD.net_vnd OR NEW.tips_vnd <> OLD.tips_vnd OR NEW.created_at <> OLD.created_at THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'A payslip keeps its printed totals';
  END IF;
  IF NEW IS DISTINCT FROM OLD AND NEW.row_version <> OLD.row_version + 1 THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'A payslip change bumps the version by one';
  END IF;
  IF OLD.status <> NEW.status AND NOT ((OLD.status = 'PENDING' AND NEW.status = 'PAID') OR (OLD.status = 'PAID' AND NEW.status = 'REVERSED')) THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'A payslip only moves forward: pending, paid, reversed';
  END IF;
  IF (OLD.paid_at IS NOT NULL AND (NEW.paid_at IS DISTINCT FROM OLD.paid_at OR NEW.paid_by_user_id IS DISTINCT FROM OLD.paid_by_user_id
        OR NEW.paid_fund_id IS DISTINCT FROM OLD.paid_fund_id OR NEW.net_entry_id IS DISTINCT FROM OLD.net_entry_id
        OR NEW.tips_entry_id IS DISTINCT FROM OLD.tips_entry_id))
     OR (OLD.reversed_at IS NOT NULL AND NEW IS DISTINCT FROM OLD) THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'A finished stage of a payslip never changes';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER lucy_payslips_guard BEFORE INSERT OR UPDATE OR DELETE ON "payslips"
  FOR EACH ROW EXECUTE FUNCTION lucy_guard_payslip();

-- ------------------------------------------------------------------------------------------------------ what a closed run took
ALTER TABLE "pay_earnings" ADD CONSTRAINT "pay_earnings_run_fkey" FOREIGN KEY ("run_id")
  REFERENCES "pay_runs"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "tips" ADD CONSTRAINT "tips_run_fkey" FOREIGN KEY ("run_id")
  REFERENCES "pay_runs"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

ALTER TABLE "collaborator_work_occurrences" ADD COLUMN "pay_run_id" UUID;
ALTER TABLE "collaborator_work_occurrences" ADD CONSTRAINT "collaborator_work_pay_run_fkey" FOREIGN KEY ("pay_run_id")
  REFERENCES "pay_runs"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
CREATE INDEX "collaborator_work_pay_run_idx" ON "collaborator_work_occurrences"("pay_run_id");

-- Work that a closed run paid cannot change what it pays or whether it happened (a correction is an adjustment in the next run). Claiming it is
-- allowed once, for a closed run, and changes nothing else.
CREATE FUNCTION lucy_guard_collaborator_work_paid() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  parent TEXT;
BEGIN
  IF NEW.pay_run_id IS NOT NULL AND OLD.pay_run_id IS NULL THEN
    SELECT status::text INTO parent FROM pay_runs WHERE id = NEW.pay_run_id;
    IF parent IS NULL OR parent = 'DRAFT' OR NEW.status <> 'SCHEDULED' THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Only scheduled work can be taken by a closed payroll run';
    END IF;
    IF (NEW.employee_user_id, NEW.branch_id, NEW.work_date, NEW.mode, NEW.start_minute, NEW.end_minute, NEW.agreed_pay_vnd, NEW.status)
       IS DISTINCT FROM (OLD.employee_user_id, OLD.branch_id, OLD.work_date, OLD.mode, OLD.start_minute, OLD.end_minute, OLD.agreed_pay_vnd, OLD.status) THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Taking work into a payroll run changes nothing else';
    END IF;
    RETURN NEW;
  END IF;
  IF OLD.pay_run_id IS NOT NULL
     AND (NEW.pay_run_id IS DISTINCT FROM OLD.pay_run_id
          OR (NEW.employee_user_id, NEW.branch_id, NEW.work_date, NEW.mode, NEW.start_minute, NEW.end_minute, NEW.agreed_pay_vnd, NEW.status)
             IS DISTINCT FROM (OLD.employee_user_id, OLD.branch_id, OLD.work_date, OLD.mode, OLD.start_minute, OLD.end_minute, OLD.agreed_pay_vnd, OLD.status)) THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Work paid by a closed payroll run cannot change; correct it in the next run';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER lucy_collaborator_work_paid_guard BEFORE UPDATE ON "collaborator_work_occurrences"
  FOR EACH ROW EXECUTE FUNCTION lucy_guard_collaborator_work_paid();
