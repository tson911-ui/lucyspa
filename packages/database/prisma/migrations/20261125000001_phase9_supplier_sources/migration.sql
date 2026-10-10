-- Phase 9 P9-2 (supplier product import), migration 2 of 2: the Phase 9 tables, the catalog semantics of the two new permissions and
-- the permission gate of a supplier source (design `PHASE9_PRODUCT_IMPORT.md` sections 4, 11, 12; P9-T2, P9-T8, P9-T9, approved by the
-- Owner on 2026-10-10).
--
-- Additive: eight new tables (all empty), eight enums, guards on the new tables only. No existing table is altered (the `suppliers`
-- table is reused as the supplier organization, T2) and no existing row is written. Nothing is granted to anyone. Nothing here fetches
-- anything: the adapter, the scan and the review arrive with P9-3 and later.
--
-- The permission gate (T9) is a database rule as well as an API rule: a source can be ENABLED only when its permission record (who
-- gave it, how, when, which content) is complete and was confirmed by a user, and the record covers text or images. A confirmed record
-- cannot change without clearing the confirmation, and the address of an enabled source cannot change. Sources, scans and price
-- observations are history and are never deleted; price observations are append-only. Supplier prices are internal reference data
-- (Owner answers 2, 6): no column here references the product cost or the selling price.

CREATE TYPE "SupplierSourceKind" AS ENUM ('FILE', 'API', 'WEBSITE', 'FEED');
CREATE TYPE "SupplierSourceStatus" AS ENUM ('PENDING_VALIDATION', 'READY', 'ADAPTER_REQUIRED', 'AUTHENTICATION_REQUIRED', 'SOURCE_ERROR');
CREATE TYPE "SupplierSourceCadence" AS ENUM ('MANUAL', 'DAILY', 'WEEKLY');
CREATE TYPE "ImportScanTrigger" AS ENUM ('MANUAL', 'SCHEDULE');
CREATE TYPE "ImportScanStatus" AS ENUM ('RUNNING', 'SUCCEEDED', 'PARTIAL', 'FAILED', 'SUSPECT');
CREATE TYPE "SourceRecordState" AS ENUM ('PRESENT', 'MISSING');
CREATE TYPE "ImportCandidateState" AS ENUM (
  'DETECTED', 'EXTRACTED', 'NORMALIZED', 'MATCHED', 'READY_FOR_REVIEW', 'NEEDS_REVIEW', 'APPROVED', 'REJECTED', 'IGNORED', 'IMPORTED'
);
CREATE TYPE "CandidateMatchKind" AS ENUM ('EXACT', 'MANUAL', 'FUZZY');
CREATE TYPE "SourceMappingKind" AS ENUM ('BRAND', 'CATEGORY');

