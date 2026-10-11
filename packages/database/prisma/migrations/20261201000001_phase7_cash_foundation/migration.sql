-- Phase 7 P7-2 (shop funds, "so quy"), migration 2 of 2: the cash-book tables, their guards and the catalog semantics of the five
-- new permissions (design `PHASE7_PAYROLL_FUNDS.md` sections 7 and 9; P7-T8, P7-T9, P7-T12, P7-T15; approved by the Owner on 2026-10-11).
--
-- Additive: five new tables (all empty), three enums, guards on the new tables only. No existing table is altered except
-- `permissions` (its catalog semantics constraint is replaced by a wider one) and no existing row is written. Nothing is granted to
-- anyone. Nothing posts anything here: the go-live action, the posting of payments and the closing arrive with the next Steps, and
-- while `finance_go_live` is empty nothing is ever posted.
--
-- Rules the database repeats (the API checks them first):
--   * an entry of the book is immutable; a correction is a NEW entry that reverses the old one (category CORRECTION);
--   * nothing can be added to a closed day (a closed day is locked); a closing row is immutable;
--   * the fund balance after a closing equals the counted cash less the withdrawal (the next-day float);
--   * the go-live instant exists once and never moves; an opening balance never changes;
--   * a fresh password confirmation is spent once (shared with the refund confirmations).

CREATE TYPE "FundKind" AS ENUM ('CASH', 'BANK');
CREATE TYPE "FundDirection" AS ENUM ('IN', 'OUT');
CREATE TYPE "FundEntryCategory" AS ENUM (
  'SALE_CASH', 'SALE_BANK', 'PAYMENT_REVERSAL', 'PRODUCT_REFUND', 'EXCHANGE_DIFFERENCE', 'FAILED_DELIVERY_REFUND',
  'TIP_IN', 'TIP_OUT', 'SALARY_PAYOUT', 'ADVANCE', 'MANUAL_INCOME', 'MANUAL_EXPENSE', 'OWNER_WITHDRAWAL', 'DEPOSIT',
  'FUND_TRANSFER', 'COUNT_DIFFERENCE', 'CORRECTION'
);

