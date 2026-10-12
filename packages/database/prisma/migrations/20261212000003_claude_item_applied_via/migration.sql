-- Claude integration Wave A (CI-R2): how a draft was applied. The page approval of up to 20 drafts (CI-R3) is allowed only after a person
-- has applied at least three drafts one by one (Owner answer to OQ-CI-5), so the item records `SINGLE` (one reviewer, one draft) or `PAGE`.
-- Additive: one nullable column on an empty-by-default table and a check that ties it to `applied_at`.
ALTER TABLE "ai_items"
  ADD COLUMN "applied_via" TEXT,
  ADD CONSTRAINT "ai_items_applied_via" CHECK (
    ("applied_via" IS NULL) = ("applied_at" IS NULL)
    AND ("applied_via" IS NULL OR "applied_via" IN ('SINGLE', 'PAGE')));