-- --------------------------------------------------------------------------------------- catalog semantics
-- Both codes are GLOBAL_ONLY and STANDARD (the catalog is not branch data). The lists are the previous ones (last set by
-- 20261106000001_phase6_permission_semantics) plus the two new codes in the GLOBAL_ONLY lists; the classification lists are unchanged.
ALTER TABLE "permissions" DROP CONSTRAINT "permissions_catalog_semantics";
ALTER TABLE "permissions"
  ADD CONSTRAINT "permissions_catalog_semantics" CHECK (
    (("code" IN ('MANAGE_SERVICE_PRICES', 'MANAGE_BOOKING_SETTINGS', 'MANAGE_DISCOUNTS', 'CREATE_VOUCHERS',
          'MANAGE_WEBSITE_CONTENT', 'ADJUST_LOYALTY_POINTS', 'MANAGE_COMBOS', 'RESTORE_COMBO_SESSIONS',
          'MANAGE_BIRTHDAY_REWARDS', 'MANAGE_REWARD_CATALOG', 'VIEW_LOYALTY_EXCEPTIONS', 'ACTIVATE_LOYALTY',
          'CHANGE_REFERRER', 'MANAGE_PRODUCTS', 'MANAGE_PRODUCT_PRICES', 'VIEW_PRODUCT_COST', 'IMPORT_PRODUCT_DATA',
          'MANAGE_PRODUCT_CAMPAIGNS', 'MANAGE_SUPPLIER_SOURCES', 'REVIEW_SUPPLIER_IMPORTS')
        AND "scope_capability" = 'GLOBAL_ONLY')
      OR ("code" NOT IN ('MANAGE_SERVICE_PRICES', 'MANAGE_BOOKING_SETTINGS', 'MANAGE_DISCOUNTS', 'CREATE_VOUCHERS',
          'MANAGE_WEBSITE_CONTENT', 'ADJUST_LOYALTY_POINTS', 'MANAGE_COMBOS', 'RESTORE_COMBO_SESSIONS',
          'MANAGE_BIRTHDAY_REWARDS', 'MANAGE_REWARD_CATALOG', 'VIEW_LOYALTY_EXCEPTIONS', 'ACTIVATE_LOYALTY',
          'CHANGE_REFERRER', 'MANAGE_PRODUCTS', 'MANAGE_PRODUCT_PRICES', 'VIEW_PRODUCT_COST', 'IMPORT_PRODUCT_DATA',
          'MANAGE_PRODUCT_CAMPAIGNS', 'MANAGE_SUPPLIER_SOURCES', 'REVIEW_SUPPLIER_IMPORTS')
        AND "scope_capability" = 'BRANCH_CAPABLE'))
    AND (("code" IN ('VIEW_EMPLOYEE_PAY', 'MANAGE_EMPLOYEE_PAY') AND "data_classification" = 'EMPLOYEE_PAY')
      OR ("code" IN ('VIEW_INVOICES', 'MANAGE_INVOICES', 'COLLECT_PAYMENTS', 'APPLY_DISCOUNTS',
          'MANAGE_DISCOUNTS', 'CREATE_VOUCHERS', 'CANCEL_INVOICES', 'CORRECT_PAYMENTS', 'VIEW_REVENUE',
          'ADJUST_LOYALTY_POINTS', 'RESTORE_COMBO_SESSIONS', 'MANAGE_PRODUCT_PRICES', 'VIEW_PRODUCT_COST',
          'MANAGE_STOCK_RECEIPTS', 'IMPORT_PRODUCT_DATA', 'REFUND_PRODUCTS', 'MANAGE_PRODUCT_CAMPAIGNS')
        AND "data_classification" = 'FINANCIAL')
      OR ("code" NOT IN ('VIEW_EMPLOYEE_PAY', 'MANAGE_EMPLOYEE_PAY', 'VIEW_INVOICES', 'MANAGE_INVOICES',
          'COLLECT_PAYMENTS', 'APPLY_DISCOUNTS', 'MANAGE_DISCOUNTS', 'CREATE_VOUCHERS', 'CANCEL_INVOICES',
          'CORRECT_PAYMENTS', 'VIEW_REVENUE', 'ADJUST_LOYALTY_POINTS', 'RESTORE_COMBO_SESSIONS',
          'MANAGE_PRODUCT_PRICES', 'VIEW_PRODUCT_COST', 'MANAGE_STOCK_RECEIPTS', 'IMPORT_PRODUCT_DATA',
          'REFUND_PRODUCTS', 'MANAGE_PRODUCT_CAMPAIGNS')
        AND "data_classification" = 'STANDARD'))
  );