-- --------------------------------------------------------------------------------------- catalog semantics
-- Same lists as 20261125000001_phase9_supplier_sources plus the five Phase 7 codes: MANAGE_PAY_RULES, MANAGE_PAYROLL and APPROVE_PAYROLL
-- are GLOBAL_ONLY and EMPLOYEE_PAY (the payroll run is shop-wide); VIEW_CASH and MANAGE_CASH are BRANCH_CAPABLE and FINANCIAL.
ALTER TABLE "permissions" DROP CONSTRAINT "permissions_catalog_semantics";
ALTER TABLE "permissions"
  ADD CONSTRAINT "permissions_catalog_semantics" CHECK (
    (("code" IN ('MANAGE_SERVICE_PRICES', 'MANAGE_BOOKING_SETTINGS', 'MANAGE_DISCOUNTS', 'CREATE_VOUCHERS',
          'MANAGE_WEBSITE_CONTENT', 'ADJUST_LOYALTY_POINTS', 'MANAGE_COMBOS', 'RESTORE_COMBO_SESSIONS',
          'MANAGE_BIRTHDAY_REWARDS', 'MANAGE_REWARD_CATALOG', 'VIEW_LOYALTY_EXCEPTIONS', 'ACTIVATE_LOYALTY',
          'CHANGE_REFERRER', 'MANAGE_PRODUCTS', 'MANAGE_PRODUCT_PRICES', 'VIEW_PRODUCT_COST', 'IMPORT_PRODUCT_DATA',
          'MANAGE_PRODUCT_CAMPAIGNS', 'MANAGE_SUPPLIER_SOURCES', 'REVIEW_SUPPLIER_IMPORTS',
          'MANAGE_PAY_RULES', 'MANAGE_PAYROLL', 'APPROVE_PAYROLL')
        AND "scope_capability" = 'GLOBAL_ONLY')
      OR ("code" NOT IN ('MANAGE_SERVICE_PRICES', 'MANAGE_BOOKING_SETTINGS', 'MANAGE_DISCOUNTS', 'CREATE_VOUCHERS',
          'MANAGE_WEBSITE_CONTENT', 'ADJUST_LOYALTY_POINTS', 'MANAGE_COMBOS', 'RESTORE_COMBO_SESSIONS',
          'MANAGE_BIRTHDAY_REWARDS', 'MANAGE_REWARD_CATALOG', 'VIEW_LOYALTY_EXCEPTIONS', 'ACTIVATE_LOYALTY',
          'CHANGE_REFERRER', 'MANAGE_PRODUCTS', 'MANAGE_PRODUCT_PRICES', 'VIEW_PRODUCT_COST', 'IMPORT_PRODUCT_DATA',
          'MANAGE_PRODUCT_CAMPAIGNS', 'MANAGE_SUPPLIER_SOURCES', 'REVIEW_SUPPLIER_IMPORTS',
          'MANAGE_PAY_RULES', 'MANAGE_PAYROLL', 'APPROVE_PAYROLL')
        AND "scope_capability" = 'BRANCH_CAPABLE'))
    AND (("code" IN ('VIEW_EMPLOYEE_PAY', 'MANAGE_EMPLOYEE_PAY', 'MANAGE_PAY_RULES', 'MANAGE_PAYROLL', 'APPROVE_PAYROLL') AND "data_classification" = 'EMPLOYEE_PAY')
      OR ("code" IN ('VIEW_INVOICES', 'MANAGE_INVOICES', 'COLLECT_PAYMENTS', 'APPLY_DISCOUNTS',
          'MANAGE_DISCOUNTS', 'CREATE_VOUCHERS', 'CANCEL_INVOICES', 'CORRECT_PAYMENTS', 'VIEW_REVENUE',
          'ADJUST_LOYALTY_POINTS', 'RESTORE_COMBO_SESSIONS', 'MANAGE_PRODUCT_PRICES', 'VIEW_PRODUCT_COST',
          'MANAGE_STOCK_RECEIPTS', 'IMPORT_PRODUCT_DATA', 'REFUND_PRODUCTS', 'MANAGE_PRODUCT_CAMPAIGNS', 'VIEW_CASH', 'MANAGE_CASH')
        AND "data_classification" = 'FINANCIAL')
      OR ("code" NOT IN ('VIEW_EMPLOYEE_PAY', 'MANAGE_EMPLOYEE_PAY', 'MANAGE_PAY_RULES', 'MANAGE_PAYROLL', 'APPROVE_PAYROLL', 'VIEW_INVOICES', 'MANAGE_INVOICES',
          'COLLECT_PAYMENTS', 'APPLY_DISCOUNTS', 'MANAGE_DISCOUNTS', 'CREATE_VOUCHERS', 'CANCEL_INVOICES',
          'CORRECT_PAYMENTS', 'VIEW_REVENUE', 'ADJUST_LOYALTY_POINTS', 'RESTORE_COMBO_SESSIONS',
          'MANAGE_PRODUCT_PRICES', 'VIEW_PRODUCT_COST', 'MANAGE_STOCK_RECEIPTS', 'IMPORT_PRODUCT_DATA',
          'REFUND_PRODUCTS', 'MANAGE_PRODUCT_CAMPAIGNS', 'VIEW_CASH', 'MANAGE_CASH')
        AND "data_classification" = 'STANDARD'))
  );


-- ------------------------------------------------------------------------------------------------- go-live
-- One row, written once by the Owner's explicit action (with a fresh password and the counted opening balances). Empty = nothing is
-- posted and nothing is earned. The instant never moves.
CREATE TABLE "finance_go_live" (
    "id" SMALLINT NOT NULL DEFAULT 1,
    "at" TIMESTAMPTZ(3) NOT NULL,
    "set_by_user_id" UUID NOT NULL,
    "reauthenticated_at" TIMESTAMPTZ(3) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT "finance_go_live_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "finance_go_live_single" CHECK ("id" = 1)
);
ALTER TABLE "finance_go_live" ADD CONSTRAINT "finance_go_live_set_by_fkey" FOREIGN KEY ("set_by_user_id")
  REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

CREATE TRIGGER lucy_finance_go_live_immutable BEFORE UPDATE OR DELETE ON "finance_go_live"
  FOR EACH ROW EXECUTE FUNCTION lucy_refuse_change();

