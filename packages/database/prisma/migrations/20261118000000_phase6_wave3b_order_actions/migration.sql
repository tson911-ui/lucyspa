-- Phase 6 P6-17 (Wave 3b: working the orders), migration 1 of 1 (design 18.3-18.5, 10.2; T31, T32, OQ-32, OQ-34, OQ-85 to OQ-87).
-- Additive: one table, one column on each of two tables, relaxed NOT NULLs and one new CHECK on the refunds, the replaced bodies of three
-- guards, new commit-time checks, widened notification checks. No row is rewritten, no permission is added or granted.
--
--   product_refunds        a refund may now follow the CANCELLATION of a pre-order line instead of a return case (`order_line_id`; the case
--                          and its ordinal are then empty): in full (OQ-32), nothing returns to stock (the goods never left the shop), the same
--                          immutable record, the same password rule, the same Owner notice and Beauty point reversal as every refund.
--   product_order_lines    the cause of a cancellation must match the state of the line (supplier cannot deliver: not arrived; before the
--                          supplier order: only PAID; change of mind: ORDERED or ARRIVED; lateness: more than 7 days after the expected date,
--                          goods not arrived). A line cancelled by a person on a paid invoice has its full refund by commit.
--   product_order_scans    the daily 08:00 branch-local claim row of the order alert (late lines, goods waiting more than 7 days).
--   product_variants       `usual_supplier_id`: the optional "usual supplier" that groups the "cần đặt" list (OQ-87).
--   notifications          PRODUCT_ORDER_ARRIVED (to the member, about the invoice) and PRODUCT_ORDER_ALERT (to the queue holders, about the
--                          branch); PRODUCT_REFUND_MADE may now be about a ProductOrder.

-- ----------------------------------------------------------------------------------------------- refunds
ALTER TABLE "product_refunds" ALTER COLUMN "return_case_id" DROP NOT NULL;
ALTER TABLE "product_refunds" ALTER COLUMN "case_ordinal" DROP NOT NULL;
ALTER TABLE "product_refunds" ADD COLUMN "order_line_id" UUID;
ALTER TABLE "product_refunds" ADD CONSTRAINT "product_refunds_order_line_id_fkey"
  FOREIGN KEY ("order_line_id") REFERENCES "product_order_lines"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
CREATE UNIQUE INDEX "product_refunds_order_line_key" ON "product_refunds"("order_line_id") WHERE "order_line_id" IS NOT NULL;
ALTER TABLE "product_refunds" ADD CONSTRAINT "product_refunds_origin" CHECK (
  ("return_case_id" IS NOT NULL AND "case_ordinal" IS NOT NULL AND "order_line_id" IS NULL)
  OR ("return_case_id" IS NULL AND "case_ordinal" IS NULL AND "order_line_id" IS NOT NULL AND "restock" = 'NOT_SELLABLE'));

