-- Phase 6 P6-9 (Q7, OQ-P6-21; design 6.3): the discount SCOPE of a program version and its product targeting. Additive.
--  * Every program version gets a scope SERVICES / PRODUCTS / BOTH. All existing versions migrate to SERVICES (the column default), so
--    Phase 4 and Phase 5 behavior is identical; nothing in the existing API sets another value yet (the screens come with P6-11).
--  * `scope_mode` keeps its two values; `ALL_SERVICES` now means "every item of the program's scope" (the name is historical).
--  * A PRODUCTS or BOTH version may target selected brands, product categories (that exact category, children are not included) or
--    products, like a services version targets services and service categories. The scope rows are append-only like the others.
--  * The scope integrity check (deferred) now reads: SERVICES names no product target, PRODUCTS names no service target, a SELECTED
--    version names at least one target, an ALL_SERVICES version names none.

CREATE TYPE "DiscountScope" AS ENUM ('SERVICES', 'PRODUCTS', 'BOTH');

ALTER TABLE "discount_versions" ADD COLUMN "scope" "DiscountScope" NOT NULL DEFAULT 'SERVICES';

CREATE TABLE "discount_version_brands" (
    "version_id" UUID NOT NULL,
    "brand_id" UUID NOT NULL,

    CONSTRAINT "discount_version_brands_pkey" PRIMARY KEY ("version_id", "brand_id")
);

CREATE TABLE "discount_version_product_categories" (
    "version_id" UUID NOT NULL,
    "category_id" UUID NOT NULL,

    CONSTRAINT "discount_version_product_categories_pkey" PRIMARY KEY ("version_id", "category_id")
);

CREATE TABLE "discount_version_products" (
    "version_id" UUID NOT NULL,
    "product_id" UUID NOT NULL,

    CONSTRAINT "discount_version_products_pkey" PRIMARY KEY ("version_id", "product_id")
);

ALTER TABLE "discount_version_brands" ADD CONSTRAINT "discount_version_brands_version_id_fkey" FOREIGN KEY ("version_id") REFERENCES "discount_versions"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "discount_version_brands" ADD CONSTRAINT "discount_version_brands_brand_id_fkey" FOREIGN KEY ("brand_id") REFERENCES "brands"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "discount_version_product_categories" ADD CONSTRAINT "discount_version_product_categories_version_id_fkey" FOREIGN KEY ("version_id") REFERENCES "discount_versions"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "discount_version_product_categories" ADD CONSTRAINT "discount_version_product_categories_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "product_categories"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "discount_version_products" ADD CONSTRAINT "discount_version_products_version_id_fkey" FOREIGN KEY ("version_id") REFERENCES "discount_versions"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "discount_version_products" ADD CONSTRAINT "discount_version_products_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

CREATE INDEX "discount_version_brands_brand_idx" ON "discount_version_brands"("brand_id");
CREATE INDEX "discount_version_product_categories_category_idx" ON "discount_version_product_categories"("category_id");
CREATE INDEX "discount_version_products_product_idx" ON "discount_version_products"("product_id");

CREATE OR REPLACE FUNCTION lucy_check_discount_version_scope() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  version_id_value uuid;
  mode "DiscountScopeMode";
  version_scope "DiscountScope";
  service_rows bigint;
  product_rows bigint;
BEGIN
  IF TG_TABLE_NAME = 'discount_versions' THEN
    version_id_value := NEW.id;
  ELSE
    version_id_value := NEW.version_id;
  END IF;
  SELECT scope_mode, scope INTO mode, version_scope FROM discount_versions WHERE id = version_id_value;
  SELECT (SELECT count(*) FROM discount_version_services WHERE version_id = version_id_value)
    + (SELECT count(*) FROM discount_version_categories WHERE version_id = version_id_value) INTO service_rows;
  SELECT (SELECT count(*) FROM discount_version_brands WHERE version_id = version_id_value)
    + (SELECT count(*) FROM discount_version_product_categories WHERE version_id = version_id_value)
    + (SELECT count(*) FROM discount_version_products WHERE version_id = version_id_value) INTO product_rows;
  IF (mode = 'SELECTED' AND service_rows + product_rows = 0) OR (mode = 'ALL_SERVICES' AND service_rows + product_rows > 0) THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'A selected-scope version names its targets and an all-services version names none';
  END IF;
  IF (version_scope = 'SERVICES' AND product_rows > 0) OR (version_scope = 'PRODUCTS' AND service_rows > 0) THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'A program names only the targets of its scope: services, products or both';
  END IF;
  RETURN NULL;
END;
$$;

CREATE CONSTRAINT TRIGGER "discount_version_brands_scope_integrity" AFTER INSERT ON "discount_version_brands"
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION lucy_check_discount_version_scope();
CREATE CONSTRAINT TRIGGER "discount_version_product_categories_scope_integrity" AFTER INSERT ON "discount_version_product_categories"
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION lucy_check_discount_version_scope();
CREATE CONSTRAINT TRIGGER "discount_version_products_scope_integrity" AFTER INSERT ON "discount_version_products"
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION lucy_check_discount_version_scope();

CREATE TRIGGER "discount_version_brands_append_only" BEFORE UPDATE OR DELETE ON "discount_version_brands" FOR EACH ROW EXECUTE FUNCTION lucy_reject_permanent_history_mutation();
CREATE TRIGGER "discount_version_product_categories_append_only" BEFORE UPDATE OR DELETE ON "discount_version_product_categories" FOR EACH ROW EXECUTE FUNCTION lucy_reject_permanent_history_mutation();
CREATE TRIGGER "discount_version_products_append_only" BEFORE UPDATE OR DELETE ON "discount_version_products" FOR EACH ROW EXECUTE FUNCTION lucy_reject_permanent_history_mutation();
CREATE TRIGGER "discount_version_brands_no_truncate" BEFORE TRUNCATE ON "discount_version_brands" FOR EACH STATEMENT EXECUTE FUNCTION lucy_reject_permanent_history_mutation();
CREATE TRIGGER "discount_version_product_categories_no_truncate" BEFORE TRUNCATE ON "discount_version_product_categories" FOR EACH STATEMENT EXECUTE FUNCTION lucy_reject_permanent_history_mutation();
CREATE TRIGGER "discount_version_products_no_truncate" BEFORE TRUNCATE ON "discount_version_products" FOR EACH STATEMENT EXECUTE FUNCTION lucy_reject_permanent_history_mutation();

-- CREATE OR REPLACE drops function-level settings: restore the Phase 1 convention (fixed search_path, no PUBLIC execute).
DO $$
DECLARE
  migration_schema text := current_schema();
BEGIN
  EXECUTE format('ALTER FUNCTION %I.%I() SET search_path TO pg_catalog, %I, pg_temp',
    migration_schema, 'lucy_check_discount_version_scope', migration_schema);
  EXECUTE format('REVOKE ALL ON FUNCTION %I.%I() FROM PUBLIC', migration_schema, 'lucy_check_discount_version_scope');
END;
$$;
