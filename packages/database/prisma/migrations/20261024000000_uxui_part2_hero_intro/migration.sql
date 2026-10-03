-- UX/UI Part 2 follow-up: the sentence under the home page headline becomes editable in Admin > Website > Shop info.
-- Additive: two nullable columns on the existing one-row table, no row changes, no permission change (MANAGE_WEBSITE_CONTENT
-- covers it). NULL means "not set": the website then shows its built-in sentence, so the migration needs no data.
ALTER TABLE "website_shop_info"
  ADD COLUMN "intro_vi" TEXT,
  ADD COLUMN "intro_en" TEXT;

ALTER TABLE "website_shop_info"
  ADD CONSTRAINT "website_shop_info_intro" CHECK (
    ("intro_vi" IS NULL OR char_length("intro_vi") BETWEEN 1 AND 200)
    AND ("intro_en" IS NULL OR char_length("intro_en") BETWEEN 1 AND 200)
  );
