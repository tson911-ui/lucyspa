-- Phase 6 P6-2, migration 4 of 5: the Excel/CSV import foundation (design 11.2, PRD 31; Owner decision P6-Q16 of 2026-10-07).
-- Tables only, empty, Wave 1 (no table of POS, invoices, discounts, loyalty or payments is touched). A file is parsed into rows,
-- previewed (valid, invalid, duplicate SKU, new, to update), and only an explicit confirmation applies it (PRD 31.2). The
-- Owner supplies the real data; nothing is seeded. The application of a job, its rows and its stock is written by later Steps.

CREATE TYPE "ProductImportKind" AS ENUM ('CATALOG', 'OPENING_STOCK', 'PRICE_UPDATE');
CREATE TYPE "ProductImportStatus" AS ENUM ('UPLOADED', 'PREVIEWED', 'APPLIED', 'FAILED', 'CANCELLED');
CREATE TYPE "ProductImportRowStatus" AS ENUM ('VALID', 'INVALID');
CREATE TYPE "ProductImportRowAction" AS ENUM ('CREATE', 'UPDATE', 'NONE');

CREATE TABLE "product_import_jobs" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "kind" "ProductImportKind" NOT NULL,
    "status" "ProductImportStatus" NOT NULL DEFAULT 'UPLOADED',
    "original_filename" TEXT NOT NULL,
    "file_sha256" VARCHAR(64) NOT NULL,
    "branch_id" UUID,
    "row_count" INTEGER NOT NULL DEFAULT 0,
    "valid_count" INTEGER NOT NULL DEFAULT 0,
    "invalid_count" INTEGER NOT NULL DEFAULT 0,
    "create_count" INTEGER NOT NULL DEFAULT 0,
    "update_count" INTEGER NOT NULL DEFAULT 0,
    "summary" JSONB,
    "failure_message" TEXT,
    "created_by_user_id" UUID NOT NULL,
    "previewed_at" TIMESTAMPTZ(3),
    "applied_at" TIMESTAMPTZ(3),
    "applied_by_user_id" UUID,
    "row_version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT clock_timestamp(),
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT clock_timestamp(),

    CONSTRAINT "product_import_jobs_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "product_import_jobs_filename" CHECK (btrim("original_filename") <> ''),
    CONSTRAINT "product_import_jobs_sha" CHECK ("file_sha256" ~ '^[0-9a-f]{64}$'),
    -- Opening stock is per branch (Q13); the other kinds are global.
    CONSTRAINT "product_import_jobs_branch" CHECK (("kind" = 'OPENING_STOCK') = ("branch_id" IS NOT NULL)),
    CONSTRAINT "product_import_jobs_counts" CHECK (
      "row_count" >= 0 AND "valid_count" >= 0 AND "invalid_count" >= 0 AND "create_count" >= 0 AND "update_count" >= 0
      AND "valid_count" + "invalid_count" <= "row_count" AND "create_count" + "update_count" <= "valid_count"),
    CONSTRAINT "product_import_jobs_state_facts" CHECK (
      (("status" = 'APPLIED') = ("applied_at" IS NOT NULL AND "applied_by_user_id" IS NOT NULL))
      AND ("applied_at" IS NULL) = ("applied_by_user_id" IS NULL)
      AND ("status" NOT IN ('PREVIEWED', 'APPLIED') OR "previewed_at" IS NOT NULL)
      AND ("status" <> 'FAILED' OR ("failure_message" IS NOT NULL AND btrim("failure_message") <> ''))),
    CONSTRAINT "product_import_jobs_version" CHECK ("row_version" >= 1)
);
CREATE INDEX "product_import_jobs_created_idx" ON "product_import_jobs"("created_at" DESC, "id" DESC);
CREATE INDEX "product_import_jobs_file_idx" ON "product_import_jobs"("file_sha256");
ALTER TABLE "product_import_jobs" ADD CONSTRAINT "product_import_jobs_branch_id_fkey"
  FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "product_import_jobs" ADD CONSTRAINT "product_import_jobs_created_by_user_id_fkey"
  FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "product_import_jobs" ADD CONSTRAINT "product_import_jobs_applied_by_user_id_fkey"
  FOREIGN KEY ("applied_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- The preview rows: what the file said, what is wrong with it, and what applying would do. Written while the job is UPLOADED;
-- applying stamps `applied_at` on a row once, while the job is PREVIEWED (the job becomes APPLIED in the same transaction).
CREATE TABLE "product_import_rows" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "job_id" UUID NOT NULL,
    "row_no" INTEGER NOT NULL,
    "raw" JSONB NOT NULL,
    "status" "ProductImportRowStatus" NOT NULL,
    "action" "ProductImportRowAction" NOT NULL DEFAULT 'NONE',
    "errors" JSONB NOT NULL DEFAULT '[]'::jsonb,
    "applied_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT clock_timestamp(),

    CONSTRAINT "product_import_rows_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "product_import_rows_row_no" CHECK ("row_no" >= 1),
    CONSTRAINT "product_import_rows_errors" CHECK (jsonb_typeof("errors") = 'array'),
    -- An invalid row never has an action and always says why; a valid row carries no error.
    CONSTRAINT "product_import_rows_validity" CHECK (
      ("status" = 'INVALID' AND "action" = 'NONE' AND jsonb_array_length("errors") > 0 AND "applied_at" IS NULL)
      OR ("status" = 'VALID' AND jsonb_array_length("errors") = 0))
);
CREATE UNIQUE INDEX "product_import_rows_job_row_key" ON "product_import_rows"("job_id", "row_no");
ALTER TABLE "product_import_rows" ADD CONSTRAINT "product_import_rows_job_id_fkey"
  FOREIGN KEY ("job_id") REFERENCES "product_import_jobs"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- ------------------------------------------------------------------------------------ guards