-- ----------------------------------------------------------------------------------------------- shared re-auth
-- A fresh password confirmation covers ONE action (the refund rule, generalised: Owner 2026-10-08 P13-3, P7-T12). The key is the
-- person and the instant of the confirmation. A confirmation already spent by a refund cannot be spent here either.
CREATE TABLE "reauth_uses" (
    "actor_user_id" UUID NOT NULL,
    "reauthenticated_at" TIMESTAMPTZ(3) NOT NULL,
    "purpose" VARCHAR(40) NOT NULL,
    "subject_id" UUID,
    "used_at" TIMESTAMPTZ(3) NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT "reauth_uses_pkey" PRIMARY KEY ("actor_user_id", "reauthenticated_at")
);
ALTER TABLE "reauth_uses" ADD CONSTRAINT "reauth_uses_actor_fkey" FOREIGN KEY ("actor_user_id")
  REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
CREATE TRIGGER lucy_reauth_uses_append_only BEFORE UPDATE OR DELETE ON "reauth_uses"
  FOR EACH ROW EXECUTE FUNCTION lucy_refuse_change();
CREATE FUNCTION lucy_guard_reauth_use() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM refund_reauthentication_uses r
             WHERE r.actor_user_id = NEW.actor_user_id AND r.reauthenticated_at = NEW.reauthenticated_at) THEN
    RAISE EXCEPTION USING ERRCODE = '23505', MESSAGE = 'This password confirmation was already used for a refund';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER lucy_reauth_uses_guard BEFORE INSERT ON "reauth_uses"
  FOR EACH ROW EXECUTE FUNCTION lucy_guard_reauth_use();

-- ------------------------------------------------------------------------------------------------------ funds
-- One CASH fund per branch (the drawer and safe) and one shared BANK fund (PayOS and transfers). Created by the go-live action with
-- the counted opening balance (a branch added later gets a fund with opening balance 0 when it is first needed). The opening balance
-- never changes: an error is a manual entry with a reason.
CREATE TABLE "cash_funds" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "kind" "FundKind" NOT NULL,
    "branch_id" UUID,
    "name" TEXT NOT NULL,
    "opening_balance_vnd" BIGINT NOT NULL,
    "opening_at" TIMESTAMPTZ(3) NOT NULL,
    "opening_by_user_id" UUID NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT "cash_funds_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "cash_funds_kind_branch" CHECK (("kind" = 'CASH' AND "branch_id" IS NOT NULL) OR ("kind" = 'BANK' AND "branch_id" IS NULL)),
    CONSTRAINT "cash_funds_opening_nonnegative" CHECK ("opening_balance_vnd" >= 0)
);
CREATE UNIQUE INDEX "cash_funds_branch_key" ON "cash_funds"("branch_id") WHERE "kind" = 'CASH';
CREATE UNIQUE INDEX "cash_funds_one_bank_key" ON "cash_funds"("kind") WHERE "kind" = 'BANK';
CREATE INDEX "cash_funds_opening_by_idx" ON "cash_funds"("opening_by_user_id");
ALTER TABLE "cash_funds" ADD CONSTRAINT "cash_funds_branch_id_fkey" FOREIGN KEY ("branch_id")
  REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "cash_funds" ADD CONSTRAINT "cash_funds_opening_by_fkey" FOREIGN KEY ("opening_by_user_id")
  REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

CREATE FUNCTION lucy_guard_cash_fund() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'A fund is history and is never deleted';
  END IF;
  IF NEW.kind IS DISTINCT FROM OLD.kind OR NEW.branch_id IS DISTINCT FROM OLD.branch_id
     OR NEW.opening_balance_vnd IS DISTINCT FROM OLD.opening_balance_vnd OR NEW.opening_at IS DISTINCT FROM OLD.opening_at
     OR NEW.opening_by_user_id IS DISTINCT FROM OLD.opening_by_user_id THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'The kind, branch and opening balance of a fund never change';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER lucy_cash_funds_guard BEFORE UPDATE OR DELETE ON "cash_funds"
  FOR EACH ROW EXECUTE FUNCTION lucy_guard_cash_fund();

