-- Phase 6 P6-15 (Wave 3b: product orders), migration 2 of 2 (design 18.3-18.5, 10.2; T28-T32, OQ-29 to OQ-37, OQ-84).
-- Additive: three tables, four enums, one sequence, one column on invoice_line_products, one replaced CHECK on stock_reservations, the replaced
-- bodies of five guards, new guards and constraint triggers. No existing row is rewritten, no permission is granted, nothing is deleted.
--
--   product_orders          the goods record of ONE invoice that has at least one PRE_ORDER product line (a pre-order is sold for goods the
--                           shop does not hold; T28). One order per invoice. The invoice stays the money record: nothing about money lives here.
--   product_order_lines     one per PRE_ORDER invoice line. One-way statuses (T32): AWAITING_PAYMENT -> PAID -> ORDERED -> ARRIVED ->
--                           HANDED_OVER -> COMPLETED, or CANCELLED from the first four (a cancellation after payment is refunded by the
--                           refund Step; here only the facts are kept). The rows are created by the finalization of the invoice (still a DRAFT
--                           in that transaction, like a stock reservation) and moved to PAID, back to AWAITING_PAYMENT (a payment reversal
--                           before anything was ordered) or to CANCELLED (an unpaid invoice cancelled) by a trigger on the invoice status, so
--                           every way of paying (cash, PayOS webhook, a zero balance) is covered by one rule. The expected arrival range is
--                           fixed at payment: the branch-local paid date plus the variant's lead time (or the settings default), "dự kiến".
--   product_order_events    append-only history, written by a trigger from every change of a line (who, when, from, to, note).
--   stock_reservations      gains the source ORDER_LINE: goods that ARRIVED are reserved for the named order line (whole line only, T30),
--                           consumed (a SALE movement per lot, by the same stock-sale machinery) only at HANDED_OVER (T31) and released when the
--                           line is cancelled. A pre-order line holds no reservation until its goods arrive.
--   T22 (extended)          an invoice whose pre-order was already ORDERED (or further) keeps its payments and stays paid.
--   Returns                 no return case on a pre-order line before its goods were handed over and sold; the window counts from the hand-over.
--
-- Money is integer VND and none is stored here. Timestamps are UTC; business dates use the branch timezone.

CREATE TYPE "ProductLineMode" AS ENUM ('IN_STOCK', 'PRE_ORDER');
CREATE TYPE "ProductOrderLineStatus" AS ENUM
  ('AWAITING_PAYMENT', 'PAID', 'ORDERED', 'ARRIVED', 'HANDED_OVER', 'COMPLETED', 'CANCELLED');
-- OQ-32: the supplier cannot deliver / the customer cancels before the supplier order / the customer changes their mind after it (the
-- Owner or a manager decides) / more than 7 days past the expected date. INVOICE_CANCELLED is the system cause (an unpaid invoice cancelled).
CREATE TYPE "ProductOrderCancelCause" AS ENUM
  ('INVOICE_CANCELLED', 'SUPPLIER_CANNOT_DELIVER', 'CUSTOMER_CANCELLED_BEFORE_ORDERING', 'CUSTOMER_CHANGED_MIND', 'LATE_OVER_7_DAYS');
CREATE TYPE "ProductHandoverTo" AS ENUM ('CUSTOMER', 'REPRESENTATIVE');
CREATE SEQUENCE "product_order_code_seq" AS BIGINT START 1;

-- -------------------------------------------------------------------------------------------- the line mode
ALTER TABLE "invoice_line_products" ADD COLUMN "fulfilment_mode" "ProductLineMode" NOT NULL DEFAULT 'IN_STOCK';

