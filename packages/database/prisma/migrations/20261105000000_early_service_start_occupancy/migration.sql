-- Owner request 2026-10-07: a technician may START a service before its planned start (customer checked in, technician
-- free). The database itself must reject an overlap, so a line started early also claims the early part
-- [started_at, planned_start_at) in ktv_occupancies, in addition to its planned window.
-- Additive: two function bodies and one trigger; no table, column or data change. A start on or after the planned start
-- keeps today's claim exactly. A claim ends with the line (DONE / CANCELLED), as before.

CREATE OR REPLACE FUNCTION lucy_sync_visit_line_occupancy() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  claim_start timestamptz;
BEGIN
  -- Check-in carries a booking line over: its booking occupancy moves to the visit line.
  IF NEW.booking_service_line_id IS NOT NULL THEN
    DELETE FROM ktv_occupancies WHERE booking_service_line_id = NEW.booking_service_line_id;
  END IF;
  -- Only an assigned line occupies; a WAITING line (no KTV, no times) never does.
  IF NEW.status IN ('PLANNED', 'IN_PROGRESS') AND NEW.employee_user_id IS NOT NULL THEN
    -- An execution that started before the planned start also holds [started_at, planned_start_at).
    SELECT LEAST(NEW.planned_start_at, x.started_at) INTO claim_start
    FROM service_executions x WHERE x.visit_service_line_id = NEW.id;
    claim_start := COALESCE(claim_start, NEW.planned_start_at);
    INSERT INTO ktv_occupancies (employee_user_id, period, visit_service_line_id)
    VALUES (NEW.employee_user_id,
      tstzrange(claim_start, NEW.planned_end_at + make_interval(mins => NEW.buffer_minutes), '[)'),
      NEW.id)
    ON CONFLICT (visit_service_line_id) DO UPDATE
      SET employee_user_id = EXCLUDED.employee_user_id, period = EXCLUDED.period;
  ELSE
    DELETE FROM ktv_occupancies WHERE visit_service_line_id = NEW.id;
  END IF;
  RETURN NULL;
END;
$$;

-- The execution row can be written before or after the line moves to IN_PROGRESS; whichever comes first, the claim is
-- widened here (and kept wide by the line trigger above). The exclusion constraint rejects an overlap with the KTV's
-- other claims (SQLSTATE 23P01, ktv_occupancies_no_overlap).
CREATE FUNCTION lucy_sync_execution_early_occupancy() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  UPDATE ktv_occupancies
  SET period = tstzrange(NEW.started_at, upper(period), '[)')
  WHERE visit_service_line_id = NEW.visit_service_line_id AND lower(period) > NEW.started_at;
  RETURN NULL;
END;
$$;
CREATE TRIGGER "service_executions_early_occupancy" AFTER INSERT ON "service_executions"
FOR EACH ROW EXECUTE FUNCTION lucy_sync_execution_early_occupancy();

-- CREATE OR REPLACE resets function options, so re-apply the Phase 1 hardening convention.
DO $$
DECLARE
  migration_schema text := current_schema();
  function_name text;
BEGIN
  FOREACH function_name IN ARRAY ARRAY[
    'lucy_sync_visit_line_occupancy', 'lucy_sync_execution_early_occupancy'
  ] LOOP
    EXECUTE format('ALTER FUNCTION %I.%I() SET search_path TO pg_catalog, %I, pg_temp',
      migration_schema, function_name, migration_schema);
    EXECUTE format('REVOKE ALL ON FUNCTION %I.%I() FROM PUBLIC', migration_schema, function_name);
  END LOOP;
END;
$$;