-- ----------------------------------------------------------------------------------------------- the book
-- Append-only. amount_vnd is positive; direction says the sign. source_type/source_id/source_leg name what produced the entry
-- (a Payment, a ProductRefund, a manual command...) and make posting idempotent: one entry per (source_type, source_id, leg).
-- business_date is the branch-local date the entry counts for; it is never earlier than the day after the last closing of the fund.
CREATE TABLE "fund_entries" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "seq" BIGINT GENERATED BY DEFAULT AS IDENTITY,
    "fund_id" UUID NOT NULL,
    "branch_id" UUID NOT NULL,
    "business_date" DATE NOT NULL,
    "direction" "FundDirection" NOT NULL,
    "category" "FundEntryCategory" NOT NULL,
    "amount_vnd" BIGINT NOT NULL,
    "source_type" VARCHAR(40),
    "source_id" UUID,
    "source_leg" SMALLINT NOT NULL DEFAULT 0,
    "reverses_entry_id" UUID,
    "reason" TEXT,
    "actor_user_id" UUID,
    "client_request_id" UUID,
    "occurred_at" TIMESTAMPTZ(3) NOT NULL DEFAULT clock_timestamp(),
    "source_occurred_at" TIMESTAMPTZ(3),
    CONSTRAINT "fund_entries_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "fund_entries_amount_positive" CHECK ("amount_vnd" > 0),
    CONSTRAINT "fund_entries_source_pair" CHECK (("source_type" IS NULL) = ("source_id" IS NULL)),
    CONSTRAINT "fund_entries_correction_shape" CHECK (("category" = 'CORRECTION') = ("reverses_entry_id" IS NOT NULL)),
    CONSTRAINT "fund_entries_manual_actor" CHECK (
      "category" NOT IN ('MANUAL_INCOME', 'MANUAL_EXPENSE', 'OWNER_WITHDRAWAL', 'DEPOSIT', 'FUND_TRANSFER', 'CORRECTION', 'COUNT_DIFFERENCE')
      OR "actor_user_id" IS NOT NULL),
    CONSTRAINT "fund_entries_reason_required" CHECK (
      "category" NOT IN ('MANUAL_INCOME', 'MANUAL_EXPENSE', 'OWNER_WITHDRAWAL', 'FUND_TRANSFER', 'CORRECTION')
      OR length(btrim(coalesce("reason", ''))) > 0)
);
CREATE UNIQUE INDEX "fund_entries_seq_key" ON "fund_entries"("seq");
CREATE UNIQUE INDEX "fund_entries_source_key" ON "fund_entries"("source_type", "source_id", "source_leg") WHERE "source_type" IS NOT NULL;
CREATE UNIQUE INDEX "fund_entries_reverses_key" ON "fund_entries"("reverses_entry_id") WHERE "reverses_entry_id" IS NOT NULL;
CREATE UNIQUE INDEX "fund_entries_request_key" ON "fund_entries"("actor_user_id", "client_request_id") WHERE "client_request_id" IS NOT NULL;
CREATE INDEX "fund_entries_fund_date_idx" ON "fund_entries"("fund_id", "business_date", "seq");
CREATE INDEX "fund_entries_branch_date_idx" ON "fund_entries"("branch_id", "business_date");
CREATE INDEX "fund_entries_actor_idx" ON "fund_entries"("actor_user_id");
ALTER TABLE "fund_entries" ADD CONSTRAINT "fund_entries_fund_id_fkey" FOREIGN KEY ("fund_id")
  REFERENCES "cash_funds"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "fund_entries" ADD CONSTRAINT "fund_entries_branch_id_fkey" FOREIGN KEY ("branch_id")
  REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "fund_entries" ADD CONSTRAINT "fund_entries_reverses_fkey" FOREIGN KEY ("reverses_entry_id")
  REFERENCES "fund_entries"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "fund_entries" ADD CONSTRAINT "fund_entries_actor_fkey" FOREIGN KEY ("actor_user_id")
  REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

CREATE FUNCTION lucy_guard_fund_entry() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  fund RECORD;
  original RECORD;
