-- Phase 4 Step 4, migration 3 of 5: the per-service quantity-limit foundation (design OP-1, 4.3.1).
--
-- The limit is configured PER SERVICE (`services.max_quantity`; never a global setting) and is
-- snapshotted with the other transaction-time pricing inputs (code, names, price range, unit) when
-- a service line is established: on the booking line, and again on the visit line (arrival copies
-- it from the booking line; walk-in intake and the staff-added line copy it from the catalog at
-- that moment). A later catalog change therefore never alters an existing Booking, Visit or
-- Invoice. A visit line still has NO quantity: one line is one performed service; the limit only
-- bounds the invoice line's quantity of a PER_NAIL service (the invoice tables follow).
--
-- Additive and historical-data-safe: no row is rewritten with an invented business value.
-- `DEFAULT 1` is the neutral, most restrictive value (a PER_SERVICE service is always 1; the Owner
-- raises the limit per PER_NAIL service afterwards). Adding a NOT NULL column with a constant
-- default is a metadata-only change, and the CHECKs below hold for every existing row.
ALTER TABLE "services" ADD COLUMN "max_quantity" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "booking_service_lines" ADD COLUMN "max_quantity_snapshot" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "visit_service_lines" ADD COLUMN "max_quantity_snapshot" INTEGER NOT NULL DEFAULT 1;

-- PER_SERVICE means exactly one unit; several performances are several lines.
ALTER TABLE "services"
  ADD CONSTRAINT "services_max_quantity" CHECK (
    "max_quantity" >= 1 AND ("pricing_unit" <> 'PER_SERVICE' OR "max_quantity" = 1)
  );
ALTER TABLE "booking_service_lines"
  ADD CONSTRAINT "booking_service_lines_max_quantity" CHECK (
    "max_quantity_snapshot" >= 1 AND ("catalog_pricing_unit" <> 'PER_SERVICE' OR "max_quantity_snapshot" = 1)
  );
ALTER TABLE "visit_service_lines"
  ADD CONSTRAINT "visit_service_lines_max_quantity" CHECK (
    "max_quantity_snapshot" >= 1 AND ("catalog_pricing_unit" <> 'PER_SERVICE' OR "max_quantity_snapshot" = 1)
  );

-- The snapshot is immutable like the rest of the catalog snapshot: the two guards below are the
-- current definitions (20261005000002 and 20261006000001) with `max_quantity_snapshot` added to the
-- protected snapshot columns and nothing else changed.
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
          NEW.catalog_price_max_vnd, NEW.catalog_pricing_unit, NEW.max_quantity_snapshot, NEW.created_at)
        IS DISTINCT FROM (OLD.id, OLD.booking_id, OLD.sequence, OLD.recipient_id, OLD.service_id,
          OLD.service_code, OLD.service_name_vi, OLD.service_name_en, OLD.catalog_price_min_vnd,
          OLD.catalog_price_max_vnd, OLD.catalog_pricing_unit, OLD.max_quantity_snapshot, OLD.created_at)
      OR (NEW IS DISTINCT FROM OLD AND NEW.row_version <> OLD.row_version + 1) THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Booking line snapshot, order and version cannot be rewritten';
    END IF;
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
        NEW.max_quantity_snapshot,
        NEW.duration_minutes, NEW.added_on_behalf, NEW.added_by_user_id, NEW.added_at, NEW.created_at)
      IS DISTINCT FROM (OLD.id, OLD.visit_id, OLD.participant_id, OLD.sequence,
        OLD.booking_service_line_id, OLD.service_id, OLD.service_code, OLD.service_name_vi,
        OLD.service_name_en, OLD.catalog_price_min_vnd, OLD.catalog_price_max_vnd,
        OLD.catalog_pricing_unit, OLD.max_quantity_snapshot, OLD.duration_minutes,
        OLD.added_on_behalf, OLD.added_by_user_id, OLD.added_at, OLD.created_at)
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

-- CREATE OR REPLACE resets function options, so re-apply the Phase 1 hardening convention.
DO $$
DECLARE
  migration_schema text := current_schema();
  function_name text;
BEGIN
  FOREACH function_name IN ARRAY ARRAY['lucy_guard_booking_child', 'lucy_guard_visit_service_line'] LOOP
    EXECUTE format('ALTER FUNCTION %I.%I() SET search_path TO pg_catalog, %I, pg_temp',
      migration_schema, function_name, migration_schema);
    EXECUTE format('REVOKE ALL ON FUNCTION %I.%I() FROM PUBLIC', migration_schema, function_name);
  END LOOP;
END;
$$;