-- -------------------------------------------------------------------------------------- supplier sources
CREATE TABLE "supplier_sources" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "supplier_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "kind" "SupplierSourceKind" NOT NULL,
    "base_url" TEXT,
    "adapter_key" VARCHAR(64),
    "status" "SupplierSourceStatus" NOT NULL DEFAULT 'PENDING_VALIDATION',
    "is_enabled" BOOLEAN NOT NULL DEFAULT false,
    "scan_cadence" "SupplierSourceCadence" NOT NULL DEFAULT 'MANUAL',
    "permission_given_by" TEXT,
    "permission_method" TEXT,
    "permission_date" DATE,
    "permission_note" TEXT,
    "permits_text" BOOLEAN NOT NULL DEFAULT false,
    "permits_images" BOOLEAN NOT NULL DEFAULT false,
    "permits_prices" BOOLEAN NOT NULL DEFAULT false,
    "permission_confirmed_by_user_id" UUID,
    "permission_confirmed_at" TIMESTAMPTZ(3),
    "last_success_at" TIMESTAMPTZ(3),
    "row_version" INTEGER NOT NULL DEFAULT 1,
    "created_by_user_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT clock_timestamp(),
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT clock_timestamp(),

    CONSTRAINT "supplier_sources_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "supplier_sources_name" CHECK (char_length(btrim("name")) BETWEEN 1 AND 120),
    CONSTRAINT "supplier_sources_url" CHECK (
      ("kind" = 'FILE' OR "base_url" IS NOT NULL)
      AND ("base_url" IS NULL OR ("base_url" ~ '^https://[^[:space:]]+$' AND char_length("base_url") <= 500))
    ),
    CONSTRAINT "supplier_sources_adapter" CHECK ("adapter_key" IS NULL OR "adapter_key" ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
    CONSTRAINT "supplier_sources_permission_text" CHECK (
      ("permission_given_by" IS NULL OR char_length(btrim("permission_given_by")) BETWEEN 1 AND 200)
      AND ("permission_method" IS NULL OR char_length(btrim("permission_method")) BETWEEN 1 AND 200)
      AND ("permission_note" IS NULL OR char_length("permission_note") BETWEEN 1 AND 2000)
    ),
    CONSTRAINT "supplier_sources_confirmed_pair" CHECK (("permission_confirmed_by_user_id" IS NULL) = ("permission_confirmed_at" IS NULL)),
    -- A confirmed record is a complete one: who gave it, how, when.
    CONSTRAINT "supplier_sources_confirmed_complete" CHECK (
      "permission_confirmed_at" IS NULL
      OR ("permission_given_by" IS NOT NULL AND "permission_method" IS NOT NULL AND "permission_date" IS NOT NULL)
    ),
    -- T9, the gate: enabled needs a confirmed record that covers text or images.
    CONSTRAINT "supplier_sources_enabled_gate" CHECK (
      NOT "is_enabled" OR ("permission_confirmed_at" IS NOT NULL AND ("permits_text" OR "permits_images"))
    ),
    CONSTRAINT "supplier_sources_version" CHECK ("row_version" >= 1)
);
CREATE UNIQUE INDEX "supplier_sources_supplier_name_key" ON "supplier_sources"("supplier_id", "name");
CREATE UNIQUE INDEX "supplier_sources_supplier_url_key" ON "supplier_sources"("supplier_id", "base_url");
CREATE INDEX "supplier_sources_enabled_idx" ON "supplier_sources"("is_enabled", "scan_cadence");
ALTER TABLE "supplier_sources" ADD CONSTRAINT "supplier_sources_supplier_id_fkey" FOREIGN KEY ("supplier_id")
  REFERENCES "suppliers"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "supplier_sources" ADD CONSTRAINT "supplier_sources_permission_confirmed_by_user_id_fkey" FOREIGN KEY ("permission_confirmed_by_user_id")
  REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "supplier_sources" ADD CONSTRAINT "supplier_sources_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id")
  REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

CREATE FUNCTION lucy_guard_supplier_source() RETURNS trigger
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
  RETURN NEW;
END;
$$;
CREATE TRIGGER lucy_supplier_sources_guard BEFORE INSERT OR UPDATE OR DELETE ON "supplier_sources"
  FOR EACH ROW EXECUTE FUNCTION lucy_guard_supplier_source();
CREATE TRIGGER lucy_supplier_sources_version BEFORE UPDATE ON "supplier_sources"
  FOR EACH ROW EXECUTE FUNCTION lucy_guard_versioned_row();

