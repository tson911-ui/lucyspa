-- Claude integration Wave A (CI-X1), migration 3 of 3: the AI settings row, the spend ledger and reservations, the rewrite runs and items, and
-- the Lucy-owned text of a product (design `docs/PHASE_CLAUDE_INTEGRATION.md` sections 4.2, 4.6 and 5.4; Owner answers of 2026-10-12).
--
-- Additive: new tables (one settings row, everything else empty) and nullable or defaulted columns on `products`. Nothing is switched on:
-- `ai_settings.enabled` and every feature flag start false, no key is stored anywhere in the database, and nobody holds the new permissions.
--  * `ai_settings`: the Owner's switches, caps (VND), the VND per USD rate he types (NULL = not typed yet, runs refuse to start), the model, the
--    effort, the refusal fallback, the "chính hãng" switch (default OFF, Owner answer to OQ-CI-8), the forbidden phrases, and the "run the rest"
--    unlock the Owner presses after reviewing the first 3 products.
--  * `ai_usage_ledger`: one row per paid call, including failed and refused ones; append-only (database refuses UPDATE and DELETE).
--  * `ai_reservations`: the amount a call may cost, held before the call so a cap is never crossed by more than one call in flight.
--  * `ai_runs` / `ai_items`: the draft engine; one OPEN item per target at most.
--  * `products`: `content_origin` (who wrote the text), the SEO title/description and the four description sections, and a database guard that
--    stops a supplier rescan or the Excel/CSV import from overwriting the text of a product Lucy has rewritten or edited.

-- ------------------------------------------------------------------------------------------------------------------------- settings
CREATE TABLE "ai_settings" (
    "id" SMALLINT NOT NULL DEFAULT 1,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "rewrite_enabled" BOOLEAN NOT NULL DEFAULT false,
    "monthly_cap_vnd" BIGINT NOT NULL DEFAULT 3000000,
    "feature_caps_vnd" JSONB NOT NULL DEFAULT '{"PRODUCT_REWRITE":2000000,"SEO":300000,"ASSISTANT":300000,"BRIEF":200000}',
    "vnd_per_usd" INTEGER,
    "rewrite_model" TEXT NOT NULL DEFAULT 'claude-opus-5-5',
    "rewrite_effort" TEXT NOT NULL DEFAULT 'medium',
    "concurrency" SMALLINT NOT NULL DEFAULT 2,
    "refusal_fallback" BOOLEAN NOT NULL DEFAULT true,
    "allow_authenticity_claims" BOOLEAN NOT NULL DEFAULT false,
    "banned_phrases" JSONB NOT NULL DEFAULT '[]',
    "run_all_unlocked_at" TIMESTAMPTZ(3),
    "run_all_unlocked_by_user_id" UUID,
    "check_requested_at" TIMESTAMPTZ(3),
    "last_check_at" TIMESTAMPTZ(3),
    "last_check_status" TEXT,
    "row_version" INTEGER NOT NULL DEFAULT 1,
    "updated_by_user_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT clock_timestamp(),
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT "ai_settings_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "ai_settings_single" CHECK ("id" = 1),
    CONSTRAINT "ai_settings_caps" CHECK ("monthly_cap_vnd" BETWEEN 0 AND 1000000000000 AND jsonb_typeof("feature_caps_vnd") = 'object'),
    CONSTRAINT "ai_settings_rate" CHECK ("vnd_per_usd" IS NULL OR "vnd_per_usd" BETWEEN 1000 AND 1000000),
    CONSTRAINT "ai_settings_model" CHECK ("rewrite_model" IN ('claude-opus-5-5', 'claude-sonnet-5-5', 'claude-haiku-5-5')),
    CONSTRAINT "ai_settings_effort" CHECK ("rewrite_effort" IN ('low', 'medium', 'high', 'xhigh', 'max')),
    CONSTRAINT "ai_settings_concurrency" CHECK ("concurrency" BETWEEN 1 AND 4),
    CONSTRAINT "ai_settings_phrases" CHECK (jsonb_typeof("banned_phrases") = 'array'),
    CONSTRAINT "ai_settings_unlock_pair" CHECK (("run_all_unlocked_at" IS NULL) = ("run_all_unlocked_by_user_id" IS NULL)),
    CONSTRAINT "ai_settings_check_status" CHECK ("last_check_status" IS NULL OR "last_check_status" IN
      ('OK', 'KEY_MISSING', 'AUTH_FAILED', 'UNREACHABLE', 'LIMIT_REACHED', 'ERROR')),
    CONSTRAINT "ai_settings_version" CHECK ("row_version" >= 1)
);
INSERT INTO "ai_settings" ("id") VALUES (1);
ALTER TABLE "ai_settings" ADD CONSTRAINT "ai_settings_unlock_user_fkey" FOREIGN KEY ("run_all_unlocked_by_user_id")
  REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "ai_settings" ADD CONSTRAINT "ai_settings_updated_by_fkey" FOREIGN KEY ("updated_by_user_id")
  REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
