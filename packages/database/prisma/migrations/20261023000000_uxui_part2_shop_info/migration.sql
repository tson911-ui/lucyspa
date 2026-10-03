-- UX/UI Part 2 (P2-2): the public shop profile (docs/UXUI_REDESIGN_PART2_DESIGN.md 6.1). Additive: one new table,
-- no existing table or row changes, no permission change (MANAGE_WEBSITE_CONTENT covers it).
--
-- One row: the id is fixed ('shop'). Opening hours are not stored here; the website reads the operating hours of the
-- chosen branch (the rows the booking engine uses), so there is one truth. A referenced image or branch cannot be removed
-- (ON DELETE RESTRICT; the media API also refuses with MEDIA_IN_USE).
CREATE TABLE "website_shop_info" (
    "id" TEXT NOT NULL DEFAULT 'shop',
    "tagline_vi" TEXT NOT NULL,
    "tagline_en" TEXT NOT NULL,
    "address" TEXT NOT NULL,
    "hotline" TEXT NOT NULL,
    "map_url" TEXT,
    "hours_branch_id" UUID,
    "hero_media_id" UUID,
    "row_version" INTEGER NOT NULL DEFAULT 1,
    "updated_by_user_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "website_shop_info_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "website_shop_info_single" CHECK ("id" = 'shop'),
    CONSTRAINT "website_shop_info_texts" CHECK (
      char_length("tagline_vi") BETWEEN 1 AND 120
      AND char_length("tagline_en") BETWEEN 1 AND 120
      AND char_length("address") BETWEEN 1 AND 300
      AND char_length("hotline") BETWEEN 6 AND 30
    ),
    -- Digits with the usual separators only; the API also requires at least 8 digits.
    CONSTRAINT "website_shop_info_hotline" CHECK ("hotline" ~ '^[0-9+().[:space:]-]+$'),
    -- An https URL only: never javascript:, data: or a protocol-relative URL.
    CONSTRAINT "website_shop_info_map_url" CHECK (
      "map_url" IS NULL OR (
        char_length("map_url") <= 500
        AND "map_url" ~ '^https://[^[:space:]<>"''\\/][^[:space:]<>"''\\]*$'
      )
    ),
    CONSTRAINT "website_shop_info_row_version" CHECK ("row_version" >= 1)
);

CREATE INDEX "website_shop_info_media_idx" ON "website_shop_info"("hero_media_id");
CREATE INDEX "website_shop_info_branch_idx" ON "website_shop_info"("hours_branch_id");

ALTER TABLE "website_shop_info"
  ADD CONSTRAINT "website_shop_info_hours_branch_id_fkey" FOREIGN KEY ("hours_branch_id")
    REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "website_shop_info"
  ADD CONSTRAINT "website_shop_info_hero_media_id_fkey" FOREIGN KEY ("hero_media_id")
    REFERENCES "media_assets"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "website_shop_info"
  ADD CONSTRAINT "website_shop_info_updated_by_user_id_fkey" FOREIGN KEY ("updated_by_user_id")
    REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- The Owner's real values (Part 2 brief, 2026-10-03). Editable afterwards in the admin "Shop info" tab.
INSERT INTO "website_shop_info" ("id", "tagline_vi", "tagline_en", "address", "hotline")
VALUES (
  'shop',
  'Thư Giãn Tận Tâm – Nâng Tầm Nhan Sắc',
  'Heartfelt Relaxation – Elevated Beauty',
  '04 Nguyễn Quang Bích, Đà Nẵng',
  '0934 936 101'
);
