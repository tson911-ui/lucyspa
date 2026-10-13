-- Claude integration Wave C (CI-S1, design section 7.1): the log of the report assistant's questions. One row per question asked by a
-- holder of USE_AI_ASSISTANT: who, the status, the tools called (names and arguments, no results), the cost, and the question and the
-- answer as text. The text is kept 30 days (OQ-CI-9) and then cleared by the worker (`purged_at`); the row itself stays as the record
-- of who asked and what it cost. Insert-only apart from that clearing.
CREATE TABLE "ai_assistant_questions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "status" TEXT NOT NULL,
    "question" TEXT,
    "answer" TEXT,
    "tools" JSONB NOT NULL DEFAULT '[]',
    "model" TEXT NOT NULL,
    "requests" INTEGER NOT NULL DEFAULT 0,
    "cost_micro_usd" BIGINT NOT NULL DEFAULT 0,
    "error_code" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT clock_timestamp(),
    "purged_at" TIMESTAMPTZ(3),
    CONSTRAINT "ai_assistant_questions_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "ai_assistant_questions_status" CHECK ("status" IN ('ANSWERED', 'UNSURE', 'REFUSED', 'FAILED')),
    CONSTRAINT "ai_assistant_questions_text" CHECK (char_length("question") <= 600 AND char_length("answer") <= 4000),
    CONSTRAINT "ai_assistant_questions_counts" CHECK ("requests" >= 0 AND "cost_micro_usd" >= 0),
    CONSTRAINT "ai_assistant_questions_purge" CHECK (("purged_at" IS NULL) = ("question" IS NOT NULL) AND ("purged_at" IS NULL OR "answer" IS NULL))
);
ALTER TABLE "ai_assistant_questions" ADD CONSTRAINT "ai_assistant_questions_user_fkey" FOREIGN KEY ("user_id")
  REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX "ai_assistant_questions_user_idx" ON "ai_assistant_questions"("user_id", "created_at");
CREATE INDEX "ai_assistant_questions_text_idx" ON "ai_assistant_questions"("created_at") WHERE "purged_at" IS NULL;

CREATE FUNCTION lucy_guard_ai_assistant_question() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'An assistant question is never deleted';
  END IF;
  -- The only change allowed: the text is cleared once, everything else stays.
  IF OLD.purged_at IS NOT NULL OR NEW.purged_at IS NULL
     OR NEW.id IS DISTINCT FROM OLD.id OR NEW.user_id IS DISTINCT FROM OLD.user_id
     OR NEW.status IS DISTINCT FROM OLD.status OR NEW.tools IS DISTINCT FROM OLD.tools
     OR NEW.model IS DISTINCT FROM OLD.model OR NEW.requests IS DISTINCT FROM OLD.requests
     OR NEW.cost_micro_usd IS DISTINCT FROM OLD.cost_micro_usd OR NEW.error_code IS DISTINCT FROM OLD.error_code
     OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'An assistant question can only have its text cleared';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER lucy_ai_assistant_question_guard BEFORE UPDATE OR DELETE ON "ai_assistant_questions"
  FOR EACH ROW EXECUTE FUNCTION lucy_guard_ai_assistant_question();

-- The Phase 1 convention (fixed search_path, no PUBLIC execute) for the function this migration creates.
DO $$
DECLARE
  migration_schema text := current_schema();
BEGIN
  EXECUTE format('ALTER FUNCTION %I.lucy_guard_ai_assistant_question() SET search_path TO pg_catalog, %I, pg_temp', migration_schema, migration_schema);
  EXECUTE format('REVOKE ALL ON FUNCTION %I.lucy_guard_ai_assistant_question() FROM PUBLIC', migration_schema);
END;
$$;
