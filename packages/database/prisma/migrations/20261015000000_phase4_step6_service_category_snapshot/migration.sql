-- Phase 4 Step 6 follow-up: the historical service-category snapshot for discount scope.
--
-- A category-scoped discount must be evaluated against the category the service had when the
-- transaction was established, never the live `services.category_id` (a catalog move after the
-- Visit must not change an existing draft's or a finalizing invoice's eligibility). Like the
-- price range and the quantity limit, the category is snapshotted on the booking line, copied to
-- the visit line (arrival copies it; walk-in intake and the staff-added line take it from the
-- catalog at that moment) and copied to the invoice line detail. It is immutable afterwards.
--
-- Steps 4 and 5 migrations are NOT modified: this migration is additive. The column is NULLABLE on
-- purpose: NULL means "the historical category is unknown", it is never guessed. A category-scoped
-- discount never matches an unknown category (service-scoped discounts are unaffected).
ALTER TABLE "booking_service_lines" ADD COLUMN "service_category_id" UUID;
ALTER TABLE "visit_service_lines" ADD COLUMN "service_category_id" UUID;
ALTER TABLE "invoice_line_services" ADD COLUMN "service_category_id" UUID;

ALTER TABLE "booking_service_lines"
  ADD CONSTRAINT "booking_service_lines_service_category_id_fkey"
  FOREIGN KEY ("service_category_id") REFERENCES "service_categories"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "visit_service_lines"
  ADD CONSTRAINT "visit_service_lines_service_category_id_fkey"
  FOREIGN KEY ("service_category_id") REFERENCES "service_categories"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "invoice_line_services"
  ADD CONSTRAINT "invoice_line_services_service_category_id_fkey"
  FOREIGN KEY ("service_category_id") REFERENCES "service_categories"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- ------------------------------------------------------------------------------- backfill
-- Truthful, never invented. The catalog audit trail records every category move as a
-- `SERVICE_UPDATED` event whose `before.categoryId` is the category the service left. For a line
-- created at T:
--   * no category move was recorded after T  -> the service still has the category it had at T,
--     so the current category IS the historical one;
--   * a move was recorded after T            -> the category at T is the `before` value of the FIRST
--     move after T. It is kept only if that category still exists and the first move is unambiguous
--     (two moves recorded at the very same instant cannot be ordered); otherwise the category is
--     unknown, NULL.
-- Visit lines that carry over a booking line copy the booking line's snapshot, and invoice line
-- details copy their visit line's snapshot (snapshot-to-snapshot, exactly like the other columns).
-- Category moves made outside the audited catalog command (for example by direct SQL) cannot be
-- known and are not detected. The guards below are the current definitions and would reject these
-- one-off UPDATEs, so the user triggers of the three tables are switched off only while they run.
ALTER TABLE "booking_service_lines" DISABLE TRIGGER USER;
ALTER TABLE "visit_service_lines" DISABLE TRIGGER USER;
ALTER TABLE "invoice_line_services" DISABLE TRIGGER USER;

UPDATE "booking_service_lines" l
SET "service_category_id" = (
  SELECT CASE
    WHEN COALESCE(later.found, false) THEN (SELECT c."id" FROM "service_categories" c WHERE c."id" = later.before_id)
    ELSE s."category_id"
  END
  FROM "services" s
  LEFT JOIN LATERAL (
    SELECT true AS found, CASE WHEN first_move.ties = 1 THEN first_move.before_id END AS before_id
    FROM (
      SELECT NULLIF(a."before"->>'categoryId', '')::uuid AS before_id,
             count(*) OVER (PARTITION BY a."occurred_at") AS ties
      FROM "audit_events" a
      WHERE a."entity_type" = 'Service' AND a."entity_id" = l."service_id"::text
        AND a."action" = 'SERVICE_UPDATED' AND (a."after" ? 'categoryId')
        AND a."occurred_at" > l."created_at"
      ORDER BY a."occurred_at", a."id"
      LIMIT 1
    ) first_move
  ) later ON true
  WHERE s."id" = l."service_id"
);

