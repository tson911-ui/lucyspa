-- Phase 9 P9-3: Test Source (docs/PHASE9_PRODUCT_IMPORT.md section 3). One row per test of a source: the worker reads robots.txt and one
-- page of at most 20 products, stores what it found, and a person confirms the sample. Only a confirmed, passed test of the source's
-- current address can make the source READY, and only a READY source can be enabled. Additive: one enum, one table, the source guard
-- function gains two checks (it only looks at the transitions into READY and into enabled, so no existing row is touched).

CREATE TYPE "SourceTestStatus" AS ENUM ('QUEUED', 'RUNNING', 'PASSED', 'FAILED');

CREATE TABLE "supplier_source_tests" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    -- Strictly increasing: "the latest test" never depends on a timestamp tie.
    "seq" BIGSERIAL NOT NULL,
    "source_id" UUID NOT NULL,
    -- The address that was tested; a confirmed test counts only for this address.
    "base_url" TEXT NOT NULL,
    "status" "SourceTestStatus" NOT NULL DEFAULT 'QUEUED',
    "requested_by_user_id" UUID NOT NULL,
    "requested_at" TIMESTAMPTZ(3) NOT NULL DEFAULT clock_timestamp(),
    "started_at" TIMESTAMPTZ(3),
    "finished_at" TIMESTAMPTZ(3),
    -- A RUNNING test whose worker disappeared is failed once the lease has run out.
    "lease_expires_at" TIMESTAMPTZ(3),
    "failure_code" VARCHAR(40),
    "failure_detail" VARCHAR(200),
    -- The status the source takes when the test fails (ADAPTER_REQUIRED, AUTHENTICATION_REQUIRED or SOURCE_ERROR).
    "failure_source_status" "SupplierSourceStatus",
    "summary" JSONB NOT NULL DEFAULT '{}',
    "sample" JSONB NOT NULL DEFAULT '[]',
    "problems" JSONB NOT NULL DEFAULT '[]',
    "request_count" INTEGER NOT NULL DEFAULT 0,
    "confirmed_by_user_id" UUID,
    "confirmed_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT clock_timestamp(),

    CONSTRAINT "supplier_source_tests_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "supplier_source_tests_url" CHECK ("base_url" ~ '^https://[^[:space:]]+$' AND char_length("base_url") <= 500),
    CONSTRAINT "supplier_source_tests_timeline" CHECK (
      ("status" = 'QUEUED' AND "started_at" IS NULL AND "finished_at" IS NULL)
      OR ("status" = 'RUNNING' AND "started_at" IS NOT NULL AND "finished_at" IS NULL AND "lease_expires_at" IS NOT NULL)
      OR ("status" IN ('PASSED', 'FAILED') AND "finished_at" IS NOT NULL)
    ),
    CONSTRAINT "supplier_source_tests_failure" CHECK (
      ("status" = 'FAILED') = ("failure_code" IS NOT NULL)
    ),
    CONSTRAINT "supplier_source_tests_count" CHECK ("request_count" BETWEEN 0 AND 10),
    CONSTRAINT "supplier_source_tests_confirmed_pair" CHECK (("confirmed_by_user_id" IS NULL) = ("confirmed_at" IS NULL)),
    -- Only a passed test can be confirmed.
    CONSTRAINT "supplier_source_tests_confirmed_passed" CHECK ("confirmed_at" IS NULL OR "status" = 'PASSED')
);
CREATE INDEX "supplier_source_tests_source_idx" ON "supplier_source_tests"("source_id", "seq" DESC);
-- One test at a time per source.
CREATE UNIQUE INDEX "supplier_source_tests_one_active_key" ON "supplier_source_tests"("source_id") WHERE "status" IN ('QUEUED', 'RUNNING');
CREATE INDEX "supplier_source_tests_queue_idx" ON "supplier_source_tests"("status", "requested_at") WHERE "status" IN ('QUEUED', 'RUNNING');
ALTER TABLE "supplier_source_tests" ADD CONSTRAINT "supplier_source_tests_source_id_fkey" FOREIGN KEY ("source_id")
  REFERENCES "supplier_sources"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "supplier_source_tests" ADD CONSTRAINT "supplier_source_tests_requested_by_user_id_fkey" FOREIGN KEY ("requested_by_user_id")
  REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "supplier_source_tests" ADD CONSTRAINT "supplier_source_tests_confirmed_by_user_id_fkey" FOREIGN KEY ("confirmed_by_user_id")
  REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