-- ------------------------------------------------------------------------------------------ import scans
-- One row per run of a source (the import history of PRD 30.7). A null actor means the schedule ran it.
CREATE TABLE "import_scans" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "source_id" UUID NOT NULL,
    "trigger" "ImportScanTrigger" NOT NULL,
    "status" "ImportScanStatus" NOT NULL DEFAULT 'RUNNING',
    "actor_user_id" UUID,
    "started_at" TIMESTAMPTZ(3) NOT NULL DEFAULT clock_timestamp(),
    "finished_at" TIMESTAMPTZ(3),
    "discovered_count" INTEGER NOT NULL DEFAULT 0,
    "new_count" INTEGER NOT NULL DEFAULT 0,
    "unchanged_count" INTEGER NOT NULL DEFAULT 0,
    "price_changed_count" INTEGER NOT NULL DEFAULT 0,
    "content_changed_count" INTEGER NOT NULL DEFAULT 0,
    "image_changed_count" INTEGER NOT NULL DEFAULT 0,
    "removed_count" INTEGER NOT NULL DEFAULT 0,
    "duplicate_count" INTEGER NOT NULL DEFAULT 0,
    "error_count" INTEGER NOT NULL DEFAULT 0,
    "errors" JSONB NOT NULL DEFAULT '[]',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT clock_timestamp(),

    CONSTRAINT "import_scans_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "import_scans_finished" CHECK (("status" = 'RUNNING') = ("finished_at" IS NULL)),
    CONSTRAINT "import_scans_actor" CHECK (("trigger" = 'SCHEDULE') = ("actor_user_id" IS NULL)),
    CONSTRAINT "import_scans_counts" CHECK (
      "discovered_count" >= 0 AND "new_count" >= 0 AND "unchanged_count" >= 0 AND "price_changed_count" >= 0
      AND "content_changed_count" >= 0 AND "image_changed_count" >= 0 AND "removed_count" >= 0 AND "duplicate_count" >= 0
      AND "error_count" >= 0
    ),
    CONSTRAINT "import_scans_errors" CHECK (jsonb_typeof("errors") = 'array')
);
CREATE INDEX "import_scans_source_idx" ON "import_scans"("source_id", "started_at" DESC);
-- At most one scan of a source runs at a time (concurrency 1 per source, design section 10).
CREATE UNIQUE INDEX "import_scans_one_running_key" ON "import_scans"("source_id") WHERE "status" = 'RUNNING';
ALTER TABLE "import_scans" ADD CONSTRAINT "import_scans_source_id_fkey" FOREIGN KEY ("source_id")
  REFERENCES "supplier_sources"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "import_scans" ADD CONSTRAINT "import_scans_actor_user_id_fkey" FOREIGN KEY ("actor_user_id")
  REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

CREATE FUNCTION lucy_refuse_delete() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = format('%s rows are history and are never deleted', TG_TABLE_NAME);
END;
$$;
CREATE TRIGGER lucy_import_scans_no_delete BEFORE DELETE ON "import_scans" FOR EACH ROW EXECUTE FUNCTION lucy_refuse_delete();

-- ---------------------------------------------------------------------------------------- source records
-- What one source says about one supplier product, as normalized text (never raw HTML). The key is the source's own id (the
-- WooCommerce product id for haruohui.com), not the SKU: most source products have none (design section 16).
CREATE TABLE "source_records" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "source_id" UUID NOT NULL,
    "source_key" VARCHAR(300) NOT NULL,
    "url" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "sku" VARCHAR(100),
    "barcode" VARCHAR(100),
    "brand_text" TEXT,
    "category_path" JSONB NOT NULL DEFAULT '[]',
    "description_text" TEXT,
    "attributes" JSONB NOT NULL DEFAULT '{}',
    "image_urls" JSONB NOT NULL DEFAULT '[]',
    "content_hash" VARCHAR(64) NOT NULL,
    "price_hash" VARCHAR(64),
    "images_hash" VARCHAR(64),
    "state" "SourceRecordState" NOT NULL DEFAULT 'PRESENT',
    "last_changes" JSONB NOT NULL DEFAULT '[]',
    "missing_scans" INTEGER NOT NULL DEFAULT 0,
    "first_seen_scan_id" UUID NOT NULL,
    "last_seen_scan_id" UUID NOT NULL,
    "first_seen_at" TIMESTAMPTZ(3) NOT NULL DEFAULT clock_timestamp(),
    "last_seen_at" TIMESTAMPTZ(3) NOT NULL DEFAULT clock_timestamp(),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT clock_timestamp(),
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT clock_timestamp(),

    CONSTRAINT "source_records_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "source_records_key" CHECK (char_length(btrim("source_key")) >= 1),
    CONSTRAINT "source_records_name" CHECK (char_length(btrim("name")) BETWEEN 1 AND 500),
    CONSTRAINT "source_records_json" CHECK (
      jsonb_typeof("category_path") = 'array' AND jsonb_typeof("attributes") = 'object' AND jsonb_typeof("image_urls") = 'array'
      AND jsonb_typeof("last_changes") = 'array'
    ),
    CONSTRAINT "source_records_missing" CHECK ("missing_scans" >= 0 AND ("state" = 'MISSING') = ("missing_scans" > 0))
);
CREATE UNIQUE INDEX "source_records_source_key_key" ON "source_records"("source_id", "source_key");
CREATE INDEX "source_records_state_idx" ON "source_records"("source_id", "state");
CREATE INDEX "source_records_sku_idx" ON "source_records"("sku") WHERE "sku" IS NOT NULL;
ALTER TABLE "source_records" ADD CONSTRAINT "source_records_source_id_fkey" FOREIGN KEY ("source_id")
  REFERENCES "supplier_sources"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "source_records" ADD CONSTRAINT "source_records_first_seen_scan_id_fkey" FOREIGN KEY ("first_seen_scan_id")
  REFERENCES "import_scans"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "source_records" ADD CONSTRAINT "source_records_last_seen_scan_id_fkey" FOREIGN KEY ("last_seen_scan_id")
  REFERENCES "import_scans"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
