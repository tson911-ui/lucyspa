-- Phase 9 P9-9b (Owner, 2026-10-11, docs/PHASE9_PRODUCT_IMPORT.md section 17): "Quét toàn bộ". A scan can now read ALL the products of
-- a source instead of the 20-product sample. Additive: one column on the scan history, the sample limit and the per-source cap widened
-- (never narrowed), so every existing row still satisfies them.
--
-- import_scans.scope: SAMPLE (the first read of a source: at most 20 products, or a re-read of the known ones) or FULL (every product of
-- the source). A scan is compared only with the earlier healthy scan of the SAME scope (the "fewer than 70%" rule of P9-7).

ALTER TABLE "import_scans"
  ADD COLUMN "scope" VARCHAR(8) NOT NULL DEFAULT 'SAMPLE',
  ADD CONSTRAINT "import_scans_scope" CHECK ("scope" IN ('SAMPLE', 'FULL')),
  DROP CONSTRAINT "import_scans_sample_limit",
  ADD CONSTRAINT "import_scans_sample_limit" CHECK ("sample_limit" BETWEEN 1 AND 2000),
  ADD CONSTRAINT "import_scans_scope_limit" CHECK ("scope" = 'FULL' OR "sample_limit" <= 20);

-- One source keeps at most 2,000 products (the Owner's catalog of the one source is 352). A source that is not a normal shop would stop at
-- the cap instead of filling the database.
CREATE OR REPLACE FUNCTION lucy_guard_source_sample_cap() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF (SELECT count(*) FROM source_records WHERE source_id = NEW.source_id) >= 2000 THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'A source keeps at most 2000 products';
  END IF;
  RETURN NEW;
END;
$$;

-- Keep the hardening the replaced function already has (fixed search_path, no PUBLIC execute).
DO $$
DECLARE
  migration_schema text := current_schema();
BEGIN
  EXECUTE format('ALTER FUNCTION %I.lucy_guard_source_sample_cap() SET search_path TO pg_catalog, %I, pg_temp', migration_schema, migration_schema);
  EXECUTE format('REVOKE ALL ON FUNCTION %I.lucy_guard_source_sample_cap() FROM PUBLIC', migration_schema);
END;
$$;
