-- Phase 6 P6-14 (Wave 3: exchanges of a returned product line), migration 2 of 2 (design 8.3, 8.5, 10.2, 10.3; OQ-24, OQ-82, OQ-80, PRD 28.5).
-- Additive: three tables, one enum, one sequence, columns on three tables, one helper function, replaced bodies of three guards, new
-- guards and constraint triggers. No row is rewritten, no permission is added or granted (REFUND_PRODUCTS already exists).
--
--   product_exchanges            one exchange: the units of ONE accepted EXCHANGE return case go back, the same number of units of ONE
--                                replacement item (in stock now) are given, on a NEW invoice (a normal product sale invoice whose only
--                                benefit is the exchange credit). Immutable: never updated, never deleted. The money is the Owner's rule
--                                (2026-10-08): replacement price on the day minus what the customer paid for the returned units (the
--                                line's net share, cumulative rounding as a refund); a same-item exchange has no difference (OQ-82).
--                                More expensive: the customer pays the difference on the exchange invoice (cash or PayOS, ordinary
--                                payments). Cheaper: the difference is handed back by cash or manual transfer (the refund rules).
--   product_exchange_completions the returned goods are taken in (sellable -> a new lot, otherwise nothing moves): at once when nothing is
--                                to be paid, otherwise after the exchange invoice is paid. Append-only.
--   product_exchange_corrections append-only linked records that correct a typed transfer reference of the money handed back.
--   lucy_line_claims             the units and money of a line already claimed by refunds and by exchanges (an exchange whose invoice was
--                                cancelled claims nothing): refunds and exchanges share ONE cumulative sequence, so the amounts of all of
--                                them add up to the line's net exactly. One open exchange per line at a time.
--   stock_movements / lots       kind EXCHANGE_RETURN into a NEW lot named after the case, keeping the expiry of a lot the line was sold from.
--   Beauty points                nothing is written here: the exchange invoice earns on its own Beauty net (= the difference paid) like any
--                                invoice; the original points stay; an equal or cheaper replacement earns nothing and takes nothing away.
--   T22                          an invoice with an exchange keeps its payments and stays paid, and so does the invoice of a completed exchange.
--
-- Money is integer VND. No PayOS call exists in the money handed back (Q4); the customer's bank account is never stored (OQ-83).

CREATE TYPE "ProductExchangeRule" AS ENUM ('SAME_ITEM', 'PRICE_DIFFERENCE');
CREATE SEQUENCE "product_exchange_code_seq" AS BIGINT START 1;

-- ---------------------------------------------------------------------------------------------- exchanges
CREATE TABLE "product_exchanges" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "code" VARCHAR(40) NOT NULL,
    "branch_id" UUID NOT NULL,
    "invoice_id" UUID NOT NULL,
    "invoice_line_id" UUID NOT NULL,
    "return_case_id" UUID NOT NULL,
    "paid_seq" INTEGER NOT NULL,
    "quantity" INTEGER NOT NULL,
    "line_units_after" INTEGER NOT NULL,
    "line_amount_after_vnd" BIGINT NOT NULL,
    "credit_vnd" BIGINT NOT NULL,
    "rule" "ProductExchangeRule" NOT NULL,
    "replacement_variant_id" UUID NOT NULL,
    "replacement_unit_price_vnd" BIGINT NOT NULL,
    "replacement_gross_vnd" BIGINT NOT NULL,
    "applied_credit_vnd" BIGINT NOT NULL,
    "payable_vnd" BIGINT NOT NULL,
    "refund_vnd" BIGINT NOT NULL,
    "refund_method" "ProductRefundMethod",
    "refund_bank_reference" VARCHAR(64),
    "exchange_invoice_id" UUID NOT NULL,
    "reason" TEXT NOT NULL,
    "actor_user_id" UUID NOT NULL,
    "reauthenticated_at" TIMESTAMPTZ(3) NOT NULL,
    "client_request_id" UUID NOT NULL,
    "occurred_at" TIMESTAMPTZ(3) NOT NULL DEFAULT clock_timestamp(),

    CONSTRAINT "product_exchanges_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "product_exchanges_code" CHECK (btrim("code") <> ''),
    CONSTRAINT "product_exchanges_quantity" CHECK ("quantity" > 0 AND "paid_seq" >= 1 AND "line_units_after" >= "quantity"),
    CONSTRAINT "product_exchanges_amounts" CHECK (
      "credit_vnd" >= 0 AND "line_amount_after_vnd" >= "credit_vnd"
      AND "replacement_unit_price_vnd" >= 0 AND "replacement_gross_vnd" = "replacement_unit_price_vnd" * "quantity"
      AND "applied_credit_vnd" >= 0 AND "applied_credit_vnd" <= "replacement_gross_vnd"
      AND "payable_vnd" = "replacement_gross_vnd" - "applied_credit_vnd" AND "refund_vnd" >= 0),
    -- OQ-82 in one place: a same-item exchange is given against the returned units at no charge and nothing is handed back; any other
    -- exchange takes the customer's payment off the replacement (never more than its price) and hands back what is left.
    CONSTRAINT "product_exchanges_rule" CHECK (
      ("rule" = 'SAME_ITEM' AND "applied_credit_vnd" = "replacement_gross_vnd" AND "refund_vnd" = 0)
      OR ("rule" = 'PRICE_DIFFERENCE' AND "applied_credit_vnd" = LEAST("credit_vnd", "replacement_gross_vnd")
          AND "refund_vnd" = "credit_vnd" - "applied_credit_vnd")),
    -- Money handed back: cash has no reference; a manual transfer has exactly the bank's reference and never an account number (OQ-83).
    CONSTRAINT "product_exchanges_refund_shape" CHECK (
      ("refund_vnd" = 0 AND "refund_method" IS NULL AND "refund_bank_reference" IS NULL)
      OR ("refund_vnd" > 0 AND (
        ("refund_method" = 'CASH' AND "refund_bank_reference" IS NULL)
        OR ("refund_method" = 'BANK_TRANSFER_MANUAL' AND "refund_bank_reference" ~ '^[A-Za-z0-9._/-]{4,64}$')))),
    CONSTRAINT "product_exchanges_reason" CHECK (btrim("reason") <> '')
);
CREATE UNIQUE INDEX "product_exchanges_code_key" ON "product_exchanges"("code");
CREATE UNIQUE INDEX "product_exchanges_request_key" ON "product_exchanges"("actor_user_id", "client_request_id");
CREATE UNIQUE INDEX "product_exchanges_invoice_key" ON "product_exchanges"("exchange_invoice_id");
CREATE INDEX "product_exchanges_line_idx" ON "product_exchanges"("invoice_line_id");
CREATE INDEX "product_exchanges_case_idx" ON "product_exchanges"("return_case_id");
CREATE INDEX "product_exchanges_original_idx" ON "product_exchanges"("invoice_id");
CREATE INDEX "product_exchanges_branch_idx" ON "product_exchanges"("branch_id", "occurred_at" DESC, "id");
ALTER TABLE "product_exchanges" ADD CONSTRAINT "product_exchanges_branch_id_fkey"
  FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "product_exchanges" ADD CONSTRAINT "product_exchanges_invoice_id_fkey"
  FOREIGN KEY ("invoice_id") REFERENCES "invoices"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "product_exchanges" ADD CONSTRAINT "product_exchanges_line_fkey"
  FOREIGN KEY ("invoice_id", "invoice_line_id") REFERENCES "invoice_lines"("invoice_id", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;
-- Only a PRODUCT line has a detail row: services and combos have no exchange (PRD 29).
ALTER TABLE "product_exchanges" ADD CONSTRAINT "product_exchanges_product_line_fkey"
  FOREIGN KEY ("invoice_line_id") REFERENCES "invoice_line_products"("invoice_line_id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "product_exchanges" ADD CONSTRAINT "product_exchanges_return_case_id_fkey"
  FOREIGN KEY ("return_case_id") REFERENCES "product_return_cases"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "product_exchanges" ADD CONSTRAINT "product_exchanges_replacement_variant_id_fkey"
  FOREIGN KEY ("replacement_variant_id") REFERENCES "product_variants"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "product_exchanges" ADD CONSTRAINT "product_exchanges_exchange_invoice_id_fkey"
  FOREIGN KEY ("exchange_invoice_id") REFERENCES "invoices"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "product_exchanges" ADD CONSTRAINT "product_exchanges_actor_user_id_fkey"
  FOREIGN KEY ("actor_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- The returned goods taken in (one per exchange; the restock decision of the person).
CREATE TABLE "product_exchange_completions" (
    "exchange_id" UUID NOT NULL,
    "restock" "ProductRefundRestock" NOT NULL,
    "actor_user_id" UUID NOT NULL,
    "occurred_at" TIMESTAMPTZ(3) NOT NULL DEFAULT clock_timestamp(),

    CONSTRAINT "product_exchange_completions_pkey" PRIMARY KEY ("exchange_id")
);
ALTER TABLE "product_exchange_completions" ADD CONSTRAINT "product_exchange_completions_exchange_id_fkey"
  FOREIGN KEY ("exchange_id") REFERENCES "product_exchanges"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "product_exchange_completions" ADD CONSTRAINT "product_exchange_completions_actor_user_id_fkey"
  FOREIGN KEY ("actor_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- Corrections of a typed transfer reference: new linked records, the exchange row itself never changes.
CREATE TABLE "product_exchange_corrections" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "exchange_id" UUID NOT NULL,
    "bank_reference" VARCHAR(64) NOT NULL,
    "reason" TEXT NOT NULL,
    "actor_user_id" UUID NOT NULL,
    "occurred_at" TIMESTAMPTZ(3) NOT NULL DEFAULT clock_timestamp(),

    CONSTRAINT "product_exchange_corrections_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "product_exchange_corrections_reference" CHECK ("bank_reference" ~ '^[A-Za-z0-9._/-]{4,64}$'),
    CONSTRAINT "product_exchange_corrections_reason" CHECK (btrim("reason") <> '')
);
CREATE INDEX "product_exchange_corrections_exchange_idx" ON "product_exchange_corrections"("exchange_id", "occurred_at", "id");
ALTER TABLE "product_exchange_corrections" ADD CONSTRAINT "product_exchange_corrections_exchange_id_fkey"
  FOREIGN KEY ("exchange_id") REFERENCES "product_exchanges"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "product_exchange_corrections" ADD CONSTRAINT "product_exchange_corrections_actor_user_id_fkey"
  FOREIGN KEY ("actor_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- ------------------------------------------------------------------------------------------- shared claims
-- The units and money of a line that refunds and exchanges have claimed so far. An exchange whose invoice was cancelled claims nothing
-- (its units were never taken). Always read under the invoice lock (the API) and the line lock (the guards).
CREATE FUNCTION lucy_line_claims(target_line uuid)
RETURNS TABLE (claimed_units integer, claimed_vnd bigint)
LANGUAGE sql STABLE AS $$
  SELECT
    (COALESCE((SELECT sum(r.quantity) FROM product_refunds r WHERE r.invoice_line_id = target_line), 0)
      + COALESCE((SELECT sum(x.quantity) FROM product_exchanges x JOIN invoices i ON i.id = x.exchange_invoice_id
                  WHERE x.invoice_line_id = target_line AND i.status <> 'CANCELLED'), 0))::integer,
    (COALESCE((SELECT sum(r.amount_vnd) FROM product_refunds r WHERE r.invoice_line_id = target_line), 0)
      + COALESCE((SELECT sum(x.credit_vnd) FROM product_exchanges x JOIN invoices i ON i.id = x.exchange_invoice_id
                  WHERE x.invoice_line_id = target_line AND i.status <> 'CANCELLED'), 0))::bigint
$$;

-- An exchange of the line that is neither completed nor cancelled blocks every other claim on the line.
CREATE FUNCTION lucy_open_exchange_on_line(target_line uuid) RETURNS boolean
LANGUAGE sql STABLE AS $$
  SELECT EXISTS (
    SELECT 1 FROM product_exchanges x JOIN invoices i ON i.id = x.exchange_invoice_id
    WHERE x.invoice_line_id = target_line AND i.status <> 'CANCELLED'
      AND NOT EXISTS (SELECT 1 FROM product_exchange_completions c WHERE c.exchange_id = x.id))
$$;

-- ---------------------------------------------------------------------------------------------- guards
-- Refunds. Replaces the P6-13 body: every rule is kept exactly; the units and money already claimed on the line now count the exchanges
-- as well (one cumulative sequence for refunds and exchanges, so all of them add up to the net exactly), and a line with an open
-- exchange takes no refund until that exchange is completed or cancelled.
CREATE OR REPLACE FUNCTION lucy_guard_product_refund() RETURNS trigger
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
  SELECT c.claimed_units, c.claimed_vnd INTO prior_units, prior_amount FROM lucy_line_claims(NEW.invoice_line_id) c;
  IF lucy_open_exchange_on_line(NEW.invoice_line_id) THEN
    RAISE EXCEPTION USING ERRCODE = '23514',
      MESSAGE = 'A line with an open exchange takes no other claim until that exchange is completed or cancelled';
  END IF;
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

-- Exchanges. INSERT only (an exchange is history). The facts come from the invoice, the line, the case and the exchange invoice, never
-- from the request: a PAID counter invoice at its current paid episode, an ACCEPTED case decided as EXCHANGE for this very line and
-- quantity, a PRODUCT line whose allocation names its net amount on the Beauty side, a new invoice that carries exactly the replacement
-- line and nothing else. The credit is the cumulative unit split of the line net (design 6.4 item 4) over the claims already made.
CREATE FUNCTION lucy_guard_product_exchange() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  inv RECORD;
  kase product_return_cases%ROWTYPE;
  alloc RECORD;
  orig_variant uuid;
  swap RECORD;
  swap_line RECORD;
  swap_lines integer;
  prior_units integer;
  prior_amount bigint;
  net bigint;
  total_units integer;
  before_share bigint;
  after_share bigint;
BEGIN
  IF TG_OP <> 'INSERT' THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'A product exchange is history and is never changed or deleted';
  END IF;
  SELECT i.branch_id, i.status, i.channel, i.paid_seq, i.payer_user_id INTO inv FROM invoices i WHERE i.id = NEW.invoice_id FOR SHARE;
  IF NOT FOUND OR inv.status <> 'PAID' THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'An exchange needs a paid invoice';
  END IF;
  IF inv.channel <> 'COUNTER' THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Only counter sales have an exchange for now';
  END IF;
  IF NEW.branch_id <> inv.branch_id THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'An exchange belongs to the branch of its invoice';
  END IF;
  IF NEW.paid_seq <> inv.paid_seq THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'An exchange belongs to the current paid episode of its invoice';
  END IF;
  SELECT c.* INTO kase FROM product_return_cases c WHERE c.id = NEW.return_case_id FOR SHARE;
  IF NOT FOUND OR kase.status <> 'ACCEPTED' OR kase.decided_outcome IS DISTINCT FROM 'EXCHANGE'
     OR kase.invoice_id <> NEW.invoice_id OR kase.invoice_line_id <> NEW.invoice_line_id OR kase.branch_id <> NEW.branch_id THEN
    RAISE EXCEPTION USING ERRCODE = '23514',
      MESSAGE = 'An exchange follows an accepted return case that was decided as an exchange, for its own line';
  END IF;
  IF kase.quantity <> NEW.quantity THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'An exchange takes back exactly the units its case accepted';
  END IF;
  IF EXISTS (
    SELECT 1 FROM product_exchanges x JOIN invoices s ON s.id = x.exchange_invoice_id
    WHERE x.return_case_id = NEW.return_case_id AND s.status <> 'CANCELLED') THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'A case has one exchange at a time';
  END IF;
  SELECT l.quantity, a.net_vnd, a.side INTO alloc
    FROM invoice_lines l JOIN invoice_line_allocations a ON a.invoice_line_id = l.id
    WHERE l.id = NEW.invoice_line_id AND l.invoice_id = NEW.invoice_id AND l.kind = 'PRODUCT'
    FOR NO KEY UPDATE OF l;
  IF NOT FOUND OR alloc.side <> 'BEAUTY' OR alloc.quantity IS NULL OR alloc.quantity < 1 THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Only a product line with a recorded net amount can be exchanged';
  END IF;
  total_units := alloc.quantity;
  net := alloc.net_vnd;
  SELECT p.variant_id INTO orig_variant FROM invoice_line_products p WHERE p.invoice_line_id = NEW.invoice_line_id;
  SELECT c.claimed_units, c.claimed_vnd INTO prior_units, prior_amount FROM lucy_line_claims(NEW.invoice_line_id) c;
  IF prior_units + NEW.quantity > total_units THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'A line cannot be exchanged more units than were sold';
  END IF;
  IF lucy_open_exchange_on_line(NEW.invoice_line_id) THEN
    RAISE EXCEPTION USING ERRCODE = '23514',
      MESSAGE = 'A line with an open exchange takes no other claim until that exchange is completed or cancelled';
  END IF;
  before_share := (2 * net * prior_units + total_units) / (2 * total_units);
  after_share := (2 * net * (prior_units + NEW.quantity) + total_units) / (2 * total_units);
  IF NEW.credit_vnd <> after_share - before_share THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'The credit of an exchange is the net share of the units returned, not another amount';
  END IF;
  IF NEW.line_units_after <> prior_units + NEW.quantity OR NEW.line_amount_after_vnd <> prior_amount + NEW.credit_vnd THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'The running totals of an exchange match the claims before it';
  END IF;
  IF (NEW.rule = 'SAME_ITEM') <> (NEW.replacement_variant_id = orig_variant) THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'The rule of an exchange follows whether the replacement is the item that was returned';
  END IF;
  SELECT s.* INTO swap FROM invoices s WHERE s.id = NEW.exchange_invoice_id FOR SHARE;
  IF NOT FOUND OR swap.kind <> 'PRODUCT_SALE' OR swap.channel <> 'COUNTER' OR swap.branch_id <> NEW.branch_id
     OR swap.payer_user_id IS DISTINCT FROM inv.payer_user_id OR swap.calculation_version <> 3
     OR swap.status NOT IN ('PENDING_PAYMENT', 'PAID') OR swap.shipping_fee_vnd <> 0 THEN
    RAISE EXCEPTION USING ERRCODE = '23514',
      MESSAGE = 'The invoice of an exchange is a finalized counter product sale of the same branch and payer';
  END IF;
  IF swap.subtotal_vnd <> NEW.replacement_gross_vnd OR swap.discount_total_vnd <> NEW.applied_credit_vnd
     OR swap.total_vnd <> NEW.payable_vnd THEN
    RAISE EXCEPTION USING ERRCODE = '23514',
      MESSAGE = 'The invoice of an exchange carries the replacement price less the exchange credit, and the customer pays the rest';
  END IF;
  SELECT count(*) INTO swap_lines FROM invoice_lines l WHERE l.invoice_id = swap.id;
  SELECT l.kind, l.quantity, l.unit_price_vnd, p.variant_id INTO swap_line
    FROM invoice_lines l JOIN invoice_line_products p ON p.invoice_line_id = l.id WHERE l.invoice_id = swap.id LIMIT 1;
  IF swap_lines <> 1 OR swap_line.kind IS DISTINCT FROM 'PRODUCT' OR swap_line.quantity IS DISTINCT FROM NEW.quantity
     OR swap_line.unit_price_vnd IS DISTINCT FROM NEW.replacement_unit_price_vnd
     OR swap_line.variant_id IS DISTINCT FROM NEW.replacement_variant_id THEN
    RAISE EXCEPTION USING ERRCODE = '23514',
      MESSAGE = 'The invoice of an exchange carries exactly the replacement line, as many units as were returned';
  END IF;
  NEW.occurred_at := clock_timestamp();
  RETURN NEW;
END;
$$;
CREATE TRIGGER lucy_product_exchanges_guard BEFORE INSERT OR UPDATE OR DELETE ON "product_exchanges"
  FOR EACH ROW EXECUTE FUNCTION lucy_guard_product_exchange();
CREATE TRIGGER lucy_product_exchanges_no_truncate BEFORE TRUNCATE ON "product_exchanges"
  FOR EACH STATEMENT EXECUTE FUNCTION lucy_guard_product_refund_truncate();

-- Completions: INSERT only, once per exchange, while the exchange invoice is paid (a payment reversal before this point reopens the
-- invoice and the exchange simply waits again) and the original invoice is still paid.
CREATE FUNCTION lucy_guard_product_exchange_completion() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  ex product_exchanges%ROWTYPE;
  swap_status "InvoiceStatus";
  orig RECORD;
BEGIN
  IF TG_OP <> 'INSERT' THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'An exchange completion is history and is never changed or deleted';
  END IF;
  SELECT x.* INTO ex FROM product_exchanges x WHERE x.id = NEW.exchange_id FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'A completion belongs to an exchange';
  END IF;
  SELECT s.status INTO swap_status FROM invoices s WHERE s.id = ex.exchange_invoice_id FOR SHARE;
  IF swap_status IS DISTINCT FROM 'PAID' THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'An exchange is completed once its invoice is paid';
  END IF;
  SELECT i.status, i.paid_seq INTO orig FROM invoices i WHERE i.id = ex.invoice_id FOR SHARE;
  IF orig.status IS DISTINCT FROM 'PAID' OR orig.paid_seq IS DISTINCT FROM ex.paid_seq THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'An exchange is completed while its original invoice is still paid';
  END IF;
  NEW.occurred_at := clock_timestamp();
  RETURN NEW;
END;
$$;
CREATE TRIGGER lucy_product_exchange_completions_guard BEFORE INSERT OR UPDATE OR DELETE ON "product_exchange_completions"
  FOR EACH ROW EXECUTE FUNCTION lucy_guard_product_exchange_completion();
CREATE TRIGGER lucy_product_exchange_completions_no_truncate BEFORE TRUNCATE ON "product_exchange_completions"
  FOR EACH STATEMENT EXECUTE FUNCTION lucy_guard_product_refund_truncate();

CREATE FUNCTION lucy_guard_product_exchange_correction() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  paid_by "ProductRefundMethod";
BEGIN
  IF TG_OP <> 'INSERT' THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'An exchange correction is history and is never changed or deleted';
  END IF;
  SELECT x.refund_method INTO paid_by FROM product_exchanges x WHERE x.id = NEW.exchange_id FOR SHARE;
  IF paid_by IS DISTINCT FROM 'BANK_TRANSFER_MANUAL' THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Only the reference of a bank transfer can be corrected';
  END IF;
  NEW.occurred_at := clock_timestamp();
  RETURN NEW;
END;
$$;
CREATE TRIGGER lucy_product_exchange_corrections_guard BEFORE INSERT OR UPDATE OR DELETE ON "product_exchange_corrections"
  FOR EACH ROW EXECUTE FUNCTION lucy_guard_product_exchange_correction();
CREATE TRIGGER lucy_product_exchange_corrections_no_truncate BEFORE TRUNCATE ON "product_exchange_corrections"
  FOR EACH STATEMENT EXECUTE FUNCTION lucy_guard_product_refund_truncate();

-- ------------------------------------------------------------------------- password confirmation (P13-3)
-- An exchange is approved with a password confirmation used once, from the same pool as the refunds: one confirmation can never cover a
-- refund and an exchange, nor two exchanges.
ALTER TABLE "refund_reauthentication_uses" ADD COLUMN "product_exchange_id" UUID;
ALTER TABLE "refund_reauthentication_uses" ADD CONSTRAINT "refund_reauthentication_uses_product_exchange_id_fkey"
  FOREIGN KEY ("product_exchange_id") REFERENCES "product_exchanges"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "refund_reauthentication_uses" DROP CONSTRAINT "refund_reauthentication_uses_owner";
ALTER TABLE "refund_reauthentication_uses" ADD CONSTRAINT "refund_reauthentication_uses_owner"
  CHECK (num_nonnulls("product_refund_id", "product_exchange_id") = 1);
CREATE UNIQUE INDEX "refund_reauthentication_uses_exchange_key" ON "refund_reauthentication_uses"("product_exchange_id")
  WHERE "product_exchange_id" IS NOT NULL;

-- At commit: an exchange names its own use of its confirmation; an exchange with nothing to pay has been completed in the same step.
CREATE FUNCTION lucy_check_product_exchange() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM refund_reauthentication_uses u
    WHERE u.product_exchange_id = NEW.id AND u.actor_user_id = NEW.actor_user_id AND u.reauthenticated_at = NEW.reauthenticated_at) THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'An exchange uses its own password confirmation once';
  END IF;
  IF NEW.payable_vnd = 0 AND NOT EXISTS (SELECT 1 FROM product_exchange_completions c WHERE c.exchange_id = NEW.id) THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'An exchange with nothing to pay is completed in the same step';
  END IF;
  RETURN NULL;
END;
$$;
CREATE CONSTRAINT TRIGGER "product_exchanges_commit_check" AFTER INSERT ON "product_exchanges"
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION lucy_check_product_exchange();

-- ------------------------------------------------------------------------------------------------- stock
ALTER TABLE "inventory_lots" ADD COLUMN "source_exchange_id" UUID;
ALTER TABLE "inventory_lots" ADD CONSTRAINT "inventory_lots_source_exchange_id_fkey"
  FOREIGN KEY ("source_exchange_id") REFERENCES "product_exchanges"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "inventory_lots" ADD CONSTRAINT "inventory_lots_source_exchange"
  CHECK ("source_exchange_id" IS NULL OR ("source_receipt_line_id" IS NULL AND "source_refund_id" IS NULL));
CREATE UNIQUE INDEX "inventory_lots_exchange_code_key" ON "inventory_lots"("source_exchange_id", "lot_code") WHERE "source_exchange_id" IS NOT NULL;

ALTER TABLE "stock_movements" ADD COLUMN "product_exchange_id" UUID;
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_product_exchange_id_fkey"
  FOREIGN KEY ("product_exchange_id") REFERENCES "product_exchanges"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
CREATE INDEX "stock_movements_exchange_idx" ON "stock_movements"("product_exchange_id") WHERE "product_exchange_id" IS NOT NULL;

-- The shape of each movement kind: unchanged for the six that exist; an EXCHANGE_RETURN puts stock back, names the exchange and nothing else.
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
  OR ("kind" = 'EXCHANGE_RETURN' AND "quantity_delta" > 0 AND "product_exchange_id" IS NOT NULL AND "product_refund_id" IS NULL
    AND "invoice_line_id" IS NULL AND "paid_seq" IS NULL AND "reason" IS NULL AND "receipt_line_id" IS NULL
    AND "count_line_id" IS NULL AND "import_job_id" IS NULL)
);

-- Only an exchange return names an exchange, and no other kind does.
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_exchange_link"
  CHECK (("kind" = 'EXCHANGE_RETURN') = ("product_exchange_id" IS NOT NULL));

-- A lot named after an exchange: the exchange is completed as sellable, at the lot's branch and variant, and the lot keeps the expiry of a
-- lot the line was sold from. Its link never changes. (The P6-2 / P6-13 body of the lot guard is untouched.)
CREATE FUNCTION lucy_guard_exchange_lot() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF NEW.source_exchange_id IS DISTINCT FROM OLD.source_exchange_id THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'A stock lot is immutable except its quantity';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.source_exchange_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM product_exchanges x
      JOIN product_exchange_completions c ON c.exchange_id = x.id
      JOIN invoice_line_products p ON p.invoice_line_id = x.invoice_line_id
    WHERE x.id = NEW.source_exchange_id AND c.restock = 'SELLABLE' AND x.branch_id = NEW.branch_id AND p.variant_id = NEW.variant_id
      AND EXISTS (
        SELECT 1 FROM stock_movements m JOIN inventory_lots s ON s.id = m.lot_id
        WHERE m.invoice_line_id = x.invoice_line_id AND m.kind = 'SALE' AND m.paid_seq = x.paid_seq
          AND s.expiry_date IS NOT DISTINCT FROM NEW.expiry_date)
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '23514',
      MESSAGE = 'A returned lot belongs to a sellable exchange of its branch and variant and keeps the expiry of a lot the line was sold from';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER lucy_inventory_lots_exchange_guard BEFORE INSERT OR UPDATE ON "inventory_lots"
  FOR EACH ROW EXECUTE FUNCTION lucy_guard_exchange_lot();

-- An exchange return: the exchange is completed as sellable, at its branch and for the variant of the returned line, into the lot named
-- after that exchange, and never more units than the exchange took back.
CREATE FUNCTION lucy_guard_exchange_return_movement() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  ex product_exchanges%ROWTYPE;
  returned_variant uuid;
  lot_source uuid;
  put_back bigint;
BEGIN
  SELECT x.* INTO ex FROM product_exchanges x WHERE x.id = NEW.product_exchange_id;
  SELECT p.variant_id INTO returned_variant FROM invoice_line_products p WHERE p.invoice_line_id = ex.invoice_line_id;
  SELECT l.source_exchange_id INTO lot_source FROM inventory_lots l WHERE l.id = NEW.lot_id;
  IF NOT FOUND OR ex.id IS NULL
     OR NOT EXISTS (SELECT 1 FROM product_exchange_completions c WHERE c.exchange_id = ex.id AND c.restock = 'SELLABLE')
     OR ex.branch_id <> NEW.branch_id OR returned_variant IS DISTINCT FROM NEW.variant_id
     OR lot_source IS DISTINCT FROM NEW.product_exchange_id THEN
    RAISE EXCEPTION USING ERRCODE = '23514',
      MESSAGE = 'An exchange return belongs to a sellable exchange, its branch and variant, and the lot named after that exchange';
  END IF;
  SELECT COALESCE(sum(m.quantity_delta), 0) INTO put_back FROM stock_movements m
    WHERE m.product_exchange_id = NEW.product_exchange_id AND m.kind = 'EXCHANGE_RETURN';
  IF put_back + NEW.quantity_delta > ex.quantity THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'An exchange puts back no more units than it took back';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER lucy_stock_movements_exchange_guard BEFORE INSERT ON "stock_movements"
  FOR EACH ROW WHEN (NEW.kind = 'EXCHANGE_RETURN') EXECUTE FUNCTION lucy_guard_exchange_return_movement();

-- At commit: an exchange completed as sellable has put back exactly its units, any other completed exchange none (no phantom stock).
CREATE FUNCTION lucy_check_exchange_stock() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  ex product_exchanges%ROWTYPE;
  completion product_exchange_completions%ROWTYPE;
  put_back bigint;
  exchange_key uuid;
BEGIN
  IF TG_TABLE_NAME = 'product_exchange_completions' THEN
    exchange_key := NEW.exchange_id;
  ELSE
    exchange_key := NEW.product_exchange_id;
  END IF;
  SELECT x.* INTO ex FROM product_exchanges x WHERE x.id = exchange_key;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;
  SELECT c.* INTO completion FROM product_exchange_completions c WHERE c.exchange_id = ex.id;
  SELECT COALESCE(sum(m.quantity_delta), 0) INTO put_back FROM stock_movements m
    WHERE m.product_exchange_id = ex.id AND m.kind = 'EXCHANGE_RETURN';
  IF completion.exchange_id IS NULL AND put_back <> 0 THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Goods are put back only when the exchange is completed';
  END IF;
  IF completion.exchange_id IS NOT NULL
     AND put_back <> (CASE WHEN completion.restock = 'SELLABLE' THEN ex.quantity ELSE 0 END) THEN
    RAISE EXCEPTION USING ERRCODE = '23514',
      MESSAGE = 'An exchange completed as sellable puts back exactly its units and any other exchange puts back none';
  END IF;
  RETURN NULL;
END;
$$;
CREATE CONSTRAINT TRIGGER "product_exchange_completions_stock_balance" AFTER INSERT ON "product_exchange_completions"
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION lucy_check_exchange_stock();
CREATE CONSTRAINT TRIGGER "stock_movements_exchange_balance" AFTER INSERT ON "stock_movements"
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW WHEN (NEW.product_exchange_id IS NOT NULL) EXECUTE FUNCTION lucy_check_exchange_stock();

-- ----------------------------------------------------------------------------------------- pricing check
-- Replaces the P6-9 body: every rule is kept exactly; the invoice of an exchange (it has a row in product_exchanges) takes the exchange
-- credit as the whole of its Beauty-side benefit, and refuses any other benefit beside it.
CREATE OR REPLACE FUNCTION lucy_check_invoice_pricing_v3(target_id uuid) RETURNS void
LANGUAGE plpgsql AS $$
DECLARE
  target invoices%ROWTYPE;
  spa_app invoice_discount_applications%ROWTYPE;
  beauty_app invoice_beauty_applications%ROWTYPE;
  spa_snap invoice_loyalty_snapshots%ROWTYPE;
  beauty_snap invoice_beauty_snapshots%ROWTYPE;
  gift birthday_redemptions%ROWTYPE;
  has_spa_app boolean;
  has_beauty_app boolean;
  has_spa_snap boolean;
  has_beauty_snap boolean;
  has_gift boolean;
  spa_discount bigint;
  beauty_discount bigint;
  spa_gross bigint;
  beauty_gross bigint;
  line_count integer;
  allocation_count integer;
  spa_shares bigint;
  beauty_shares bigint;
  net_sum bigint;
  swap_credit bigint;
  has_swap boolean;
BEGIN
  SELECT * INTO target FROM invoices WHERE id = target_id;
  IF NOT FOUND THEN
    RETURN;
  END IF;
  SELECT * INTO spa_app FROM invoice_discount_applications WHERE invoice_id = target.id;
  has_spa_app := FOUND;
  SELECT * INTO beauty_app FROM invoice_beauty_applications WHERE invoice_id = target.id;
  has_beauty_app := FOUND;
  SELECT * INTO spa_snap FROM invoice_loyalty_snapshots WHERE invoice_id = target.id;
  has_spa_snap := FOUND;
  SELECT * INTO beauty_snap FROM invoice_beauty_snapshots WHERE invoice_id = target.id;
  has_beauty_snap := FOUND;
  SELECT * INTO gift FROM birthday_redemptions WHERE invoice_id = target.id;
  has_gift := FOUND;
  SELECT x.applied_credit_vnd INTO swap_credit FROM product_exchanges x WHERE x.exchange_invoice_id = target.id;
  has_swap := FOUND;
  IF target.finalized_at IS NULL THEN
    IF has_spa_app OR has_beauty_app OR has_spa_snap OR has_beauty_snap OR has_gift
      OR EXISTS (SELECT 1 FROM discount_redemptions WHERE invoice_id = target.id)
      OR EXISTS (SELECT 1 FROM invoice_line_allocations WHERE invoice_id = target.id) THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'A draft invoice has no applied benefit, redemption, snapshot or line allocation yet';
    END IF;
    RETURN;
  END IF;
  -- The Spa part (the Phase 5 reading): the applied program benefit, or the member amount, or nothing when a lone birthday gift is
  -- the only benefit; plus the gift on top of a combinable ordinary benefit.
  IF has_spa_snap AND spa_snap.winner_source IN ('MEMBER_TIER', 'BIRTHDAY') THEN
    IF has_spa_app THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'A member discount or a lone birthday gift excludes every program benefit on the Spa side';
    END IF;
    spa_discount := CASE WHEN spa_snap.winner_source = 'MEMBER_TIER' THEN spa_snap.member_amount_vnd ELSE 0 END;
  ELSE
    spa_discount := COALESCE(spa_app.computed_amount_vnd, 0);
  END IF;
  IF has_spa_snap THEN
    spa_discount := spa_discount + spa_snap.birthday_amount_vnd;
  END IF;
  IF has_spa_snap AND spa_snap.winner_source IN ('PROMOTION', 'VOUCHER') AND NOT has_spa_app THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'A program benefit named by the snapshot must be applied';
  END IF;
  -- The Beauty part: the applied program benefit or the member amount, never both.
  IF has_beauty_snap AND beauty_snap.winner_source = 'MEMBER_TIER' THEN
    IF has_beauty_app THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'A member discount excludes every program benefit on the Beauty side';
    END IF;
    beauty_discount := beauty_snap.member_amount_vnd;
  ELSE
    beauty_discount := COALESCE(beauty_app.computed_amount_vnd, 0);
  END IF;
  -- The invoice of an exchange (P6-14): its only benefit is the exchange credit, on the Beauty side; no program, member discount,
  -- voucher or gift stacks with it.
  IF has_swap THEN
    IF has_beauty_app OR has_beauty_snap OR has_spa_app OR has_spa_snap OR has_gift
      OR EXISTS (SELECT 1 FROM discount_redemptions WHERE invoice_id = target.id) THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'The invoice of an exchange has no benefit but its exchange credit';
    END IF;
    beauty_discount := swap_credit;
  END IF;
  IF has_beauty_snap AND beauty_snap.winner_source IN ('PROMOTION', 'VOUCHER') AND NOT has_beauty_app THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'A program benefit named by the snapshot must be applied';
  END IF;
  IF target.discount_total_vnd <> spa_discount + beauty_discount THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'The invoice discount total must equal the benefits applied to its sides';
  END IF;
  -- Eligible amounts never exceed the side they belong to.
  SELECT COALESCE(sum(gross_vnd) FILTER (WHERE kind <> 'PRODUCT'), 0), COALESCE(sum(gross_vnd) FILTER (WHERE kind = 'PRODUCT'), 0)
    INTO spa_gross, beauty_gross FROM invoice_lines WHERE invoice_id = target.id;
  IF (has_spa_snap AND spa_snap.eligible_spa_vnd > spa_gross) OR (has_spa_app AND spa_app.eligible_subtotal_vnd > spa_gross)
    OR (has_beauty_snap AND beauty_snap.eligible_beauty_vnd > beauty_gross)
    OR (has_beauty_app AND beauty_app.eligible_subtotal_vnd > beauty_gross) THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'The eligible subtotal cannot exceed the side it belongs to';
  END IF;
  IF (has_spa_app AND spa_app.voucher_id IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM invoice_voucher_entries e
        WHERE e.invoice_id = target.id AND e.voucher_id = spa_app.voucher_id AND e.removed_at IS NULL))
    OR (has_beauty_app AND beauty_app.voucher_id IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM invoice_voucher_entries e
        WHERE e.invoice_id = target.id AND e.voucher_id = beauty_app.voucher_id AND e.removed_at IS NULL)) THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'A voucher benefit needs its code supplied to the invoice';
  END IF;
  -- On a version 3 invoice every BOTH program is applied with its shared amount (the engine always splits it).
  IF (has_spa_app AND spa_app.shared_amount_vnd IS NULL AND EXISTS (
        SELECT 1 FROM discount_versions v WHERE v.id = spa_app.version_id AND v.scope = 'BOTH'))
    OR (has_beauty_app AND beauty_app.shared_amount_vnd IS NULL AND EXISTS (
        SELECT 1 FROM discount_versions v WHERE v.id = beauty_app.version_id AND v.scope = 'BOTH')) THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'A shared (BOTH) program on a version 3 invoice records its shared amount';
  END IF;
  -- A program applied to both sides is one shared program with one version and code, and its two shares are its amount.
  IF has_spa_app AND has_beauty_app AND spa_app.discount_id = beauty_app.discount_id THEN
    IF (spa_app.version_id, spa_app.voucher_id, spa_app.shared_amount_vnd, spa_app.shared_eligible_subtotal_vnd)
        IS DISTINCT FROM (beauty_app.version_id, beauty_app.voucher_id, beauty_app.shared_amount_vnd, beauty_app.shared_eligible_subtotal_vnd)
      OR spa_app.shared_amount_vnd IS NULL
      OR spa_app.eligible_subtotal_vnd + beauty_app.eligible_subtotal_vnd <> spa_app.shared_eligible_subtotal_vnd
      OR spa_app.computed_amount_vnd + beauty_app.computed_amount_vnd <> spa_app.shared_amount_vnd THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'A program applied to both sides is one shared program whose shares add up to its amount';
    END IF;
  END IF;
  -- Every applied program is redeemed exactly once (the unique key makes "at most once"), and nothing else is redeemed.
  IF EXISTS (
      SELECT 1 FROM (
        SELECT discount_id, version_id, voucher_id FROM invoice_discount_applications WHERE invoice_id = target.id
        UNION
        SELECT discount_id, version_id, voucher_id FROM invoice_beauty_applications WHERE invoice_id = target.id) applied
      WHERE NOT EXISTS (
        SELECT 1 FROM discount_redemptions r
        WHERE r.invoice_id = target.id AND r.discount_id = applied.discount_id AND r.version_id = applied.version_id
          AND r.voucher_id IS NOT DISTINCT FROM applied.voucher_id))
    OR EXISTS (
      SELECT 1 FROM discount_redemptions r
      WHERE r.invoice_id = target.id
        AND NOT EXISTS (SELECT 1 FROM invoice_discount_applications a
          WHERE a.invoice_id = target.id AND a.discount_id = r.discount_id AND a.version_id = r.version_id
            AND a.voucher_id IS NOT DISTINCT FROM r.voucher_id)
        AND NOT EXISTS (SELECT 1 FROM invoice_beauty_applications b
          WHERE b.invoice_id = target.id AND b.discount_id = r.discount_id AND b.version_id = r.version_id
            AND b.voucher_id IS NOT DISTINCT FROM r.voucher_id)) THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'An applied benefit is redeemed exactly once';
  END IF;
  -- The birthday gift (Spa side): worth money <=> exactly one redemption recording that amount.
  IF has_spa_snap AND (spa_snap.birthday_amount_vnd > 0) <> has_gift THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'A birthday gift is redeemed exactly once';
  END IF;
  IF has_gift AND (NOT has_spa_snap OR gift.amount_vnd <> spa_snap.birthday_amount_vnd) THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'A birthday redemption records exactly the gift of its invoice snapshot';
  END IF;
  -- Cancellation releases every redemption in the same transaction; nothing else does.
  IF EXISTS (
    SELECT 1 FROM discount_redemptions r
    WHERE r.invoice_id = target.id
      AND (target.status = 'CANCELLED') <> EXISTS (SELECT 1 FROM discount_redemption_releases l WHERE l.redemption_id = r.id)) THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'A redemption is released exactly when its invoice is cancelled';
  END IF;
  IF has_gift AND (target.status = 'CANCELLED') <> EXISTS (
    SELECT 1 FROM birthday_redemption_releases l WHERE l.redemption_id = gift.id) THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'A birthday redemption is released exactly when its invoice is cancelled';
  END IF;
  -- The line net amounts: every line has one, the shares add up to each side's discount, and the nets add up to the receivable.
  SELECT count(*) INTO line_count FROM invoice_lines WHERE invoice_id = target.id;
  SELECT count(*), COALESCE(sum(discount_share_vnd) FILTER (WHERE side = 'SPA'), 0),
         COALESCE(sum(discount_share_vnd) FILTER (WHERE side = 'BEAUTY'), 0), COALESCE(sum(net_vnd), 0)
    INTO allocation_count, spa_shares, beauty_shares, net_sum FROM invoice_line_allocations WHERE invoice_id = target.id;
  IF allocation_count <> line_count THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Every line of a version 3 invoice has its net allocation';
  END IF;
  IF spa_shares <> spa_discount OR beauty_shares <> beauty_discount THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'The line allocations must add up to the discount of each side';
  END IF;
  IF net_sum <> target.total_vnd - target.shipping_fee_vnd THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'The line net amounts must add up to the receivable without the shipping fee';
  END IF;
