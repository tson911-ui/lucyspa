-- UX/UI Step 13: the homepage slider (design 16.2, 16.6). Additive: no existing table or row changes, and
-- no permission change (MANAGE_WEBSITE_CONTENT from Step 11 covers it).
--
-- The order is `sort_order`, dense integers rewritten in one transaction by the API (reorder and delete);
-- it is deliberately not unique so a rewrite never trips over itself. "At most 8 visible at once" is enforced
-- by the API under an advisory lock (it depends on the time windows), not by a constraint here.
CREATE TABLE "website_slides" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "media_id" UUID NOT NULL,
    "mobile_media_id" UUID,
    "title_vi" TEXT,
    "title_en" TEXT,
    "subtitle_vi" TEXT,
    "subtitle_en" TEXT,
    "link_url" TEXT,
    "link_label_vi" TEXT,
    "link_label_en" TEXT,
    "alt_vi" TEXT,
    "alt_en" TEXT,
    "sort_order" INTEGER NOT NULL,
    "starts_at" TIMESTAMPTZ(3),
    "ends_at" TIMESTAMPTZ(3),
    "is_enabled" BOOLEAN NOT NULL DEFAULT false,
    "row_version" INTEGER NOT NULL DEFAULT 1,
    "created_by_user_id" UUID NOT NULL,
    "updated_by_user_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "website_slides_pkey" PRIMARY KEY ("id"),
    -- Both ends are optional (no end = always); when both are set the window must have a length.
    CONSTRAINT "website_slides_window" CHECK (
      "starts_at" IS NULL OR "ends_at" IS NULL OR "ends_at" > "starts_at"
    ),
    CONSTRAINT "website_slides_texts" CHECK (
      ("title_vi" IS NULL OR char_length("title_vi") BETWEEN 1 AND 120)
      AND ("title_en" IS NULL OR char_length("title_en") BETWEEN 1 AND 120)
      AND ("subtitle_vi" IS NULL OR char_length("subtitle_vi") BETWEEN 1 AND 200)
      AND ("subtitle_en" IS NULL OR char_length("subtitle_en") BETWEEN 1 AND 200)
      AND ("link_label_vi" IS NULL OR char_length("link_label_vi") BETWEEN 1 AND 40)
      AND ("link_label_en" IS NULL OR char_length("link_label_en") BETWEEN 1 AND 40)
      AND ("alt_vi" IS NULL OR char_length("alt_vi") BETWEEN 1 AND 300)
      AND ("alt_en" IS NULL OR char_length("alt_en") BETWEEN 1 AND 300)
    ),
    -- The same link rule as the popup: an internal path (/vi/..., /en/..., /{locale}/...) or an https URL only.
    CONSTRAINT "website_slides_link_url" CHECK (
      "link_url" IS NULL OR (
        char_length("link_url") <= 500
        AND ("link_url" ~ '^/(vi|en|\{locale\})(/[^[:space:]<>"''\\]*)?$'
          OR "link_url" ~ '^https://[^[:space:]<>"''\\/][^[:space:]<>"''\\]*$')
      )
    ),
    -- A link needs a label and a label needs a link.
    CONSTRAINT "website_slides_link_pair" CHECK (
      ("link_url" IS NOT NULL AND ("link_label_vi" IS NOT NULL OR "link_label_en" IS NOT NULL))
      OR ("link_url" IS NULL AND "link_label_vi" IS NULL AND "link_label_en" IS NULL)
    ),
    CONSTRAINT "website_slides_sort_order" CHECK ("sort_order" >= 0),
    CONSTRAINT "website_slides_row_version" CHECK ("row_version" >= 1)
);

CREATE INDEX "website_slides_order_idx" ON "website_slides"("sort_order", "id");
CREATE INDEX "website_slides_media_idx" ON "website_slides"("media_id");
CREATE INDEX "website_slides_mobile_media_idx" ON "website_slides"("mobile_media_id");

-- A referenced image cannot be removed: the delete is refused by the API (MEDIA_IN_USE) and, as the last line
-- of defence, by these keys.
ALTER TABLE "website_slides"
  ADD CONSTRAINT "website_slides_media_id_fkey" FOREIGN KEY ("media_id")
    REFERENCES "media_assets"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "website_slides"
  ADD CONSTRAINT "website_slides_mobile_media_id_fkey" FOREIGN KEY ("mobile_media_id")
    REFERENCES "media_assets"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "website_slides"
  ADD CONSTRAINT "website_slides_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id")
    REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "website_slides"
  ADD CONSTRAINT "website_slides_updated_by_user_id_fkey" FOREIGN KEY ("updated_by_user_id")
    REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