-- Replaces the P6-15 body of the order line guard: the same moves and facts, with the cancellation causes tied to the state of the line.
CREATE OR REPLACE FUNCTION lucy_guard_product_order_line() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  target invoices%ROWTYPE;
  detail invoice_line_products%ROWTYPE;
  sold invoice_lines%ROWTYPE;
  ord product_orders%ROWTYPE;
  chosen product_variants%ROWTYPE;
  defaults product_settings%ROWTYPE;
  lead_min integer;
  lead_max integer;
  paid_day date;
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'A product order line is history and is never deleted';
  END IF;
  IF TG_OP = 'INSERT' THEN
    SELECT * INTO target FROM invoices WHERE id = NEW.invoice_id FOR SHARE;
    SELECT * INTO ord FROM product_orders WHERE id = NEW.order_id;
    SELECT * INTO detail FROM invoice_line_products WHERE invoice_line_id = NEW.invoice_line_id;
    SELECT * INTO sold FROM invoice_lines WHERE id = NEW.invoice_line_id;
    IF NOT FOUND OR target.status <> 'DRAFT' OR ord.id IS NULL OR ord.invoice_id <> NEW.invoice_id
       OR detail.invoice_line_id IS NULL OR detail.fulfilment_mode <> 'PRE_ORDER' THEN
      RAISE EXCEPTION USING ERRCODE = '23514',
        MESSAGE = 'An order line is created by the finalization of a draft invoice, for a pre-order product line';
    END IF;
    IF NEW.status <> 'AWAITING_PAYMENT' OR NEW.branch_id <> target.branch_id OR NEW.variant_id <> detail.variant_id
       OR NEW.quantity IS DISTINCT FROM sold.quantity OR NEW.row_version <> 1 THEN
      RAISE EXCEPTION USING ERRCODE = '23514',
        MESSAGE = 'An order line starts awaiting payment with the branch, variant and quantity of its invoice line';
    END IF;
    NEW.created_at := clock_timestamp();
    NEW.updated_at := NEW.created_at;
    RETURN NEW;
  END IF;
  IF (NEW.id, NEW.order_id, NEW.invoice_id, NEW.invoice_line_id, NEW.branch_id, NEW.variant_id, NEW.quantity, NEW.created_at)
    IS DISTINCT FROM (OLD.id, OLD.order_id, OLD.invoice_id, OLD.invoice_line_id, OLD.branch_id, OLD.variant_id, OLD.quantity,
      OLD.created_at) THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'The identity of an order line never changes';
  END IF;
  IF NEW.status = OLD.status THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'An order line changes only by moving to its next status';
  END IF;
  IF NOT (
    (OLD.status = 'AWAITING_PAYMENT' AND NEW.status IN ('PAID', 'CANCELLED'))
    OR (OLD.status = 'PAID' AND NEW.status IN ('AWAITING_PAYMENT', 'ORDERED', 'ARRIVED', 'CANCELLED'))
    OR (OLD.status = 'ORDERED' AND NEW.status IN ('ARRIVED', 'CANCELLED'))
    OR (OLD.status = 'ARRIVED' AND NEW.status IN ('HANDED_OVER', 'CANCELLED'))
    OR (OLD.status = 'HANDED_OVER' AND NEW.status = 'COMPLETED')) THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Illegal order line status transition';
  END IF;
  SELECT * INTO target FROM invoices WHERE id = OLD.invoice_id FOR SHARE;
  -- What an earlier status recorded is kept: these columns are written only by the move that sets them.
  IF NEW.status <> 'AWAITING_PAYMENT' AND OLD.status <> 'AWAITING_PAYMENT'
     AND (NEW.paid_at, NEW.expected_from, NEW.expected_to) IS DISTINCT FROM (OLD.paid_at, OLD.expected_from, OLD.expected_to) THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'The paid time and the expected range are fixed at payment';
  END IF;
  IF OLD.ordered_at IS NOT NULL AND (NEW.ordered_at, NEW.ordered_by_user_id, NEW.ordered_note)
       IS DISTINCT FROM (OLD.ordered_at, OLD.ordered_by_user_id, OLD.ordered_note) THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'What was recorded about the supplier order is kept';
  END IF;
  IF NEW.status = 'PAID' THEN
    IF target.status <> 'PAID' OR target.paid_at IS NULL THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'An order line is paid when its invoice is paid';
    END IF;
    SELECT * INTO chosen FROM product_variants WHERE id = OLD.variant_id;
    SELECT * INTO defaults FROM product_settings WHERE id = 1;
    lead_min := COALESCE(chosen.lead_time_days_min, defaults.lead_time_days_min);
    lead_max := GREATEST(COALESCE(chosen.lead_time_days_max, defaults.lead_time_days_max), lead_min);
    paid_day := lucy_branch_local_date(OLD.branch_id, target.paid_at);
    NEW.paid_at := target.paid_at;
    NEW.expected_from := paid_day + lead_min;
    NEW.expected_to := paid_day + lead_max;
  ELSIF NEW.status = 'AWAITING_PAYMENT' THEN
    IF target.status <> 'PENDING_PAYMENT' THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'An order line awaits payment only when its invoice is back to pending payment';
    END IF;
    NEW.paid_at := NULL;
    NEW.expected_from := NULL;
    NEW.expected_to := NULL;
  ELSIF NEW.status = 'ORDERED' THEN
    IF target.status <> 'PAID' THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Goods are ordered only for a paid invoice';
    END IF;
    NEW.ordered_at := clock_timestamp();
  ELSIF NEW.status = 'ARRIVED' THEN
    IF target.status <> 'PAID' THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Goods arrive only for a paid invoice';
    END IF;
    NEW.arrived_at := clock_timestamp();
  ELSIF NEW.status = 'HANDED_OVER' THEN
    IF target.status <> 'PAID' THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Goods are handed over only for a paid invoice';
    END IF;
    NEW.handed_over_at := clock_timestamp();
  ELSIF NEW.status = 'COMPLETED' THEN
    NEW.completed_at := clock_timestamp();
  ELSIF NEW.status = 'CANCELLED' THEN
    IF NEW.cancel_cause = 'INVOICE_CANCELLED' THEN
      IF target.status <> 'CANCELLED' OR OLD.status NOT IN ('AWAITING_PAYMENT', 'PAID') THEN
        RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'The cancellation of the invoice cancels an order line that was not yet ordered';
      END IF;
    ELSIF target.status <> 'PAID' OR OLD.status = 'AWAITING_PAYMENT' THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'A paid order line is cancelled while its invoice stays paid';
    ELSIF NEW.cancel_cause = 'CUSTOMER_CANCELLED_BEFORE_ORDERING' AND OLD.status <> 'PAID' THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'A cancellation before the supplier order is only for a line that was not ordered yet';
    ELSIF NEW.cancel_cause = 'SUPPLIER_CANNOT_DELIVER' AND OLD.status NOT IN ('PAID', 'ORDERED') THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'A supplier that cannot deliver cancels a line whose goods have not arrived';
    ELSIF NEW.cancel_cause = 'CUSTOMER_CHANGED_MIND' AND OLD.status NOT IN ('ORDERED', 'ARRIVED') THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'A change of mind after the supplier order is for an ordered or arrived line';
    ELSIF NEW.cancel_cause = 'LATE_OVER_7_DAYS' AND (OLD.status NOT IN ('PAID', 'ORDERED') OR OLD.expected_to IS NULL
        OR lucy_branch_local_date(OLD.branch_id, clock_timestamp()) <= OLD.expected_to + 7) THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'A line is cancelled for lateness only more than 7 days after its expected date, before its goods arrived';
    END IF;
    NEW.cancelled_at := clock_timestamp();
  END IF;
  NEW.row_version := OLD.row_version + 1;
  NEW.updated_at := clock_timestamp();
  RETURN NEW;