CREATE TRIGGER lucy_source_records_no_delete BEFORE DELETE ON "source_records" FOR EACH ROW EXECUTE FUNCTION lucy_refuse_delete();

-- --------------------------------------------------------------------------------- source price observations
-- Append-only. A price seen on a source is reference data only: it is never the selling price and never the cost (Owner answer 6).
CREATE TABLE "source_price_observations" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "source_record_id" UUID NOT NULL,
    "scan_id" UUID NOT NULL,
    "price_vnd" BIGINT,
    "promo_price_vnd" BIGINT,
    "currency" VARCHAR(3) NOT NULL DEFAULT 'VND',
    "original_amount" NUMERIC(20,4),
    "observed_at" TIMESTAMPTZ(3) NOT NULL DEFAULT clock_timestamp(),

    CONSTRAINT "source_price_observations_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "source_price_observations_amounts" CHECK (
      ("price_vnd" IS NULL OR "price_vnd" >= 0) AND ("promo_price_vnd" IS NULL OR "promo_price_vnd" >= 0)
      AND ("original_amount" IS NULL OR "original_amount" >= 0)
    ),
    CONSTRAINT "source_price_observations_currency" CHECK ("currency" ~ '^[A-Z]{3}$'),
    -- Integer VND is only claimed for VND; another currency keeps its original amount until a person confirms a rate.
    CONSTRAINT "source_price_observations_vnd" CHECK ("currency" = 'VND' OR ("price_vnd" IS NULL AND "promo_price_vnd" IS NULL))
);
CREATE UNIQUE INDEX "source_price_observations_scan_key" ON "source_price_observations"("source_record_id", "scan_id");
CREATE INDEX "source_price_observations_scan_idx" ON "source_price_observations"("scan_id");
ALTER TABLE "source_price_observations" ADD CONSTRAINT "source_price_observations_source_record_id_fkey" FOREIGN KEY ("source_record_id")
  REFERENCES "source_records"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "source_price_observations" ADD CONSTRAINT "source_price_observations_scan_id_fkey" FOREIGN KEY ("scan_id")
  REFERENCES "import_scans"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
CREATE FUNCTION lucy_refuse_change() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = format('%s rows are append-only', TG_TABLE_NAME);
END;
$$;
CREATE TRIGGER lucy_source_price_observations_append_only BEFORE UPDATE OR DELETE ON "source_price_observations"
  FOR EACH ROW EXECUTE FUNCTION lucy_refuse_change();