CREATE TRIGGER lucy_ai_settings_guard BEFORE UPDATE ON "ai_settings"
  FOR EACH ROW EXECUTE FUNCTION lucy_guard_versioned_row();
-- The settings row is never deleted or duplicated.
CREATE FUNCTION lucy_guard_ai_settings_delete() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'The AI settings row is never deleted';
END;
$$;
CREATE TRIGGER lucy_ai_settings_no_delete BEFORE DELETE ON "ai_settings"
  FOR EACH ROW EXECUTE FUNCTION lucy_guard_ai_settings_delete();

-- ------------------------------------------------------------------------------------------------------------------------- runs
CREATE TABLE "ai_runs" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "kind" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'QUEUED',
    "model" TEXT NOT NULL,
    "effort" TEXT NOT NULL,
    "prompt_version" TEXT NOT NULL,
    "estimated_cost_micro_usd" BIGINT NOT NULL DEFAULT 0,
    "pause_reason" TEXT,
    "started_by_user_id" UUID NOT NULL,
    "started_at" TIMESTAMPTZ(3),
    "finished_at" TIMESTAMPTZ(3),
    "row_version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT clock_timestamp(),
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT "ai_runs_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "ai_runs_kind" CHECK ("kind" IN ('PRODUCT_TEXT')),
    CONSTRAINT "ai_runs_scope" CHECK ("scope" IN ('FIRST_THREE', 'SELECTION', 'ALL_PENDING')),
    CONSTRAINT "ai_runs_status" CHECK ("status" IN ('QUEUED', 'RUNNING', 'PAUSED_CAP', 'PAUSED_USER', 'PAUSED_ERROR', 'DONE', 'CANCELLED')),
    CONSTRAINT "ai_runs_effort" CHECK ("effort" IN ('low', 'medium', 'high', 'xhigh', 'max')),
    CONSTRAINT "ai_runs_estimate" CHECK ("estimated_cost_micro_usd" >= 0),
    CONSTRAINT "ai_runs_version" CHECK ("row_version" >= 1)
);
CREATE INDEX "ai_runs_status_idx" ON "ai_runs"("status", "created_at");
ALTER TABLE "ai_runs" ADD CONSTRAINT "ai_runs_started_by_fkey" FOREIGN KEY ("started_by_user_id")
  REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
CREATE TRIGGER lucy_ai_runs_guard BEFORE UPDATE ON "ai_runs"
  FOR EACH ROW EXECUTE FUNCTION lucy_guard_versioned_row();

