-- Owner request 2026-10-06: contact buttons for Zalo / Messenger / phone on the public site. Shop info gets two optional
-- fields the Owner fills in himself: the Facebook page link (the footer icon, and Messenger as m.me/<page>) and the Zalo
-- number or zalo.me link. Additive: two nullable columns on the existing one-row table, no default, no data change, and
-- nothing is seeded (production stays empty until the Owner enters the links). No permission change
-- (MANAGE_WEBSITE_CONTENT covers it). The API validates the shape of both values; the CHECK only bounds the length.
ALTER TABLE "website_shop_info"
  ADD COLUMN "facebook_url" TEXT,
  ADD COLUMN "zalo_contact" TEXT;

ALTER TABLE "website_shop_info"
  ADD CONSTRAINT "website_shop_info_contact_links" CHECK (
    ("facebook_url" IS NULL OR char_length("facebook_url") BETWEEN 1 AND 300)
    AND ("zalo_contact" IS NULL OR char_length("zalo_contact") BETWEEN 1 AND 300)
  );
