-- Phase 6 P6-10 (Wave 2: stock consumption), migration 2 of 2 (design 4.5, T15, T27). Additive: two columns on each of two tables, one
-- replaced CHECK on each, three replaced functions, one new function with two constraint triggers. No row is rewritten.
--
-- A paid invoice turns its reservations into sales and the end of a paid episode turns them back:
--   RESERVED -> CONSUMED   the invoice is PAID at the paid episode the reservation records (`consumed_paid_seq`)
--   CONSUMED -> RESERVED   that paid episode has ended (payment reversed) and the invoice is not cancelled
--   CONSUMED -> RELEASED   the invoice is CANCELLED (the sale is reversed first)
--   RESERVED -> RELEASED   as before (cancelled invoice)
-- The movements that go with it are `SALE` (stock leaves the lots, one movement per lot) and `SALE_REVERSAL` (the exact mirror of
-- those movements). The order of the statements is forced by `stock_levels_reserved` (reserved <= on_hand, immediate): to consume,
-- the reservation flips first (reserved falls), then the SALE movements (on_hand falls); to give back, the SALE_REVERSAL
-- movements first (on_hand rises), then the reservation flips back (reserved rises).

-- ------------------------------------------------------------------------------------------------- columns
ALTER TABLE "stock_movements" ADD COLUMN "invoice_line_id" UUID;
ALTER TABLE "stock_movements" ADD COLUMN "paid_seq" INTEGER;
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_invoice_line_id_fkey"
  FOREIGN KEY ("invoice_line_id") REFERENCES "invoice_lines"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
CREATE INDEX "stock_movements_invoice_line_idx" ON "stock_movements"("invoice_line_id") WHERE "invoice_line_id" IS NOT NULL;

ALTER TABLE "stock_reservations" ADD COLUMN "consumed_paid_seq" INTEGER;
ALTER TABLE "stock_reservations" ADD COLUMN "consumed_at" TIMESTAMPTZ(3);

-- The shape of each movement kind: the three original kinds keep their rules and never carry an invoice line; a SALE takes stock
-- out and a SALE_REVERSAL puts it back, both naming the invoice line and the paid episode.
ALTER TABLE "stock_movements" DROP CONSTRAINT "stock_movements_kind_shape";
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_kind_shape" CHECK (
  ("kind" = 'RECEIPT' AND "quantity_delta" > 0 AND "receipt_line_id" IS NOT NULL AND "count_line_id" IS NULL
    AND "import_job_id" IS NULL AND "reason" IS NULL AND "invoice_line_id" IS NULL AND "paid_seq" IS NULL)
  OR ("kind" = 'OPENING' AND "quantity_delta" > 0 AND "import_job_id" IS NOT NULL AND "receipt_line_id" IS NULL
    AND "count_line_id" IS NULL AND "reason" IS NULL AND "invoice_line_id" IS NULL AND "paid_seq" IS NULL)
  OR ("kind" = 'ADJUSTMENT' AND "reason" IS NOT NULL AND "receipt_line_id" IS NULL AND "import_job_id" IS NULL
    AND "invoice_line_id" IS NULL AND "paid_seq" IS NULL
    AND (("reason" = 'COUNT_CORRECTION' AND "count_line_id" IS NOT NULL)
      OR ("reason" <> 'COUNT_CORRECTION' AND "count_line_id" IS NULL AND "quantity_delta" < 0)))
  OR ("kind" = 'SALE' AND "quantity_delta" < 0 AND "invoice_line_id" IS NOT NULL AND "paid_seq" >= 1 AND "reason" IS NULL
    AND "receipt_line_id" IS NULL AND "count_line_id" IS NULL AND "import_job_id" IS NULL)
  OR ("kind" = 'SALE_REVERSAL' AND "quantity_delta" > 0 AND "invoice_line_id" IS NOT NULL AND "paid_seq" >= 1 AND "reason" IS NULL
    AND "receipt_line_id" IS NULL AND "count_line_id" IS NULL AND "import_job_id" IS NULL)
);