END;
$$;

-- Replaces the P6-15 body of the commit-time check: a cancelled paid line has its full refund.
CREATE OR REPLACE FUNCTION lucy_check_product_orders() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  invoice_id_value uuid;
  target invoices%ROWTYPE;
  pre_count integer;
  order_count integer;
  line_count integer;
BEGIN
  IF TG_TABLE_NAME = 'invoices' THEN
    invoice_id_value := NEW.id;
  ELSE
    invoice_id_value := NEW.invoice_id;
  END IF;
  SELECT * INTO target FROM invoices WHERE id = invoice_id_value;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;
  SELECT count(*) INTO pre_count FROM invoice_line_products WHERE invoice_id = target.id AND fulfilment_mode = 'PRE_ORDER';
  SELECT count(*) INTO order_count FROM product_orders WHERE invoice_id = target.id;
  SELECT count(*) INTO line_count FROM product_order_lines WHERE invoice_id = target.id;
  IF target.finalized_at IS NULL THEN
    IF order_count > 0 OR line_count > 0 THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'A draft invoice has no product order';
    END IF;
    RETURN NULL;
  END IF;
  IF (pre_count = 0 AND (order_count > 0 OR line_count > 0)) OR (pre_count > 0 AND (order_count <> 1 OR line_count <> pre_count)) THEN
    RAISE EXCEPTION USING ERRCODE = '23514',
      MESSAGE = 'A finalized invoice has one order with exactly one order line for each of its pre-order lines';
  END IF;
  IF pre_count = 0 THEN
    RETURN NULL;
  END IF;
  IF EXISTS (
    SELECT 1 FROM invoice_line_products d JOIN invoice_lines l ON l.id = d.invoice_line_id
    WHERE d.invoice_id = target.id AND d.fulfilment_mode = 'PRE_ORDER'
      AND NOT EXISTS (SELECT 1 FROM product_order_lines o
        WHERE o.invoice_line_id = d.invoice_line_id AND o.variant_id = d.variant_id AND o.quantity = l.quantity
          AND o.branch_id = target.branch_id)) THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'An order line matches the variant and quantity of its pre-order line';
  END IF;
  IF (target.status = 'PENDING_PAYMENT' AND EXISTS (
        SELECT 1 FROM product_order_lines WHERE invoice_id = target.id AND status <> 'AWAITING_PAYMENT'))
    OR (target.status = 'PAID' AND EXISTS (
        SELECT 1 FROM product_order_lines WHERE invoice_id = target.id AND status = 'AWAITING_PAYMENT'))
    OR (target.status = 'CANCELLED' AND EXISTS (
        SELECT 1 FROM product_order_lines WHERE invoice_id = target.id AND status <> 'CANCELLED')) THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'The order lines follow the payment status of their invoice';
  END IF;
  IF EXISTS (
    SELECT 1 FROM product_order_lines o
      LEFT JOIN stock_reservations r ON r.invoice_line_id = o.invoice_line_id AND r.source = 'ORDER_LINE'
    WHERE o.invoice_id = target.id AND (
      (o.status IN ('AWAITING_PAYMENT', 'PAID', 'ORDERED') AND r.id IS NULL)
      OR (o.status = 'ARRIVED' AND r.status = 'RESERVED' AND r.quantity = o.quantity AND r.variant_id = o.variant_id
          AND r.branch_id = o.branch_id)
      OR (o.status = 'HANDED_OVER' AND r.status IN ('RESERVED', 'CONSUMED') AND r.quantity = o.quantity
          AND r.variant_id = o.variant_id AND r.branch_id = o.branch_id)
      OR (o.status = 'COMPLETED' AND r.status = 'CONSUMED' AND r.quantity = o.quantity AND r.variant_id = o.variant_id
          AND r.branch_id = o.branch_id)
      OR (o.status = 'CANCELLED' AND (r.id IS NULL OR r.status = 'RELEASED'))) IS NOT TRUE) THEN
    RAISE EXCEPTION USING ERRCODE = '23514',
      MESSAGE = 'The goods reserved for an order line follow its status: held when arrived, sold when completed, released when cancelled';
  END IF;
  -- A line cancelled by a person on a paid invoice is refunded in full (OQ-32); a line with nothing paid for it needs no refund.
  IF EXISTS (
    SELECT 1 FROM product_order_lines o JOIN invoice_line_allocations a ON a.invoice_line_id = o.invoice_line_id
    WHERE o.invoice_id = target.id AND o.status = 'CANCELLED' AND o.cancel_cause <> 'INVOICE_CANCELLED' AND a.net_vnd > 0
      AND NOT EXISTS (SELECT 1 FROM product_refunds r WHERE r.order_line_id = o.id)) THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'A cancelled paid order line is refunded in full';
  END IF;
  IF EXISTS (
    SELECT 1 FROM stock_reservations r
    WHERE r.invoice_id = target.id AND r.source = 'ORDER_LINE'
      AND NOT EXISTS (SELECT 1 FROM product_order_lines o WHERE o.invoice_line_id = r.invoice_line_id)) THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Goods are reserved for an order line only';
  END IF;
  RETURN NULL;
