-- UX/UI Step 12: the promotional popup (design 16.2, 16.5). Additive: no existing table or row changes, and
-- no permission change (MANAGE_WEBSITE_CONTENT from Step 11 covers it).
--
-- At most one ENABLED popup may cover any instant. That rule is enforced by the API in one transaction under an
-- advisory lock (design 16.5: no DB extension), not by a constraint here. Disabled popups may overlap.
CREATE TABLE "website_popups" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "media_id" UUID,
    "title_vi" TEXT,
    "title_en" TEXT,
    "body_vi" TEXT,
    "body_en" TEXT,
    "cta_label_vi" TEXT,
    "cta_label_en" TEXT,
    "cta_url" TEXT,
    "starts_at" TIMESTAMPTZ(3) NOT NULL,
    "ends_at" TIMESTAMPTZ(3) NOT NULL,
    "is_enabled" BOOLEAN NOT NULL DEFAULT false,
    "row_version" INTEGER NOT NULL DEFAULT 1,
    "created_by_user_id" UUID NOT NULL,
    "updated_by_user_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "website_popups_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "website_popups_window" CHECK ("ends_at" > "starts_at"),
    CONSTRAINT "website_popups_texts" CHECK (
      ("title_vi" IS NULL OR char_length("title_vi") BETWEEN 1 AND 120)
      AND ("title_en" IS NULL OR char_length("title_en") BETWEEN 1 AND 120)
      AND ("body_vi" IS NULL OR char_length("body_vi") BETWEEN 1 AND 300)
      AND ("body_en" IS NULL OR char_length("body_en") BETWEEN 1 AND 300)
      AND ("cta_label_vi" IS NULL OR char_length("cta_label_vi") BETWEEN 1 AND 40)
      AND ("cta_label_en" IS NULL OR char_length("cta_label_en") BETWEEN 1 AND 40)
    ),
    -- At least an image or a title.
    CONSTRAINT "website_popups_content" CHECK (
      "media_id" IS NOT NULL OR "title_vi" IS NOT NULL OR "title_en" IS NOT NULL
    ),
    -- An internal path (/vi/..., /en/..., or /{locale}/... resolved at serve time) or an https URL only: never
    -- javascript:, data: or a protocol-relative URL.
    CONSTRAINT "website_popups_cta_url" CHECK (
      "cta_url" IS NULL OR (
        char_length("cta_url") <= 500
        AND ("cta_url" ~ '^/(vi|en|\{locale\})(/[^[:space:]<>"''\\]*)?$'
          OR "cta_url" ~ '^https://[^[:space:]<>"''\\/][^[:space:]<>"''\\]*$')
      )
    ),
    -- A link needs a label and a label needs a link.
    CONSTRAINT "website_popups_cta_pair" CHECK (
      ("cta_url" IS NOT NULL AND ("cta_label_vi" IS NOT NULL OR "cta_label_en" IS NOT NULL))
      OR ("cta_url" IS NULL AND "cta_label_vi" IS NULL AND "cta_label_en" IS NULL)
    ),
    CONSTRAINT "website_popups_row_version" CHECK ("row_version" >= 1)
);

CREATE INDEX "website_popups_starts_idx" ON "website_popups"("starts_at" DESC, "id");
CREATE INDEX "website_popups_media_idx" ON "website_popups"("media_id");

-- A referenced image cannot be removed: the delete is refused by the API (MEDIA_IN_USE) and, as the last line
-- of defence, by this key.
ALTER TABLE "website_popups"
  ADD CONSTRAINT "website_popups_media_id_fkey" FOREIGN KEY ("media_id")
    REFERENCES "media_assets"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "website_popups"
  ADD CONSTRAINT "website_popups_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id")
    REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "website_popups"
  ADD CONSTRAINT "website_popups_updated_by_user_id_fkey" FOREIGN KEY ("updated_by_user_id")
    REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
