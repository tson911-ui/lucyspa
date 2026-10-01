-- UX/UI Step 11, migration 2 of 2: the website media library (design 16.2, 16.3) and the catalog semantics
-- of MANAGE_WEBSITE_CONTENT. Additive: no existing table or row changes.
--
-- MANAGE_WEBSITE_CONTENT is GLOBAL_ONLY (website content is not branch scoped, like MANAGE_DISCOUNTS) and
-- STANDARD data. The existing overrides trigger already refuses a GLOBAL_ONLY code at a branch scope by
-- reading `permissions.scope_capability`, so it needs no change. Nothing is granted by this migration.
ALTER TABLE "permissions" DROP CONSTRAINT "permissions_catalog_semantics";
ALTER TABLE "permissions"
  ADD CONSTRAINT "permissions_catalog_semantics" CHECK (
    (("code" IN ('MANAGE_SERVICE_PRICES', 'MANAGE_BOOKING_SETTINGS', 'MANAGE_DISCOUNTS', 'CREATE_VOUCHERS',
          'MANAGE_WEBSITE_CONTENT')
        AND "scope_capability" = 'GLOBAL_ONLY')
      OR ("code" NOT IN ('MANAGE_SERVICE_PRICES', 'MANAGE_BOOKING_SETTINGS', 'MANAGE_DISCOUNTS', 'CREATE_VOUCHERS',
          'MANAGE_WEBSITE_CONTENT')
        AND "scope_capability" = 'BRANCH_CAPABLE'))
    AND (("code" IN ('VIEW_EMPLOYEE_PAY', 'MANAGE_EMPLOYEE_PAY') AND "data_classification" = 'EMPLOYEE_PAY')
      OR ("code" IN ('VIEW_INVOICES', 'MANAGE_INVOICES', 'COLLECT_PAYMENTS', 'APPLY_DISCOUNTS',
          'MANAGE_DISCOUNTS', 'CREATE_VOUCHERS', 'CANCEL_INVOICES', 'CORRECT_PAYMENTS', 'VIEW_REVENUE')
        AND "data_classification" = 'FINANCIAL')
      OR ("code" NOT IN ('VIEW_EMPLOYEE_PAY', 'MANAGE_EMPLOYEE_PAY', 'VIEW_INVOICES', 'MANAGE_INVOICES',
          'COLLECT_PAYMENTS', 'APPLY_DISCOUNTS', 'MANAGE_DISCOUNTS', 'CREATE_VOUCHERS', 'CANCEL_INVOICES',
          'CORRECT_PAYMENTS', 'VIEW_REVENUE')
        AND "data_classification" = 'STANDARD'))
  );

-- ------------------------------------------------------------------------------ media library
CREATE TYPE "MediaVariantKind" AS ENUM ('THUMB', 'MD', 'LG');

-- One row per distinct uploaded image (deduplicated by sha256). `storage_key` and the variant keys are opaque
-- random keys (`{yyyy}/{mm}/{uuid}.{ext}`), never paths or URLs, so storage can move without a data migration.
CREATE TABLE "media_assets" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "storage_key" TEXT NOT NULL,
    "original_filename" TEXT NOT NULL,
    "mime" TEXT NOT NULL,
    "bytes" INTEGER NOT NULL,
    "width" INTEGER NOT NULL,
    "height" INTEGER NOT NULL,
    "sha256" TEXT NOT NULL,
    "alt_vi" TEXT,
    "alt_en" TEXT,
    "created_by_user_id" UUID NOT NULL,
    "row_version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "media_assets_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "media_assets_mime" CHECK ("mime" IN ('image/jpeg', 'image/png', 'image/webp')),
    CONSTRAINT "media_assets_bytes" CHECK ("bytes" BETWEEN 1 AND 10485760),
    CONSTRAINT "media_assets_dimensions" CHECK ("width" BETWEEN 1 AND 6000 AND "height" BETWEEN 1 AND 6000),
    CONSTRAINT "media_assets_sha256" CHECK ("sha256" ~ '^[0-9a-f]{64}$'),
    CONSTRAINT "media_assets_texts" CHECK (
      char_length("original_filename") BETWEEN 1 AND 255
      AND ("alt_vi" IS NULL OR char_length("alt_vi") BETWEEN 1 AND 300)
      AND ("alt_en" IS NULL OR char_length("alt_en") BETWEEN 1 AND 300)
    ),
    CONSTRAINT "media_assets_row_version" CHECK ("row_version" >= 1)
);

CREATE UNIQUE INDEX "media_assets_storage_key_key" ON "media_assets"("storage_key");
CREATE UNIQUE INDEX "media_assets_sha256_key" ON "media_assets"("sha256");
CREATE INDEX "media_assets_created_idx" ON "media_assets"("created_at" DESC, "id" DESC);

-- The derived WebP renditions (thumb 320w, md 960w, lg 1920w). They live and die with their asset.
CREATE TABLE "media_variants" (
    "asset_id" UUID NOT NULL,
    "kind" "MediaVariantKind" NOT NULL,
    "storage_key" TEXT NOT NULL,
    "width" INTEGER NOT NULL,
    "height" INTEGER NOT NULL,
    "bytes" INTEGER NOT NULL,

    CONSTRAINT "media_variants_pkey" PRIMARY KEY ("asset_id", "kind"),
    CONSTRAINT "media_variants_dimensions" CHECK ("width" BETWEEN 1 AND 6000 AND "height" BETWEEN 1 AND 6000 AND "bytes" > 0)
);

CREATE UNIQUE INDEX "media_variants_storage_key_key" ON "media_variants"("storage_key");

ALTER TABLE "media_assets"
  ADD CONSTRAINT "media_assets_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id")
    REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "media_variants"
  ADD CONSTRAINT "media_variants_asset_id_fkey" FOREIGN KEY ("asset_id")
    REFERENCES "media_assets"("id") ON DELETE CASCADE ON UPDATE RESTRICT;