-- A reservation is RESERVED (nothing else recorded), CONSUMED (the paid episode and the instant of the sale) or RELEASED (who,
-- when and why, nothing of a sale: a released reservation has had its sale reversed).
ALTER TABLE "stock_reservations" DROP CONSTRAINT "stock_reservations_facts";
ALTER TABLE "stock_reservations" ADD CONSTRAINT "stock_reservations_facts" CHECK (
  ("status" = 'RESERVED' AND "released_at" IS NULL AND "released_by_user_id" IS NULL AND "release_cause" IS NULL
    AND "consumed_paid_seq" IS NULL AND "consumed_at" IS NULL)
  OR ("status" = 'RELEASED' AND "released_at" IS NOT NULL AND "released_by_user_id" IS NOT NULL
      AND "release_cause" IN ('INVOICE_CANCELLED_UNPAID', 'ZERO_BALANCE_CORRECTION')
      AND "consumed_paid_seq" IS NULL AND "consumed_at" IS NULL)
  OR ("status" = 'CONSUMED' AND "consumed_paid_seq" >= 1 AND "consumed_at" IS NOT NULL
      AND "released_at" IS NULL AND "released_by_user_id" IS NULL AND "release_cause" IS NULL)
);

-- ------------------------------------------------------------------------------------------ movements
-- Replaces the P6-4 body: the three original kinds are checked exactly as before; a SALE or SALE_REVERSAL must belong to the
-- CONSUMED reservation of its invoice line (same branch and variant, same paid episode), a sale never takes more than the line's
-- quantity in one episode and a reversal returns, lot by lot, no more than that lot gave.
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
  sold bigint;
  sold_on_lot bigint;
  returned bigint;
  returned_on_lot bigint;
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
  END IF;
  NEW.created_at := clock_timestamp();
  RETURN NEW;
END;
$$;

-- ---------------------------------------------------------------------------------------- reservations
-- Replaces the P6-8 body: the insert and the immutability rules are unchanged, as are the messages of the rules that stay.
CREATE OR REPLACE FUNCTION lucy_guard_stock_reservation() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  target invoices%ROWTYPE;
  line invoice_lines%ROWTYPE;
  detail invoice_line_products%ROWTYPE;
  level stock_levels%ROWTYPE;
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'A stock reservation is history and is never deleted';
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'RESERVED' OR NEW.source <> 'INVOICE_LINE' THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'A stock reservation starts reserved';
    END IF;
    SELECT * INTO target FROM invoices WHERE id = NEW.invoice_id FOR SHARE;
    IF target.status IS DISTINCT FROM 'DRAFT' OR target.branch_id IS DISTINCT FROM NEW.branch_id THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Stock is reserved by the finalization of a draft invoice, at its branch';
    END IF;
    SELECT * INTO line FROM invoice_lines WHERE id = NEW.invoice_line_id;
    SELECT * INTO detail FROM invoice_line_products WHERE invoice_line_id = NEW.invoice_line_id;
    IF detail.invoice_line_id IS NULL OR line.invoice_id IS DISTINCT FROM NEW.invoice_id
      OR detail.variant_id IS DISTINCT FROM NEW.variant_id OR line.quantity IS DISTINCT FROM NEW.quantity THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'A reservation matches the variant and quantity of its product line';
    END IF;
    SELECT * INTO level FROM stock_levels WHERE branch_id = NEW.branch_id AND variant_id = NEW.variant_id FOR UPDATE;
    IF NOT FOUND OR lucy_available_stock(NEW.branch_id, NEW.variant_id) < NEW.quantity THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'There is not enough stock available to reserve';
    END IF;
    NEW.reserved_at := clock_timestamp();
    RETURN NEW;
  END IF;
  IF (NEW.id, NEW.invoice_line_id, NEW.invoice_id, NEW.branch_id, NEW.variant_id, NEW.quantity, NEW.source, NEW.reserved_at,
      NEW.created_by_user_id)
    IS DISTINCT FROM (OLD.id, OLD.invoice_line_id, OLD.invoice_id, OLD.branch_id, OLD.variant_id, OLD.quantity, OLD.source,
      OLD.reserved_at, OLD.created_by_user_id) THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'A stock reservation is immutable apart from being consumed, returned or released';
  END IF;
  SELECT * INTO target FROM invoices WHERE id = OLD.invoice_id FOR SHARE;
  IF OLD.status = 'RESERVED' AND NEW.status = 'RELEASED' THEN
    IF target.status IS DISTINCT FROM 'CANCELLED' THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'A reservation is released only when its invoice is cancelled';
    END IF;
    NEW.released_at := clock_timestamp();
    RETURN NEW;
  ELSIF OLD.status = 'RESERVED' AND NEW.status = 'CONSUMED' THEN
    IF target.status IS DISTINCT FROM 'PAID' OR NEW.consumed_paid_seq IS DISTINCT FROM target.paid_seq THEN
      RAISE EXCEPTION USING ERRCODE = '23514',
        MESSAGE = 'A stock reservation changes only from reserved to released (cancelled invoice) or consumed (paid invoice, current paid episode)';
    END IF;
    NEW.consumed_at := clock_timestamp();
    RETURN NEW;
  ELSIF OLD.status = 'CONSUMED' AND NEW.status = 'RESERVED' THEN
    IF target.status = 'CANCELLED' OR (target.status = 'PAID' AND target.paid_seq = OLD.consumed_paid_seq) THEN
      RAISE EXCEPTION USING ERRCODE = '23514',
        MESSAGE = 'A consumed reservation returns to reserved only when its paid episode has ended and the invoice is not cancelled';
    END IF;
    NEW.consumed_paid_seq := NULL;
    NEW.consumed_at := NULL;
    RETURN NEW;
  ELSIF OLD.status = 'CONSUMED' AND NEW.status = 'RELEASED' THEN
    IF target.status IS DISTINCT FROM 'CANCELLED' THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'A reservation is released only when its invoice is cancelled';
    END IF;
    NEW.consumed_paid_seq := NULL;
    NEW.consumed_at := NULL;
    NEW.released_at := clock_timestamp();
    RETURN NEW;
  END IF;
  RAISE EXCEPTION USING ERRCODE = '23514',
    MESSAGE = 'A stock reservation changes only from reserved to released (cancelled invoice) or consumed (paid invoice), and back from consumed';
