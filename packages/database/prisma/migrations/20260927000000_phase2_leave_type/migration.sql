-- Phase 2 Step 8 only (Owner-authorized): a controlled leave type on every leave request.
-- The type describes the request only; paid/unpaid treatment, quotas, carry-forward and
-- payroll belong to a future configurable Leave Policy and are deliberately absent.
-- Required with no default: leave_requests is empty everywhere this applies, and a
-- default would silently mislabel requests.
CREATE TYPE "LeaveType" AS ENUM ('ANNUAL', 'SICK', 'PERSONAL', 'FAMILY_EVENT', 'MATERNITY', 'OTHER');
ALTER TABLE "leave_requests" ADD COLUMN "leave_type" "LeaveType" NOT NULL;

-- Same guard as Phase 2 Step 2, with leave_type frozen alongside the other request facts:
-- editable while PENDING, fixed once the request is decided or cancelled.
CREATE OR REPLACE FUNCTION lucy_guard_leave_request() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Leave request history cannot be deleted';
  END IF;
  IF (NEW.id, NEW.employee_user_id, NEW.requested_at, NEW.created_at)
    IS DISTINCT FROM (OLD.id, OLD.employee_user_id, OLD.requested_at, OLD.created_at)
    OR (OLD.status IN ('REJECTED', 'CANCELLED') AND NEW IS DISTINCT FROM OLD)
    OR (OLD.status = 'APPROVED' AND NEW.status NOT IN ('APPROVED', 'CANCELLED'))
    OR (OLD.status <> 'PENDING' AND (NEW.start_date, NEW.end_date, NEW.reason, NEW.leave_type,
        NEW.decided_by_user_id, NEW.decided_at, NEW.decision_reason)
      IS DISTINCT FROM (OLD.start_date, OLD.end_date, OLD.reason, OLD.leave_type,
        OLD.decided_by_user_id, OLD.decided_at, OLD.decision_reason))
    OR (OLD.status = 'PENDING' AND NEW.status <> 'PENDING'
      AND (NEW.start_date, NEW.end_date, NEW.reason, NEW.leave_type)
        IS DISTINCT FROM (OLD.start_date, OLD.end_date, OLD.reason, OLD.leave_type)) THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Leave request transition or history rewrite is not allowed';
  END IF;
  RETURN NEW;
END;
$$;