BEGIN
  SELECT kind, branch_id, is_active INTO fund FROM cash_funds WHERE id = NEW.fund_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = '23503', MESSAGE = 'The fund does not exist';
  END IF;
  IF fund.kind = 'CASH' AND fund.branch_id IS DISTINCT FROM NEW.branch_id THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'A cash entry belongs to the branch of its fund';
  END IF;
  IF NEW.category = 'SALE_CASH' AND fund.kind <> 'CASH' THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'A cash sale goes to a cash fund';
  END IF;
  IF NEW.category = 'SALE_BANK' AND fund.kind <> 'BANK' THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'A bank sale goes to the bank fund';
  END IF;
  IF NEW.category IN ('SALE_CASH', 'SALE_BANK', 'TIP_IN', 'MANUAL_INCOME', 'DEPOSIT') AND NEW.direction <> 'IN' THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'This category is money in';
  END IF;
  IF NEW.category IN ('PAYMENT_REVERSAL', 'PRODUCT_REFUND', 'FAILED_DELIVERY_REFUND', 'TIP_OUT', 'SALARY_PAYOUT', 'ADVANCE',
                      'MANUAL_EXPENSE', 'OWNER_WITHDRAWAL') AND NEW.direction <> 'OUT' THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'This category is money out';
  END IF;
  IF EXISTS (SELECT 1 FROM cash_day_closings c WHERE c.fund_id = NEW.fund_id AND c.business_date >= NEW.business_date) THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'The day is closed: nothing can be added to it';
  END IF;
  IF NEW.reverses_entry_id IS NOT NULL THEN
    SELECT fund_id, direction, amount_vnd, reverses_entry_id INTO original FROM fund_entries WHERE id = NEW.reverses_entry_id;
    IF NOT FOUND OR original.fund_id <> NEW.fund_id OR original.direction = NEW.direction
       OR original.amount_vnd <> NEW.amount_vnd OR original.reverses_entry_id IS NOT NULL THEN
      RAISE EXCEPTION USING ERRCODE = '23514',
        MESSAGE = 'A correction reverses one earlier entry of the same fund, in the opposite direction, for the same amount';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER lucy_fund_entries_guard BEFORE INSERT ON "fund_entries"
  FOR EACH ROW EXECUTE FUNCTION lucy_guard_fund_entry();
CREATE TRIGGER lucy_fund_entries_append_only BEFORE UPDATE OR DELETE ON "fund_entries"
  FOR EACH ROW EXECUTE FUNCTION lucy_refuse_change();

-- --------------------------------------------------------------------------------------------- day closings
-- One row per (cash fund, business date): the counted cash, the difference to the book, the owner's withdrawal and the float left for
-- the next day. Immutable: a closed day is never reopened; an error is a correcting entry. The count difference and the withdrawal are
-- entries dated on the closing day (source_type CASH_CLOSING, source_id = this row's id) inserted just BEFORE this row, so the book
-- after the closing equals next_float_vnd exactly. The guard recomputes the numbers from the book.
CREATE TABLE "cash_day_closings" (
    "id" UUID NOT NULL,
    "fund_id" UUID NOT NULL,
    "branch_id" UUID NOT NULL,
    "business_date" DATE NOT NULL,
    "opening_float_vnd" BIGINT NOT NULL,
    "cash_in_vnd" BIGINT NOT NULL,
    "cash_out_vnd" BIGINT NOT NULL,
    "expected_vnd" BIGINT NOT NULL,
    "counted_vnd" BIGINT NOT NULL,
    "difference_vnd" BIGINT NOT NULL,
    "reason" TEXT,
    "withdrawal_vnd" BIGINT NOT NULL DEFAULT 0,
    "next_float_vnd" BIGINT NOT NULL,
    "closed_by_user_id" UUID NOT NULL,
    "reauthenticated_at" TIMESTAMPTZ(3) NOT NULL,
    "client_request_id" UUID NOT NULL,
    "closed_at" TIMESTAMPTZ(3) NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT "cash_day_closings_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "cash_day_closings_amounts" CHECK (
      "opening_float_vnd" >= 0 AND "cash_in_vnd" >= 0 AND "cash_out_vnd" >= 0 AND "counted_vnd" >= 0 AND "withdrawal_vnd" >= 0
      AND "next_float_vnd" >= 0),
    CONSTRAINT "cash_day_closings_expected" CHECK ("expected_vnd" = "opening_float_vnd" + "cash_in_vnd" - "cash_out_vnd"),
    CONSTRAINT "cash_day_closings_difference" CHECK ("difference_vnd" = "counted_vnd" - "expected_vnd"),
    CONSTRAINT "cash_day_closings_next_float" CHECK ("next_float_vnd" = "counted_vnd" - "withdrawal_vnd"),
    CONSTRAINT "cash_day_closings_reason" CHECK ("difference_vnd" = 0 OR length(btrim(coalesce("reason", ''))) > 0)
);
CREATE UNIQUE INDEX "cash_day_closings_fund_date_key" ON "cash_day_closings"("fund_id", "business_date");
CREATE UNIQUE INDEX "cash_day_closings_request_key" ON "cash_day_closings"("closed_by_user_id", "client_request_id");
CREATE INDEX "cash_day_closings_branch_date_idx" ON "cash_day_closings"("branch_id", "business_date");
ALTER TABLE "cash_day_closings" ADD CONSTRAINT "cash_day_closings_fund_id_fkey" FOREIGN KEY ("fund_id")
  REFERENCES "cash_funds"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "cash_day_closings" ADD CONSTRAINT "cash_day_closings_branch_id_fkey" FOREIGN KEY ("branch_id")
  REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "cash_day_closings" ADD CONSTRAINT "cash_day_closings_closed_by_fkey" FOREIGN KEY ("closed_by_user_id")
  REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