-- ---------------------------------------------------------------------------------------- import candidates
-- The Lucy-side draft of one underlying supplier product. The text columns (name_*, description_*) are LUCY-owned: they start from
-- the source text, a person may change them, and a later sync never overwrites them (PRD 30.9.11). The text observed at the source
-- lives in `source_records`, so a later "Claude integration" draft can be a third thing next to these two without touching either.
CREATE TABLE "import_candidates" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "supplier_id" UUID NOT NULL,
    "state" "ImportCandidateState" NOT NULL DEFAULT 'DETECTED',
    "name_vi" TEXT NOT NULL,
    "name_en" TEXT NOT NULL,
    "needs_translation" BOOLEAN NOT NULL DEFAULT true,
    "description_vi" TEXT,
    "description_en" TEXT,
    "brand_text" TEXT,
    "brand_id" UUID,
    "category_path" JSONB NOT NULL DEFAULT '[]',
    "category_id" UUID,
    "proposed_sku" VARCHAR(64),
    "proposed_variants" JSONB NOT NULL DEFAULT '[]',
    "warnings" JSONB NOT NULL DEFAULT '[]',
    "matched_product_id" UUID,
    "imported_product_id" UUID,
    "decided_by_user_id" UUID,
    "decided_at" TIMESTAMPTZ(3),
    "decision_note" TEXT,
    "row_version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT clock_timestamp(),
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT clock_timestamp(),

    CONSTRAINT "import_candidates_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "import_candidates_names" CHECK (char_length(btrim("name_vi")) BETWEEN 1 AND 500 AND char_length(btrim("name_en")) BETWEEN 1 AND 500),
    CONSTRAINT "import_candidates_json" CHECK (
      jsonb_typeof("category_path") = 'array' AND jsonb_typeof("proposed_variants") = 'array' AND jsonb_typeof("warnings") = 'array'
    ),
    CONSTRAINT "import_candidates_decided_pair" CHECK (("decided_by_user_id" IS NULL) = ("decided_at" IS NULL)),
    CONSTRAINT "import_candidates_imported" CHECK ("imported_product_id" IS NULL OR "state" = 'IMPORTED'),
    CONSTRAINT "import_candidates_version" CHECK ("row_version" >= 1)
);
CREATE INDEX "import_candidates_state_idx" ON "import_candidates"("supplier_id", "state");
CREATE INDEX "import_candidates_matched_idx" ON "import_candidates"("matched_product_id") WHERE "matched_product_id" IS NOT NULL;
ALTER TABLE "import_candidates" ADD CONSTRAINT "import_candidates_supplier_id_fkey" FOREIGN KEY ("supplier_id")
  REFERENCES "suppliers"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "import_candidates" ADD CONSTRAINT "import_candidates_brand_id_fkey" FOREIGN KEY ("brand_id")
  REFERENCES "brands"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "import_candidates" ADD CONSTRAINT "import_candidates_category_id_fkey" FOREIGN KEY ("category_id")
  REFERENCES "product_categories"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "import_candidates" ADD CONSTRAINT "import_candidates_matched_product_id_fkey" FOREIGN KEY ("matched_product_id")
  REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "import_candidates" ADD CONSTRAINT "import_candidates_imported_product_id_fkey" FOREIGN KEY ("imported_product_id")
  REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "import_candidates" ADD CONSTRAINT "import_candidates_decided_by_user_id_fkey" FOREIGN KEY ("decided_by_user_id")
  REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
CREATE TRIGGER lucy_import_candidates_no_delete BEFORE DELETE ON "import_candidates" FOR EACH ROW EXECUTE FUNCTION lucy_refuse_delete();
CREATE TRIGGER lucy_import_candidates_version BEFORE UPDATE ON "import_candidates"
  FOR EACH ROW EXECUTE FUNCTION lucy_guard_versioned_row();

