-- Phase 6 P6-13 (Wave 3: refunds per product line), migration 2 of 2 (design 8.2-8.4, 10.2, 10.3; Q3, Q4, Q5, OQ-19 option A, OQ-23, T21, T22,
-- OQ-80, OQ-81, OQ-83; PRD 28.6). Additive: two tables, two enums, one sequence, columns on three tables, replaced bodies of three
-- guards, new guards and constraint triggers. No row is rewritten, no permission is added or granted (REFUND_PRODUCTS already exists).
--
--   product_refunds             one refund of some units of ONE product line of a PAID counter invoice, backed by an ACCEPTED return case
--                               whose decided outcome is REFUND. Immutable: never updated, never deleted. The amount is the line's net
--                               share of those units (cumulative rounding, design 6.4 item 4), recomputed here from the line allocation.
--   product_refund_corrections  append-only linked records that correct a typed bank transfer reference (the refund itself never changes).
--   loyalty_ledger_entries      kind REFUND_REVERSAL: a linked, negative Beauty entry per refund (`product_refund_id`, unique); the earn
--                               entry stays. Refunds never take back more than the invoice earned. The Spa wallet and referral points
--                               are never touched.
--   stock_movements / lots      kind REFUND_RETURN: sellable returned goods enter a NEW lot named after the return case, keeping the
--                               expiry of a lot the line was sold from. A refund recorded as not sellable moves no stock (no phantom stock).
--   T22                         an invoice that has a refund keeps its payments and stays paid: a payment reversal (CORRECT_PAYMENTS) and
--                               any move of a PAID invoice to another status are refused by the database too.
--
-- Money is integer VND. No PayOS call exists anywhere in this migration or its code (Q4); the customer's bank account is never stored
-- (OQ-83): only the transfer reference, restricted to letters, digits and . _ / - .

CREATE TYPE "ProductRefundMethod" AS ENUM ('CASH', 'BANK_TRANSFER_MANUAL');
CREATE TYPE "ProductRefundRestock" AS ENUM ('SELLABLE', 'NOT_SELLABLE');
CREATE SEQUENCE "product_refund_code_seq" AS BIGINT START 1;