-- ------------------------------------------------------------------------------------------------------------------------- items
CREATE TABLE "ai_items" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "run_id" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "target_type" TEXT NOT NULL,
    "target_id" UUID NOT NULL,
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
    "input_tokens" INTEGER NOT NULL DEFAULT 0,
    "cache_read_tokens" INTEGER NOT NULL DEFAULT 0,
    "cache_write_tokens" INTEGER NOT NULL DEFAULT 0,
    "output_tokens" INTEGER NOT NULL DEFAULT 0,
    "cost_micro_usd" BIGINT NOT NULL DEFAULT 0,
    "viewed_by_user_id" UUID,
    "viewed_at" TIMESTAMPTZ(3),
    "reviewed_by_user_id" UUID,
    "reviewed_at" TIMESTAMPTZ(3),
    "applied_by_user_id" UUID,
    "applied_at" TIMESTAMPTZ(3),
    "row_version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT clock_timestamp(),
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT "ai_items_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "ai_items_kind" CHECK ("kind" IN ('PRODUCT_TEXT')),
    CONSTRAINT "ai_items_target_type" CHECK ("target_type" IN ('PRODUCT')),
    CONSTRAINT "ai_items_status" CHECK ("status" IN
      ('QUEUED', 'GENERATING', 'DRAFT_READY', 'NEEDS_ATTENTION', 'FAILED', 'APPLIED', 'REJECTED', 'STALE')),
    CONSTRAINT "ai_items_json" CHECK (jsonb_typeof("base_snapshot") = 'object' AND jsonb_typeof("warnings") = 'array'),
    CONSTRAINT "ai_items_counts" CHECK ("attempts" >= 0 AND "regenerations" BETWEEN 0 AND 3 AND "input_tokens" >= 0
      AND "cache_read_tokens" >= 0 AND "cache_write_tokens" >= 0 AND "output_tokens" >= 0 AND "cost_micro_usd" >= 0),
    CONSTRAINT "ai_items_applied_pair" CHECK (("applied_at" IS NULL) = ("applied_by_user_id" IS NULL)),
    CONSTRAINT "ai_items_applied_status" CHECK (("status" = 'APPLIED') = ("applied_at" IS NOT NULL)),
    CONSTRAINT "ai_items_viewed_pair" CHECK (("viewed_at" IS NULL) = ("viewed_by_user_id" IS NULL)),
    CONSTRAINT "ai_items_reviewed_pair" CHECK (("reviewed_at" IS NULL) = ("reviewed_by_user_id" IS NULL)),
    CONSTRAINT "ai_items_version" CHECK ("row_version" >= 1)
);
-- At most one open (not applied, not rejected) item per target and kind: a product is never in two reviews at once.
CREATE UNIQUE INDEX "ai_items_open_target_key" ON "ai_items"("kind", "target_id") WHERE "status" NOT IN ('APPLIED', 'REJECTED');
CREATE INDEX "ai_items_run_idx" ON "ai_items"("run_id", "status");
CREATE INDEX "ai_items_queue_idx" ON "ai_items"("status", "locked_until");
CREATE INDEX "ai_items_target_idx" ON "ai_items"("target_id");
ALTER TABLE "ai_items" ADD CONSTRAINT "ai_items_run_fkey" FOREIGN KEY ("run_id")
  REFERENCES "ai_runs"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "ai_items" ADD CONSTRAINT "ai_items_viewed_by_fkey" FOREIGN KEY ("viewed_by_user_id")
  REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "ai_items" ADD CONSTRAINT "ai_items_reviewed_by_fkey" FOREIGN KEY ("reviewed_by_user_id")
  REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "ai_items" ADD CONSTRAINT "ai_items_applied_by_fkey" FOREIGN KEY ("applied_by_user_id")
  REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
CREATE TRIGGER lucy_ai_items_guard BEFORE UPDATE ON "ai_items"
  FOR EACH ROW EXECUTE FUNCTION lucy_guard_versioned_row();
