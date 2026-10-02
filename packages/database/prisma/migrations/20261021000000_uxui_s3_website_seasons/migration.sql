-- UX/UI Step S3: scheduled seasonal themes (design 20.4, 20.6). Additive: one new table and one nullable link
-- column on each of the popup and slide tables; no existing row or constraint changes, and no permission change
-- (MANAGE_WEBSITE_CONTENT from Step 11 covers it).
--
-- `preset_key` is checked for FORMAT only: the API validates it against the registry in packages/contracts, so a
-- new preset needs no migration. "One enabled season at a time" depends on the time windows and is enforced by the
-- API under an advisory lock, not by a constraint here.
CREATE TABLE "website_seasons" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "preset_key" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "starts_at" TIMESTAMPTZ(3) NOT NULL,
    "ends_at" TIMESTAMPTZ(3) NOT NULL,
    "greeting_vi" TEXT,
    "greeting_en" TEXT,
    "apply_customer" BOOLEAN NOT NULL DEFAULT true,
    "apply_admin" BOOLEAN NOT NULL DEFAULT true,
    "particles_enabled" BOOLEAN NOT NULL DEFAULT true,
    "is_enabled" BOOLEAN NOT NULL DEFAULT false,
    "row_version" INTEGER NOT NULL DEFAULT 1,
    "created_by_user_id" UUID NOT NULL,
    "updated_by_user_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "website_seasons_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "website_seasons_window" CHECK ("ends_at" > "starts_at"),
    CONSTRAINT "website_seasons_preset_key" CHECK ("preset_key" ~ '^[a-z][a-z0-9-]{0,39}$'),
    CONSTRAINT "website_seasons_label" CHECK (char_length("label") BETWEEN 1 AND 80),
    CONSTRAINT "website_seasons_greetings" CHECK (
      ("greeting_vi" IS NULL OR char_length("greeting_vi") BETWEEN 1 AND 80)
      AND ("greeting_en" IS NULL OR char_length("greeting_en") BETWEEN 1 AND 80)
    ),
    CONSTRAINT "website_seasons_row_version" CHECK ("row_version" >= 1)
);

CREATE INDEX "website_seasons_starts_idx" ON "website_seasons"("starts_at" DESC, "id");

ALTER TABLE "website_seasons"
  ADD CONSTRAINT "website_seasons_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id")
    REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "website_seasons"
  ADD CONSTRAINT "website_seasons_updated_by_user_id_fkey" FOREIGN KEY ("updated_by_user_id")
    REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- A popup or slide may follow a season (Q-S2). The API unlinks before it deletes a season; RESTRICT is the last
-- line of defence.
ALTER TABLE "website_popups" ADD COLUMN "season_id" UUID;
ALTER TABLE "website_slides" ADD COLUMN "season_id" UUID;

CREATE INDEX "website_popups_season_idx" ON "website_popups"("season_id");
CREATE INDEX "website_slides_season_idx" ON "website_slides"("season_id");

ALTER TABLE "website_popups"
  ADD CONSTRAINT "website_popups_season_id_fkey" FOREIGN KEY ("season_id")
    REFERENCES "website_seasons"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "website_slides"
  ADD CONSTRAINT "website_slides_season_id_fkey" FOREIGN KEY ("season_id")
    REFERENCES "website_seasons"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
