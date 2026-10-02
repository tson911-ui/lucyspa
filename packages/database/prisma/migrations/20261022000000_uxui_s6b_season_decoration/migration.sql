-- UX/UI Step S6b: per-event decoration of a season (docs/UXUI_REDESIGN_S6_PLAN.md sections 6 and 7). Additive: nine
-- columns on `website_seasons` (every existing row keeps meaning "everything on, medium density") and one new table
-- for the media-library image that replaces a slot's drawn art. No permission change (MANAGE_WEBSITE_CONTENT covers
-- it). The particles slot is the existing `particles_enabled` column. `preset_key` stays checked for FORMAT only: the
-- API validates it against the registry, so the new `celebration` kit needs no migration.
-- Rollback: the previous build ignores the new columns and table.
ALTER TABLE "website_seasons"
  ADD COLUMN "slot_header" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "slot_logo" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "slot_corners" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "slot_dividers" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "slot_footer" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "slot_tint" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "greeting_strip" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "greeting_footer" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "particle_density" TEXT NOT NULL DEFAULT 'medium',
  ADD CONSTRAINT "website_seasons_particle_density" CHECK ("particle_density" IN ('low', 'medium', 'high'));

-- One image per slot per season. The image is RESTRICT: the media API refuses to delete an image that a season uses
-- (it reports the season as a usage), and this key is the last line of defence. Deleting a season removes its rows.
CREATE TABLE "website_season_slot_media" (
    "season_id" UUID NOT NULL,
    "slot" TEXT NOT NULL,
    "media_id" UUID NOT NULL,

    CONSTRAINT "website_season_slot_media_pkey" PRIMARY KEY ("season_id", "slot"),
    CONSTRAINT "website_season_slot_media_slot" CHECK (
      "slot" IN ('particles', 'header', 'logo', 'corners', 'dividers', 'footer', 'tint')
    )
);

CREATE INDEX "website_season_slot_media_media_idx" ON "website_season_slot_media"("media_id");

ALTER TABLE "website_season_slot_media"
  ADD CONSTRAINT "website_season_slot_media_season_id_fkey" FOREIGN KEY ("season_id")
    REFERENCES "website_seasons"("id") ON DELETE CASCADE ON UPDATE RESTRICT;
ALTER TABLE "website_season_slot_media"
  ADD CONSTRAINT "website_season_slot_media_media_id_fkey" FOREIGN KEY ("media_id")
    REFERENCES "media_assets"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
