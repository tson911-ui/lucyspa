-- Phase 3 Step 2: KTV occupancy integrity (additive; no data change).
--
-- ktv_occupancies is derived from booking and visit service lines. These guards make it
-- impossible for a normal write path to leave a stale or missing claim:
--   * the table is writable only by the occupancy triggers, never directly;
--   * the source line tables and the occupancy table cannot be truncated;
--   * booking children lock their booking (FOR SHARE), so a concurrent cancel/no-show/check-in
--     cannot miss a line claim that is being written;
--   * a visit line is added only to an OPEN or IN_SERVICE visit (locked FOR SHARE), and a carried
--     booking line is locked FOR UPDATE, so a concurrent booking-line replan cannot re-create the
--     booking claim that the carry-over removes;
--   * a visit becomes CANCELLED or COMPLETED only when none of its lines is PLANNED or IN_PROGRESS.

CREATE FUNCTION lucy_guard_ktv_occupancy_write() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  -- Depth 1 is a statement issued directly against the table; the occupancy triggers write at depth 2+.
  IF pg_trigger_depth() < 2 THEN
    RAISE EXCEPTION USING ERRCODE = '23514',
      MESSAGE = 'KTV occupancies are derived from service lines and are never written directly';
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$;
CREATE TRIGGER "ktv_occupancies_derived_only" BEFORE INSERT OR UPDATE OR DELETE ON "ktv_occupancies"
FOR EACH ROW EXECUTE FUNCTION lucy_guard_ktv_occupancy_write();
CREATE TRIGGER "ktv_occupancies_no_truncate" BEFORE TRUNCATE ON "ktv_occupancies"
FOR EACH STATEMENT EXECUTE FUNCTION lucy_reject_permanent_history_mutation();
CREATE TRIGGER "booking_service_lines_no_truncate" BEFORE TRUNCATE ON "booking_service_lines"
FOR EACH STATEMENT EXECUTE FUNCTION lucy_reject_permanent_history_mutation();
CREATE TRIGGER "visit_service_lines_no_truncate" BEFORE TRUNCATE ON "visit_service_lines"
FOR EACH STATEMENT EXECUTE FUNCTION lucy_reject_permanent_history_mutation();

CREATE OR REPLACE FUNCTION lucy_guard_booking_child() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  booking_status "BookingStatus";
BEGIN
  -- FOR SHARE serializes with a concurrent booking status change (which releases claims).
  SELECT status INTO booking_status FROM bookings WHERE id = NEW.booking_id FOR SHARE;
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
    -- A closed visit holds no planned or running line, so it can hold no KTV occupancy.
    IF NEW.status IN ('COMPLETED', 'CANCELLED') AND OLD.status NOT IN ('COMPLETED', 'CANCELLED')
      AND EXISTS (SELECT 1 FROM visit_service_lines l
        WHERE l.visit_id = NEW.id AND l.status IN ('PLANNED', 'IN_PROGRESS')) THEN
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

CREATE OR REPLACE FUNCTION lucy_guard_visit_service_line() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  visit_status "VisitStatus";
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'PLANNED' OR NEW.row_version <> 1 OR NEW.start_overdue_warned_at IS NOT NULL THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'A visit line starts PLANNED at version 1';
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

-- CREATE OR REPLACE resets function options, so re-apply the Phase 1 hardening convention.
DO $$
DECLARE
  migration_schema text := current_schema();
  function_name text;
BEGIN
  FOREACH function_name IN ARRAY ARRAY[
    'lucy_guard_ktv_occupancy_write', 'lucy_guard_booking_child', 'lucy_guard_visit',
    'lucy_guard_visit_service_line'
  ] LOOP
    EXECUTE format('ALTER FUNCTION %I.%I() SET search_path TO pg_catalog, %I, pg_temp',
      migration_schema, function_name, migration_schema);
    EXECUTE format('REVOKE ALL ON FUNCTION %I.%I() FROM PUBLIC', migration_schema, function_name);
  END LOOP;
END;
$$;
