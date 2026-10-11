-- Phase 7 P7-8 (pay configuration; design `PHASE7_PAYROLL_FUNDS.md` sections 4.2, 8: P7-T1, P7-T2, P7-T5, P7-T6; approved by the Owner on 2026-10-11).
--
-- Additive: three new tables, all empty ("rules ship empty"): employee_salary_versions, tour_rules, commission_rules. No existing table is
-- altered and no existing row is written. In particular NO salary version is created from `employee_profiles.base_salary_vnd`: the Owner
-- enters the first version himself (the "safer option" rule), and until he does the payroll draft shows the current base salary as
-- unconfirmed. All three tables are history: a rule or a salary is never edited or deleted; a change is a NEW row with a later
-- `effective_from`, and the row in force on a date is the latest one with `effective_from <= date`. A value of 0 is an explicit "pays
-- nothing" (it stops a rule from falling back to a broader one); a salary amount of NULL says "no salary from that date".

CREATE TYPE "CommissionScope" AS ENUM ('SHOP', 'BRAND', 'CATEGORY', 'PRODUCT');
CREATE TYPE "CommissionKind" AS ENUM ('PERCENT', 'FIXED_PER_UNIT');

-- ------------------------------------------------------------------------------------------------- salary versions
CREATE TABLE "employee_salary_versions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "employee_user_id" UUID NOT NULL,
    "amount_vnd" BIGINT,
    "effective_from" DATE NOT NULL,
    "reason" TEXT,
    "recorded_by_user_id" UUID NOT NULL,
    "recorded_at" TIMESTAMPTZ(3) NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT "employee_salary_versions_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "employee_salary_versions_amount" CHECK ("amount_vnd" IS NULL OR ("amount_vnd" >= 0 AND "amount_vnd" <= 10000000000))
);
CREATE UNIQUE INDEX "employee_salary_versions_date_key" ON "employee_salary_versions"("employee_user_id", "effective_from");
CREATE INDEX "employee_salary_versions_recorder_idx" ON "employee_salary_versions"("recorded_by_user_id");
ALTER TABLE "employee_salary_versions" ADD CONSTRAINT "employee_salary_versions_employee_fkey" FOREIGN KEY ("employee_user_id")
  REFERENCES "employee_profiles"("user_id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "employee_salary_versions" ADD CONSTRAINT "employee_salary_versions_recorder_fkey" FOREIGN KEY ("recorded_by_user_id")
  REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
CREATE TRIGGER lucy_employee_salary_versions_append_only BEFORE UPDATE OR DELETE ON "employee_salary_versions"
  FOR EACH ROW EXECUTE FUNCTION lucy_refuse_change();

-- ------------------------------------------------------------------------------------------------------ tour rules
-- PRD 33: a fixed amount per eligible paid service, effective-dated. No percentage of the price exists.
CREATE TABLE "tour_rules" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "service_id" UUID NOT NULL,
    "amount_vnd" BIGINT NOT NULL,
    "effective_from" DATE NOT NULL,
    "reason" TEXT,
    "created_by_user_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT "tour_rules_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "tour_rules_amount" CHECK ("amount_vnd" >= 0 AND "amount_vnd" <= 10000000000)
);
CREATE UNIQUE INDEX "tour_rules_date_key" ON "tour_rules"("service_id", "effective_from");
CREATE INDEX "tour_rules_creator_idx" ON "tour_rules"("created_by_user_id");
ALTER TABLE "tour_rules" ADD CONSTRAINT "tour_rules_service_fkey" FOREIGN KEY ("service_id")
  REFERENCES "services"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "tour_rules" ADD CONSTRAINT "tour_rules_creator_fkey" FOREIGN KEY ("created_by_user_id")
  REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
CREATE TRIGGER lucy_tour_rules_append_only BEFORE UPDATE OR DELETE ON "tour_rules"
  FOR EACH ROW EXECUTE FUNCTION lucy_refuse_change();

-- ------------------------------------------------------------------------------------------------ commission rules
-- PRD 26: a percentage (basis points of the line net) or a fixed amount per unit, by shop default, brand, category or product, and
-- optionally for one employee. The most specific rule in force wins (resolution lives in the engine); `value` is basis points for
-- PERCENT (0..10000) and whole dong per unit for FIXED_PER_UNIT.
CREATE TABLE "commission_rules" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "scope" "CommissionScope" NOT NULL,
    "brand_id" UUID,
    "category_id" UUID,
    "product_id" UUID,
    "employee_user_id" UUID,
    "kind" "CommissionKind" NOT NULL,
    "value" BIGINT NOT NULL,
    "effective_from" DATE NOT NULL,
    "reason" TEXT,
    "created_by_user_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT "commission_rules_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "commission_rules_scope_shape" CHECK (
      ("scope" = 'SHOP' AND "brand_id" IS NULL AND "category_id" IS NULL AND "product_id" IS NULL)
      OR ("scope" = 'BRAND' AND "brand_id" IS NOT NULL AND "category_id" IS NULL AND "product_id" IS NULL)
      OR ("scope" = 'CATEGORY' AND "category_id" IS NOT NULL AND "brand_id" IS NULL AND "product_id" IS NULL)
      OR ("scope" = 'PRODUCT' AND "product_id" IS NOT NULL AND "brand_id" IS NULL AND "category_id" IS NULL)),
    CONSTRAINT "commission_rules_value" CHECK (
      ("kind" = 'PERCENT' AND "value" BETWEEN 0 AND 10000)
      OR ("kind" = 'FIXED_PER_UNIT' AND "value" BETWEEN 0 AND 10000000000))
);
CREATE UNIQUE INDEX "commission_rules_scope_date_key" ON "commission_rules"(
  "scope",
  COALESCE("brand_id", '00000000-0000-0000-0000-000000000000'::uuid),
  COALESCE("category_id", '00000000-0000-0000-0000-000000000000'::uuid),
  COALESCE("product_id", '00000000-0000-0000-0000-000000000000'::uuid),
  COALESCE("employee_user_id", '00000000-0000-0000-0000-000000000000'::uuid),
  "effective_from");
CREATE INDEX "commission_rules_lookup_idx" ON "commission_rules"("scope", "effective_from");
CREATE INDEX "commission_rules_creator_idx" ON "commission_rules"("created_by_user_id");
ALTER TABLE "commission_rules" ADD CONSTRAINT "commission_rules_brand_fkey" FOREIGN KEY ("brand_id")
  REFERENCES "brands"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "commission_rules" ADD CONSTRAINT "commission_rules_category_fkey" FOREIGN KEY ("category_id")
  REFERENCES "product_categories"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "commission_rules" ADD CONSTRAINT "commission_rules_product_fkey" FOREIGN KEY ("product_id")
  REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "commission_rules" ADD CONSTRAINT "commission_rules_employee_fkey" FOREIGN KEY ("employee_user_id")
  REFERENCES "employee_profiles"("user_id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "commission_rules" ADD CONSTRAINT "commission_rules_creator_fkey" FOREIGN KEY ("created_by_user_id")
  REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
CREATE TRIGGER lucy_commission_rules_append_only BEFORE UPDATE OR DELETE ON "commission_rules"
  FOR EACH ROW EXECUTE FUNCTION lucy_refuse_change();
