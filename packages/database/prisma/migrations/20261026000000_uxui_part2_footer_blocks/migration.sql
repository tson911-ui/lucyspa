-- UX/UI Part 2 follow-up (Owner request 2026-10-04): the footer's brand column becomes a block area the Owner manages in
-- Admin > Website > Shop info (social icons, app badges, text, link list, image, slogan; add, edit, delete, reorder,
-- show/hide). Additive: one column on the existing one-row table with the default `[]`, so no data change is needed and
-- nothing is seeded: until the Owner adds blocks the footer shows only the logo. No permission change
-- (MANAGE_WEBSITE_CONTENT covers it). The API validates the content of every block (https links, lengths, languages, the
-- image's media asset); the CHECK only keeps the shape and size of the list sane.
ALTER TABLE "website_shop_info"
  ADD COLUMN "footer_blocks" JSONB NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE "website_shop_info"
  ADD CONSTRAINT "website_shop_info_footer_blocks" CHECK (
    jsonb_typeof("footer_blocks") = 'array'
    AND jsonb_array_length("footer_blocks") <= 12
  );