CREATE FUNCTION lucy_guard_supplier_source_test() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  source RECORD;
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Source tests are history and are never deleted';
  END IF;
  IF TG_OP = 'INSERT' THEN
    SELECT base_url, permission_confirmed_at INTO source FROM supplier_sources WHERE id = NEW.source_id;
    IF NEW.status <> 'QUEUED' OR NEW.confirmed_at IS NOT NULL THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'A source test starts queued and unconfirmed';
    END IF;
    -- No request goes to a supplier site before the permission is recorded and confirmed, and only to the configured address.
    IF source.permission_confirmed_at IS NULL OR source.base_url IS DISTINCT FROM NEW.base_url THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'A source test needs a confirmed permission and the current address of the source';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.id IS DISTINCT FROM OLD.id OR NEW.source_id IS DISTINCT FROM OLD.source_id OR NEW.base_url IS DISTINCT FROM OLD.base_url
     OR NEW.seq IS DISTINCT FROM OLD.seq
     OR NEW.requested_by_user_id IS DISTINCT FROM OLD.requested_by_user_id OR NEW.requested_at IS DISTINCT FROM OLD.requested_at
     OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'The identity of a source test never changes';
  END IF;
  IF OLD.status IN ('PASSED', 'FAILED') THEN
    -- A finished test only gains its confirmation, once.
    IF OLD.confirmed_at IS NOT NULL
       OR NEW.confirmed_at IS NULL
       OR (to_jsonb(NEW) - 'confirmed_by_user_id' - 'confirmed_at') IS DISTINCT FROM (to_jsonb(OLD) - 'confirmed_by_user_id' - 'confirmed_at') THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'A finished source test cannot change; it can only be confirmed once';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.confirmed_at IS NOT NULL THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Only a passed source test can be confirmed';
  END IF;
  IF NOT ((OLD.status = 'QUEUED' AND NEW.status IN ('QUEUED', 'RUNNING', 'FAILED'))
       OR (OLD.status = 'RUNNING' AND NEW.status IN ('RUNNING', 'PASSED', 'FAILED'))) THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Invalid source test status change';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER lucy_supplier_source_tests_guard BEFORE INSERT OR UPDATE OR DELETE ON "supplier_source_tests"
  FOR EACH ROW EXECUTE FUNCTION lucy_guard_supplier_source_test();

-- The source guard: the two new checks. READY needs a confirmed, passed test of the current address, and a source can only be enabled
-- when it is READY. (Everything else in the function is the P9-2 body, unchanged.)
CREATE OR REPLACE FUNCTION lucy_guard_supplier_source() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'A supplier source is history and is never deleted';
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.is_enabled OR NEW.permission_confirmed_at IS NOT NULL THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'A supplier source starts disabled with no confirmed permission';
    END IF;
    RETURN NEW;
  END IF;
  IF OLD.permission_confirmed_at IS NOT NULL AND NEW.permission_confirmed_at IS NOT DISTINCT FROM OLD.permission_confirmed_at
     AND (NEW.permission_given_by IS DISTINCT FROM OLD.permission_given_by
       OR NEW.permission_method IS DISTINCT FROM OLD.permission_method
       OR NEW.permission_date IS DISTINCT FROM OLD.permission_date
       OR NEW.permission_note IS DISTINCT FROM OLD.permission_note
       OR NEW.permits_text IS DISTINCT FROM OLD.permits_text
       OR NEW.permits_images IS DISTINCT FROM OLD.permits_images
       OR NEW.permits_prices IS DISTINCT FROM OLD.permits_prices) THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'A confirmed permission record cannot change without clearing the confirmation';
  END IF;
  IF OLD.is_enabled AND NEW.is_enabled
     AND (NEW.base_url IS DISTINCT FROM OLD.base_url OR NEW.kind IS DISTINCT FROM OLD.kind OR NEW.supplier_id IS DISTINCT FROM OLD.supplier_id) THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'The address of an enabled source cannot change; disable it first';
  END IF;
  IF NEW.status = 'READY' AND OLD.status <> 'READY' AND NOT EXISTS (
       SELECT 1 FROM supplier_source_tests t
       WHERE t.source_id = NEW.id AND t.status = 'PASSED' AND t.confirmed_at IS NOT NULL AND t.base_url IS NOT DISTINCT FROM NEW.base_url) THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'A source becomes READY only through a confirmed, passed test of its current address';
  END IF;
  IF NEW.is_enabled AND NOT OLD.is_enabled AND NEW.status <> 'READY' THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'A supplier source can be enabled only when it is READY';
  END IF;
  RETURN NEW;
END;
$$;
