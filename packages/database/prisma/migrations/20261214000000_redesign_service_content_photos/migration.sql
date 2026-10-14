-- Redesign group 1 (C11b): optional content and photos for the customer pages. Additive and nullable only: no existing row or function changes.
-- Services get lists of text per language (what is included, steps, FAQ question/answer pairs; NULL means none and the public band is hidden) and a
-- photo. Service groups (service_categories) and cosmetics categories (product_categories) get a photo. Every photo is a media-library asset; the
-- key is RESTRICT, like every other media key, so an image in use cannot be deleted.
ALTER TABLE "services"
  ADD COLUMN "included_vi" JSONB,
  ADD COLUMN "included_en" JSONB,
  ADD COLUMN "steps_vi" JSONB,
  ADD COLUMN "steps_en" JSONB,
  ADD COLUMN "faq_vi" JSONB,
  ADD COLUMN "faq_en" JSONB,
  ADD COLUMN "photo_media_id" UUID;
ALTER TABLE "service_categories" ADD COLUMN "photo_media_id" UUID;
ALTER TABLE "product_categories" ADD COLUMN "photo_media_id" UUID;

CREATE INDEX "services_photo_idx" ON "services"("photo_media_id");
CREATE INDEX "service_categories_photo_idx" ON "service_categories"("photo_media_id");
CREATE INDEX "product_categories_photo_idx" ON "product_categories"("photo_media_id");

ALTER TABLE "services"
  ADD CONSTRAINT "services_photo_media_id_fkey" FOREIGN KEY ("photo_media_id")
    REFERENCES "media_assets"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "service_categories"
  ADD CONSTRAINT "service_categories_photo_media_id_fkey" FOREIGN KEY ("photo_media_id")
    REFERENCES "media_assets"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "product_categories"
  ADD CONSTRAINT "product_categories_photo_media_id_fkey" FOREIGN KEY ("photo_media_id")
    REFERENCES "media_assets"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