-- An applied or rejected item is history: its decision is never undone and the item is never deleted.
CREATE FUNCTION lucy_guard_ai_item() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'An AI draft is history: it is never deleted';
  END IF;
  IF OLD.status IN ('APPLIED', 'REJECTED') AND NEW.status IS DISTINCT FROM OLD.status THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'An applied or rejected AI draft is never reopened';
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$;
CREATE TRIGGER lucy_ai_items_history BEFORE UPDATE OR DELETE ON "ai_items"
  FOR EACH ROW EXECUTE FUNCTION lucy_guard_ai_item();

-- ------------------------------------------------------------------------------------------------------------------------- ledger
CREATE TABLE "ai_usage_ledger" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "feature" TEXT NOT NULL,
    "run_id" UUID,
    "item_id" UUID,
    "provider" TEXT NOT NULL DEFAULT 'ANTHROPIC',
    "model" TEXT NOT NULL,
    "outcome" TEXT NOT NULL,
    "input_tokens" INTEGER NOT NULL DEFAULT 0,
    "cache_read_tokens" INTEGER NOT NULL DEFAULT 0,
    "cache_write_tokens" INTEGER NOT NULL DEFAULT 0,
    "output_tokens" INTEGER NOT NULL DEFAULT 0,
    "cost_micro_usd" BIGINT NOT NULL DEFAULT 0,
    "request_id" TEXT,
    "occurred_at" TIMESTAMPTZ(3) NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT "ai_usage_ledger_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "ai_usage_ledger_feature" CHECK ("feature" IN ('PRODUCT_REWRITE', 'SEO', 'ASSISTANT', 'BRIEF', 'SUGGESTIONS', 'CHECK')),
    CONSTRAINT "ai_usage_ledger_provider" CHECK ("provider" IN ('ANTHROPIC')),
    CONSTRAINT "ai_usage_ledger_outcome" CHECK ("outcome" IN ('SUCCEEDED', 'REFUSED', 'FAILED')),
    CONSTRAINT "ai_usage_ledger_counts" CHECK ("input_tokens" >= 0 AND "cache_read_tokens" >= 0 AND "cache_write_tokens" >= 0
      AND "output_tokens" >= 0 AND "cost_micro_usd" >= 0)
);
CREATE INDEX "ai_usage_ledger_time_idx" ON "ai_usage_ledger"("occurred_at", "id");
CREATE INDEX "ai_usage_ledger_feature_idx" ON "ai_usage_ledger"("feature", "occurred_at");
CREATE INDEX "ai_usage_ledger_item_idx" ON "ai_usage_ledger"("item_id") WHERE "item_id" IS NOT NULL;
CREATE FUNCTION lucy_guard_ai_ledger() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'The AI usage ledger is append-only';
END;
$$;
CREATE TRIGGER lucy_ai_ledger_append_only BEFORE UPDATE OR DELETE ON "ai_usage_ledger"
  FOR EACH ROW EXECUTE FUNCTION lucy_guard_ai_ledger();

-- ------------------------------------------------------------------------------------------------------------------------- reservations
-- The most a call may cost, held before the call and released in the same transaction that writes the ledger row. A row left behind by a
-- crash stops counting when it expires.
CREATE TABLE "ai_reservations" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "feature" TEXT NOT NULL,
    "item_id" UUID,
    "amount_micro_usd" BIGINT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT clock_timestamp(),
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "ai_reservations_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "ai_reservations_feature" CHECK ("feature" IN ('PRODUCT_REWRITE', 'SEO', 'ASSISTANT', 'BRIEF', 'SUGGESTIONS', 'CHECK')),
    CONSTRAINT "ai_reservations_amount" CHECK ("amount_micro_usd" > 0),
    CONSTRAINT "ai_reservations_expiry" CHECK ("expires_at" > "created_at")
);
CREATE INDEX "ai_reservations_open_idx" ON "ai_reservations"("expires_at");