-- ---------------------------------------------------------------------------------------------- refunds
CREATE TABLE "product_refunds" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "code" VARCHAR(40) NOT NULL,
    "branch_id" UUID NOT NULL,
    "invoice_id" UUID NOT NULL,
    "invoice_line_id" UUID NOT NULL,
    "return_case_id" UUID NOT NULL,
    "paid_seq" INTEGER NOT NULL,
    "case_ordinal" INTEGER NOT NULL,
    "quantity" INTEGER NOT NULL,
    "amount_vnd" BIGINT NOT NULL,
    "line_units_after" INTEGER NOT NULL,
    "line_amount_after_vnd" BIGINT NOT NULL,
    "invoice_refunded_after_vnd" BIGINT NOT NULL,
    "method" "ProductRefundMethod" NOT NULL,
    "bank_reference" VARCHAR(64),
    "reason" TEXT NOT NULL,
    "restock" "ProductRefundRestock" NOT NULL,
    "actor_user_id" UUID NOT NULL,
    "reauthenticated_at" TIMESTAMPTZ(3) NOT NULL,
    "client_request_id" UUID NOT NULL,
    "occurred_at" TIMESTAMPTZ(3) NOT NULL DEFAULT clock_timestamp(),

    CONSTRAINT "product_refunds_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "product_refunds_code" CHECK (btrim("code") <> ''),
    CONSTRAINT "product_refunds_quantity" CHECK ("quantity" > 0 AND "case_ordinal" >= 1 AND "paid_seq" >= 1),
    CONSTRAINT "product_refunds_amount" CHECK (
      "amount_vnd" > 0 AND "line_units_after" >= "quantity" AND "line_amount_after_vnd" >= "amount_vnd"
      AND "invoice_refunded_after_vnd" >= "line_amount_after_vnd"),
    CONSTRAINT "product_refunds_reason" CHECK (btrim("reason") <> ''),
    -- Cash has no reference; a manual transfer has exactly the bank's reference and never an account number (OQ-83, Q4).
    CONSTRAINT "product_refunds_reference" CHECK (
      ("method" = 'CASH' AND "bank_reference" IS NULL)
      OR ("method" = 'BANK_TRANSFER_MANUAL' AND "bank_reference" IS NOT NULL AND "bank_reference" ~ '^[A-Za-z0-9._/-]{4,64}$'))
);
CREATE UNIQUE INDEX "product_refunds_code_key" ON "product_refunds"("code");
CREATE UNIQUE INDEX "product_refunds_request_key" ON "product_refunds"("actor_user_id", "client_request_id");
-- The units of a line are refunded as a growing prefix: no two refunds end at the same cumulative unit, none is written twice.
CREATE UNIQUE INDEX "product_refunds_line_units_key" ON "product_refunds"("invoice_line_id", "line_units_after");
CREATE UNIQUE INDEX "product_refunds_case_ordinal_key" ON "product_refunds"("return_case_id", "case_ordinal");
CREATE INDEX "product_refunds_invoice_idx" ON "product_refunds"("invoice_id");
CREATE INDEX "product_refunds_branch_idx" ON "product_refunds"("branch_id", "occurred_at" DESC, "id");
ALTER TABLE "product_refunds" ADD CONSTRAINT "product_refunds_branch_id_fkey"
  FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "product_refunds" ADD CONSTRAINT "product_refunds_invoice_id_fkey"
  FOREIGN KEY ("invoice_id") REFERENCES "invoices"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "product_refunds" ADD CONSTRAINT "product_refunds_line_fkey"
  FOREIGN KEY ("invoice_id", "invoice_line_id") REFERENCES "invoice_lines"("invoice_id", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;
-- Only a PRODUCT line has a detail row: services and combos have no refund (PRD 29).
ALTER TABLE "product_refunds" ADD CONSTRAINT "product_refunds_product_line_fkey"
  FOREIGN KEY ("invoice_line_id") REFERENCES "invoice_line_products"("invoice_line_id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "product_refunds" ADD CONSTRAINT "product_refunds_return_case_id_fkey"
  FOREIGN KEY ("return_case_id") REFERENCES "product_return_cases"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "product_refunds" ADD CONSTRAINT "product_refunds_actor_user_id_fkey"
  FOREIGN KEY ("actor_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- Corrections of a typed transfer reference: new linked records, the refund row itself never changes.
CREATE TABLE "product_refund_corrections" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "refund_id" UUID NOT NULL,
    "bank_reference" VARCHAR(64) NOT NULL,
    "reason" TEXT NOT NULL,
    "actor_user_id" UUID NOT NULL,
    "occurred_at" TIMESTAMPTZ(3) NOT NULL DEFAULT clock_timestamp(),

    CONSTRAINT "product_refund_corrections_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "product_refund_corrections_reference" CHECK ("bank_reference" ~ '^[A-Za-z0-9._/-]{4,64}$'),
    CONSTRAINT "product_refund_corrections_reason" CHECK (btrim("reason") <> '')
);
CREATE INDEX "product_refund_corrections_refund_idx" ON "product_refund_corrections"("refund_id", "occurred_at", "id");
ALTER TABLE "product_refund_corrections" ADD CONSTRAINT "product_refund_corrections_refund_id_fkey"
  FOREIGN KEY ("refund_id") REFERENCES "product_refunds"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "product_refund_corrections" ADD CONSTRAINT "product_refund_corrections_actor_user_id_fkey"
  FOREIGN KEY ("actor_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- ---------------------------------------------------------------------------------------------- guards
-- A statement-level guard for TRUNCATE (no row trigger sees it).
CREATE FUNCTION lucy_guard_product_refund_truncate() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Refund history is never truncated';
END;
$$;

-- Refunds. INSERT only (a refund is history: never updated, never deleted). The facts come from the invoice, the line and the case, never
-- from the request: a PAID counter invoice at its current paid episode, an ACCEPTED case decided as REFUND for this very line, a
-- PRODUCT line whose allocation names its net amount on the Beauty side. The units refunded on a line never exceed the units sold, nor
-- the units of the case; the amount is the cumulative unit split of the line net (design 6.4 item 4): C(k) = floor((2 * net * k + n) / (2n)),
-- the refund of units (u, u + q] is C(u + q) - C(u), so the refunds of all n units add up to the net exactly. The lines are locked first
-- (`FOR NO KEY UPDATE`) so two concurrent refunds of one line serialize here as well as on the invoice row.
CREATE FUNCTION lucy_guard_product_refund() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  inv RECORD;
  kase product_return_cases%ROWTYPE;
  alloc RECORD;
  prior_units integer;
  prior_amount bigint;
  prior_case_units integer;
  prior_case_count integer;
  prior_invoice bigint;
  net bigint;
  total_units integer;
  before_share bigint;
  after_share bigint;
BEGIN
  IF TG_OP <> 'INSERT' THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'A product refund is history and is never changed or deleted';
  END IF;
  SELECT i.branch_id, i.status, i.channel, i.paid_seq INTO inv FROM invoices i WHERE i.id = NEW.invoice_id FOR SHARE;
  IF NOT FOUND OR inv.status <> 'PAID' THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'A refund needs a paid invoice';
  END IF;
  IF inv.channel <> 'COUNTER' THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Only counter sales have a refund for now';
  END IF;
  IF NEW.branch_id <> inv.branch_id THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'A refund belongs to the branch of its invoice';
  END IF;
  IF NEW.paid_seq <> inv.paid_seq THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'A refund belongs to the current paid episode of its invoice';
  END IF;
  SELECT c.* INTO kase FROM product_return_cases c WHERE c.id = NEW.return_case_id FOR SHARE;
  IF NOT FOUND OR kase.status <> 'ACCEPTED' OR kase.decided_outcome IS DISTINCT FROM 'REFUND'
     OR kase.invoice_id <> NEW.invoice_id OR kase.invoice_line_id <> NEW.invoice_line_id OR kase.branch_id <> NEW.branch_id THEN
    RAISE EXCEPTION USING ERRCODE = '23514',
      MESSAGE = 'A refund follows an accepted return case that was decided as a refund, for its own line';
  END IF;
  SELECT l.quantity, a.net_vnd, a.side INTO alloc
    FROM invoice_lines l JOIN invoice_line_allocations a ON a.invoice_line_id = l.id
    WHERE l.id = NEW.invoice_line_id AND l.invoice_id = NEW.invoice_id AND l.kind = 'PRODUCT'
    FOR NO KEY UPDATE OF l;
  IF NOT FOUND OR alloc.side <> 'BEAUTY' OR alloc.quantity IS NULL OR alloc.quantity < 1 THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Only a product line with a recorded net amount can be refunded';
  END IF;
  total_units := alloc.quantity;
  net := alloc.net_vnd;
  SELECT COALESCE(sum(r.quantity), 0), COALESCE(sum(r.amount_vnd), 0) INTO prior_units, prior_amount
    FROM product_refunds r WHERE r.invoice_line_id = NEW.invoice_line_id;
  IF prior_units + NEW.quantity > total_units THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'A line cannot be refunded more units than were sold';
  END IF;
  SELECT COALESCE(sum(r.quantity), 0), count(*) INTO prior_case_units, prior_case_count
    FROM product_refunds r WHERE r.return_case_id = NEW.return_case_id;
  IF prior_case_units + NEW.quantity > kase.quantity THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'A case cannot be refunded more units than it accepted';
  END IF;
  IF NEW.case_ordinal <> prior_case_count + 1 THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'The refunds of a case are numbered in order';
  END IF;
  before_share := (2 * net * prior_units + total_units) / (2 * total_units);
  after_share := (2 * net * (prior_units + NEW.quantity) + total_units) / (2 * total_units);
  IF NEW.amount_vnd <> after_share - before_share THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'A refund is the net share of the units refunded, not another amount';
  END IF;
  IF NEW.line_units_after <> prior_units + NEW.quantity OR NEW.line_amount_after_vnd <> prior_amount + NEW.amount_vnd THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'The running totals of a refund match the refunds before it';
  END IF;
  SELECT COALESCE(sum(r.amount_vnd), 0) INTO prior_invoice FROM product_refunds r WHERE r.invoice_id = NEW.invoice_id;
  IF NEW.invoice_refunded_after_vnd <> prior_invoice + NEW.amount_vnd THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'The running total of an invoice matches the refunds before it';
  END IF;
  NEW.occurred_at := clock_timestamp();
  RETURN NEW;
END;
$$;
CREATE TRIGGER lucy_product_refunds_guard BEFORE INSERT OR UPDATE OR DELETE ON "product_refunds"
  FOR EACH ROW EXECUTE FUNCTION lucy_guard_product_refund();
CREATE TRIGGER lucy_product_refunds_no_truncate BEFORE TRUNCATE ON "product_refunds"
  FOR EACH STATEMENT EXECUTE FUNCTION lucy_guard_product_refund_truncate();

CREATE FUNCTION lucy_guard_product_refund_correction() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  paid_by "ProductRefundMethod";
BEGIN
  IF TG_OP <> 'INSERT' THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'A refund correction is history and is never changed or deleted';
  END IF;
  SELECT r.method INTO paid_by FROM product_refunds r WHERE r.id = NEW.refund_id FOR SHARE;
  IF paid_by IS DISTINCT FROM 'BANK_TRANSFER_MANUAL' THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Only the reference of a bank transfer refund can be corrected';
  END IF;
  NEW.occurred_at := clock_timestamp();
  RETURN NEW;
END;
$$;
CREATE TRIGGER lucy_product_refund_corrections_guard BEFORE INSERT OR UPDATE OR DELETE ON "product_refund_corrections"
  FOR EACH ROW EXECUTE FUNCTION lucy_guard_product_refund_correction();
CREATE TRIGGER lucy_product_refund_corrections_no_truncate BEFORE TRUNCATE ON "product_refund_corrections"
  FOR EACH STATEMENT EXECUTE FUNCTION lucy_guard_product_refund_truncate();

-- ----------------------------------------------------------------------------------------------- ledger
ALTER TABLE "loyalty_ledger_entries" ADD COLUMN "product_refund_id" UUID;
ALTER TABLE "loyalty_ledger_entries" ADD CONSTRAINT "loyalty_ledger_entries_product_refund_id_fkey"
  FOREIGN KEY ("product_refund_id") REFERENCES "product_refunds"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
-- One reversal entry per refund (the replay key BEAUTY_REFUND:{refund} makes the consumer idempotent; this is the structural backstop).
CREATE UNIQUE INDEX "loyalty_ledger_entries_refund_key" ON "loyalty_ledger_entries"("product_refund_id")
  WHERE "product_refund_id" IS NOT NULL;

ALTER TABLE "loyalty_ledger_entries" DROP CONSTRAINT "loyalty_ledger_entries_kind_shape";
ALTER TABLE "loyalty_ledger_entries" ADD CONSTRAINT "loyalty_ledger_entries_kind_shape" CHECK (
  ("kind" = 'EARN' AND "points" > 0 AND "invoice_id" IS NOT NULL AND "paid_seq" IS NOT NULL AND "paid_seq" >= 1
    AND "referral_id" IS NULL AND "reverses_entry_id" IS NULL AND "corrects_entry_id" IS NULL
    AND "actor_user_id" IS NULL AND "reason" IS NULL AND "product_refund_id" IS NULL)
  OR ("kind" = 'EARN_REVERSAL' AND "points" <= 0 AND "reverses_entry_id" IS NOT NULL AND "invoice_id" IS NOT NULL
    AND "paid_seq" IS NOT NULL AND "paid_seq" >= 1 AND "referral_id" IS NULL AND "corrects_entry_id" IS NULL
    AND "actor_user_id" IS NULL AND "product_refund_id" IS NULL)
  OR ("kind" = 'REFERRAL_AWARD' AND "points" > 0 AND "referral_id" IS NOT NULL AND "invoice_id" IS NULL
    AND "paid_seq" IS NULL AND "reverses_entry_id" IS NULL AND "corrects_entry_id" IS NULL
    AND "actor_user_id" IS NULL AND "reason" IS NULL AND "product_refund_id" IS NULL)
  OR ("kind" = 'MANUAL_ADJUSTMENT' AND "actor_user_id" IS NOT NULL AND "reason" IS NOT NULL AND btrim("reason") <> ''
    AND "invoice_id" IS NULL AND "paid_seq" IS NULL AND "referral_id" IS NULL
    AND "reverses_entry_id" IS NULL AND "corrects_entry_id" IS NULL AND "product_refund_id" IS NULL)
  OR ("kind" = 'MANUAL_CORRECTION' AND "actor_user_id" IS NOT NULL AND "reason" IS NOT NULL AND btrim("reason") <> ''
    AND "corrects_entry_id" IS NOT NULL AND "invoice_id" IS NULL AND "paid_seq" IS NULL AND "referral_id" IS NULL
    AND "reverses_entry_id" IS NULL AND "product_refund_id" IS NULL)
  -- REFUND_REVERSAL (PRD 28.6): Beauty points taken back by one refund; applied points are 0 or negative (a shortfall is recorded
  -- when the balance cannot absorb it, P5-Q5); it names its refund, its invoice and paid episode and the person who refunded.
  OR ("kind" = 'REFUND_REVERSAL' AND "points" <= 0 AND "product_refund_id" IS NOT NULL AND "invoice_id" IS NOT NULL
    AND "paid_seq" IS NOT NULL AND "paid_seq" >= 1 AND "referral_id" IS NULL AND "reverses_entry_id" IS NULL
    AND "corrects_entry_id" IS NULL AND "actor_user_id" IS NOT NULL)
);

-- Replaces the Phase 5 body: the four original kinds are checked exactly as before; a REFUND_REVERSAL belongs to the Beauty wallet of the
-- payer of the refunded invoice, for the paid episode of its refund, and all the refunds of an invoice together never take back
-- more points than the Beauty earn entry gave (applied plus shortfall counts as taken back).
CREATE OR REPLACE FUNCTION lucy_guard_loyalty_ledger() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  target invoices%ROWTYPE;
  other loyalty_ledger_entries%ROWTYPE;
  live timestamptz;
  referral referrals%ROWTYPE;
  refund product_refunds%ROWTYPE;
  earned integer;
  taken bigint;
BEGIN
  NEW.created_at := clock_timestamp();
  IF NEW.kind = 'EARN' THEN
    SELECT i.* INTO target FROM invoices i WHERE i.id = NEW.invoice_id FOR SHARE;
    SELECT g.go_live_at INTO live FROM loyalty_go_live g;
    IF target.status IS DISTINCT FROM 'PAID' OR target.paid_seq IS DISTINCT FROM NEW.paid_seq THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Points are earned only for the current paid episode of a paid invoice';
    END IF;
    IF target.payer_user_id IS NULL OR target.payer_user_id IS DISTINCT FROM NEW.user_id THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Points are earned by the member payer of the invoice only';
    END IF;
    IF target.paid_at < live THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'No points are earned for an invoice paid before go-live';
    END IF;
  ELSIF NEW.kind = 'EARN_REVERSAL' THEN
    SELECT e.* INTO other FROM loyalty_ledger_entries e WHERE e.id = NEW.reverses_entry_id;
    IF NOT FOUND OR other.kind IS DISTINCT FROM 'EARN'
      OR (other.user_id, other.wallet, other.invoice_id, other.paid_seq)
        IS DISTINCT FROM (NEW.user_id, NEW.wallet, NEW.invoice_id, NEW.paid_seq) THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'A reversal targets the earn entry of the same wallet and paid episode';
    END IF;
    IF -NEW.points + NEW.shortfall_points <> other.points THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'A reversal is for the full earned amount (applied plus shortfall)';
    END IF;
  ELSIF NEW.kind = 'MANUAL_CORRECTION' THEN
    SELECT e.* INTO other FROM loyalty_ledger_entries e WHERE e.id = NEW.corrects_entry_id;
    IF NOT FOUND OR other.id = NEW.id OR (other.user_id, other.wallet) IS DISTINCT FROM (NEW.user_id, NEW.wallet) THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'A correction targets another entry of the same wallet';
    END IF;
  ELSIF NEW.kind = 'REFERRAL_AWARD' THEN
    SELECT r.* INTO referral FROM referrals r WHERE r.id = NEW.referral_id;
    IF NOT FOUND OR referral.referrer_user_id IS DISTINCT FROM NEW.user_id THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'A referral award goes to the referrer of that referral';
    END IF;
  ELSIF NEW.kind = 'REFUND_REVERSAL' THEN
    SELECT r.* INTO refund FROM product_refunds r WHERE r.id = NEW.product_refund_id;
    IF NOT FOUND OR refund.invoice_id IS DISTINCT FROM NEW.invoice_id OR refund.paid_seq IS DISTINCT FROM NEW.paid_seq
       OR refund.actor_user_id IS DISTINCT FROM NEW.actor_user_id THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'A refund reversal belongs to the invoice, paid episode and person of its refund';
    END IF;
    IF NEW.wallet <> 'BEAUTY' THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'A product refund takes back Beauty points only';
    END IF;
    SELECT i.* INTO target FROM invoices i WHERE i.id = NEW.invoice_id FOR SHARE;
    IF target.payer_user_id IS NULL OR target.payer_user_id IS DISTINCT FROM NEW.user_id THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Points are taken back from the member payer of the invoice only';
    END IF;
    SELECT e.points INTO earned FROM loyalty_ledger_entries e
      WHERE e.kind = 'EARN' AND e.invoice_id = NEW.invoice_id AND e.paid_seq = NEW.paid_seq
        AND e.wallet = 'BEAUTY' AND e.user_id = NEW.user_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'There are no earned Beauty points to take back for this invoice';
    END IF;
    SELECT COALESCE(sum(-e.points + e.shortfall_points), 0) INTO taken FROM loyalty_ledger_entries e
      WHERE e.kind = 'REFUND_REVERSAL' AND e.invoice_id = NEW.invoice_id AND e.paid_seq = NEW.paid_seq AND e.wallet = 'BEAUTY';
    IF taken + (-NEW.points + NEW.shortfall_points) > earned THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Refunds cannot take back more points than the invoice earned';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

-- ----------------------------------------------------------------------------------------------- stock
ALTER TABLE "stock_movements" ADD COLUMN "product_refund_id" UUID;
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_product_refund_id_fkey"
  FOREIGN KEY ("product_refund_id") REFERENCES "product_refunds"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
CREATE INDEX "stock_movements_refund_idx" ON "stock_movements"("product_refund_id") WHERE "product_refund_id" IS NOT NULL;

ALTER TABLE "inventory_lots" ADD COLUMN "source_refund_id" UUID;
ALTER TABLE "inventory_lots" ADD CONSTRAINT "inventory_lots_source_refund_id_fkey"
  FOREIGN KEY ("source_refund_id") REFERENCES "product_refunds"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "inventory_lots" ADD CONSTRAINT "inventory_lots_source" CHECK ("source_receipt_line_id" IS NULL OR "source_refund_id" IS NULL);
CREATE UNIQUE INDEX "inventory_lots_refund_code_key" ON "inventory_lots"("source_refund_id", "lot_code") WHERE "source_refund_id" IS NOT NULL;

-- The shape of each movement kind: unchanged for the five that exist (none carries a refund); a REFUND_RETURN puts stock back, names the
-- refund and nothing else.
ALTER TABLE "stock_movements" DROP CONSTRAINT "stock_movements_kind_shape";
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_kind_shape" CHECK (
  ("kind" = 'RECEIPT' AND "quantity_delta" > 0 AND "receipt_line_id" IS NOT NULL AND "count_line_id" IS NULL
    AND "import_job_id" IS NULL AND "reason" IS NULL AND "invoice_line_id" IS NULL AND "paid_seq" IS NULL
    AND "product_refund_id" IS NULL)
  OR ("kind" = 'OPENING' AND "quantity_delta" > 0 AND "import_job_id" IS NOT NULL AND "receipt_line_id" IS NULL
    AND "count_line_id" IS NULL AND "reason" IS NULL AND "invoice_line_id" IS NULL AND "paid_seq" IS NULL
    AND "product_refund_id" IS NULL)
  OR ("kind" = 'ADJUSTMENT' AND "reason" IS NOT NULL AND "receipt_line_id" IS NULL AND "import_job_id" IS NULL
    AND "invoice_line_id" IS NULL AND "paid_seq" IS NULL AND "product_refund_id" IS NULL
    AND (("reason" = 'COUNT_CORRECTION' AND "count_line_id" IS NOT NULL)
      OR ("reason" <> 'COUNT_CORRECTION' AND "count_line_id" IS NULL AND "quantity_delta" < 0)))
  OR ("kind" = 'SALE' AND "quantity_delta" < 0 AND "invoice_line_id" IS NOT NULL AND "paid_seq" >= 1 AND "reason" IS NULL
    AND "receipt_line_id" IS NULL AND "count_line_id" IS NULL AND "import_job_id" IS NULL AND "product_refund_id" IS NULL)
  OR ("kind" = 'SALE_REVERSAL' AND "quantity_delta" > 0 AND "invoice_line_id" IS NOT NULL AND "paid_seq" >= 1 AND "reason" IS NULL
    AND "receipt_line_id" IS NULL AND "count_line_id" IS NULL AND "import_job_id" IS NULL AND "product_refund_id" IS NULL)
  OR ("kind" = 'REFUND_RETURN' AND "quantity_delta" > 0 AND "product_refund_id" IS NOT NULL AND "invoice_line_id" IS NULL
    AND "paid_seq" IS NULL AND "reason" IS NULL AND "receipt_line_id" IS NULL AND "count_line_id" IS NULL
    AND "import_job_id" IS NULL)
);

-- Lots. Replaces the P6-2 body: a lot starts empty and is immutable but for its quantity, exactly as before; a lot named after a refund
-- (`source_refund_id`) must belong to a refund recorded as sellable, at the lot's branch and variant, and keep the expiry of a lot the line
-- was sold from; `source_refund_id` joins the immutable columns.
CREATE OR REPLACE FUNCTION lucy_guard_inventory_lot() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'A stock lot is history and is never deleted';
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.quantity_on_hand <> 0 THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'A lot starts empty; stock enters through a movement';
    END IF;
    IF NEW.source_receipt_line_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM stock_receipt_lines l JOIN stock_receipts r ON r.id = l.receipt_id
      WHERE l.id = NEW.source_receipt_line_id AND l.variant_id = NEW.variant_id AND r.branch_id = NEW.branch_id
    ) THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'A receipt lot matches the branch and variant of its receipt line';
    END IF;
    IF NEW.source_refund_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM product_refunds r JOIN invoice_line_products p ON p.invoice_line_id = r.invoice_line_id
      WHERE r.id = NEW.source_refund_id AND r.restock = 'SELLABLE' AND r.branch_id = NEW.branch_id AND p.variant_id = NEW.variant_id
        AND EXISTS (
          SELECT 1 FROM stock_movements m JOIN inventory_lots s ON s.id = m.lot_id
          WHERE m.invoice_line_id = r.invoice_line_id AND m.kind = 'SALE' AND m.paid_seq = r.paid_seq
            AND s.expiry_date IS NOT DISTINCT FROM NEW.expiry_date)
    ) THEN
      RAISE EXCEPTION USING ERRCODE = '23514',
        MESSAGE = 'A returned lot belongs to a sellable refund of its branch and variant and keeps the expiry of a lot the line was sold from';
    END IF;
    NEW.created_at := clock_timestamp();
    RETURN NEW;
  END IF;
  IF (NEW.id, NEW.branch_id, NEW.variant_id, NEW.lot_code, NEW.expiry_date, NEW.unit_cost_vnd, NEW.source_receipt_line_id,
      NEW.source_refund_id, NEW.created_by_user_id, NEW.created_at)
    IS DISTINCT FROM (OLD.id, OLD.branch_id, OLD.variant_id, OLD.lot_code, OLD.expiry_date, OLD.unit_cost_vnd,
      OLD.source_receipt_line_id, OLD.source_refund_id, OLD.created_by_user_id, OLD.created_at) THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'A stock lot is immutable except its quantity';
  END IF;
  IF NEW.quantity_on_hand IS DISTINCT FROM OLD.quantity_on_hand AND pg_trigger_depth() < 2 THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'A lot quantity changes only through a stock movement';
  END IF;
  RETURN NEW;