END;
$$;

-- Replaces the P6-14 body of the refund guard: a refund follows an accepted return case OR the cancellation of a pre-order line.
CREATE OR REPLACE FUNCTION lucy_guard_product_refund() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  inv RECORD;
  kase product_return_cases%ROWTYPE;
  oline product_order_lines%ROWTYPE;
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
  IF NEW.order_line_id IS NULL THEN
    SELECT c.* INTO kase FROM product_return_cases c WHERE c.id = NEW.return_case_id FOR SHARE;
    IF NOT FOUND OR kase.status <> 'ACCEPTED' OR kase.decided_outcome IS DISTINCT FROM 'REFUND'
       OR kase.invoice_id <> NEW.invoice_id OR kase.invoice_line_id <> NEW.invoice_line_id OR kase.branch_id <> NEW.branch_id THEN
      RAISE EXCEPTION USING ERRCODE = '23514',
        MESSAGE = 'A refund follows an accepted return case that was decided as a refund, for its own line';
    END IF;
  ELSE
    -- Phase 6 P6-17 (OQ-32): the refund of a cancelled pre-order line, in full. The goods never left the shop, so nothing is returned.
    SELECT o.* INTO oline FROM product_order_lines o WHERE o.id = NEW.order_line_id FOR SHARE;
    IF NOT FOUND OR oline.status <> 'CANCELLED' OR oline.cancel_cause = 'INVOICE_CANCELLED'
       OR oline.invoice_id <> NEW.invoice_id OR oline.invoice_line_id <> NEW.invoice_line_id OR oline.branch_id <> NEW.branch_id THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'A refund of an order line follows its cancellation by a person, for its own line';
    END IF;
    IF NEW.quantity <> oline.quantity THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'A cancelled order line is refunded in full';
    END IF;
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
  IF NEW.order_line_id IS NULL THEN
    SELECT COALESCE(sum(r.quantity), 0), count(*) INTO prior_case_units, prior_case_count
      FROM product_refunds r WHERE r.return_case_id = NEW.return_case_id;
    IF prior_case_units + NEW.quantity > kase.quantity THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'A case cannot be refunded more units than it accepted';
    END IF;
    IF NEW.case_ordinal <> prior_case_count + 1 THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'The refunds of a case are numbered in order';
    END IF;
  ELSIF prior_units <> 0 THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'A cancelled order line is refunded in full and has no other claim';
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