UPDATE "visit_service_lines" v
SET "service_category_id" = b."service_category_id"
FROM "booking_service_lines" b
WHERE v."booking_service_line_id" = b."id";

UPDATE "visit_service_lines" v
SET "service_category_id" = (
  SELECT CASE
    WHEN COALESCE(later.found, false) THEN (SELECT c."id" FROM "service_categories" c WHERE c."id" = later.before_id)
    ELSE s."category_id"
  END
  FROM "services" s
  LEFT JOIN LATERAL (
    SELECT true AS found, CASE WHEN first_move.ties = 1 THEN first_move.before_id END AS before_id
    FROM (
      SELECT NULLIF(a."before"->>'categoryId', '')::uuid AS before_id,
             count(*) OVER (PARTITION BY a."occurred_at") AS ties
      FROM "audit_events" a
      WHERE a."entity_type" = 'Service' AND a."entity_id" = v."service_id"::text
        AND a."action" = 'SERVICE_UPDATED' AND (a."after" ? 'categoryId')
        AND a."occurred_at" > v."created_at"
      ORDER BY a."occurred_at", a."id"
      LIMIT 1
    ) first_move
  ) later ON true
  WHERE s."id" = v."service_id"
)
WHERE v."booking_service_line_id" IS NULL;

UPDATE "invoice_line_services" d
SET "service_category_id" = v."service_category_id"
FROM "visit_service_lines" v
WHERE d."visit_service_line_id" = v."id";

ALTER TABLE "booking_service_lines" ENABLE TRIGGER USER;
ALTER TABLE "visit_service_lines" ENABLE TRIGGER USER;
ALTER TABLE "invoice_line_services" ENABLE TRIGGER USER;

-- ---------------------------------------------------------------------------------- guards
-- The three guards below are the CURRENT definitions (booking/visit line: 20261014000002; invoice
-- line detail: 20261014000003) with the category snapshot added and nothing else changed:
--   * booking line, INSERT: an unset category is filled from the service's category at that moment
--     (the snapshot is taken when the line is first created);
--   * visit line, INSERT: a carried line copies its booking line's snapshot exactly (an unset value is
--     filled from it, a different value is rejected); a walk-in / staff-added line takes the service's
--     category at that moment;
--   * invoice line detail, INSERT: copies the visit line's snapshot exactly (unset is filled, different
--     is rejected);
--   * booking and visit lines: the snapshot is immutable (added to the protected columns).
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
    IF NEW.service_category_id IS NULL THEN
      SELECT category_id INTO NEW.service_category_id FROM services WHERE id = NEW.service_id;
    END IF;
  ELSE
    -- Only a confirmed booking's lines may be reassigned or replanned; the catalog snapshot,
    -- service, recipient and order are fixed.
    IF booking_status IS DISTINCT FROM 'CONFIRMED'
      OR (NEW.id, NEW.booking_id, NEW.sequence, NEW.recipient_id, NEW.service_id, NEW.service_code,
          NEW.service_name_vi, NEW.service_name_en, NEW.catalog_price_min_vnd,
          NEW.catalog_price_max_vnd, NEW.catalog_pricing_unit, NEW.max_quantity_snapshot,
          NEW.service_category_id, NEW.created_at)
        IS DISTINCT FROM (OLD.id, OLD.booking_id, OLD.sequence, OLD.recipient_id, OLD.service_id,
          OLD.service_code, OLD.service_name_vi, OLD.service_name_en, OLD.catalog_price_min_vnd,
          OLD.catalog_price_max_vnd, OLD.catalog_pricing_unit, OLD.max_quantity_snapshot,
          OLD.service_category_id, OLD.created_at)
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
  carried_category uuid;
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
      -- Snapshot-to-snapshot: the carried line's historical category, never the live catalog.
      SELECT service_category_id INTO carried_category
        FROM booking_service_lines WHERE id = NEW.booking_service_line_id;
      IF NEW.service_category_id IS NULL THEN
        NEW.service_category_id := carried_category;
      ELSIF NEW.service_category_id IS DISTINCT FROM carried_category THEN
        RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'A carried visit line copies the historical category of its booking line';
      END IF;
    ELSIF NEW.service_category_id IS NULL THEN
      SELECT category_id INTO NEW.service_category_id FROM services WHERE id = NEW.service_id;
    END IF;
  ELSE
    IF (NEW.id, NEW.visit_id, NEW.participant_id, NEW.sequence, NEW.booking_service_line_id,
        NEW.service_id, NEW.service_code, NEW.service_name_vi, NEW.service_name_en,
        NEW.catalog_price_min_vnd, NEW.catalog_price_max_vnd, NEW.catalog_pricing_unit,
        NEW.max_quantity_snapshot, NEW.service_category_id,
        NEW.duration_minutes, NEW.added_on_behalf, NEW.added_by_user_id, NEW.added_at, NEW.created_at)
      IS DISTINCT FROM (OLD.id, OLD.visit_id, OLD.participant_id, OLD.sequence,
        OLD.booking_service_line_id, OLD.service_id, OLD.service_code, OLD.service_name_vi,
        OLD.service_name_en, OLD.catalog_price_min_vnd, OLD.catalog_price_max_vnd,
        OLD.catalog_pricing_unit, OLD.max_quantity_snapshot, OLD.service_category_id,
        OLD.duration_minutes, OLD.added_on_behalf, OLD.added_by_user_id, OLD.added_at, OLD.created_at)
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