END;
$$;

-- Movements. Replaces the P6-10 body: every earlier kind is checked exactly as before; a REFUND_RETURN belongs to a refund recorded as
-- sellable, at its branch and for its variant, goes into the lot that was named after that refund, and the units put back for one refund
-- never exceed the units it refunded.
CREATE OR REPLACE FUNCTION lucy_guard_stock_movement() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  line stock_receipt_lines%ROWTYPE;
  receipt stock_receipts%ROWTYPE;
  lot inventory_lots%ROWTYPE;
  counted stock_count_lines%ROWTYPE;
  count_session stock_count_sessions%ROWTYPE;
  job product_import_jobs%ROWTYPE;
  reserved_for_sale stock_reservations%ROWTYPE;
  refund product_refunds%ROWTYPE;
  refund_variant uuid;
  sold bigint;
  sold_on_lot bigint;
  returned bigint;
  returned_on_lot bigint;
  put_back bigint;
BEGIN
  IF TG_OP <> 'INSERT' THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'A stock movement is append-only';
  END IF;
  SELECT l.* INTO lot FROM inventory_lots l WHERE l.id = NEW.lot_id;
  IF NOT FOUND OR (lot.branch_id, lot.variant_id) IS DISTINCT FROM (NEW.branch_id, NEW.variant_id) THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'A movement uses a lot of its own branch and variant';
  END IF;
  IF NEW.kind = 'RECEIPT' THEN
    SELECT l.* INTO line FROM stock_receipt_lines l WHERE l.id = NEW.receipt_line_id;
    SELECT r.* INTO receipt FROM stock_receipts r WHERE r.id = line.receipt_id;
    IF NOT FOUND OR receipt.status <> 'CONFIRMED' OR receipt.branch_id <> NEW.branch_id OR line.variant_id <> NEW.variant_id
      OR line.quantity <> NEW.quantity_delta OR lot.source_receipt_line_id IS DISTINCT FROM line.id THEN
      RAISE EXCEPTION USING ERRCODE = '23514',
        MESSAGE = 'A receipt movement matches a confirmed receipt line, its lot, branch, variant and quantity';
    END IF;
  ELSIF NEW.kind = 'OPENING' THEN
    SELECT j.* INTO job FROM product_import_jobs j WHERE j.id = NEW.import_job_id;
    IF NOT FOUND OR job.kind <> 'OPENING_STOCK' OR job.status NOT IN ('PREVIEWED', 'APPLIED')
      OR job.branch_id IS DISTINCT FROM NEW.branch_id THEN
      RAISE EXCEPTION USING ERRCODE = '23514',
        MESSAGE = 'An opening movement belongs to a previewed opening-stock import of the same branch';
    END IF;
  ELSIF NEW.kind = 'ADJUSTMENT' AND NEW.reason = 'COUNT_CORRECTION' THEN
    SELECT c.* INTO counted FROM stock_count_lines c WHERE c.id = NEW.count_line_id;
    SELECT s.* INTO count_session FROM stock_count_sessions s WHERE s.id = counted.session_id;
    IF NOT FOUND OR count_session.status NOT IN ('OPEN', 'APPROVED') OR count_session.branch_id <> NEW.branch_id
      OR counted.variant_id <> NEW.variant_id THEN
      RAISE EXCEPTION USING ERRCODE = '23514',
        MESSAGE = 'A count correction belongs to a count line of the same branch and variant';
    END IF;
  ELSIF NEW.kind IN ('SALE', 'SALE_REVERSAL') THEN
    SELECT r.* INTO reserved_for_sale FROM stock_reservations r WHERE r.invoice_line_id = NEW.invoice_line_id;
    IF NOT FOUND OR reserved_for_sale.status <> 'CONSUMED' OR reserved_for_sale.consumed_paid_seq IS DISTINCT FROM NEW.paid_seq
      OR reserved_for_sale.branch_id <> NEW.branch_id OR reserved_for_sale.variant_id <> NEW.variant_id THEN
      RAISE EXCEPTION USING ERRCODE = '23514',
        MESSAGE = 'A sale movement belongs to the consumed reservation of its invoice line, branch, variant and paid episode';
    END IF;
    SELECT COALESCE(-sum(m.quantity_delta), 0), COALESCE(-sum(m.quantity_delta) FILTER (WHERE m.lot_id = NEW.lot_id), 0)
      INTO sold, sold_on_lot
      FROM stock_movements m WHERE m.invoice_line_id = NEW.invoice_line_id AND m.paid_seq = NEW.paid_seq AND m.kind = 'SALE';
    IF NEW.kind = 'SALE' THEN
      IF sold - NEW.quantity_delta > reserved_for_sale.quantity THEN
        RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'A sale takes no more than the quantity of its invoice line';
      END IF;
    ELSE
      SELECT COALESCE(sum(m.quantity_delta), 0), COALESCE(sum(m.quantity_delta) FILTER (WHERE m.lot_id = NEW.lot_id), 0)
        INTO returned, returned_on_lot
        FROM stock_movements m WHERE m.invoice_line_id = NEW.invoice_line_id AND m.paid_seq = NEW.paid_seq AND m.kind = 'SALE_REVERSAL';
      IF returned_on_lot + NEW.quantity_delta > sold_on_lot THEN
        RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'A sale reversal returns to a lot no more than the sale took from it';
      END IF;
    END IF;
  ELSIF NEW.kind = 'REFUND_RETURN' THEN
    SELECT r.* INTO refund FROM product_refunds r WHERE r.id = NEW.product_refund_id;
    SELECT p.variant_id INTO refund_variant FROM invoice_line_products p WHERE p.invoice_line_id = refund.invoice_line_id;
    IF NOT FOUND OR refund.restock <> 'SELLABLE' OR refund.branch_id <> NEW.branch_id OR refund_variant IS DISTINCT FROM NEW.variant_id
       OR lot.source_refund_id IS DISTINCT FROM NEW.product_refund_id THEN
      RAISE EXCEPTION USING ERRCODE = '23514',
        MESSAGE = 'A refund return belongs to a sellable refund, its branch and variant, and the lot named after that refund';
    END IF;
    SELECT COALESCE(sum(m.quantity_delta), 0) INTO put_back FROM stock_movements m
      WHERE m.product_refund_id = NEW.product_refund_id AND m.kind = 'REFUND_RETURN';
    IF put_back + NEW.quantity_delta > refund.quantity THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'A refund puts back no more units than it refunded';
    END IF;
  END IF;
  NEW.created_at := clock_timestamp();
  RETURN NEW;