CREATE FUNCTION lucy_guard_cash_day_closing() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  fund RECORD;
  previous RECORD;
  start_value BIGINT;
  start_date DATE;
  own_in BIGINT;
  own_out BIGINT;
  all_net BIGINT;
BEGIN
  SELECT kind, branch_id, opening_balance_vnd INTO fund FROM cash_funds WHERE id = NEW.fund_id;
  IF NOT FOUND OR fund.kind <> 'CASH' OR fund.branch_id <> NEW.branch_id THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Only a cash fund of the branch is closed';
  END IF;
  SELECT business_date, next_float_vnd INTO previous FROM cash_day_closings
    WHERE fund_id = NEW.fund_id ORDER BY business_date DESC LIMIT 1;
  IF FOUND THEN
    IF NEW.business_date <= previous.business_date THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'A day after the last closing is closed next';
    END IF;
    start_value := previous.next_float_vnd;
    start_date := previous.business_date;
  ELSE
    start_value := fund.opening_balance_vnd;
    start_date := '-infinity'::date;
  END IF;
  IF NEW.opening_float_vnd <> start_value THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'The opening float is the previous next-day float or the opening balance';
  END IF;
  SELECT COALESCE(SUM(amount_vnd) FILTER (WHERE direction = 'IN'), 0), COALESCE(SUM(amount_vnd) FILTER (WHERE direction = 'OUT'), 0)
    INTO own_in, own_out
    FROM fund_entries
    WHERE fund_id = NEW.fund_id AND business_date > start_date AND business_date <= NEW.business_date
      AND (source_type IS DISTINCT FROM 'CASH_CLOSING' OR source_id IS DISTINCT FROM NEW.id);
  IF NEW.cash_in_vnd <> own_in OR NEW.cash_out_vnd <> own_out THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'The closing does not match the book';
  END IF;
  SELECT COALESCE(SUM(CASE WHEN direction = 'IN' THEN amount_vnd ELSE -amount_vnd END), 0) INTO all_net
    FROM fund_entries WHERE fund_id = NEW.fund_id AND business_date > start_date AND business_date <= NEW.business_date;
  IF start_value + all_net <> NEW.next_float_vnd THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'After the closing the book must equal the next-day float';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER lucy_cash_day_closings_guard BEFORE INSERT ON "cash_day_closings"
  FOR EACH ROW EXECUTE FUNCTION lucy_guard_cash_day_closing();
CREATE TRIGGER lucy_cash_day_closings_immutable BEFORE UPDATE OR DELETE ON "cash_day_closings"
  FOR EACH ROW EXECUTE FUNCTION lucy_refuse_change();