CREATE CONSTRAINT TRIGGER "product_refund_order_lines_integrity" AFTER INSERT ON "product_refunds"
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW WHEN (NEW.order_line_id IS NOT NULL) EXECUTE FUNCTION lucy_check_product_orders();

-- ------------------------------------------------------------------------------------------ daily scan
CREATE TABLE "product_order_scans" (
    "branch_id" UUID NOT NULL,
    "business_date" DATE NOT NULL,
    "late_lines" INTEGER NOT NULL,
    "held_lines" INTEGER NOT NULL,
    "outcome" TEXT NOT NULL,
    "scanned_at" TIMESTAMPTZ(3) NOT NULL DEFAULT clock_timestamp(),

    CONSTRAINT "product_order_scans_pkey" PRIMARY KEY ("branch_id", "business_date"),
    CONSTRAINT "product_order_scans_values" CHECK ("late_lines" >= 0 AND "held_lines" >= 0),
    CONSTRAINT "product_order_scans_outcome" CHECK ("outcome" IN ('PUBLISHED', 'NOTHING_TO_REPORT', 'UNROUTABLE'))
);
ALTER TABLE "product_order_scans" ADD CONSTRAINT "product_order_scans_branch_id_fkey"
  FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
CREATE FUNCTION lucy_guard_product_order_scan() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP <> 'INSERT' THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'An order scan is history and is never changed or deleted';
  END IF;
  NEW.scanned_at := clock_timestamp();
  RETURN NEW;
END;
$$;
CREATE TRIGGER "product_order_scans_guard" BEFORE INSERT OR UPDATE OR DELETE ON "product_order_scans"
FOR EACH ROW EXECUTE FUNCTION lucy_guard_product_order_scan();
CREATE TRIGGER "product_order_scans_no_truncate" BEFORE TRUNCATE ON "product_order_scans"
FOR EACH STATEMENT EXECUTE FUNCTION lucy_guard_product_order_truncate();

-- ------------------------------------------------------------------------------------- usual supplier
ALTER TABLE "product_variants" ADD COLUMN "usual_supplier_id" UUID;
ALTER TABLE "product_variants" ADD CONSTRAINT "product_variants_usual_supplier_id_fkey"
  FOREIGN KEY ("usual_supplier_id") REFERENCES "suppliers"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