END;
$$;

-- The level cache follows the reservation: +quantity when it is taken, -quantity when it is released or consumed (it no longer
-- holds the unit: the sale takes it), +quantity when a consumed reservation comes back, nothing for consumed -> released.
CREATE OR REPLACE FUNCTION lucy_apply_stock_reservation() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  change integer;
BEGIN
  IF TG_OP = 'INSERT' THEN
    change := NEW.quantity;
  ELSIF OLD.status = 'RESERVED' THEN
    change := -OLD.quantity;
  ELSIF NEW.status = 'RESERVED' THEN
    change := OLD.quantity;
  ELSE
    RETURN NULL;
  END IF;
  PERFORM set_config('lucy.stock_reservation', 'on', true);
  UPDATE stock_levels SET reserved = reserved + change
    WHERE branch_id = NEW.branch_id AND variant_id = NEW.variant_id;
  PERFORM set_config('lucy.stock_reservation', 'off', true);
  RETURN NULL;
END;
$$;

-- ----------------------------------------------------------------------------- commit-time invariant
-- Per invoice line: the SALE and SALE_REVERSAL movements of every paid episode add up to minus the line's quantity while its
-- reservation is CONSUMED and to nothing in any other state (a sale is complete or it is not there).
CREATE FUNCTION lucy_check_stock_sales() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  held stock_reservations%ROWTYPE;
  net bigint;
BEGIN
  SELECT r.* INTO held FROM stock_reservations r WHERE r.invoice_line_id = NEW.invoice_line_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'A sale movement needs the reservation of its invoice line';
  END IF;
  SELECT COALESCE(sum(m.quantity_delta), 0) INTO net FROM stock_movements m
    WHERE m.invoice_line_id = NEW.invoice_line_id AND m.kind IN ('SALE', 'SALE_REVERSAL');
  IF net <> (CASE WHEN held.status = 'CONSUMED' THEN -held.quantity ELSE 0 END) THEN
    RAISE EXCEPTION USING ERRCODE = '23514',
      MESSAGE = 'A consumed reservation has sold exactly its quantity and any other reservation has sold nothing';
  END IF;
  RETURN NULL;
END;
$$;
CREATE CONSTRAINT TRIGGER "stock_movements_sales_balance" AFTER INSERT ON "stock_movements"
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW WHEN (NEW.invoice_line_id IS NOT NULL) EXECUTE FUNCTION lucy_check_stock_sales();
CREATE CONSTRAINT TRIGGER "stock_reservations_sales_balance" AFTER UPDATE ON "stock_reservations"
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION lucy_check_stock_sales();

-- CREATE OR REPLACE drops function-level settings and CREATE FUNCTION starts without them: apply the Phase 1 convention
-- (fixed search_path, no PUBLIC execute) to every function this migration touches.
DO $$
DECLARE
  migration_schema text := current_schema();
  function_name text;
BEGIN
  FOREACH function_name IN ARRAY ARRAY[
    'lucy_guard_stock_movement', 'lucy_guard_stock_reservation', 'lucy_apply_stock_reservation', 'lucy_check_stock_sales'
  ] LOOP
    EXECUTE format('ALTER FUNCTION %I.%I() SET search_path TO pg_catalog, %I, pg_temp',
      migration_schema, function_name, migration_schema);
    EXECUTE format('REVOKE ALL ON FUNCTION %I.%I() FROM PUBLIC', migration_schema, function_name);
  END LOOP;
END;
$$;
