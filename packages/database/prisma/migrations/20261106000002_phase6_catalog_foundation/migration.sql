-- Phase 6 P6-2, migration 3 of 5: the product catalog foundation (design sections 3, P6-T9..T12; Owner decisions P6-Q11, P6-Q14,
-- OQ-P6-28 of 2026-10-07). Additive and Wave 1 only: new tables, no change to invoices, discounts, loyalty, payments or any other
-- existing table. Everything starts EMPTY (nothing is seeded) except the one settings row with the Owner-approved defaults.
--
--   Brand -> ProductCategory -> Product -> ProductVariant (P6-T9: price, SKU, stock and threshold live on the variant)
--   append-only list-price versions and per-variant promotions with a database-clock effective price (P6-T12, PRD 23.4, 24)
--   product images from the media library, one settings row (expiry warning days, "Moi" badge days).

CREATE TYPE "ProductStatus" AS ENUM ('DRAFT', 'PUBLISHED', 'INACTIVE');

-- ------------------------------------------------------------------------------ generic row guard
-- Identity and creation time never change; every update advances row_version by exactly one (optimistic concurrency, as
-- the other versioned tables) and stamps updated_at with the database clock.
CREATE FUNCTION lucy_guard_versioned_row() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.id IS DISTINCT FROM OLD.id OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'A row identity and creation time are immutable';
  END IF;
  IF NEW.row_version IS DISTINCT FROM OLD.row_version + 1 THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'An update must advance the row version by one';
  END IF;
  NEW.updated_at := clock_timestamp();
  RETURN NEW;
END;
$$;

-- ------------------------------------------------------------------------------------------ brands
CREATE TABLE "brands" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "code" VARCHAR(64) NOT NULL,
    "name_vi" TEXT NOT NULL,
    "name_en" TEXT NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "row_version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT clock_timestamp(),
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT clock_timestamp(),

    CONSTRAINT "brands_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "brands_code" CHECK ("code" ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
    CONSTRAINT "brands_names" CHECK (btrim("name_vi") <> '' AND btrim("name_en") <> ''),
    CONSTRAINT "brands_version" CHECK ("row_version" >= 1)
);
CREATE UNIQUE INDEX "brands_code_key" ON "brands"("code");
CREATE TRIGGER lucy_brands_guard BEFORE UPDATE ON "brands" FOR EACH ROW EXECUTE FUNCTION lucy_guard_versioned_row();

-- ------------------------------------------------------------------------------------ categories
-- One level plus an optional parent (design 3.1): a child cannot itself be a parent.
CREATE TABLE "product_categories" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "parent_id" UUID,
    "code" VARCHAR(64) NOT NULL,
    "name_vi" TEXT NOT NULL,
    "name_en" TEXT NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "row_version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT clock_timestamp(),
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT clock_timestamp(),

    CONSTRAINT "product_categories_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "product_categories_code" CHECK ("code" ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
    CONSTRAINT "product_categories_names" CHECK (btrim("name_vi") <> '' AND btrim("name_en") <> ''),
    CONSTRAINT "product_categories_parent" CHECK ("parent_id" IS NULL OR "parent_id" <> "id"),
    CONSTRAINT "product_categories_version" CHECK ("row_version" >= 1)
);
CREATE UNIQUE INDEX "product_categories_code_key" ON "product_categories"("code");
CREATE INDEX "product_categories_parent_idx" ON "product_categories"("parent_id");
ALTER TABLE "product_categories" ADD CONSTRAINT "product_categories_parent_id_fkey"
  FOREIGN KEY ("parent_id") REFERENCES "product_categories"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

CREATE FUNCTION lucy_guard_product_category() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  parent_parent uuid;
BEGIN
  IF NEW.parent_id IS NOT NULL THEN
    SELECT c.parent_id INTO parent_parent FROM product_categories c WHERE c.id = NEW.parent_id;
    IF NOT FOUND OR parent_parent IS NOT NULL THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'A category parent must exist and must not be a child itself';
    END IF;
    IF TG_OP = 'UPDATE' AND EXISTS (SELECT 1 FROM product_categories c WHERE c.parent_id = NEW.id) THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'A category that has children cannot become a child';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER lucy_product_categories_tree BEFORE INSERT OR UPDATE OF "parent_id" ON "product_categories"
  FOR EACH ROW EXECUTE FUNCTION lucy_guard_product_category();