-- --------------------------------------------------------------------------------------------------- orders
CREATE TABLE "product_orders" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "code" VARCHAR(40) NOT NULL,
    "invoice_id" UUID NOT NULL,
    "branch_id" UUID NOT NULL,
    "channel" "InvoiceChannel" NOT NULL DEFAULT 'COUNTER',
    "customer_user_id" UUID,
    "contact_phone" VARCHAR(16) NOT NULL,
    "contact_name" VARCHAR(120),
    "created_by_user_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT clock_timestamp(),
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT clock_timestamp(),

    CONSTRAINT "product_orders_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "product_orders_code" CHECK (btrim("code") <> ''),
    -- A phone number is mandatory on a pre-order (OQ-34), stored in the canonical +84 form.
    CONSTRAINT "product_orders_phone" CHECK (("contact_phone" = lucy_phone_canonical("contact_phone")) IS TRUE),
    CONSTRAINT "product_orders_name" CHECK ("contact_name" IS NULL OR btrim("contact_name") <> ''),
    -- Counter only until the online wave (Wave 4) lifts it.
    CONSTRAINT "product_orders_counter" CHECK ("channel" = 'COUNTER')
);
CREATE UNIQUE INDEX "product_orders_code_key" ON "product_orders"("code");
CREATE UNIQUE INDEX "product_orders_invoice_key" ON "product_orders"("invoice_id");
CREATE INDEX "product_orders_branch_idx" ON "product_orders"("branch_id", "created_at" DESC, "id");
CREATE INDEX "product_orders_customer_idx" ON "product_orders"("customer_user_id") WHERE "customer_user_id" IS NOT NULL;
CREATE INDEX "product_orders_phone_idx" ON "product_orders"("contact_phone");
ALTER TABLE "product_orders" ADD CONSTRAINT "product_orders_invoice_id_fkey"
  FOREIGN KEY ("invoice_id") REFERENCES "invoices"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "product_orders" ADD CONSTRAINT "product_orders_branch_id_fkey"
  FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "product_orders" ADD CONSTRAINT "product_orders_customer_user_id_fkey"
  FOREIGN KEY ("customer_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "product_orders" ADD CONSTRAINT "product_orders_created_by_user_id_fkey"
  FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- ------------------------------------------------------------------------------------------- order lines
CREATE TABLE "product_order_lines" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "order_id" UUID NOT NULL,
    "invoice_id" UUID NOT NULL,
    "invoice_line_id" UUID NOT NULL,
    "branch_id" UUID NOT NULL,
    "variant_id" UUID NOT NULL,
    "quantity" INTEGER NOT NULL,
    "status" "ProductOrderLineStatus" NOT NULL DEFAULT 'AWAITING_PAYMENT',
    "paid_at" TIMESTAMPTZ(3),
    "expected_from" DATE,
    "expected_to" DATE,
    "ordered_at" TIMESTAMPTZ(3),
    "ordered_by_user_id" UUID,
    "ordered_note" TEXT,
    "arrived_at" TIMESTAMPTZ(3),
    "arrived_by_user_id" UUID,
    "arrival_receipt_id" UUID,
    "handed_over_at" TIMESTAMPTZ(3),
    "handed_over_by_user_id" UUID,
    "handed_over_to" "ProductHandoverTo",
    "handed_over_to_name" VARCHAR(120),
    "handed_over_note" TEXT,
    "completed_at" TIMESTAMPTZ(3),
    "cancelled_at" TIMESTAMPTZ(3),
    "cancelled_by_user_id" UUID,
    "cancel_cause" "ProductOrderCancelCause",
    "cancel_note" TEXT,
    "row_version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT clock_timestamp(),
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT clock_timestamp(),

    CONSTRAINT "product_order_lines_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "product_order_lines_quantity" CHECK ("quantity" >= 1),
    CONSTRAINT "product_order_lines_expected" CHECK (("expected_from" IS NULL) = ("expected_to" IS NULL)
      AND ("expected_from" IS NULL OR "expected_from" <= "expected_to")),
    CONSTRAINT "product_order_lines_notes" CHECK (
      ("ordered_note" IS NULL OR btrim("ordered_note") <> '') AND ("handed_over_note" IS NULL OR btrim("handed_over_note") <> '')
      AND ("cancel_note" IS NULL OR btrim("cancel_note") <> '')
      AND ("handed_over_to_name" IS NULL OR btrim("handed_over_to_name") <> '')),
    -- Each status records exactly the facts that lead to it (a later fact never exists without the earlier ones).
    CONSTRAINT "product_order_lines_facts" CHECK (
      ("status" = 'AWAITING_PAYMENT' AND "paid_at" IS NULL AND "expected_from" IS NULL AND "ordered_at" IS NULL
        AND "ordered_by_user_id" IS NULL AND "arrived_at" IS NULL AND "handed_over_at" IS NULL AND "completed_at" IS NULL
        AND "cancelled_at" IS NULL AND "cancel_cause" IS NULL)
      OR ("status" = 'PAID' AND "paid_at" IS NOT NULL AND "expected_from" IS NOT NULL AND "ordered_at" IS NULL
        AND "ordered_by_user_id" IS NULL AND "arrived_at" IS NULL AND "handed_over_at" IS NULL AND "completed_at" IS NULL
        AND "cancelled_at" IS NULL AND "cancel_cause" IS NULL)
      OR ("status" = 'ORDERED' AND "paid_at" IS NOT NULL AND "expected_from" IS NOT NULL AND "ordered_at" IS NOT NULL
        AND "ordered_by_user_id" IS NOT NULL AND "arrived_at" IS NULL AND "handed_over_at" IS NULL AND "completed_at" IS NULL
        AND "cancelled_at" IS NULL AND "cancel_cause" IS NULL)
      OR ("status" = 'ARRIVED' AND "paid_at" IS NOT NULL AND "expected_from" IS NOT NULL AND "arrived_at" IS NOT NULL
        AND "handed_over_at" IS NULL AND "completed_at" IS NULL AND "cancelled_at" IS NULL AND "cancel_cause" IS NULL)
      OR ("status" = 'HANDED_OVER' AND "paid_at" IS NOT NULL AND "arrived_at" IS NOT NULL AND "handed_over_at" IS NOT NULL
        AND "handed_over_by_user_id" IS NOT NULL AND "handed_over_to" IS NOT NULL AND "completed_at" IS NULL
        AND "cancelled_at" IS NULL AND "cancel_cause" IS NULL)
      OR ("status" = 'COMPLETED' AND "paid_at" IS NOT NULL AND "arrived_at" IS NOT NULL AND "handed_over_at" IS NOT NULL
        AND "handed_over_by_user_id" IS NOT NULL AND "handed_over_to" IS NOT NULL AND "completed_at" IS NOT NULL
        AND "cancelled_at" IS NULL AND "cancel_cause" IS NULL)
      OR ("status" = 'CANCELLED' AND "cancelled_at" IS NOT NULL AND "cancel_cause" IS NOT NULL AND "handed_over_at" IS NULL
        AND "completed_at" IS NULL
        AND (("cancel_cause" = 'INVOICE_CANCELLED' AND "cancelled_by_user_id" IS NULL)
          OR ("cancel_cause" <> 'INVOICE_CANCELLED' AND "cancelled_by_user_id" IS NOT NULL AND "cancel_note" IS NOT NULL)))),
    -- Handing the goods to somebody else names them (OQ-85); to the customer, nobody is named.
    CONSTRAINT "product_order_lines_handover_to" CHECK (
      ("handed_over_to" IS NULL AND "handed_over_to_name" IS NULL)
      OR ("handed_over_to" = 'CUSTOMER' AND "handed_over_to_name" IS NULL)
      OR ("handed_over_to" = 'REPRESENTATIVE' AND "handed_over_to_name" IS NOT NULL))
);
CREATE UNIQUE INDEX "product_order_lines_line_key" ON "product_order_lines"("invoice_line_id");
CREATE INDEX "product_order_lines_order_idx" ON "product_order_lines"("order_id");
CREATE INDEX "product_order_lines_invoice_idx" ON "product_order_lines"("invoice_id");
-- The waiting queue (T30): per (branch, variant), oldest paid first.
CREATE INDEX "product_order_lines_queue_idx" ON "product_order_lines"("branch_id", "variant_id", "paid_at", "id")
  WHERE "status" IN ('PAID', 'ORDERED');