-- ------------------------------------------------------------------------------------------------------------------------- products
-- Who wrote the text of a product: the supplier (copied at import), Lucy's AI (an approved draft), or a person. Everything that is not the
-- supplier's copy is Lucy-owned text and is locked against supplier rescans and the Excel/CSV import (Owner answer to OQ-CI-5).
ALTER TABLE "products"
  ADD COLUMN "content_origin" TEXT NOT NULL DEFAULT 'LUCY_MANUAL',
  ADD COLUMN "content_origin_at" TIMESTAMPTZ(3),
  ADD COLUMN "seo_title_vi" TEXT,
  ADD COLUMN "seo_title_en" TEXT,
  ADD COLUMN "seo_description_vi" TEXT,
  ADD COLUMN "seo_description_en" TEXT,
  ADD COLUMN "description_sections_vi" JSONB,
  ADD COLUMN "description_sections_en" JSONB,
  ADD CONSTRAINT "products_content_origin" CHECK ("content_origin" IN ('SUPPLIER_COPY', 'LUCY_AI', 'LUCY_MANUAL')),
  ADD CONSTRAINT "products_seo_text" CHECK (
    ("seo_title_vi" IS NULL OR char_length("seo_title_vi") BETWEEN 1 AND 200)
    AND ("seo_title_en" IS NULL OR char_length("seo_title_en") BETWEEN 1 AND 200)
    AND ("seo_description_vi" IS NULL OR char_length("seo_description_vi") BETWEEN 1 AND 400)
    AND ("seo_description_en" IS NULL OR char_length("seo_description_en") BETWEEN 1 AND 400)),
  ADD CONSTRAINT "products_sections_json" CHECK (
    ("description_sections_vi" IS NULL OR jsonb_typeof("description_sections_vi") = 'object')
    AND ("description_sections_en" IS NULL OR jsonb_typeof("description_sections_en") = 'object'));

-- Backfill: the 348 imported Haruohui products (their provenance names a supplier) are the supplier's copy; every other product keeps the default.
-- The generic row guard needs the row version advanced by one on every update.
UPDATE "products" SET "content_origin" = 'SUPPLIER_COPY', "row_version" = "row_version" + 1
 WHERE "source" IS NOT NULL AND "source" ->> 'supplierId' IS NOT NULL;

-- Defence in depth for the lock: an importer declares where a text change comes from (`SET LOCAL lucy.text_change_source = 'SUPPLIER_IMPORT'`
-- or 'FILE_IMPORT'); the database then refuses to change any text field of a product whose origin is not the supplier's copy, unless the same
-- transaction also declares `lucy.text_lock_override = 'on'` (the explicit tick with a reason). A person editing a product through the catalog
-- declares nothing and is not affected.
CREATE FUNCTION lucy_guard_product_text_lock() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  source TEXT := coalesce(current_setting('lucy.text_change_source', true), '');
BEGIN
  IF OLD.content_origin <> 'SUPPLIER_COPY'
     AND source IN ('SUPPLIER_IMPORT', 'FILE_IMPORT')
     AND coalesce(current_setting('lucy.text_lock_override', true), '') <> 'on'
     AND (NEW.name_vi IS DISTINCT FROM OLD.name_vi
       OR NEW.name_en IS DISTINCT FROM OLD.name_en
       OR NEW.description_vi IS DISTINCT FROM OLD.description_vi
       OR NEW.description_en IS DISTINCT FROM OLD.description_en
       OR NEW.seo_title_vi IS DISTINCT FROM OLD.seo_title_vi
       OR NEW.seo_title_en IS DISTINCT FROM OLD.seo_title_en
       OR NEW.seo_description_vi IS DISTINCT FROM OLD.seo_description_vi
       OR NEW.seo_description_en IS DISTINCT FROM OLD.seo_description_en
       OR NEW.description_sections_vi IS DISTINCT FROM OLD.description_sections_vi
       OR NEW.description_sections_en IS DISTINCT FROM OLD.description_sections_en) THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'The text of a product Lucy has written is not overwritten by an import';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER lucy_products_text_lock BEFORE UPDATE ON "products"
  FOR EACH ROW EXECUTE FUNCTION lucy_guard_product_text_lock();