END;
$$;

-- ----------------------------------------------------------------------------------------------- T22
-- Replaces the P6-13 body: the refund rule is kept as it was; an invoice that has an exchange keeps its payments and stays paid, and so
-- does the invoice of a completed exchange. An exchange whose invoice was cancelled holds nothing. The API refuses first, precisely.
CREATE OR REPLACE FUNCTION lucy_refuse_when_refunded() RETURNS trigger
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
  IF target IS NOT NULL AND EXISTS (
    SELECT 1 FROM product_exchanges x JOIN invoices s ON s.id = x.exchange_invoice_id
    WHERE x.invoice_id = target AND s.status <> 'CANCELLED') THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'An invoice with an exchange keeps its payments and stays paid';
  END IF;
  IF target IS NOT NULL AND EXISTS (
    SELECT 1 FROM product_exchanges x JOIN product_exchange_completions c ON c.exchange_id = x.id
    WHERE x.exchange_invoice_id = target) THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'The invoice of a completed exchange keeps its payments and stays paid';
  END IF;
  RETURN NEW;
END;
$$;

-- The Phase 1 convention (fixed search_path, no PUBLIC execute) for every function this migration creates or replaces.
DO $$
DECLARE
  migration_schema text := current_schema();
  function_name text;
BEGIN
  FOREACH function_name IN ARRAY ARRAY[
    'lucy_guard_product_refund', 'lucy_guard_product_exchange', 'lucy_guard_product_exchange_completion',
    'lucy_guard_product_exchange_correction', 'lucy_check_product_exchange', 'lucy_guard_exchange_lot',
    'lucy_guard_exchange_return_movement', 'lucy_check_exchange_stock', 'lucy_refuse_when_refunded'
  ] LOOP
    EXECUTE format('ALTER FUNCTION %I.%I() SET search_path TO pg_catalog, %I, pg_temp',
      migration_schema, function_name, migration_schema);
    EXECUTE format('REVOKE ALL ON FUNCTION %I.%I() FROM PUBLIC', migration_schema, function_name);
  END LOOP;
  EXECUTE format('ALTER FUNCTION %I.lucy_line_claims(uuid) SET search_path TO pg_catalog, %I, pg_temp', migration_schema, migration_schema);
  EXECUTE format('REVOKE ALL ON FUNCTION %I.lucy_line_claims(uuid) FROM PUBLIC', migration_schema);
  EXECUTE format('ALTER FUNCTION %I.lucy_open_exchange_on_line(uuid) SET search_path TO pg_catalog, %I, pg_temp', migration_schema, migration_schema);
  EXECUTE format('REVOKE ALL ON FUNCTION %I.lucy_open_exchange_on_line(uuid) FROM PUBLIC', migration_schema);
  EXECUTE format('ALTER FUNCTION %I.lucy_check_invoice_pricing_v3(uuid) SET search_path TO pg_catalog, %I, pg_temp', migration_schema, migration_schema);
  EXECUTE format('REVOKE ALL ON FUNCTION %I.lucy_check_invoice_pricing_v3(uuid) FROM PUBLIC', migration_schema);
END;
$$;