CREATE TRIGGER lucy_product_categories_guard BEFORE UPDATE ON "product_categories"
  FOR EACH ROW EXECUTE FUNCTION lucy_guard_versioned_row();

-- ------------------------------------------------------------------------------------ products
-- Created as DRAFT. `published_at` is stamped by the database the first time the product is published and never changes (it
-- feeds the "Moi" badge); a published product can become INACTIVE and back but never DRAFT again (P6-T11).
CREATE TABLE "products" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "code" VARCHAR(96) NOT NULL,
    "brand_id" UUID,
    "category_id" UUID,
    "name_vi" TEXT NOT NULL,
    "name_en" TEXT NOT NULL,
    "description_vi" TEXT,
    "description_en" TEXT,
    "status" "ProductStatus" NOT NULL DEFAULT 'DRAFT',
    "featured" BOOLEAN NOT NULL DEFAULT false,
    "published_at" TIMESTAMPTZ(3),
    "source" JSONB,
    "created_by_user_id" UUID NOT NULL,
    "row_version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT clock_timestamp(),
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT clock_timestamp(),

    CONSTRAINT "products_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "products_code" CHECK ("code" ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
    CONSTRAINT "products_names" CHECK (btrim("name_vi") <> '' AND btrim("name_en") <> ''),
    CONSTRAINT "products_published_stamp" CHECK ("status" = 'DRAFT' OR "published_at" IS NOT NULL),
    CONSTRAINT "products_version" CHECK ("row_version" >= 1)
);
CREATE UNIQUE INDEX "products_code_key" ON "products"("code");
CREATE INDEX "products_status_idx" ON "products"("status", "category_id");
CREATE INDEX "products_brand_idx" ON "products"("brand_id");
ALTER TABLE "products" ADD CONSTRAINT "products_brand_id_fkey"
  FOREIGN KEY ("brand_id") REFERENCES "brands"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "products" ADD CONSTRAINT "products_category_id_fkey"
  FOREIGN KEY ("category_id") REFERENCES "product_categories"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "products" ADD CONSTRAINT "products_created_by_user_id_fkey"
  FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- ---------------------------------------------------------------------------- variants and prices
CREATE TABLE "product_variants" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "product_id" UUID NOT NULL,
    "sku" VARCHAR(64) NOT NULL,
    "label_vi" TEXT,
    "label_en" TEXT,
    "barcode" VARCHAR(64),
    "cost_price_vnd" BIGINT,
    "low_stock_threshold" INTEGER,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "row_version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT clock_timestamp(),
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT clock_timestamp(),

    CONSTRAINT "product_variants_pkey" PRIMARY KEY ("id"),
    -- SKU is the stable business identifier used to match imports (PRD 31.4): upper case, no spaces.
    CONSTRAINT "product_variants_sku" CHECK ("sku" ~ '^[A-Z0-9][A-Z0-9._-]{0,63}$'),
    CONSTRAINT "product_variants_labels" CHECK (
      ("label_vi" IS NULL OR btrim("label_vi") <> '') AND ("label_en" IS NULL OR btrim("label_en") <> '')),
    CONSTRAINT "product_variants_barcode" CHECK ("barcode" IS NULL OR btrim("barcode") <> ''),
    -- Money is integer VND (CLAUDE.md). The cost is restricted data; the API decides who may read it (PRD 23.3).
    CONSTRAINT "product_variants_cost" CHECK ("cost_price_vnd" IS NULL OR "cost_price_vnd" >= 0),
    CONSTRAINT "product_variants_threshold" CHECK ("low_stock_threshold" IS NULL OR "low_stock_threshold" >= 0),
    CONSTRAINT "product_variants_version" CHECK ("row_version" >= 1)
);
CREATE UNIQUE INDEX "product_variants_sku_key" ON "product_variants"("sku");
CREATE UNIQUE INDEX "product_variants_barcode_key" ON "product_variants"("barcode") WHERE "barcode" IS NOT NULL;
CREATE INDEX "product_variants_product_idx" ON "product_variants"("product_id", "sort_order");
ALTER TABLE "product_variants" ADD CONSTRAINT "product_variants_product_id_fkey"
  FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- Append-only list-price history: the current list price is the highest version (PRD 23.4: every price change is audited).
