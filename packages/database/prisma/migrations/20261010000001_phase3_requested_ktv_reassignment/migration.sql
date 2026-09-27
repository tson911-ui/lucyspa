-- Keep the original SPECIFIC request separate from the actual KTV after an
-- explicit Step 8 reassignment. Initial assignment must still honor the request.
ALTER TABLE "visit_service_lines"
  DROP CONSTRAINT "visit_service_lines_requested",
  ADD CONSTRAINT "visit_service_lines_requested" CHECK (
    ("requested_employee_user_id" IS NULL OR "assignment_mode" = 'SPECIFIC')
    AND ("status" <> 'WAITING' OR "assignment_mode" <> 'SPECIFIC'
      OR "requested_employee_user_id" IS NOT NULL)
  );

CREATE FUNCTION lucy_guard_initial_requested_ktv() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' OR OLD.status = 'WAITING' THEN
    IF NEW.requested_employee_user_id IS NOT NULL
      AND NEW.employee_user_id IS NOT NULL
      AND NEW.employee_user_id <> NEW.requested_employee_user_id THEN
      RAISE EXCEPTION USING ERRCODE = '23514',
        MESSAGE = 'Initial assignment must honor the requested KTV';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "visit_service_lines_initial_requested_ktv"
BEFORE INSERT OR UPDATE ON "visit_service_lines"
FOR EACH ROW EXECUTE FUNCTION lucy_guard_initial_requested_ktv();

DO $$
DECLARE migration_schema text := current_schema();
BEGIN
  EXECUTE format('ALTER FUNCTION %I.lucy_guard_initial_requested_ktv() SET search_path TO pg_catalog, %I, pg_temp',
    migration_schema, migration_schema);
  EXECUTE format('REVOKE ALL ON FUNCTION %I.lucy_guard_initial_requested_ktv() FROM PUBLIC', migration_schema);
END;
$$;
