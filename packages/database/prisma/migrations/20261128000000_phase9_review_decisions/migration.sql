-- Phase 9 P9-6: the decisions a reviewer makes about a candidate that must be remembered (docs/PHASE9_PRODUCT_IMPORT.md sections 8 and 9).
-- A picture the same file or a near-identical copy of which sits on another product needs an explicit "keep for this product" or
-- "drop" before the candidate can be approved; "keep separate" says two products that look like duplicates are not. Without a record
-- the next scan or evaluation would raise the same warning again. Append-only history (the latest row for a picture or a reference
-- wins). Additive: one enum, one table.

CREATE TYPE "ReviewDecisionKind" AS ENUM ('IMAGE_KEEP', 'IMAGE_DROP', 'DUPLICATE_KEEP_SEPARATE');

CREATE TABLE "candidate_review_decisions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    -- Strictly increasing: "the latest decision" never depends on a timestamp tie.
    "seq" BIGSERIAL NOT NULL,
    "candidate_id" UUID NOT NULL,
    "kind" "ReviewDecisionKind" NOT NULL,
    "image_id" UUID,
    -- The product or candidate the duplicate suspicion named: PRODUCT:<uuid> or CANDIDATE:<uuid>.
    "ref" VARCHAR(80),
    "decided_by_user_id" UUID NOT NULL,
    "decided_at" TIMESTAMPTZ(3) NOT NULL DEFAULT clock_timestamp(),
    "note" VARCHAR(500),

    CONSTRAINT "candidate_review_decisions_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "candidate_review_decisions_image" CHECK (("kind" IN ('IMAGE_KEEP', 'IMAGE_DROP')) = ("image_id" IS NOT NULL)),
    CONSTRAINT "candidate_review_decisions_ref" CHECK (
      ("kind" = 'DUPLICATE_KEEP_SEPARATE') = ("ref" IS NOT NULL)
      AND ("ref" IS NULL OR "ref" ~ '^(PRODUCT|CANDIDATE):[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$')
    )
);
CREATE INDEX "candidate_review_decisions_candidate_idx" ON "candidate_review_decisions"("candidate_id", "seq" DESC);
CREATE INDEX "candidate_review_decisions_image_idx" ON "candidate_review_decisions"("image_id") WHERE "image_id" IS NOT NULL;
ALTER TABLE "candidate_review_decisions" ADD CONSTRAINT "candidate_review_decisions_candidate_id_fkey" FOREIGN KEY ("candidate_id")
  REFERENCES "import_candidates"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "candidate_review_decisions" ADD CONSTRAINT "candidate_review_decisions_image_id_fkey" FOREIGN KEY ("image_id")
  REFERENCES "candidate_images"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "candidate_review_decisions" ADD CONSTRAINT "candidate_review_decisions_decided_by_user_id_fkey" FOREIGN KEY ("decided_by_user_id")
  REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- A decision about a picture is about a picture of THAT candidate.
CREATE FUNCTION lucy_guard_candidate_review_decision() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.image_id IS NOT NULL AND NOT EXISTS (
       SELECT 1 FROM candidate_images WHERE id = NEW.image_id AND candidate_id = NEW.candidate_id) THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'A picture decision names a picture of another candidate';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER lucy_candidate_review_decisions_guard BEFORE INSERT ON "candidate_review_decisions"
  FOR EACH ROW EXECUTE FUNCTION lucy_guard_candidate_review_decision();
CREATE TRIGGER lucy_candidate_review_decisions_append_only BEFORE UPDATE OR DELETE ON "candidate_review_decisions"
  FOR EACH ROW EXECUTE FUNCTION lucy_refuse_change();