CREATE TABLE "product_price_versions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "variant_id" UUID NOT NULL,
    "version_no" INTEGER NOT NULL,
    "list_price_vnd" BIGINT NOT NULL,
    "reason" TEXT,
    "created_by_user_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT clock_timestamp(),

    CONSTRAINT "product_price_versions_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "product_price_versions_price" CHECK ("list_price_vnd" > 0),
    CONSTRAINT "product_price_versions_version" CHECK ("version_no" >= 1),
    CONSTRAINT "product_price_versions_reason" CHECK ("reason" IS NULL OR btrim("reason") <> '')
);
CREATE UNIQUE INDEX "product_price_versions_variant_version_key" ON "product_price_versions"("variant_id", "version_no");
ALTER TABLE "product_price_versions" ADD CONSTRAINT "product_price_versions_variant_id_fkey"
  FOREIGN KEY ("variant_id") REFERENCES "product_variants"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "product_price_versions" ADD CONSTRAINT "product_price_versions_created_by_user_id_fkey"
  FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- A simple price promotion of one variant (PRD 24, Owner Q11): a promotional price inside [starts_at, ends_at), optionally ended
-- early by hand. Two promotions of one variant never overlap in time. When it is over the price returns by itself.
CREATE TABLE "product_promotions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "variant_id" UUID NOT NULL,
    "promo_price_vnd" BIGINT NOT NULL,
    "starts_at" TIMESTAMPTZ(3) NOT NULL,
    "ends_at" TIMESTAMPTZ(3) NOT NULL,
    "ended_early_at" TIMESTAMPTZ(3),
    "ended_early_by_user_id" UUID,
    "created_by_user_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT clock_timestamp(),

    CONSTRAINT "product_promotions_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "product_promotions_price" CHECK ("promo_price_vnd" > 0),
    CONSTRAINT "product_promotions_window" CHECK ("ends_at" > "starts_at"),
    CONSTRAINT "product_promotions_ended_pair" CHECK (("ended_early_at" IS NULL) = ("ended_early_by_user_id" IS NULL)),
    CONSTRAINT "product_promotions_ended_inside" CHECK (
      "ended_early_at" IS NULL OR ("ended_early_at" >= "starts_at" AND "ended_early_at" <= "ends_at")),
    CONSTRAINT "product_promotions_no_overlap" EXCLUDE USING gist (
      "variant_id" WITH =,
      tstzrange("starts_at", COALESCE("ended_early_at", "ends_at"), '[)') WITH &&)
);
CREATE INDEX "product_promotions_variant_idx" ON "product_promotions"("variant_id", "starts_at");
ALTER TABLE "product_promotions" ADD CONSTRAINT "product_promotions_variant_id_fkey"
  FOREIGN KEY ("variant_id") REFERENCES "product_variants"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "product_promotions" ADD CONSTRAINT "product_promotions_ended_early_by_user_id_fkey"
  FOREIGN KEY ("ended_early_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "product_promotions" ADD CONSTRAINT "product_promotions_created_by_user_id_fkey"
  FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- ------------------------------------------------------------------------------------- images
-- Product pictures come from the media library; a picture in use cannot be deleted from it (RESTRICT, like popups and slides).
CREATE TABLE "product_images" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "product_id" UUID NOT NULL,
    "media_asset_id" UUID NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_by_user_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT clock_timestamp(),

    CONSTRAINT "product_images_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "product_images_product_asset_key" ON "product_images"("product_id", "media_asset_id");
CREATE INDEX "product_images_asset_idx" ON "product_images"("media_asset_id");
ALTER TABLE "product_images" ADD CONSTRAINT "product_images_product_id_fkey"
  FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "product_images" ADD CONSTRAINT "product_images_media_asset_id_fkey"
  FOREIGN KEY ("media_asset_id") REFERENCES "media_assets"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "product_images" ADD CONSTRAINT "product_images_created_by_user_id_fkey"
  FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- ------------------------------------------------------------------------------------ settings
-- One row with the Owner-approved defaults: expiry warning 90 days (Q14), "Moi" badge for 30 days after the first publication
-- (OQ-P6-28). Both are configurable by the Owner later (`MANAGE_PRODUCTS`).
CREATE TABLE "product_settings" (
    "id" SMALLINT NOT NULL DEFAULT 1,
    "expiry_warning_days" INTEGER NOT NULL DEFAULT 90,
    "new_badge_days" INTEGER NOT NULL DEFAULT 30,
    "updated_by_user_id" UUID,
    "row_version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT clock_timestamp(),
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT clock_timestamp(),

    CONSTRAINT "product_settings_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "product_settings_singleton" CHECK ("id" = 1),
    CONSTRAINT "product_settings_expiry" CHECK ("expiry_warning_days" BETWEEN 1 AND 730),
    CONSTRAINT "product_settings_new_badge" CHECK ("new_badge_days" BETWEEN 1 AND 365),
    CONSTRAINT "product_settings_version" CHECK ("row_version" >= 1)
);
ALTER TABLE "product_settings" ADD CONSTRAINT "product_settings_updated_by_user_id_fkey"
  FOREIGN KEY ("updated_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
CREATE TRIGGER lucy_product_settings_guard BEFORE UPDATE ON "product_settings"
  FOR EACH ROW EXECUTE FUNCTION lucy_guard_versioned_row();
INSERT INTO "product_settings" ("id") VALUES (1);

-- ------------------------------------------------------------------------------------ guards
-- Product lifecycle (P6-T11). Publishing needs at least one ACTIVE variant that has a list price; the database stamps the first
-- publication and refuses a return to DRAFT once published.
CREATE FUNCTION lucy_guard_product() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'DRAFT' OR NEW.published_at IS NOT NULL THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'A product is created as a draft';
    END IF;
    RETURN NEW;
  END IF;
  IF OLD.published_at IS NOT NULL THEN
    IF NEW.published_at IS DISTINCT FROM OLD.published_at THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'The first publication time is immutable';
    END IF;
    IF NEW.status = 'DRAFT' THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'A published product never returns to draft';
    END IF;
  END IF;
  IF NEW.status = 'PUBLISHED' AND OLD.status IS DISTINCT FROM 'PUBLISHED' THEN
    IF NOT EXISTS (
      SELECT 1 FROM product_variants v WHERE v.product_id = NEW.id AND v.is_active
        AND EXISTS (SELECT 1 FROM product_price_versions p WHERE p.variant_id = v.id)
    ) THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'A product is published only with an active, priced variant';
    END IF;
    IF NEW.published_at IS NULL THEN NEW.published_at := clock_timestamp(); END IF;
  ELSIF NEW.status = 'DRAFT' AND NEW.published_at IS NOT NULL THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'A published product never returns to draft';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER lucy_products_lifecycle BEFORE INSERT OR UPDATE ON "products"
  FOR EACH ROW EXECUTE FUNCTION lucy_guard_product();
CREATE TRIGGER lucy_products_guard BEFORE UPDATE ON "products"
  FOR EACH ROW EXECUTE FUNCTION lucy_guard_versioned_row();

-- A variant is never deleted (history); it is deactivated. A published product keeps at least one active, priced variant.
CREATE FUNCTION lucy_guard_product_variant() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  parent_status "ProductStatus";
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'A product variant is deactivated, never deleted';
  END IF;
  IF NEW.product_id IS DISTINCT FROM OLD.product_id THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'A variant never moves to another product';
  END IF;
  IF OLD.is_active AND NOT NEW.is_active THEN
    SELECT p.status INTO parent_status FROM products p WHERE p.id = NEW.product_id;
    IF parent_status = 'PUBLISHED' AND NOT EXISTS (
      SELECT 1 FROM product_variants v WHERE v.product_id = NEW.product_id AND v.id <> NEW.id AND v.is_active
        AND EXISTS (SELECT 1 FROM product_price_versions p WHERE p.variant_id = v.id)
    ) THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'A published product keeps at least one active, priced variant';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER lucy_product_variants_lifecycle BEFORE UPDATE OR DELETE ON "product_variants"
  FOR EACH ROW EXECUTE FUNCTION lucy_guard_product_variant();
CREATE TRIGGER lucy_product_variants_guard BEFORE UPDATE ON "product_variants"
  FOR EACH ROW EXECUTE FUNCTION lucy_guard_versioned_row();

-- Price versions: numbered one after another, never changed, never deleted. A new list price must stay above the promotional
-- price of any promotion that has not ended yet (a promotion must be cheaper than the list price, PRD 24).
CREATE FUNCTION lucy_guard_product_price_version() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  latest integer;
BEGIN
  IF TG_OP <> 'INSERT' THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'A price version is append-only';
  END IF;
  PERFORM 1 FROM product_variants v WHERE v.id = NEW.variant_id FOR KEY SHARE;
  SELECT COALESCE(max(p.version_no), 0) INTO latest FROM product_price_versions p WHERE p.variant_id = NEW.variant_id;
  IF NEW.version_no <> latest + 1 THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'A price version follows the previous one';
  END IF;
  NEW.created_at := clock_timestamp();
  IF EXISTS (
    SELECT 1 FROM product_promotions r
    WHERE r.variant_id = NEW.variant_id AND COALESCE(r.ended_early_at, r.ends_at) > NEW.created_at
      AND r.promo_price_vnd >= NEW.list_price_vnd
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '23514',
      MESSAGE = 'The list price must stay above the price of a promotion that has not ended';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER lucy_product_price_versions_guard BEFORE INSERT OR UPDATE OR DELETE ON "product_price_versions"
  FOR EACH ROW EXECUTE FUNCTION lucy_guard_product_price_version();

-- Promotions: a new one must be cheaper than the current list price and not already over; the only change allowed afterwards is
-- the manual early end, once, stamped with the database clock; never deleted.
CREATE FUNCTION lucy_guard_product_promotion() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  current_list bigint;
  now_ts timestamptz := clock_timestamp();
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'A promotion is ended, never deleted';
  END IF;
  IF TG_OP = 'INSERT' THEN
    SELECT p.list_price_vnd INTO current_list FROM product_price_versions p
      WHERE p.variant_id = NEW.variant_id ORDER BY p.version_no DESC LIMIT 1;
    IF current_list IS NULL OR NEW.promo_price_vnd >= current_list THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'A promotional price is below the current list price';
    END IF;
    IF NEW.ends_at <= now_ts THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'A promotion cannot already be over';
    END IF;
    IF NEW.ended_early_at IS NOT NULL THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'A promotion is created before it is ended';
    END IF;
    NEW.created_at := now_ts;
    RETURN NEW;
  END IF;
  IF (NEW.id, NEW.variant_id, NEW.promo_price_vnd, NEW.starts_at, NEW.ends_at, NEW.created_by_user_id, NEW.created_at)
    IS DISTINCT FROM (OLD.id, OLD.variant_id, OLD.promo_price_vnd, OLD.starts_at, OLD.ends_at, OLD.created_by_user_id, OLD.created_at)
    OR OLD.ended_early_at IS NOT NULL OR NEW.ended_early_at IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'A promotion can only be ended early, once';
  END IF;
  IF now_ts >= OLD.ends_at THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'The promotion is already over';
  END IF;
  NEW.ended_early_at := GREATEST(OLD.starts_at, now_ts);
  RETURN NEW;
END;
$$;
CREATE TRIGGER lucy_product_promotions_guard BEFORE INSERT OR UPDATE OR DELETE ON "product_promotions"
  FOR EACH ROW EXECUTE FUNCTION lucy_guard_product_promotion();

-- The effective price is a pure function of (variant, instant): the list price in force at that instant (the latest version
-- written at or before it) and the promotion running at that instant, never above the list price (P6-T12). Zero rows when the
-- variant had no list price yet.
CREATE FUNCTION lucy_variant_price_at(p_variant uuid, p_at timestamptz)
RETURNS TABLE (list_price_vnd bigint, promo_price_vnd bigint, effective_price_vnd bigint, promotion_id uuid)
LANGUAGE sql STABLE AS $$
  WITH l AS (
    SELECT v.list_price_vnd FROM product_price_versions v
    WHERE v.variant_id = p_variant AND v.created_at <= p_at ORDER BY v.version_no DESC LIMIT 1
  ), p AS (
    SELECT r.id, r.promo_price_vnd FROM product_promotions r
    WHERE r.variant_id = p_variant AND r.starts_at <= p_at AND p_at < COALESCE(r.ended_early_at, r.ends_at)
    ORDER BY r.starts_at DESC LIMIT 1
  )
  SELECT l.list_price_vnd, p.promo_price_vnd,
         LEAST(l.list_price_vnd, COALESCE(p.promo_price_vnd, l.list_price_vnd)), p.id
  FROM l LEFT JOIN p ON true
$$;
