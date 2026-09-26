-- Allowed classification changes with COLLABORATOR (append-only history, unchanged rules
-- otherwise): any start except ENDED; TRAINEE -> COLLABORATOR | OFFICIAL_EMPLOYEE | ENDED;
-- COLLABORATOR -> OFFICIAL_EMPLOYEE | ENDED; OFFICIAL_EMPLOYEE -> ENDED (never back to
-- COLLABORATOR); nothing after ENDED (no rehire). Existing rows are not touched.
CREATE OR REPLACE FUNCTION lucy_check_employment_classification() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  latest RECORD;
BEGIN
  IF TG_OP <> 'INSERT' THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Employment classification history is append-only';
  END IF;
  PERFORM 1 FROM employee_profiles WHERE user_id = NEW.employee_user_id FOR UPDATE;
  SELECT classification, effective_date INTO latest
    FROM employment_classification_changes
    WHERE employee_user_id = NEW.employee_user_id
    ORDER BY effective_date DESC
    LIMIT 1;
  IF NOT FOUND THEN
    IF NEW.classification = 'ENDED' THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Employment cannot start as ENDED';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.effective_date <= latest.effective_date THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Employment classification changes must be later than the latest change';
  END IF;
  IF NOT (
    (latest.classification = 'TRAINEE'
      AND NEW.classification IN ('COLLABORATOR', 'OFFICIAL_EMPLOYEE', 'ENDED'))
    OR (latest.classification = 'COLLABORATOR'
      AND NEW.classification IN ('OFFICIAL_EMPLOYEE', 'ENDED'))
    OR (latest.classification = 'OFFICIAL_EMPLOYEE' AND NEW.classification = 'ENDED')
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Employment classification transition is not allowed';
  END IF;
  RETURN NEW;
END;
$$;