CREATE INDEX "product_variants_usual_supplier_idx" ON "product_variants"("usual_supplier_id") WHERE "usual_supplier_id" IS NOT NULL;

-- ------------------------------------------------------------------------------------ notifications
-- Same method as 20261114000000: the closed type CHECK and the type/entity pairing are widened, never narrowed.
ALTER TABLE "notifications"
  DROP CONSTRAINT "notifications_type_check",
  ADD CONSTRAINT "notifications_type_check" CHECK ("type" IN (
    'BOOKING_CREATED', 'BOOKING_CANCELLED', 'LATE_CANCELLATION', 'BOOKING_NO_SHOW', 'CUSTOMER_ARRIVED',
    'BOOKING_KTV_CONFLICT', 'KTV_REASSIGNED', 'START_OVERDUE', 'PRE_END', 'END_OVERDUE',
    'LEAVE_REQUESTED', 'LEAVE_DECIDED',
    'INVOICE_PAID', 'INVOICE_CANCELLED', 'PAYOS_PAYMENT_SUCCEEDED', 'PAYOS_PAYMENT_ANOMALY', 'PAYMENT_REVERSED',
    'INVOICE_CANCELLED_ALERT', 'REVENUE_DAILY_SUMMARY',
    'LOW_STOCK_REACHED', 'EXPIRY_ALERT', 'EXPIRED_LOT_SOLD', 'PRODUCT_RETURN_OPENED', 'PRODUCT_REFUND_MADE',
    'PRODUCT_ORDER_ARRIVED', 'PRODUCT_ORDER_ALERT')),
  DROP CONSTRAINT "notifications_entity_type_check",
  ADD CONSTRAINT "notifications_entity_type_check" CHECK ("entity_type" IN
    ('Booking', 'Visit', 'LeaveRequest', 'Invoice', 'Branch', 'ProductVariant', 'ProductReturnCase', 'ProductOrder')),
  DROP CONSTRAINT "notifications_type_entity",
  ADD CONSTRAINT "notifications_type_entity" CHECK (
    (("type" LIKE 'LEAVE\_%') = ("entity_type" = 'LeaveRequest'))
    AND (("type" IN ('INVOICE_PAID', 'INVOICE_CANCELLED', 'PAYOS_PAYMENT_SUCCEEDED', 'PAYOS_PAYMENT_ANOMALY',
                     'PAYMENT_REVERSED', 'INVOICE_CANCELLED_ALERT', 'PRODUCT_ORDER_ARRIVED')) = ("entity_type" = 'Invoice'))
    AND (("type" IN ('REVENUE_DAILY_SUMMARY', 'EXPIRY_ALERT', 'PRODUCT_ORDER_ALERT')) = ("entity_type" = 'Branch'))
    AND (("type" IN ('LOW_STOCK_REACHED', 'EXPIRED_LOT_SOLD')) = ("entity_type" = 'ProductVariant'))
    AND (
      ("type" = 'PRODUCT_RETURN_OPENED' AND "entity_type" = 'ProductReturnCase')
      OR ("type" = 'PRODUCT_REFUND_MADE' AND "entity_type" IN ('ProductReturnCase', 'ProductOrder'))
      OR ("type" NOT IN ('PRODUCT_RETURN_OPENED', 'PRODUCT_REFUND_MADE')
          AND "entity_type" NOT IN ('ProductReturnCase', 'ProductOrder'))));

-- The Phase 1 convention (fixed search_path, no PUBLIC execute) for every function this migration creates or replaces.
DO $$
DECLARE
  migration_schema text := current_schema();
  function_name text;
BEGIN
  FOREACH function_name IN ARRAY ARRAY[
    'lucy_guard_product_order_line', 'lucy_check_product_orders', 'lucy_guard_product_refund', 'lucy_guard_product_order_scan'
  ] LOOP
    EXECUTE format('ALTER FUNCTION %I.%I() SET search_path TO pg_catalog, %I, pg_temp',
      migration_schema, function_name, migration_schema);
    EXECUTE format('REVOKE ALL ON FUNCTION %I.%I() FROM PUBLIC', migration_schema, function_name);
  END LOOP;
END;
$$;