CREATE OR REPLACE FUNCTION lucy_guard_invoice_line_service() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  invoice_status "InvoiceStatus";
  invoice_visit uuid;
  line invoice_lines%ROWTYPE;
  visit_line visit_service_lines%ROWTYPE;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Invoice service details are recorded once';
  END IF;
  SELECT status, visit_id INTO invoice_status, invoice_visit FROM invoices WHERE id = NEW.invoice_id FOR SHARE;
  IF invoice_status IS DISTINCT FROM 'DRAFT' THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Invoice service details are created only while the invoice is a draft';
  END IF;
  SELECT * INTO line FROM invoice_lines WHERE id = NEW.invoice_line_id;
  IF line.kind IS DISTINCT FROM 'SERVICE' THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'A service detail belongs to a SERVICE line';
  END IF;
  SELECT * INTO visit_line FROM visit_service_lines WHERE id = NEW.visit_service_line_id;
  IF visit_line.status IS DISTINCT FROM 'DONE' OR visit_line.visit_id IS DISTINCT FROM invoice_visit THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'An invoice line invoices a performed service of its own visit';
  END IF;
  -- The historical category is copied from the visit line (an unset value is filled, a different one is rejected).
  IF NEW.service_category_id IS NULL THEN
    NEW.service_category_id := visit_line.service_category_id;
  END IF;
  -- Snapshot consistency: the invoice copies the visit-line snapshot exactly (never the live catalog).
  IF (NEW.service_id, NEW.participant_id, NEW.employee_user_id, NEW.pricing_unit,
      NEW.catalog_price_min_vnd, NEW.catalog_price_max_vnd, NEW.quantity_limit, NEW.added_on_behalf,
      NEW.service_category_id)
    IS DISTINCT FROM (visit_line.service_id, visit_line.participant_id, visit_line.employee_user_id,
      visit_line.catalog_pricing_unit, visit_line.catalog_price_min_vnd, visit_line.catalog_price_max_vnd,
      visit_line.max_quantity_snapshot, visit_line.added_on_behalf, visit_line.service_category_id)
    OR (line.item_code, line.name_vi, line.name_en)
      IS DISTINCT FROM (visit_line.service_code, visit_line.service_name_vi, visit_line.service_name_en) THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'The invoice line must copy the visit line snapshot';
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
    'lucy_guard_booking_child', 'lucy_guard_visit_service_line', 'lucy_guard_invoice_line_service'
  ] LOOP
    EXECUTE format('ALTER FUNCTION %I.%I() SET search_path TO pg_catalog, %I, pg_temp',
      migration_schema, function_name, migration_schema);
    EXECUTE format('REVOKE ALL ON FUNCTION %I.%I() FROM PUBLIC', migration_schema, function_name);
  END LOOP;
END;
$$;