-- ------------------------------------------------------------------------------------------ candidate links
CREATE TABLE "candidate_sources" (
    "candidate_id" UUID NOT NULL,
    "source_record_id" UUID NOT NULL,
    "match_kind" "CandidateMatchKind" NOT NULL,
    "matched_by_user_id" UUID,
    "matched_at" TIMESTAMPTZ(3) NOT NULL DEFAULT clock_timestamp(),

    CONSTRAINT "candidate_sources_pkey" PRIMARY KEY ("candidate_id", "source_record_id"),
    CONSTRAINT "candidate_sources_manual" CHECK (("match_kind" = 'MANUAL') = ("matched_by_user_id" IS NOT NULL))
);
-- A source record belongs to exactly one candidate at a time.
CREATE UNIQUE INDEX "candidate_sources_record_key" ON "candidate_sources"("source_record_id");
ALTER TABLE "candidate_sources" ADD CONSTRAINT "candidate_sources_candidate_id_fkey" FOREIGN KEY ("candidate_id")
  REFERENCES "import_candidates"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "candidate_sources" ADD CONSTRAINT "candidate_sources_source_record_id_fkey" FOREIGN KEY ("source_record_id")
  REFERENCES "source_records"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "candidate_sources" ADD CONSTRAINT "candidate_sources_matched_by_user_id_fkey" FOREIGN KEY ("matched_by_user_id")
  REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- ------------------------------------------------------------------------------------------ candidate images
-- At most six images per candidate (Owner answer 5): the position is 0..5.
CREATE TABLE "candidate_images" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "candidate_id" UUID NOT NULL,
    "media_asset_id" UUID NOT NULL,
    "source_url" TEXT NOT NULL,
    "sort_order" SMALLINT NOT NULL,
    "sha256" VARCHAR(64) NOT NULL,
    "phash" VARCHAR(16),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT clock_timestamp(),

    CONSTRAINT "candidate_images_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "candidate_images_position" CHECK ("sort_order" BETWEEN 0 AND 5),
    CONSTRAINT "candidate_images_hash" CHECK ("sha256" ~ '^[0-9a-f]{64}$' AND ("phash" IS NULL OR "phash" ~ '^[0-9a-f]{16}$'))
);
CREATE UNIQUE INDEX "candidate_images_asset_key" ON "candidate_images"("candidate_id", "media_asset_id");
CREATE INDEX "candidate_images_order_idx" ON "candidate_images"("candidate_id", "sort_order");
CREATE INDEX "candidate_images_media_idx" ON "candidate_images"("media_asset_id");
ALTER TABLE "candidate_images" ADD CONSTRAINT "candidate_images_candidate_id_fkey" FOREIGN KEY ("candidate_id")
  REFERENCES "import_candidates"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "candidate_images" ADD CONSTRAINT "candidate_images_media_asset_id_fkey" FOREIGN KEY ("media_asset_id")
  REFERENCES "media_assets"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- --------------------------------------------------------------------------------------- remembered mappings
-- "Supplier text X means brand/category Y", remembered so the Owner maps each value once (design section 8).
CREATE TABLE "source_value_mappings" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "supplier_id" UUID NOT NULL,
    "kind" "SourceMappingKind" NOT NULL,
    "source_text" VARCHAR(300) NOT NULL,
    "brand_id" UUID,
    "category_id" UUID,
    "created_by_user_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT clock_timestamp(),

    CONSTRAINT "source_value_mappings_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "source_value_mappings_text" CHECK (char_length(btrim("source_text")) >= 1),
    CONSTRAINT "source_value_mappings_target" CHECK (
      ("kind" = 'BRAND' AND "brand_id" IS NOT NULL AND "category_id" IS NULL)
      OR ("kind" = 'CATEGORY' AND "category_id" IS NOT NULL AND "brand_id" IS NULL)
    )
);
CREATE UNIQUE INDEX "source_value_mappings_text_key" ON "source_value_mappings"("supplier_id", "kind", "source_text");
ALTER TABLE "source_value_mappings" ADD CONSTRAINT "source_value_mappings_supplier_id_fkey" FOREIGN KEY ("supplier_id")
  REFERENCES "suppliers"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "source_value_mappings" ADD CONSTRAINT "source_value_mappings_brand_id_fkey" FOREIGN KEY ("brand_id")
  REFERENCES "brands"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "source_value_mappings" ADD CONSTRAINT "source_value_mappings_category_id_fkey" FOREIGN KEY ("category_id")
  REFERENCES "product_categories"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "source_value_mappings" ADD CONSTRAINT "source_value_mappings_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id")
  REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
