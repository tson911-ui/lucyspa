-- Claude integration Wave B (CI-E1, design 4.4 and 4.7; Owner message of 2026-10-13): search descriptions and English texts of the services
-- and of the home page. Two new nullable text columns on `services` and on `website_shop_info` (written only by "Áp dụng" or by hand), and
-- `ai_seo_drafts`, the drafts a person reads and applies one by one. Additive: no existing row changes, nothing reads the new columns
-- until a person applies a draft, the public pages fall back to what they show today while a column is empty.

ALTER TABLE "services"
  ADD COLUMN "seo_description_vi" TEXT,
  ADD COLUMN "seo_description_en" TEXT,
  ADD CONSTRAINT "services_seo_description_length" CHECK (
    ("seo_description_vi" IS NULL OR char_length("seo_description_vi") <= 300)
    AND ("seo_description_en" IS NULL OR char_length("seo_description_en") <= 300));

ALTER TABLE "website_shop_info"
  ADD COLUMN "seo_description_vi" TEXT,
  ADD COLUMN "seo_description_en" TEXT,
  ADD CONSTRAINT "website_shop_info_seo_description_length" CHECK (
    ("seo_description_vi" IS NULL OR char_length("seo_description_vi") <= 300)
    AND ("seo_description_en" IS NULL OR char_length("seo_description_en") <= 300));

CREATE TABLE "ai_seo_drafts" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "kind" TEXT NOT NULL,
    -- A service id, or `shop` for the home page (the shop profile row's own key).
    "target_id" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'QUEUED',
    "attempts" SMALLINT NOT NULL DEFAULT 0,
    "locked_until" TIMESTAMPTZ(3),
    "base_row_version" INTEGER NOT NULL,
    "base_snapshot" JSONB NOT NULL DEFAULT '{}',
    "draft" JSONB,
    "edited" JSONB,
    "warnings" JSONB NOT NULL DEFAULT '[]',
    "error_code" TEXT,
    "instruction" TEXT,
    "regenerations" SMALLINT NOT NULL DEFAULT 0,
    "model" TEXT NOT NULL,
    "effort" TEXT NOT NULL,
    "input_tokens" INTEGER NOT NULL DEFAULT 0,
    "cache_read_tokens" INTEGER NOT NULL DEFAULT 0,
    "cache_write_tokens" INTEGER NOT NULL DEFAULT 0,
    "output_tokens" INTEGER NOT NULL DEFAULT 0,
    "cost_micro_usd" BIGINT NOT NULL DEFAULT 0,
    "requested_by_user_id" UUID NOT NULL,
    "reviewed_by_user_id" UUID,
    "reviewed_at" TIMESTAMPTZ(3),
    "applied_by_user_id" UUID,
    "applied_at" TIMESTAMPTZ(3),
    "row_version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT clock_timestamp(),
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT "ai_seo_drafts_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "ai_seo_drafts_kind" CHECK ("kind" IN ('SERVICE', 'SHOP')),
    CONSTRAINT "ai_seo_drafts_target" CHECK (("kind" = 'SHOP') = ("target_id" = 'shop')),
    CONSTRAINT "ai_seo_drafts_status" CHECK ("status" IN
      ('QUEUED', 'GENERATING', 'DRAFT_READY', 'NEEDS_ATTENTION', 'FAILED', 'APPLIED', 'REJECTED', 'STALE')),
    CONSTRAINT "ai_seo_drafts_effort" CHECK ("effort" IN ('low', 'medium', 'high', 'xhigh', 'max')),
    CONSTRAINT "ai_seo_drafts_json" CHECK (jsonb_typeof("base_snapshot") = 'object' AND jsonb_typeof("warnings") = 'array'),
    CONSTRAINT "ai_seo_drafts_counts" CHECK ("attempts" >= 0 AND "regenerations" BETWEEN 0 AND 3 AND "input_tokens" >= 0
      AND "cache_read_tokens" >= 0 AND "cache_write_tokens" >= 0 AND "output_tokens" >= 0 AND "cost_micro_usd" >= 0),
    CONSTRAINT "ai_seo_drafts_applied" CHECK (("status" = 'APPLIED') = ("applied_at" IS NOT NULL)
      AND ("applied_at" IS NULL) = ("applied_by_user_id" IS NULL)),
    CONSTRAINT "ai_seo_drafts_reviewed" CHECK (("reviewed_at" IS NULL) = ("reviewed_by_user_id" IS NULL)),
    CONSTRAINT "ai_seo_drafts_version" CHECK ("row_version" >= 1)
);
-- One open draft per target (a new one waits until the open one is applied or rejected).
CREATE UNIQUE INDEX "ai_seo_drafts_open_target_key" ON "ai_seo_drafts"("kind", "target_id") WHERE "status" NOT IN ('APPLIED', 'REJECTED');
CREATE INDEX "ai_seo_drafts_queue_idx" ON "ai_seo_drafts"("status", "locked_until");
CREATE INDEX "ai_seo_drafts_list_idx" ON "ai_seo_drafts"("status", "updated_at" DESC);
ALTER TABLE "ai_seo_drafts" ADD CONSTRAINT "ai_seo_drafts_requested_by_fkey" FOREIGN KEY ("requested_by_user_id")
  REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "ai_seo_drafts" ADD CONSTRAINT "ai_seo_drafts_reviewed_by_fkey" FOREIGN KEY ("reviewed_by_user_id")
  REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "ai_seo_drafts" ADD CONSTRAINT "ai_seo_drafts_applied_by_fkey" FOREIGN KEY ("applied_by_user_id")
  REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
CREATE TRIGGER lucy_ai_seo_drafts_guard BEFORE UPDATE ON "ai_seo_drafts"
  FOR EACH ROW EXECUTE FUNCTION lucy_guard_versioned_row();
-- An applied or rejected draft is history: its decision is never undone and the row is never deleted.
CREATE FUNCTION lucy_guard_ai_seo_draft() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'An AI draft is history: it is never deleted';
  END IF;
  IF OLD.status IN ('APPLIED', 'REJECTED') AND NEW.status IS DISTINCT FROM OLD.status THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'An applied or rejected AI draft is never reopened';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER lucy_ai_seo_drafts_history BEFORE UPDATE OR DELETE ON "ai_seo_drafts"
  FOR EACH ROW EXECUTE FUNCTION lucy_guard_ai_seo_draft();

-- The Phase 1 convention (fixed search_path, no PUBLIC execute) for the function this migration creates.
DO $$
DECLARE
  migration_schema text := current_schema();
BEGIN
  EXECUTE format('ALTER FUNCTION %I.lucy_guard_ai_seo_draft() SET search_path TO pg_catalog, %I, pg_temp', migration_schema, migration_schema);
  EXECUTE format('REVOKE ALL ON FUNCTION %I.lucy_guard_ai_seo_draft() FROM PUBLIC', migration_schema);
END;
$$;