CREATE INDEX "product_order_lines_status_idx" ON "product_order_lines"("branch_id", "status", "paid_at");
ALTER TABLE "product_order_lines" ADD CONSTRAINT "product_order_lines_order_id_fkey"
  FOREIGN KEY ("order_id") REFERENCES "product_orders"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "product_order_lines" ADD CONSTRAINT "product_order_lines_line_fkey"
  FOREIGN KEY ("invoice_id", "invoice_line_id") REFERENCES "invoice_lines"("invoice_id", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "product_order_lines" ADD CONSTRAINT "product_order_lines_product_line_fkey"
  FOREIGN KEY ("invoice_line_id") REFERENCES "invoice_line_products"("invoice_line_id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "product_order_lines" ADD CONSTRAINT "product_order_lines_branch_id_fkey"
  FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "product_order_lines" ADD CONSTRAINT "product_order_lines_variant_id_fkey"
  FOREIGN KEY ("variant_id") REFERENCES "product_variants"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "product_order_lines" ADD CONSTRAINT "product_order_lines_ordered_by_user_id_fkey"
  FOREIGN KEY ("ordered_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "product_order_lines" ADD CONSTRAINT "product_order_lines_arrived_by_user_id_fkey"
  FOREIGN KEY ("arrived_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "product_order_lines" ADD CONSTRAINT "product_order_lines_arrival_receipt_id_fkey"
  FOREIGN KEY ("arrival_receipt_id") REFERENCES "stock_receipts"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "product_order_lines" ADD CONSTRAINT "product_order_lines_handed_over_by_user_id_fkey"
  FOREIGN KEY ("handed_over_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "product_order_lines" ADD CONSTRAINT "product_order_lines_cancelled_by_user_id_fkey"
  FOREIGN KEY ("cancelled_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- ------------------------------------------------------------------------------------------------ events
CREATE TABLE "product_order_events" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "order_line_id" UUID NOT NULL,
    "from_status" "ProductOrderLineStatus",
    "to_status" "ProductOrderLineStatus" NOT NULL,
    "actor_user_id" UUID,
    "note" TEXT,
    "occurred_at" TIMESTAMPTZ(3) NOT NULL DEFAULT clock_timestamp(),

    CONSTRAINT "product_order_events_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "product_order_events_note" CHECK ("note" IS NULL OR btrim("note") <> '')
);
CREATE INDEX "product_order_events_line_idx" ON "product_order_events"("order_line_id", "occurred_at", "id");
ALTER TABLE "product_order_events" ADD CONSTRAINT "product_order_events_order_line_id_fkey"
  FOREIGN KEY ("order_line_id") REFERENCES "product_order_lines"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "product_order_events" ADD CONSTRAINT "product_order_events_actor_user_id_fkey"
  FOREIGN KEY ("actor_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- ----------------------------------------------------------------------- the reservation: a second source
ALTER TABLE "stock_reservations" DROP CONSTRAINT "stock_reservations_facts";
ALTER TABLE "stock_reservations" ADD CONSTRAINT "stock_reservations_facts" CHECK (
  ("status" = 'RESERVED' AND "released_at" IS NULL AND "released_by_user_id" IS NULL AND "release_cause" IS NULL
    AND "consumed_paid_seq" IS NULL AND "consumed_at" IS NULL)
  OR ("status" = 'RELEASED' AND "released_at" IS NOT NULL AND "released_by_user_id" IS NOT NULL
      AND (("source" = 'INVOICE_LINE' AND "release_cause" IN ('INVOICE_CANCELLED_UNPAID', 'ZERO_BALANCE_CORRECTION'))
        OR ("source" = 'ORDER_LINE' AND "release_cause" = 'ORDER_LINE_CANCELLED'))
      AND "consumed_paid_seq" IS NULL AND "consumed_at" IS NULL)
  OR ("status" = 'CONSUMED' AND "consumed_paid_seq" >= 1 AND "consumed_at" IS NOT NULL
      AND "released_at" IS NULL AND "released_by_user_id" IS NULL AND "release_cause" IS NULL)
);

-- -------------------------------------------------------------------------------------- the invoice line
-- Replaces the P6-8 body: a PRE_ORDER line is allowed only for a variant that is sold on order (OQ-30, OQ-37); the mode is part of the
-- copy that is never rewritten. Everything else is as it was.
CREATE OR REPLACE FUNCTION lucy_guard_invoice_line_product() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  target invoices%ROWTYPE;
  line invoice_lines%ROWTYPE;
  chosen product_variants%ROWTYPE;
  item products%ROWTYPE;
BEGIN
  SELECT * INTO target FROM invoices WHERE id = NEW.invoice_id FOR SHARE;
  IF target.status IS DISTINCT FROM 'DRAFT' OR target.kind NOT IN ('VISIT', 'PRODUCT_SALE') THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'A product detail belongs to a product line of a draft visit or product-sale invoice';
  END IF;
  SELECT * INTO line FROM invoice_lines WHERE id = NEW.invoice_line_id;
  IF line.kind IS DISTINCT FROM 'PRODUCT' OR line.invoice_id IS DISTINCT FROM NEW.invoice_id THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'A product detail belongs to a PRODUCT line';
  END IF;
  SELECT * INTO chosen FROM product_variants WHERE id = NEW.variant_id;
  SELECT * INTO item FROM products WHERE id = chosen.product_id;
  IF chosen.id IS NULL OR item.id IS NULL OR NEW.product_id <> item.id OR NEW.sku <> chosen.sku
    OR line.item_code <> chosen.sku THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'A product detail names the product, variant and SKU of its line';
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF item.status <> 'PUBLISHED' OR NOT chosen.is_active THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Only a published product with an active variant is added to an invoice';
    END IF;
    IF (NEW.brand_id, NEW.category_id, NEW.product_name_vi, NEW.product_name_en, NEW.variant_label_vi, NEW.variant_label_en)
      IS DISTINCT FROM (item.brand_id, item.category_id, item.name_vi, item.name_en, chosen.label_vi, chosen.label_en) THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'The product detail must copy the product as it is now';
    END IF;
    IF NEW.fulfilment_mode = 'PRE_ORDER' AND NOT chosen.sell_on_order THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'A pre-order line needs a variant that is sold on order';
    END IF;
    NEW.created_at := clock_timestamp();
  ELSE
    IF (NEW.invoice_line_id, NEW.invoice_id, NEW.product_id, NEW.variant_id, NEW.sku, NEW.brand_id, NEW.category_id,
        NEW.product_name_vi, NEW.product_name_en, NEW.variant_label_vi, NEW.variant_label_en, NEW.created_at, NEW.fulfilment_mode)
      IS DISTINCT FROM (OLD.invoice_line_id, OLD.invoice_id, OLD.product_id, OLD.variant_id, OLD.sku, OLD.brand_id,
        OLD.category_id, OLD.product_name_vi, OLD.product_name_en, OLD.variant_label_vi, OLD.variant_label_en, OLD.created_at,
        OLD.fulfilment_mode) THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'The copy of a product on an invoice line is never rewritten';
    END IF;
  END IF;
  IF TG_OP = 'INSERT' OR NEW.seller_user_id IS DISTINCT FROM OLD.seller_user_id THEN
    IF NOT EXISTS (
      SELECT 1 FROM users u JOIN employee_branch_assignments a ON a.employee_user_id = u.id
      WHERE u.id = NEW.seller_user_id AND u.kind = 'EMPLOYEE' AND u.status = 'ACTIVE'
        AND a.branch_id = target.branch_id AND a.revoked_at IS NULL) THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'The seller is an active employee assigned to the branch of the invoice';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

-- ------------------------------------------------------------------------------------ invoice integrity
-- Replaces the Wave 2 body. Two changes only: the stock a finalized invoice must have reserved is that of its IN_STOCK lines (a PRE_ORDER
-- line reserves nothing until its goods arrive, and then by an order-line reservation that the order checks below look after), and the
-- "cancelled invoice holds no stock, a live one keeps its reservations" rule is about the reservations of invoice lines.
CREATE OR REPLACE FUNCTION lucy_check_invoice_integrity() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  invoice_id_value uuid;
  target invoices%ROWTYPE;
  line_count integer;
  product_count integer;
  detail_count integer;
  done_count integer;
  unpriced integer;
  line_total bigint;
  effective bigint;
BEGIN
  IF TG_TABLE_NAME = 'invoices' THEN
    invoice_id_value := NEW.id;
  ELSIF TG_TABLE_NAME = 'payment_corrections' THEN
    SELECT invoice_id INTO invoice_id_value FROM payments WHERE id = NEW.payment_id;
  ELSE
    invoice_id_value := NEW.invoice_id;
  END IF;
  SELECT * INTO target FROM invoices WHERE id = invoice_id_value;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;
  SELECT count(*), count(*) FILTER (WHERE kind = 'PRODUCT') INTO line_count, product_count
    FROM invoice_lines WHERE invoice_id = target.id;
  IF target.kind = 'VISIT' THEN
    -- Every performed (DONE) service of the visit is on the invoice exactly once, each with its detail
    -- (the unique keys make "at most once"; the counts make "at least once"). Product lines are not services.
    SELECT count(*) INTO detail_count FROM invoice_line_services WHERE invoice_id = target.id;
    SELECT count(*) INTO done_count FROM visit_service_lines WHERE visit_id = target.visit_id AND status = 'DONE';
    IF line_count - product_count = 0 OR line_count - product_count <> detail_count
      OR line_count - product_count <> done_count THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'An invoice carries every performed service of its visit exactly once';
    END IF;
    IF EXISTS (
      SELECT 1 FROM invoice_lines l JOIN invoice_line_services s ON s.invoice_line_id = l.id
      WHERE l.invoice_id = target.id
        AND NOT EXISTS (SELECT 1 FROM invoice_line_combo_usages u WHERE u.invoice_line_id = l.id)
        AND ((l.unit_price_vnd IS NOT NULL
            AND (l.unit_price_vnd < s.catalog_price_min_vnd OR l.unit_price_vnd > s.catalog_price_max_vnd))
          OR (l.quantity IS NOT NULL AND l.quantity > s.quantity_limit))) THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'A line price must lie in the snapshotted range and its quantity within the snapshotted limit';
    END IF;
    IF EXISTS (
      SELECT 1 FROM invoice_lines l JOIN invoice_line_combo_usages u ON u.invoice_line_id = l.id
      WHERE l.invoice_id = target.id
        AND ((l.unit_price_vnd IS NOT NULL AND l.unit_price_vnd <> 0)
          OR (l.quantity IS NOT NULL AND l.quantity <> 1)
          OR (l.gross_vnd IS NOT NULL AND l.gross_vnd <> 0))) THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'A line paid with a combo session is a 0 VND line of quantity 1';
    END IF;
    IF target.finalized_at IS NOT NULL AND EXISTS (
      SELECT 1 FROM invoice_line_combo_usages u
        WHERE u.invoice_id = target.id
          AND NOT EXISTS (SELECT 1 FROM combo_session_consumptions c WHERE c.invoice_line_id = u.invoice_line_id)) THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'A finalized invoice consumes a combo session for every line paid with one';
    END IF;
  ELSIF target.kind = 'COMBO_SALE' THEN
    SELECT count(*) INTO detail_count FROM invoice_line_combos WHERE invoice_id = target.id;
    IF line_count <> 1 OR detail_count <> 1 THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'A combo sale carries exactly one combo purchase line';
    END IF;
    IF EXISTS (
      SELECT 1 FROM invoice_lines l JOIN invoice_line_combos d ON d.invoice_line_id = l.id
      WHERE l.invoice_id = target.id
        AND (l.kind <> 'COMBO_PURCHASE' OR l.quantity IS DISTINCT FROM 1
          OR l.unit_price_vnd IS DISTINCT FROM d.price_vnd OR l.gross_vnd IS DISTINCT FROM d.price_vnd)) THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'A combo purchase line is priced exactly at its combo price, quantity 1';
    END IF;
  ELSE
    IF line_count <> product_count OR (target.finalized_at IS NOT NULL AND product_count = 0) THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'A product sale carries product lines only, at least one once finalized';
    END IF;
  END IF;
  -- Product lines (a VISIT may hold them beside its services; a PRODUCT_SALE holds only them).
  SELECT count(*) INTO detail_count FROM invoice_line_products WHERE invoice_id = target.id;
  IF product_count <> detail_count THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Every product line has its product detail';
  END IF;
  IF EXISTS (
    SELECT 1 FROM invoice_lines l JOIN invoice_line_products d ON d.invoice_line_id = l.id
    WHERE l.invoice_id = target.id
      AND (l.quantity IS NULL OR l.unit_price_vnd IS NULL
        OR l.unit_price_vnd IS DISTINCT FROM (SELECT p.effective_price_vnd FROM lucy_variant_price_at(d.variant_id, d.priced_at) p)
        OR d.list_price_vnd IS DISTINCT FROM (SELECT p.list_price_vnd FROM lucy_variant_price_at(d.variant_id, d.priced_at) p)
        OR (target.finalized_at IS NOT NULL AND d.priced_at IS DISTINCT FROM target.finalized_at))) THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'A product line is priced at the effective price of its variant, frozen at finalization';
  END IF;
  IF target.finalized_at IS NULL THEN
    IF EXISTS (SELECT 1 FROM stock_reservations WHERE invoice_id = target.id) THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'A draft invoice holds no stock';
    END IF;
  ELSE
    IF EXISTS (
      SELECT 1 FROM invoice_lines l JOIN invoice_line_products d ON d.invoice_line_id = l.id
      WHERE l.invoice_id = target.id AND d.fulfilment_mode = 'IN_STOCK'
        AND NOT EXISTS (
          SELECT 1 FROM stock_reservations r
          WHERE r.invoice_line_id = l.id AND r.invoice_id = target.id AND r.branch_id = target.branch_id
            AND r.variant_id = d.variant_id AND r.quantity = l.quantity AND r.source = 'INVOICE_LINE')) THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'A finalized invoice reserves the stock of every product line';
    END IF;
    IF (target.status = 'CANCELLED' AND EXISTS (
          SELECT 1 FROM stock_reservations WHERE invoice_id = target.id AND source = 'INVOICE_LINE' AND status <> 'RELEASED'))
      OR (target.status <> 'CANCELLED' AND EXISTS (
          SELECT 1 FROM stock_reservations WHERE invoice_id = target.id AND source = 'INVOICE_LINE' AND status = 'RELEASED')) THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'A cancelled invoice holds no stock and a live one keeps its reservations';
    END IF;
  END IF;
  IF target.finalized_at IS NOT NULL THEN
    SELECT count(*) FILTER (WHERE quantity IS NULL OR unit_price_vnd IS NULL), COALESCE(sum(gross_vnd), 0)
      INTO unpriced, line_total FROM invoice_lines WHERE invoice_id = target.id;
    IF unpriced > 0 OR target.subtotal_vnd <> line_total THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'A finalized invoice has every line priced and its subtotal is the sum of its lines';
    END IF;
  END IF;
  effective := lucy_invoice_effective_paid(target.id);
  IF effective > target.total_vnd
    OR (target.status = 'DRAFT' AND EXISTS (SELECT 1 FROM payments WHERE invoice_id = target.id))
    OR (target.status = 'PAID' AND effective <> target.total_vnd)
    OR (target.status = 'PENDING_PAYMENT' AND effective >= target.total_vnd)
    OR (target.status = 'CANCELLED' AND effective <> 0) THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Payments must reconcile with the invoice status and receivable';
  END IF;
  RETURN NULL;
END;
$$;

-- ---------------------------------------------------------------------------------------------- orders
CREATE FUNCTION lucy_guard_product_order() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  target invoices%ROWTYPE;
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'A product order is history and is never deleted';
  END IF;
  IF TG_OP = 'INSERT' THEN
    SELECT * INTO target FROM invoices WHERE id = NEW.invoice_id FOR SHARE;
    IF NOT FOUND OR target.status <> 'DRAFT' OR target.kind NOT IN ('VISIT', 'PRODUCT_SALE') THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'A product order is created by the finalization of a draft invoice with product lines';
    END IF;
    IF NEW.branch_id <> target.branch_id OR NEW.channel <> target.channel
       OR NEW.customer_user_id IS DISTINCT FROM target.payer_user_id THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'A product order has the branch, channel and customer of its invoice';
    END IF;
    NEW.created_at := clock_timestamp();
    NEW.updated_at := NEW.created_at;
    RETURN NEW;
  END IF;
  -- Only the contact (a mistyped phone or name is corrected, with an audit event written by the API) may change.
  IF (NEW.id, NEW.code, NEW.invoice_id, NEW.branch_id, NEW.channel, NEW.customer_user_id, NEW.created_by_user_id, NEW.created_at)
    IS DISTINCT FROM (OLD.id, OLD.code, OLD.invoice_id, OLD.branch_id, OLD.channel, OLD.customer_user_id, OLD.created_by_user_id,
      OLD.created_at) THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Only the contact of a product order can change';
  END IF;
  NEW.updated_at := clock_timestamp();
  RETURN NEW;
END;
$$;
CREATE TRIGGER "product_orders_guard" BEFORE INSERT OR UPDATE OR DELETE ON "product_orders"
FOR EACH ROW EXECUTE FUNCTION lucy_guard_product_order();

CREATE FUNCTION lucy_guard_product_order_truncate() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Product order history is never truncated';
END;
$$;
CREATE TRIGGER "product_orders_no_truncate" BEFORE TRUNCATE ON "product_orders"
FOR EACH STATEMENT EXECUTE FUNCTION lucy_guard_product_order_truncate();
CREATE TRIGGER "product_order_lines_no_truncate" BEFORE TRUNCATE ON "product_order_lines"
FOR EACH STATEMENT EXECUTE FUNCTION lucy_guard_product_order_truncate();
CREATE TRIGGER "product_order_events_no_truncate" BEFORE TRUNCATE ON "product_order_events"
FOR EACH STATEMENT EXECUTE FUNCTION lucy_guard_product_order_truncate();

-- ---------------------------------------------------------------------------------------- order lines
-- The state machine. The facts of each status are the CHECK above; this guard decides which move is legal and stamps its time.
--   AWAITING_PAYMENT -> PAID              the invoice is PAID (fixes the paid time and the expected range)
--   PAID -> AWAITING_PAYMENT              the invoice is back to PENDING_PAYMENT (a payment reversal)
--   AWAITING_PAYMENT | PAID -> CANCELLED  INVOICE_CANCELLED, the invoice is CANCELLED
--   PAID -> ORDERED                       staff ordered the goods from the supplier (who)
--   PAID | ORDERED -> ARRIVED             the goods arrived and are reserved for this line (a RESERVED order-line reservation exists)
--   ARRIVED -> HANDED_OVER                staff handed the goods over (who, to whom)
--   HANDED_OVER -> COMPLETED              the stock sale is recorded (the reservation is CONSUMED)
--   PAID | ORDERED | ARRIVED -> CANCELLED the order is cancelled by a person with a cause and a reason (the invoice is PAID; the money
--                                         is given back by the refund Step)
CREATE FUNCTION lucy_guard_product_order_line() RETURNS trigger
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
    END IF;
    NEW.cancelled_at := clock_timestamp();
  END IF;
  NEW.row_version := OLD.row_version + 1;
  NEW.updated_at := clock_timestamp();
  RETURN NEW;
END;
$$;
CREATE TRIGGER "product_order_lines_guard" BEFORE INSERT OR UPDATE OR DELETE ON "product_order_lines"
FOR EACH ROW EXECUTE FUNCTION lucy_guard_product_order_line();

-- Every creation and move is an event. A BEFORE trigger cannot write it (the line row does not exist yet on insert), so this is an AFTER one.
CREATE FUNCTION lucy_record_product_order_event() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO product_order_events (order_line_id, from_status, to_status, actor_user_id, note, occurred_at)
  VALUES (
    NEW.id,
    CASE WHEN TG_OP = 'INSERT' THEN NULL ELSE OLD.status END,
    NEW.status,
    CASE NEW.status
      WHEN 'ORDERED' THEN NEW.ordered_by_user_id
      WHEN 'ARRIVED' THEN NEW.arrived_by_user_id
      WHEN 'HANDED_OVER' THEN NEW.handed_over_by_user_id
      WHEN 'CANCELLED' THEN NEW.cancelled_by_user_id
      ELSE NULL END,
    CASE NEW.status
      WHEN 'ORDERED' THEN NEW.ordered_note
      WHEN 'HANDED_OVER' THEN NEW.handed_over_note
      WHEN 'CANCELLED' THEN NEW.cancel_note
      ELSE NULL END,
    NEW.updated_at);
  RETURN NULL;
END;
$$;
CREATE TRIGGER "product_order_lines_event" AFTER INSERT OR UPDATE ON "product_order_lines"
FOR EACH ROW EXECUTE FUNCTION lucy_record_product_order_event();

CREATE FUNCTION lucy_guard_product_order_event() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP <> 'INSERT' THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'A product order event is history and is never changed or deleted';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "product_order_events_guard" BEFORE INSERT OR UPDATE OR DELETE ON "product_order_events"
FOR EACH ROW EXECUTE FUNCTION lucy_guard_product_order_event();

-- ------------------------------------------------------------------------------- the invoice drives it
-- One rule for every way an invoice changes status (cash, the PayOS webhook, a zero balance, a payment reversal, a cancellation).
CREATE FUNCTION lucy_sync_product_order_lines() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM product_orders WHERE invoice_id = NEW.id) THEN
    RETURN NULL;
  END IF;
  IF NEW.status = 'PAID' THEN
    UPDATE product_order_lines SET status = 'PAID' WHERE invoice_id = NEW.id AND status = 'AWAITING_PAYMENT';
  ELSIF NEW.status = 'PENDING_PAYMENT' THEN
    UPDATE product_order_lines SET status = 'AWAITING_PAYMENT' WHERE invoice_id = NEW.id AND status = 'PAID';
  ELSIF NEW.status = 'CANCELLED' THEN
    UPDATE product_order_lines SET status = 'CANCELLED', cancel_cause = 'INVOICE_CANCELLED', cancelled_at = clock_timestamp()
      WHERE invoice_id = NEW.id AND status IN ('AWAITING_PAYMENT', 'PAID');
  END IF;
  RETURN NULL;
END;
$$;
CREATE TRIGGER "invoices_sync_product_orders" AFTER UPDATE OF status ON "invoices"
FOR EACH ROW WHEN (OLD.status IS DISTINCT FROM NEW.status) EXECUTE FUNCTION lucy_sync_product_order_lines();

-- ------------------------------------------------------------------------------ reservations (sources)
-- Replaces the Wave 2 body. INVOICE_LINE keeps every rule and message it had. ORDER_LINE: taken for a PAID invoice, for a line that is
-- PAID or ORDERED (it becomes ARRIVED in the same transaction), under the stock level lock and only if the whole line is available; consumed
-- only while its line is HANDED_OVER (at the invoice's current paid episode); released only when its line is CANCELLED; never given back.
CREATE OR REPLACE FUNCTION lucy_guard_stock_reservation() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  target invoices%ROWTYPE;
  line invoice_lines%ROWTYPE;
  detail invoice_line_products%ROWTYPE;
  level stock_levels%ROWTYPE;
  held product_order_lines%ROWTYPE;
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'A stock reservation is history and is never deleted';
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'RESERVED' OR NEW.source NOT IN ('INVOICE_LINE', 'ORDER_LINE') THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'A stock reservation starts reserved';
    END IF;
    SELECT * INTO target FROM invoices WHERE id = NEW.invoice_id FOR SHARE;
    SELECT * INTO line FROM invoice_lines WHERE id = NEW.invoice_line_id;
    SELECT * INTO detail FROM invoice_line_products WHERE invoice_line_id = NEW.invoice_line_id;
    IF NEW.source = 'INVOICE_LINE' THEN
      IF target.status IS DISTINCT FROM 'DRAFT' OR target.branch_id IS DISTINCT FROM NEW.branch_id THEN
        RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Stock is reserved by the finalization of a draft invoice, at its branch';
      END IF;
      IF detail.invoice_line_id IS NULL OR line.invoice_id IS DISTINCT FROM NEW.invoice_id
        OR detail.variant_id IS DISTINCT FROM NEW.variant_id OR line.quantity IS DISTINCT FROM NEW.quantity
        OR detail.fulfilment_mode <> 'IN_STOCK' THEN
        RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'A reservation matches the variant and quantity of its product line';
      END IF;
    ELSE
      SELECT * INTO held FROM product_order_lines WHERE invoice_line_id = NEW.invoice_line_id;
      IF target.status IS DISTINCT FROM 'PAID' OR target.branch_id IS DISTINCT FROM NEW.branch_id
        OR held.id IS NULL OR held.status NOT IN ('PAID', 'ORDERED') THEN
        RAISE EXCEPTION USING ERRCODE = '23514',
          MESSAGE = 'Goods are reserved for a paid pre-order line that is waiting for them, at its branch';
      END IF;
      IF detail.invoice_line_id IS NULL OR line.invoice_id IS DISTINCT FROM NEW.invoice_id
        OR detail.variant_id IS DISTINCT FROM NEW.variant_id OR line.quantity IS DISTINCT FROM NEW.quantity
        OR detail.fulfilment_mode <> 'PRE_ORDER' THEN
        RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'A reservation matches the variant and quantity of its product line';
      END IF;
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
  IF OLD.source = 'ORDER_LINE' THEN
    SELECT * INTO held FROM product_order_lines WHERE invoice_line_id = OLD.invoice_line_id;
    IF OLD.status = 'RESERVED' AND NEW.status = 'CONSUMED' THEN
      IF target.status IS DISTINCT FROM 'PAID' OR NEW.consumed_paid_seq IS DISTINCT FROM target.paid_seq
         OR held.status IS DISTINCT FROM 'HANDED_OVER' THEN
        RAISE EXCEPTION USING ERRCODE = '23514',
          MESSAGE = 'Reserved goods are sold only when their pre-order line is handed over, at the current paid episode';
      END IF;
      NEW.consumed_at := clock_timestamp();
      RETURN NEW;
    ELSIF OLD.status = 'RESERVED' AND NEW.status = 'RELEASED' THEN
      IF held.status IS DISTINCT FROM 'CANCELLED' THEN
        RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Goods reserved for an order line are released only when the line is cancelled';
      END IF;
      NEW.released_at := clock_timestamp();
      RETURN NEW;
    END IF;
    RAISE EXCEPTION USING ERRCODE = '23514',
      MESSAGE = 'Goods reserved for an order line are sold when it is handed over or released when it is cancelled, and never given back';
  END IF;
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

-- --------------------------------------------------------------------------- commit-time order checks
-- At commit, per invoice: the orders, the order lines, the invoice status and the order-line reservations tell one story.
CREATE FUNCTION lucy_check_product_orders() RETURNS trigger
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
  IF EXISTS (
    SELECT 1 FROM stock_reservations r
    WHERE r.invoice_id = target.id AND r.source = 'ORDER_LINE'
      AND NOT EXISTS (SELECT 1 FROM product_order_lines o WHERE o.invoice_line_id = r.invoice_line_id)) THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Goods are reserved for an order line only';
  END IF;
  RETURN NULL;
END;
$$;
CREATE CONSTRAINT TRIGGER "product_orders_integrity" AFTER INSERT OR UPDATE ON "product_orders"
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION lucy_check_product_orders();
CREATE CONSTRAINT TRIGGER "product_order_lines_integrity" AFTER INSERT OR UPDATE ON "product_order_lines"
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION lucy_check_product_orders();
CREATE CONSTRAINT TRIGGER "product_order_reservations_integrity" AFTER INSERT OR UPDATE ON "stock_reservations"
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW WHEN (NEW.source = 'ORDER_LINE') EXECUTE FUNCTION lucy_check_product_orders();
CREATE CONSTRAINT TRIGGER "product_order_details_integrity" AFTER INSERT OR UPDATE ON "invoice_line_products"
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW WHEN (NEW.fulfilment_mode = 'PRE_ORDER') EXECUTE FUNCTION lucy_check_product_orders();
CREATE CONSTRAINT TRIGGER "product_order_invoices_integrity" AFTER UPDATE ON "invoices"
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW WHEN (OLD.status IS DISTINCT FROM NEW.status) EXECUTE FUNCTION lucy_check_product_orders();

-- ------------------------------------------------------------------------------------------- returns
-- Replaces the P6-12 body. Only one rule is added: the goods of a PRE_ORDER line are in the customer's hands only after the hand-over has
-- been completed (the stock sale recorded), and the window starts then (OQ-40). An IN_STOCK line keeps the invoice's paid time.
CREATE OR REPLACE FUNCTION lucy_guard_product_return_case() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  inv RECORD;
  sold integer;
  claimed integer;
  pre_order product_order_lines%ROWTYPE;
  handover timestamptz;
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'A product return case is history and is never deleted';
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'OPEN' THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'A return case starts open';
    END IF;
    SELECT i.branch_id, i.status, i.channel, i.paid_at, i.paid_seq INTO inv FROM invoices i WHERE i.id = NEW.invoice_id FOR SHARE;
    IF NOT FOUND OR inv.status <> 'PAID' OR inv.paid_at IS NULL THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'A return case needs a paid invoice';
    END IF;
    IF inv.channel <> 'COUNTER' THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Only counter sales have a return case for now';
    END IF;
    IF NEW.branch_id <> inv.branch_id THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'A return case belongs to the branch of its invoice';
    END IF;
    SELECT * INTO pre_order FROM product_order_lines WHERE invoice_line_id = NEW.invoice_line_id FOR SHARE;
    IF FOUND THEN
      IF pre_order.status <> 'COMPLETED' THEN
        RAISE EXCEPTION USING ERRCODE = '23514',
          MESSAGE = 'A pre-order line has a return case only after its goods were handed over and sold';
      END IF;
      handover := pre_order.handed_over_at;
    ELSE
      handover := inv.paid_at;
    END IF;
    IF NEW.handover_at <> handover OR NEW.paid_seq <> inv.paid_seq THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'The return window starts when the goods were handed over';
    END IF;
    NEW.opened_at := clock_timestamp();
    NEW.created_at := NEW.opened_at;
    NEW.updated_at := NEW.opened_at;
    IF NEW.window_exception_by_user_id IS NOT NULL OR NEW.window_exception_reason IS NOT NULL
       OR NEW.window_exception_at IS NOT NULL THEN
      IF NOT EXISTS (SELECT 1 FROM users u WHERE u.id = NEW.window_exception_by_user_id AND u.kind = 'OWNER') THEN
        RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Only the Owner may approve a return outside its window';
      END IF;
      IF NEW.window_ends_at IS NULL OR NEW.opened_at <= NEW.window_ends_at THEN
        RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'An exception is only for a return after its window';
      END IF;
      NEW.window_exception_at := NEW.opened_at;
    ELSIF NEW.window_ends_at IS NOT NULL AND NEW.opened_at > NEW.window_ends_at THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'The return window is over';
    END IF;
    SELECT l.quantity INTO sold FROM invoice_lines l
      WHERE l.id = NEW.invoice_line_id AND l.invoice_id = NEW.invoice_id FOR NO KEY UPDATE;
    IF sold IS NULL OR NEW.quantity > sold THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'A return case cannot claim more units than were sold';
    END IF;
    SELECT COALESCE(SUM(c.quantity), 0) INTO claimed FROM product_return_cases c
      WHERE c.invoice_line_id = NEW.invoice_line_id AND c.status IN ('OPEN', 'ACCEPTED');
    IF claimed + NEW.quantity > sold THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'The units claimed on a line cannot exceed the units sold';
    END IF;
    RETURN NEW;
  END IF;
  -- UPDATE
  IF NEW.id IS DISTINCT FROM OLD.id OR NEW.code IS DISTINCT FROM OLD.code OR NEW.branch_id IS DISTINCT FROM OLD.branch_id
     OR NEW.invoice_id IS DISTINCT FROM OLD.invoice_id OR NEW.invoice_line_id IS DISTINCT FROM OLD.invoice_line_id
     OR NEW.reason IS DISTINCT FROM OLD.reason OR NEW.requested_outcome IS DISTINCT FROM OLD.requested_outcome
     OR NEW.quantity IS DISTINCT FROM OLD.quantity OR NEW.seal_intact IS DISTINCT FROM OLD.seal_intact
     OR NEW.notes IS DISTINCT FROM OLD.notes OR NEW.handover_at IS DISTINCT FROM OLD.handover_at
     OR NEW.paid_seq IS DISTINCT FROM OLD.paid_seq OR NEW.window_ends_at IS DISTINCT FROM OLD.window_ends_at
     OR NEW.window_exception_by_user_id IS DISTINCT FROM OLD.window_exception_by_user_id
     OR NEW.window_exception_reason IS DISTINCT FROM OLD.window_exception_reason
     OR NEW.window_exception_at IS DISTINCT FROM OLD.window_exception_at
     OR NEW.opened_by_user_id IS DISTINCT FROM OLD.opened_by_user_id OR NEW.opened_at IS DISTINCT FROM OLD.opened_at
     OR NEW.client_request_id IS DISTINCT FROM OLD.client_request_id OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'The facts of a return case never change';
  END IF;
  IF OLD.status <> 'OPEN' THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'A closed return case is immutable';
  END IF;
  IF NEW.status = 'OPEN' THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'An open return case changes only by being decided or cancelled';
  END IF;
  NEW.closed_at := clock_timestamp();
  IF NEW.status = 'ACCEPTED' THEN
    PERFORM 1 FROM invoices i WHERE i.id = OLD.invoice_id AND i.status = 'PAID' FOR SHARE;
    IF NOT FOUND THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'A return case is accepted only while its invoice is paid';
    END IF;
    IF OLD.reason = 'WRONG_OR_DAMAGED' AND NOT EXISTS (
         SELECT 1 FROM product_return_photos p
         WHERE p.case_id = OLD.id AND p.removed_at IS NULL
           AND (OLD.window_exception_at IS NOT NULL OR p.uploaded_at <= OLD.window_ends_at)) THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'A wrong or damaged product needs a photo taken within 48 hours';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

-- ------------------------------------------------------------------------------------------------ T22
-- Replaces the P6-14 body. Added: an invoice whose pre-order was ordered (or further) keeps its payments and stays paid. A pre-order that
-- is only PAID can still be reversed or cancelled with its invoice (the order lines follow it).
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
  IF target IS NOT NULL AND EXISTS (
    SELECT 1 FROM product_order_lines o WHERE o.invoice_id = target
      AND o.status IN ('ORDERED', 'ARRIVED', 'HANDED_OVER', 'COMPLETED', 'CANCELLED')) THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'An invoice whose pre-order was ordered keeps its payments and stays paid';
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
    'lucy_guard_invoice_line_product', 'lucy_check_invoice_integrity', 'lucy_guard_product_order',
    'lucy_guard_product_order_truncate', 'lucy_guard_product_order_line', 'lucy_record_product_order_event',
    'lucy_guard_product_order_event', 'lucy_sync_product_order_lines', 'lucy_guard_stock_reservation',
    'lucy_check_product_orders', 'lucy_guard_product_return_case', 'lucy_refuse_when_refunded'
  ] LOOP
    EXECUTE format('ALTER FUNCTION %I.%I() SET search_path TO pg_catalog, %I, pg_temp',
      migration_schema, function_name, migration_schema);
    EXECUTE format('REVOKE ALL ON FUNCTION %I.%I() FROM PUBLIC', migration_schema, function_name);
  END LOOP;
END;
$$;
