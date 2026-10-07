-- Phase 6 P6-6: the Owner-written copy of the public cosmetics page (design 16.2, OQ-P6-28), kept in the one settings row of the
-- product module. Additive only: eight nullable or defaulted columns on `product_settings`, one foreign key, no data written.
--   hero_media_id, hero_title_*, hero_text_*   the hero image and the headline and sentence over it
--   commitment_title_*, commitment_items       the "commitment" box: a title and a short list, each line in both languages
-- Everything is empty until the Owner fills it in (nothing is seeded); the public page hides the hero and the box while empty.
-- An image chosen here is served publicly through `/api/v1/public/media` (the API checks it), so the key is RESTRICT like every
-- other media reference: an image in use cannot be deleted.

ALTER TABLE "product_settings"
  ADD COLUMN "hero_media_id" UUID,
  ADD COLUMN "hero_title_vi" TEXT,
  ADD COLUMN "hero_title_en" TEXT,
  ADD COLUMN "hero_text_vi" TEXT,
  ADD COLUMN "hero_text_en" TEXT,
  ADD COLUMN "commitment_title_vi" TEXT,
  ADD COLUMN "commitment_title_en" TEXT,
  ADD COLUMN "commitment_items" JSONB NOT NULL DEFAULT '[]';

ALTER TABLE "product_settings"
  ADD CONSTRAINT "product_settings_hero_media_fkey" FOREIGN KEY ("hero_media_id")
    REFERENCES "media_assets"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  ADD CONSTRAINT "product_settings_commitment_items_array" CHECK (jsonb_typeof("commitment_items") = 'array');

CREATE INDEX "product_settings_hero_media_idx" ON "product_settings"("hero_media_id");