END;
$$;

-- Commit-time: a refund recorded as sellable has put back exactly its units, any other refund has put back nothing (no phantom stock, and
-- the goods of a sellable refund are never lost).
CREATE FUNCTION lucy_check_refund_stock() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  refund product_refunds%ROWTYPE;
  put_back bigint;
  refund_id uuid;
BEGIN
  IF TG_TABLE_NAME = 'product_refunds' THEN
    refund_id := NEW.id;
  ELSE
    refund_id := NEW.product_refund_id;
  END IF;
  SELECT r.* INTO refund FROM product_refunds r WHERE r.id = refund_id;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;
  SELECT COALESCE(sum(m.quantity_delta), 0) INTO put_back FROM stock_movements m
    WHERE m.product_refund_id = refund.id AND m.kind = 'REFUND_RETURN';
  IF put_back <> (CASE WHEN refund.restock = 'SELLABLE' THEN refund.quantity ELSE 0 END) THEN
    RAISE EXCEPTION USING ERRCODE = '23514',
      MESSAGE = 'A refund recorded as sellable puts back exactly its units and any other refund puts back none';
  END IF;
  RETURN NULL;
END;
$$;
CREATE CONSTRAINT TRIGGER "product_refunds_stock_balance" AFTER INSERT ON "product_refunds"
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION lucy_check_refund_stock();
CREATE CONSTRAINT TRIGGER "stock_movements_refund_balance" AFTER INSERT ON "stock_movements"
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW WHEN (NEW.product_refund_id IS NOT NULL) EXECUTE FUNCTION lucy_check_refund_stock();

