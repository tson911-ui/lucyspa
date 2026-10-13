-- Claude integration Wave B (approve all): a third way a draft can be applied. "Duyệt tất cả" (Owner, 2026-10-13) applies every ready product
-- draft that has zero warnings after one preview and one confirm; the item records `ALL` next to `SINGLE` (one reviewer, one draft) and `PAGE`.
-- Additive: only the allowed values of the check widen; no row changes.
ALTER TABLE "ai_items" DROP CONSTRAINT "ai_items_applied_via";
ALTER TABLE "ai_items"
  ADD CONSTRAINT "ai_items_applied_via" CHECK (
    ("applied_via" IS NULL) = ("applied_at" IS NULL)
    AND ("applied_via" IS NULL OR "applied_via" IN ('SINGLE', 'PAGE', 'ALL')));
