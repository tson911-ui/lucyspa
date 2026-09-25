-- Employee management Step 1: effective-dated employment classification history.
-- Classification is separate from users.kind/status (account), roles, branches and skills.
-- The history is authoritative and append-only: "classification on date D" is the change with
-- the latest effective_date <= D for that employee. effective_date is a calendar DATE, compared
-- directly with attendance business dates and leave dates.
CREATE TYPE "EmploymentClassification" AS ENUM ('TRAINEE', 'OFFICIAL_EMPLOYEE', 'ENDED');

CREATE TABLE "employment_classification_changes" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "employee_user_id" UUID NOT NULL,
    "classification" "EmploymentClassification" NOT NULL,
    "effective_date" DATE NOT NULL,
    "reason" TEXT,
    -- NULL only for rows backfilled by this migration (history that predates the feature).
    "recorded_by_user_id" UUID,
    "recorded_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "employment_classification_changes_pkey" PRIMARY KEY ("id")
);

-- One change per employee and effective date: history is never ambiguous.
CREATE UNIQUE INDEX "employment_classification_changes_employee_date_key"
  ON "employment_classification_changes"("employee_user_id", "effective_date");
CREATE INDEX "employment_classification_changes_recorder_idx"
  ON "employment_classification_changes"("recorded_by_user_id");

ALTER TABLE "employment_classification_changes"
  ADD CONSTRAINT "employment_classification_changes_employee_user_id_fkey" FOREIGN KEY ("employee_user_id") REFERENCES "employee_profiles"("user_id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  ADD CONSTRAINT "employment_classification_changes_recorded_by_user_id_fkey" FOREIGN KEY ("recorded_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  ADD CONSTRAINT "employment_classification_changes_date_finite" CHECK (isfinite("effective_date")),
  ADD CONSTRAINT "employment_classification_changes_reason_nonblank" CHECK ("reason" IS NULL OR "reason" !~ '^[[:space:]]*$');

-- Backfill: employees that already exist predate this history, so no trainee period can be
-- truthfully inferred. Each becomes OFFICIAL_EMPLOYEE from the UTC calendar date of its
-- account creation. The Owner has no employee profile and is not touched.
INSERT INTO "employment_classification_changes"
  ("employee_user_id", "classification", "effective_date", "reason", "recorded_by_user_id")
SELECT ep."user_id", 'OFFICIAL_EMPLOYEE', (u."created_at" AT TIME ZONE 'UTC')::date,
  'Backfilled: employment predates classification history', NULL
FROM "employee_profiles" ep
JOIN "users" u ON u."id" = ep."user_id";

-- Append-only with legal transitions only. A new change must be later than every existing change
-- for the employee (history is never rewritten or reordered), must follow an allowed transition,
-- and nothing follows ENDED (rehire is not modeled). The employee row is locked so concurrent
-- inserts for one employee serialize even outside the API.
CREATE FUNCTION lucy_check_employment_classification() RETURNS trigger
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
    (latest.classification = 'TRAINEE' AND NEW.classification IN ('OFFICIAL_EMPLOYEE', 'ENDED'))
    OR (latest.classification = 'OFFICIAL_EMPLOYEE' AND NEW.classification = 'ENDED')
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Employment classification transition is not allowed';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "employment_classification_changes_guard"
BEFORE INSERT OR UPDATE OR DELETE ON "employment_classification_changes"
FOR EACH ROW EXECUTE FUNCTION lucy_check_employment_classification();
CREATE TRIGGER "employment_classification_changes_no_truncate"
BEFORE TRUNCATE ON "employment_classification_changes"
FOR EACH STATEMENT EXECUTE FUNCTION lucy_reject_permanent_history_mutation();
