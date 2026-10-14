-- Session 7b: information pages the Owner writes in the website admin (about, policies, terms, privacy). Additive: one enum and one
-- table; no existing table or row changes, and no permission change (MANAGE_WEBSITE_CONTENT covers it).
--
-- `body_*` is the page text in the small markup the website accepts (headings, paragraphs, lists, bold, italic, links); the API
-- validates it on every save and the website draws it as elements, never as HTML. A page is unpublished, not deleted (the Owner
-- asked for create, edit and publish/unpublish).
--
-- The footer's legal line names ONE terms page and ONE privacy page, so at most one page of each of those roles may be published
-- at a time. That is the real guard (two saves racing cannot both pass); the API maps its violation to a named 409.
CREATE TYPE "WebsitePageRole" AS ENUM ('INFO', 'POLICY', 'TERMS', 'PRIVACY');

CREATE TABLE "website_pages" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "slug" TEXT NOT NULL,
    "role" "WebsitePageRole" NOT NULL DEFAULT 'INFO',
    "title_vi" TEXT NOT NULL,
    "title_en" TEXT,
    "body_vi" TEXT NOT NULL,
    "body_en" TEXT,
    "seo_title_vi" TEXT,
    "seo_title_en" TEXT,
    "seo_description_vi" TEXT,
    "seo_description_en" TEXT,
    "is_published" BOOLEAN NOT NULL DEFAULT false,
    "row_version" INTEGER NOT NULL DEFAULT 1,
    "created_by_user_id" UUID NOT NULL,
    "updated_by_user_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "website_pages_pkey" PRIMARY KEY ("id"),
    -- The address of the page: lowercase letters and digits joined by single dashes.
    CONSTRAINT "website_pages_slug_format" CHECK (
      char_length("slug") BETWEEN 1 AND 80 AND "slug" ~ '^[a-z0-9]+(-[a-z0-9]+)*$'
    ),
    CONSTRAINT "website_pages_texts" CHECK (
      char_length("title_vi") BETWEEN 1 AND 120
      AND ("title_en" IS NULL OR char_length("title_en") BETWEEN 1 AND 120)
      AND char_length("body_vi") BETWEEN 1 AND 12000
      AND ("body_en" IS NULL OR char_length("body_en") BETWEEN 1 AND 12000)
      AND ("seo_title_vi" IS NULL OR char_length("seo_title_vi") BETWEEN 1 AND 70)
      AND ("seo_title_en" IS NULL OR char_length("seo_title_en") BETWEEN 1 AND 70)
      AND ("seo_description_vi" IS NULL OR char_length("seo_description_vi") BETWEEN 1 AND 200)
      AND ("seo_description_en" IS NULL OR char_length("seo_description_en") BETWEEN 1 AND 200)
    ),
    CONSTRAINT "website_pages_row_version" CHECK ("row_version" >= 1)
);

CREATE UNIQUE INDEX "website_pages_slug_key" ON "website_pages"("slug");
CREATE UNIQUE INDEX "website_pages_published_legal_key"
  ON "website_pages"("role") WHERE "is_published" AND "role" IN ('TERMS', 'PRIVACY');
CREATE INDEX "website_pages_published_idx" ON "website_pages"("is_published", "role", "title_vi");

ALTER TABLE "website_pages"
  ADD CONSTRAINT "website_pages_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id")
    REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "website_pages"
  ADD CONSTRAINT "website_pages_updated_by_user_id_fkey" FOREIGN KEY ("updated_by_user_id")
    REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
