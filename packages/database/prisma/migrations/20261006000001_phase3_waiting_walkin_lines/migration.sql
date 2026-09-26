-- Phase 3 Step 6 foundation amendment (Owner-approved): TRUE WAITING WALK-IN.
--
-- A walk-in visit records its service intent even when no KTV is free. Such a line is WAITING:
-- it has its real visit, participant, service, order, duration and catalog snapshot and its
-- assignment mode (plus the requested KTV for SPECIFIC), but NO assigned KTV, NO planned times,
-- NO buffer snapshot and therefore NO KTV occupancy. Initial assignment (WAITING -> PLANNED)
-- sets the real KTV, the planned interval and the buffer snapshot in one update; the existing
-- occupancy trigger then claims the interval under the unchanged overlap exclusion constraint.
-- Existing rows are all assigned (the columns were NOT NULL) and keep their values: no backfill.

ALTER TABLE "visit_service_lines"
  ALTER COLUMN "employee_user_id" DROP NOT NULL,
  ALTER COLUMN "planned_start_at" DROP NOT NULL,
  ALTER COLUMN "planned_end_at" DROP NOT NULL,
  ALTER COLUMN "buffer_minutes" DROP NOT NULL,
  ADD COLUMN "requested_employee_user_id" UUID;

ALTER TABLE "visit_service_lines"
  ADD CONSTRAINT "visit_service_lines_requested_employee_user_id_fkey"
    FOREIGN KEY ("requested_employee_user_id") REFERENCES "employee_profiles"("user_id")
    ON DELETE RESTRICT ON UPDATE RESTRICT;
CREATE INDEX "visit_service_lines_requested_employee_idx"
  ON "visit_service_lines" ("requested_employee_user_id");
CREATE INDEX "visit_service_lines_waiting_idx"
  ON "visit_service_lines" ("visit_id") WHERE "status" = 'WAITING';

ALTER TABLE "visit_service_lines"
  -- The assignment is all or nothing: KTV, start, end and buffer together. The existing
  -- shape check (end = start + duration) then applies to every assigned line.
  ADD CONSTRAINT "visit_service_lines_assignment" CHECK (
    ("employee_user_id" IS NULL) = ("planned_start_at" IS NULL)
    AND ("planned_start_at" IS NULL) = ("planned_end_at" IS NULL)
    AND ("planned_end_at" IS NULL) = ("buffer_minutes" IS NULL)
    AND ("status" <> 'WAITING' OR ("employee_user_id" IS NULL AND "booking_service_line_id" IS NULL))
    AND ("status" NOT IN ('PLANNED', 'IN_PROGRESS', 'DONE') OR "employee_user_id" IS NOT NULL)
  ),
  -- Requested KTV: only with SPECIFIC; required while a SPECIFIC line waits; an assignment of a
  -- requested line is always that KTV (never silently substituted). Lines carried from a booking
  -- keep it NULL (their intent lives on the booking line).
  ADD CONSTRAINT "visit_service_lines_requested" CHECK (
    ("requested_employee_user_id" IS NULL OR "assignment_mode" = 'SPECIFIC')
    AND ("status" <> 'WAITING' OR "assignment_mode" <> 'SPECIFIC'
      OR "requested_employee_user_id" IS NOT NULL)
    AND ("requested_employee_user_id" IS NULL OR "employee_user_id" IS NULL
      OR "employee_user_id" = "requested_employee_user_id")
  );