-- Job lifecycle: UPLOADED -> PREVIEWED | FAILED | CANCELLED, PREVIEWED -> APPLIED | FAILED | CANCELLED. A finished job is
-- immutable and a job is never deleted (history, PRD 40). The time of preview and of application comes from the database clock.
CREATE FUNCTION lucy_guard_product_import_job() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'An import job is history and is never deleted';
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'UPLOADED' OR NEW.previewed_at IS NOT NULL OR NEW.applied_at IS NOT NULL THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'An import job starts as uploaded';
    END IF;
    RETURN NEW;
  END IF;
  IF OLD.status IN ('APPLIED', 'FAILED', 'CANCELLED') THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'A finished import job is immutable';
  END IF;
  IF (NEW.kind, NEW.branch_id, NEW.file_sha256, NEW.original_filename, NEW.created_by_user_id)
    IS DISTINCT FROM (OLD.kind, OLD.branch_id, OLD.file_sha256, OLD.original_filename, OLD.created_by_user_id) THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'The file facts of an import job are immutable';
  END IF;
  IF NEW.status = OLD.status THEN
    IF NEW.previewed_at IS DISTINCT FROM OLD.previewed_at THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'The preview time is set by the transition';
    END IF;
  ELSIF OLD.status = 'UPLOADED' AND NEW.status = 'PREVIEWED' THEN
    NEW.previewed_at := clock_timestamp();
  ELSIF OLD.status = 'PREVIEWED' AND NEW.status = 'APPLIED' THEN
    NEW.applied_at := clock_timestamp();
  ELSIF NOT (NEW.status IN ('FAILED', 'CANCELLED')) THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'This import job transition is not allowed';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER lucy_product_import_jobs_guard BEFORE INSERT OR UPDATE OR DELETE ON "product_import_jobs"
  FOR EACH ROW EXECUTE FUNCTION lucy_guard_product_import_job();
CREATE TRIGGER lucy_product_import_jobs_version BEFORE UPDATE ON "product_import_jobs"
  FOR EACH ROW EXECUTE FUNCTION lucy_guard_versioned_row();

CREATE FUNCTION lucy_guard_product_import_row() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  job_status "ProductImportStatus";
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'An import row is history and is never deleted';
  END IF;
  IF TG_OP = 'INSERT' THEN
    SELECT j.status INTO job_status FROM product_import_jobs j WHERE j.id = NEW.job_id FOR SHARE;
    IF job_status IS DISTINCT FROM 'UPLOADED' THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Rows are written while the job is being uploaded';
    END IF;
    NEW.created_at := clock_timestamp();
    NEW.applied_at := NULL;
    RETURN NEW;
  END IF;
  SELECT j.status INTO job_status FROM product_import_jobs j WHERE j.id = NEW.job_id;
  IF OLD.applied_at IS NOT NULL OR NEW.applied_at IS NULL
    OR (NEW.id, NEW.job_id, NEW.row_no, NEW.raw, NEW.status, NEW.action, NEW.errors, NEW.created_at)
      IS DISTINCT FROM (OLD.id, OLD.job_id, OLD.row_no, OLD.raw, OLD.status, OLD.action, OLD.errors, OLD.created_at) THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'An import row can only be marked applied, once';
  END IF;
  IF OLD.status <> 'VALID' OR job_status IS DISTINCT FROM 'PREVIEWED' THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Only a valid row of a previewed job can be applied';
  END IF;
  NEW.applied_at := clock_timestamp();
  RETURN NEW;
END;
$$;
CREATE TRIGGER lucy_product_import_rows_guard BEFORE INSERT OR UPDATE OR DELETE ON "product_import_rows"
  FOR EACH ROW EXECUTE FUNCTION lucy_guard_product_import_row();
