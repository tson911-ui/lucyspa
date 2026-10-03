-- UX/UI Part 2 follow-up (Owner review): the home page's facts strip, featured service groups and the optional "why
-- choose us" section become editable in Admin > Website > Shop info. Additive: columns on the existing one-row table,
-- all with defaults, so no data change is needed. `facts_items = []` means the three built-in facts in their default
-- order; `featured_groups = []` means every catalogue group (the website's behaviour before this change); the "why"
-- section is OFF and empty (nothing is seeded). No permission change (MANAGE_WEBSITE_CONTENT covers it). The API validates
-- the content of the lists; the CHECK only keeps their shape, size and the two titles' length sane.
ALTER TABLE "website_shop_info"
  ADD COLUMN "facts_visible" BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN "facts_items" JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN "featured_groups" JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN "why_visible" BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN "why_title_vi" TEXT,
  ADD COLUMN "why_title_en" TEXT,
  ADD COLUMN "why_cards" JSONB NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE "website_shop_info"
  ADD CONSTRAINT "website_shop_info_lists" CHECK (
    jsonb_typeof("facts_items") = 'array'
    AND jsonb_array_length("facts_items") <= 16
    AND jsonb_typeof("featured_groups") = 'array'
    AND jsonb_array_length("featured_groups") <= 12
    AND jsonb_typeof("why_cards") = 'array'
    AND jsonb_array_length("why_cards") <= 12
    AND ("why_title_vi" IS NULL OR char_length("why_title_vi") BETWEEN 1 AND 80)
    AND ("why_title_en" IS NULL OR char_length("why_title_en") BETWEEN 1 AND 80)
  );
