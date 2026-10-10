-- Phase 9 P9-4: the sample scan and the supplier images (docs/PHASE9_PRODUCT_IMPORT.md sections 7 and 10).
-- Owner requirement: an image must NEVER be mixed between products. The database enforces the backbone of that rule: an image row
-- names the source record it came from, and (candidate, source record) must be a link that exists in candidate_sources, so a picture
-- can only sit on the candidate that owns the product it was read from. Additive: new columns on two empty tables, indexes, guards.
-- The new NOT NULL columns of candidate_images would fail on a table that has rows; the table is empty on every database (nothing
-- wrote to it before this migration), so a failure here would be a loud, correct refusal.

-- ------------------------------------------------------------------------------------------------------------ scans
ALTER TABLE "import_scans"
  ADD COLUMN "claimed_at" TIMESTAMPTZ(3),
  ADD COLUMN "lease_expires_at" TIMESTAMPTZ(3),
  -- Until the process is proven the Owner limits live fetching to a 20-product sample (docs section 13).
  ADD COLUMN "sample_limit" SMALLINT NOT NULL DEFAULT 20,
  ADD COLUMN "request_count" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "image_count" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "image_flag_count" INTEGER NOT NULL DEFAULT 0,
  ADD CONSTRAINT "import_scans_sample_limit" CHECK ("sample_limit" BETWEEN 1 AND 20),
  ADD CONSTRAINT "import_scans_request_count" CHECK ("request_count" >= 0 AND "image_count" >= 0 AND "image_flag_count" >= 0),
  -- A claimed running scan has a lease; a finished one needs none.
  ADD CONSTRAINT "import_scans_lease" CHECK ("claimed_at" IS NULL OR "status" <> 'RUNNING' OR "lease_expires_at" IS NOT NULL);
CREATE INDEX "import_scans_queue_idx" ON "import_scans"("started_at") WHERE "status" = 'RUNNING';

-- At most 20 sampled products per source in this phase (a later step lifts the limit with its own migration).
CREATE FUNCTION lucy_guard_source_sample_cap() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF (SELECT count(*) FROM source_records WHERE source_id = NEW.source_id) >= 20 THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'A source keeps at most 20 sampled products until bulk import is approved';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER lucy_source_records_sample_cap BEFORE INSERT ON "source_records"
  FOR EACH ROW EXECUTE FUNCTION lucy_guard_source_sample_cap();

-- --------------------------------------------------------------------------------------------------- candidate images
DROP INDEX "candidate_images_asset_key";
-- The picture hash is a 256-bit difference hash (64 hex digits); 64 bits were too coarse for white-background product photos.
ALTER TABLE "candidate_images" DROP CONSTRAINT "candidate_images_hash";
ALTER TABLE "candidate_images" ALTER COLUMN "phash" TYPE VARCHAR(64);
ALTER TABLE "candidate_images"
  ADD COLUMN "source_record_id" UUID NOT NULL,
  -- The WooCommerce product id the picture was read from (a copy of source_records.source_key, kept for the audit trail).
  ADD COLUMN "source_product_key" VARCHAR(300) NOT NULL,
  -- The WooCommerce variation id when the picture belongs to one variant of the product (variant pictures stay on their variant).
  ADD COLUMN "variant_key" VARCHAR(300),
  -- Set when the same file or a near-identical one appears on another product: both are flagged for a person, never reassigned.
  ADD COLUMN "flag" VARCHAR(24),
  -- When the picture was checked against the product's own record at download time.
  ADD COLUMN "verified_at" TIMESTAMPTZ(3) NOT NULL DEFAULT clock_timestamp(),
  -- A picture the source no longer lists is retired, not deleted (history); its position and file are free again.
  ADD COLUMN "retired_at" TIMESTAMPTZ(3),
  ADD CONSTRAINT "candidate_images_hash" CHECK (
    "sha256" ~ '^[0-9a-f]{64}$' AND ("phash" IS NULL OR "phash" ~ '^[0-9a-f]{64}$')
  ),
  ADD CONSTRAINT "candidate_images_flag" CHECK (
    "flag" IS NULL OR "flag" IN ('SAME_FILE', 'SIMILAR', 'CATALOG_SAME_FILE')
  ),
  ADD CONSTRAINT "candidate_images_url" CHECK ("source_url" ~ '^https://[^[:space:]]+$'),
  ADD CONSTRAINT "candidate_images_keys" CHECK (
    char_length(btrim("source_product_key")) >= 1 AND ("variant_key" IS NULL OR char_length(btrim("variant_key")) >= 1)
  );
-- Six pictures at most, one file once, one picture per position, among the active ones.
CREATE UNIQUE INDEX "candidate_images_asset_key" ON "candidate_images"("candidate_id", "media_asset_id") WHERE "retired_at" IS NULL;
CREATE UNIQUE INDEX "candidate_images_position_key" ON "candidate_images"("candidate_id", "sort_order") WHERE "retired_at" IS NULL;
CREATE INDEX "candidate_images_record_idx" ON "candidate_images"("source_record_id");
CREATE INDEX "candidate_images_phash_idx" ON "candidate_images"("phash") WHERE "phash" IS NOT NULL AND "retired_at" IS NULL;
-- The backbone: the picture's candidate must own the source record the picture came from.
ALTER TABLE "candidate_images" ADD CONSTRAINT "candidate_images_owner_fkey" FOREIGN KEY ("candidate_id", "source_record_id")
  REFERENCES "candidate_sources"("candidate_id", "source_record_id") ON DELETE RESTRICT ON UPDATE RESTRICT;

CREATE FUNCTION lucy_guard_candidate_image() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  record_key TEXT;
  candidate_state "ImportCandidateState";
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Candidate pictures are history: they are retired, never deleted';
  END IF;
  SELECT state INTO candidate_state FROM import_candidates WHERE id = NEW.candidate_id;
  IF TG_OP = 'INSERT' THEN
    SELECT source_key INTO record_key FROM source_records WHERE id = NEW.source_record_id;
    IF record_key IS DISTINCT FROM NEW.source_product_key THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'The picture names a product other than the source record it was read from';
    END IF;
    IF NEW.retired_at IS NOT NULL THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'A picture starts active';
    END IF;
    IF candidate_state IN ('APPROVED', 'REJECTED', 'IGNORED', 'IMPORTED') THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'The pictures of a decided candidate do not change';
    END IF;
    RETURN NEW;
  END IF;
  -- Update: only the flag may be set (or cleared) and an active picture retired, once. Everything else is fixed.
  IF (to_jsonb(NEW) - 'flag' - 'retired_at') IS DISTINCT FROM (to_jsonb(OLD) - 'flag' - 'retired_at') THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'A candidate picture cannot change; only its flag and its retirement can';
  END IF;
  IF OLD.retired_at IS NOT NULL AND NEW.retired_at IS DISTINCT FROM OLD.retired_at THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'A retired picture stays retired';
  END IF;
  IF NEW.retired_at IS DISTINCT FROM OLD.retired_at AND candidate_state IN ('APPROVED', 'REJECTED', 'IGNORED', 'IMPORTED') THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'The pictures of a decided candidate do not change';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER lucy_candidate_images_guard BEFORE INSERT OR UPDATE OR DELETE ON "candidate_images"
  FOR EACH ROW EXECUTE FUNCTION lucy_guard_candidate_image();