CREATE OR REPLACE FUNCTION lucy_guard_visit_service_line() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  visit_status "VisitStatus";
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.status NOT IN ('PLANNED', 'WAITING') OR NEW.row_version <> 1
      OR NEW.start_overdue_warned_at IS NOT NULL THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'A visit line starts PLANNED or WAITING at version 1';
    END IF;
    -- FOR SHARE serializes with a concurrent visit close.
    SELECT status INTO visit_status FROM visits WHERE id = NEW.visit_id FOR SHARE;
    IF visit_status IS DISTINCT FROM 'OPEN' AND visit_status IS DISTINCT FROM 'IN_SERVICE' THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Lines are added only to an open or in-service visit';
    END IF;
    IF NEW.booking_service_line_id IS NOT NULL THEN
      -- FOR UPDATE serializes with a concurrent replan of the carried booking line.
      PERFORM 1 FROM booking_service_lines WHERE id = NEW.booking_service_line_id FOR UPDATE;
      IF NOT EXISTS (
        SELECT 1 FROM booking_service_lines l JOIN visits v ON v.booking_id = l.booking_id
        WHERE l.id = NEW.booking_service_line_id AND v.id = NEW.visit_id) THEN
        RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'A visit line carries over a line of the same booking';
      END IF;
    END IF;
  ELSE
    IF (NEW.id, NEW.visit_id, NEW.participant_id, NEW.sequence, NEW.booking_service_line_id,
        NEW.service_id, NEW.service_code, NEW.service_name_vi, NEW.service_name_en,
        NEW.catalog_price_min_vnd, NEW.catalog_price_max_vnd, NEW.catalog_pricing_unit,
        NEW.duration_minutes, NEW.added_on_behalf, NEW.added_by_user_id, NEW.added_at, NEW.created_at)
      IS DISTINCT FROM (OLD.id, OLD.visit_id, OLD.participant_id, OLD.sequence,
        OLD.booking_service_line_id, OLD.service_id, OLD.service_code, OLD.service_name_vi,
        OLD.service_name_en, OLD.catalog_price_min_vnd, OLD.catalog_price_max_vnd,
        OLD.catalog_pricing_unit, OLD.duration_minutes, OLD.added_on_behalf, OLD.added_by_user_id,
        OLD.added_at, OLD.created_at)
      OR (OLD.status IN ('DONE', 'CANCELLED') AND NEW IS DISTINCT FROM OLD)
      OR (NEW.status <> OLD.status AND NOT (
        (OLD.status = 'WAITING' AND NEW.status IN ('PLANNED', 'CANCELLED'))
        OR (OLD.status = 'PLANNED' AND NEW.status IN ('IN_PROGRESS', 'CANCELLED'))
        OR (OLD.status = 'IN_PROGRESS' AND NEW.status = 'DONE')))
      -- The KTV is set by the initial assignment (WAITING -> PLANNED), may change while
      -- PLANNED (Step 8 reassignment) and is fixed once the service has started.
      OR (OLD.status NOT IN ('WAITING', 'PLANNED')
        AND NEW.employee_user_id IS DISTINCT FROM OLD.employee_user_id)
      -- Assignment intent changes only while the line still waits (no KTV assigned yet).
      OR ((NEW.assignment_mode, NEW.requested_employee_user_id)
          IS DISTINCT FROM (OLD.assignment_mode, OLD.requested_employee_user_id)
        AND NOT (OLD.status = 'WAITING' AND NEW.status = 'WAITING'))
      -- A warning fact is written once.
      OR (OLD.start_overdue_warned_at IS NOT NULL
        AND NEW.start_overdue_warned_at IS DISTINCT FROM OLD.start_overdue_warned_at)
      OR (NEW IS DISTINCT FROM OLD AND NEW.row_version <> OLD.row_version + 1) THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Visit line snapshot, final states, intent, warning facts and version cannot be rewritten';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION lucy_sync_visit_line_occupancy() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  -- Check-in carries a booking line over: its booking occupancy moves to the visit line.
  IF NEW.booking_service_line_id IS NOT NULL THEN
    DELETE FROM ktv_occupancies WHERE booking_service_line_id = NEW.booking_service_line_id;
  END IF;
  -- Only an assigned line occupies; a WAITING line (no KTV, no times) never does.
  IF NEW.status IN ('PLANNED', 'IN_PROGRESS') AND NEW.employee_user_id IS NOT NULL THEN
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

CREATE OR REPLACE FUNCTION lucy_guard_visit() RETURNS trigger
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
    -- A closed visit holds no waiting, planned or running line (so no occupancy or intent).
    IF NEW.status IN ('COMPLETED', 'CANCELLED') AND OLD.status NOT IN ('COMPLETED', 'CANCELLED')
      AND EXISTS (SELECT 1 FROM visit_service_lines l
        WHERE l.visit_id = NEW.id AND l.status IN ('WAITING', 'PLANNED', 'IN_PROGRESS')) THEN
      RAISE EXCEPTION USING ERRCODE = '23514',
        MESSAGE = 'A visit closes only after each of its lines is done or cancelled';
    END IF;
  END IF;
  IF NEW.service_date IS DISTINCT FROM lucy_branch_local_date(NEW.branch_id, NEW.arrived_at) THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Visit service date must be the branch-local date of arrival';
  END IF;
  RETURN NEW;
END;
$$;

-- CREATE OR REPLACE resets function options, so re-apply the Phase 1 hardening convention.
DO $$
DECLARE
  migration_schema text := current_schema();
  function_name text;
BEGIN
  FOREACH function_name IN ARRAY ARRAY[
    'lucy_guard_visit_service_line', 'lucy_sync_visit_line_occupancy', 'lucy_guard_visit'
  ] LOOP
    EXECUTE format('ALTER FUNCTION %I.%I() SET search_path TO pg_catalog, %I, pg_temp',
      migration_schema, function_name, migration_schema);
    EXECUTE format('REVOKE ALL ON FUNCTION %I.%I() FROM PUBLIC', migration_schema, function_name);
  END LOOP;
END;
$$;
