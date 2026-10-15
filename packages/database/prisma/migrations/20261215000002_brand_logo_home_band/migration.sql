-- Redesign group 1 (session 9): the brand band on the home page. Additive only: no existing row or function changes.
-- A brand gets an optional logo (a media-library asset; the key is RESTRICT like every other media key, so a logo in use cannot be deleted),
-- a switch for showing it in the band (off by default, so nothing appears until the Owner enables a brand) and its place in the band.
ALTER TABLE "brands"
  ADD COLUMN "logo_media_id" UUID,
  ADD COLUMN "show_on_home" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "home_sort_order" INTEGER NOT NULL DEFAULT 0;

CREATE INDEX "brands_logo_idx" ON "brands"("logo_media_id");

ALTER TABLE "brands"
  ADD CONSTRAINT "brands_logo_media_id_fkey" FOREIGN KEY ("logo_media_id")
    REFERENCES "media_assets"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