-- ----------------------------------------------------------------------------------------------- T22
-- An invoice that has a refund keeps its payments and stays paid. The API refuses first (a precise error); these are the backstop.
CREATE FUNCTION lucy_refuse_when_refunded() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  target uuid;
BEGIN
  IF TG_TABLE_NAME = 'payment_corrections' THEN
    SELECT p.invoice_id INTO target FROM payments p WHERE p.id = NEW.payment_id;
  ELSE
    target := OLD.id;
  END IF;
  IF target IS NOT NULL AND EXISTS (SELECT 1 FROM product_refunds r WHERE r.invoice_id = target) THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'An invoice with a refund keeps its payments and stays paid';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER lucy_payment_corrections_refund_guard BEFORE INSERT ON "payment_corrections"
  FOR EACH ROW EXECUTE FUNCTION lucy_refuse_when_refunded();
CREATE TRIGGER lucy_invoices_refund_guard BEFORE UPDATE ON "invoices"
  FOR EACH ROW WHEN (OLD.status = 'PAID' AND NEW.status <> 'PAID') EXECUTE FUNCTION lucy_refuse_when_refunded();

-- CREATE OR REPLACE drops function-level settings and CREATE FUNCTION starts without them: apply the Phase 1 convention
-- (fixed search_path, no PUBLIC execute) to every function this migration touches.
DO $$
DECLARE
  migration_schema text := current_schema();
  function_name text;
BEGIN
  FOREACH function_name IN ARRAY ARRAY[
    'lucy_guard_product_refund', 'lucy_guard_product_refund_correction', 'lucy_guard_product_refund_truncate',
    'lucy_guard_loyalty_ledger', 'lucy_guard_inventory_lot', 'lucy_guard_stock_movement', 'lucy_check_refund_stock',
    'lucy_refuse_when_refunded'
  ] LOOP
    EXECUTE format('ALTER FUNCTION %I.%I() SET search_path TO pg_catalog, %I, pg_temp',
      migration_schema, function_name, migration_schema);
    EXECUTE format('REVOKE ALL ON FUNCTION %I.%I() FROM PUBLIC', migration_schema, function_name);
  END LOOP;
END;
$$;
