-- Phase 6 P6-8 (Wave 2: product lines on invoices), migration 2 of 2 (design 4.5, 5, T15, T19 in part, T20, T33).
-- Approved by the Owner on 2026-10-07 (design 2.13). Additive: no existing row is touched (every existing invoice is a VISIT or a
-- COMBO_SALE, channel COUNTER, fee 0). Everything the Phase 4/5 guards enforce for a service-only invoice is unchanged.
--
--   * invoices get a sales `channel` (COUNTER | ONLINE, default COUNTER) and a `shipping_fee_vnd` (default 0, only an ONLINE
--     product sale may carry a fee). The identity `total = subtotal - discount` gains the fee term, so the live invoice table is
--     not altered again for Wave 4;
--   * a PRODUCT line has a detail row (`invoice_line_products`): product, variant, SKU, brand/category, names and label copied
--     at the time of the sale, the SELLER (required, an active employee assigned to the invoice branch), and the price
--     resolution (list price, promotion, instant). The price is the effective price of the variant at that instant and is frozen
--     at finalization: the integrity check re-derives it; nobody can type a price;
--   * a VISIT invoice may hold service and product lines; a PRODUCT_SALE invoice holds product lines only and is not tied to a
--     Visit (a member or a guest pays); COMBO_SALE keeps its one combo line. A draft PRODUCT line (and its detail) may be removed
--     while the invoice is a DRAFT (a draft is a working copy; the audit log keeps the removal); every other invoice line stays
--     undeletable;
--   * stock reservations (T15): finalizing an invoice with product lines reserves each line's quantity at the invoice branch
--     (one reservation per line); cancelling the unpaid invoice releases it. `stock_levels.reserved` is a cache written only by
--     the reservation trigger, and the deferred checks keep `reserved = sum of RESERVED reservations` and
--     `reserved <= on_hand`. Consumption (a SALE movement) arrives with the point-of-sale Step and is refused here.
--   * the per-side persistence of T19 (applications, redemptions, snapshots, net allocations) belongs with the pricing engine that
--     writes it (P6-9) and is not part of this migration: in this Step a product line gets no discount and earns no points.

-- ------------------------------------------------------------------------------- channel and shipping fee
CREATE TYPE "InvoiceChannel" AS ENUM ('COUNTER', 'ONLINE');

ALTER TABLE "invoices"
  ADD COLUMN "channel" "InvoiceChannel" NOT NULL DEFAULT 'COUNTER',
  ADD COLUMN "shipping_fee_vnd" BIGINT NOT NULL DEFAULT 0;

ALTER TABLE "invoices"
  ADD CONSTRAINT "invoices_channel_fee" CHECK (
    "shipping_fee_vnd" >= 0 AND ("channel" = 'ONLINE' OR "shipping_fee_vnd" = 0)),
  ADD CONSTRAINT "invoices_online_product_sale" CHECK ("channel" = 'COUNTER' OR "kind" = 'PRODUCT_SALE'),
  DROP CONSTRAINT "invoices_money",
  ADD CONSTRAINT "invoices_money" CHECK (
    "subtotal_vnd" >= 0 AND "discount_total_vnd" >= 0 AND "total_vnd" >= 0
    AND "discount_total_vnd" <= "subtotal_vnd"
    AND "total_vnd" = "subtotal_vnd" - "discount_total_vnd" + "shipping_fee_vnd"
  );

-- ------------------------------------------------------------------------------------ the product line detail
CREATE TABLE "invoice_line_products" (
    "invoice_line_id" UUID NOT NULL,
    "invoice_id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "variant_id" UUID NOT NULL,
    "sku" VARCHAR(64) NOT NULL,
    "brand_id" UUID,
    "category_id" UUID,
    "product_name_vi" TEXT NOT NULL,
    "product_name_en" TEXT NOT NULL,
    "variant_label_vi" TEXT,
    "variant_label_en" TEXT,
    "seller_user_id" UUID NOT NULL,
    "list_price_vnd" BIGINT NOT NULL,
    "promotion_id" UUID,
    "priced_at" TIMESTAMPTZ(3) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT clock_timestamp(),

    CONSTRAINT "invoice_line_products_pkey" PRIMARY KEY ("invoice_line_id"),
    CONSTRAINT "invoice_line_products_list_price" CHECK ("list_price_vnd" >= 0),
    CONSTRAINT "invoice_line_products_text" CHECK (btrim("product_name_vi") <> '' AND btrim("product_name_en") <> '' AND btrim("sku") <> '')
);
CREATE INDEX "invoice_line_products_invoice_idx" ON "invoice_line_products"("invoice_id");
CREATE INDEX "invoice_line_products_variant_idx" ON "invoice_line_products"("variant_id");
CREATE INDEX "invoice_line_products_seller_idx" ON "invoice_line_products"("seller_user_id");
ALTER TABLE "invoice_line_products" ADD CONSTRAINT "invoice_line_products_line_fkey"
  FOREIGN KEY ("invoice_id", "invoice_line_id") REFERENCES "invoice_lines"("invoice_id", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "invoice_line_products" ADD CONSTRAINT "invoice_line_products_product_id_fkey"
  FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "invoice_line_products" ADD CONSTRAINT "invoice_line_products_variant_id_fkey"
  FOREIGN KEY ("variant_id") REFERENCES "product_variants"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "invoice_line_products" ADD CONSTRAINT "invoice_line_products_brand_id_fkey"
  FOREIGN KEY ("brand_id") REFERENCES "brands"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "invoice_line_products" ADD CONSTRAINT "invoice_line_products_category_id_fkey"
  FOREIGN KEY ("category_id") REFERENCES "product_categories"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "invoice_line_products" ADD CONSTRAINT "invoice_line_products_seller_user_id_fkey"
  FOREIGN KEY ("seller_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "invoice_line_products" ADD CONSTRAINT "invoice_line_products_promotion_id_fkey"
  FOREIGN KEY ("promotion_id") REFERENCES "product_promotions"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- ------------------------------------------------------------------------------------- stock reservations
CREATE TYPE "StockReservationStatus" AS ENUM ('RESERVED', 'CONSUMED', 'RELEASED');
CREATE TYPE "StockReservationSource" AS ENUM ('INVOICE_LINE');

CREATE TABLE "stock_reservations" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "invoice_line_id" UUID NOT NULL,
    "invoice_id" UUID NOT NULL,
    "branch_id" UUID NOT NULL,
    "variant_id" UUID NOT NULL,
    "quantity" INTEGER NOT NULL,
    "source" "StockReservationSource" NOT NULL DEFAULT 'INVOICE_LINE',
    "status" "StockReservationStatus" NOT NULL DEFAULT 'RESERVED',
    "reserved_at" TIMESTAMPTZ(3) NOT NULL DEFAULT clock_timestamp(),
    "created_by_user_id" UUID NOT NULL,
    "released_at" TIMESTAMPTZ(3),
    "released_by_user_id" UUID,
    "release_cause" TEXT,

    CONSTRAINT "stock_reservations_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "stock_reservations_quantity" CHECK ("quantity" >= 1),
    CONSTRAINT "stock_reservations_facts" CHECK (
      ("status" = 'RESERVED' AND "released_at" IS NULL AND "released_by_user_id" IS NULL AND "release_cause" IS NULL)
      OR ("status" = 'RELEASED' AND "released_at" IS NOT NULL AND "released_by_user_id" IS NOT NULL
          AND "release_cause" IN ('INVOICE_CANCELLED_UNPAID', 'ZERO_BALANCE_CORRECTION'))
      OR "status" = 'CONSUMED')
);
-- One reservation per invoice line (the retry of a finalization creates nothing new).
CREATE UNIQUE INDEX "stock_reservations_line_key" ON "stock_reservations"("invoice_line_id");
CREATE INDEX "stock_reservations_invoice_idx" ON "stock_reservations"("invoice_id");
CREATE INDEX "stock_reservations_level_idx" ON "stock_reservations"("branch_id", "variant_id") WHERE "status" = 'RESERVED';
ALTER TABLE "stock_reservations" ADD CONSTRAINT "stock_reservations_line_fkey"
  FOREIGN KEY ("invoice_id", "invoice_line_id") REFERENCES "invoice_lines"("invoice_id", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "stock_reservations" ADD CONSTRAINT "stock_reservations_level_fkey"
  FOREIGN KEY ("branch_id", "variant_id") REFERENCES "stock_levels"("branch_id", "variant_id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "stock_reservations" ADD CONSTRAINT "stock_reservations_created_by_user_id_fkey"
  FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "stock_reservations" ADD CONSTRAINT "stock_reservations_released_by_user_id_fkey"
  FOREIGN KEY ("released_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- ------------------------------------------------------------------------------------------------- guards
-- The product detail is recorded on a PRODUCT line of a DRAFT invoice, as an exact copy of the product at this instant. Only a
-- published product with an active variant is added. The identity and the copy never change; the seller and the price resolution
-- may change while the invoice is a DRAFT. The seller is an active employee with an active assignment to the invoice branch.
CREATE FUNCTION lucy_guard_invoice_line_product() RETURNS trigger
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
    NEW.created_at := clock_timestamp();
  ELSE
    IF (NEW.invoice_line_id, NEW.invoice_id, NEW.product_id, NEW.variant_id, NEW.sku, NEW.brand_id, NEW.category_id,
        NEW.product_name_vi, NEW.product_name_en, NEW.variant_label_vi, NEW.variant_label_en, NEW.created_at)
      IS DISTINCT FROM (OLD.invoice_line_id, OLD.invoice_id, OLD.product_id, OLD.variant_id, OLD.sku, OLD.brand_id,
        OLD.category_id, OLD.product_name_vi, OLD.product_name_en, OLD.variant_label_vi, OLD.variant_label_en, OLD.created_at) THEN
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
CREATE TRIGGER "invoice_line_products_guard" BEFORE INSERT OR UPDATE ON "invoice_line_products"
FOR EACH ROW EXECUTE FUNCTION lucy_guard_invoice_line_product();
CREATE TRIGGER "invoice_line_products_no_truncate" BEFORE TRUNCATE ON "invoice_line_products"
FOR EACH STATEMENT EXECUTE FUNCTION lucy_reject_permanent_history_mutation();

-- Deleting: a PRODUCT line of a DRAFT invoice (and its detail) may be removed; every other invoice line, detail and any line of a
-- finalized or cancelled invoice is financial history and stays (Phase 4 rule, unchanged).
CREATE FUNCTION lucy_guard_draft_product_delete() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  invoice_status "InvoiceStatus";
BEGIN
  IF TG_TABLE_NAME = 'invoice_lines' THEN
    IF OLD.kind IS DISTINCT FROM 'PRODUCT' THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Financial records are never deleted';
    END IF;
  END IF;
  SELECT status INTO invoice_status FROM invoices WHERE id = OLD.invoice_id FOR SHARE;
  IF invoice_status IS DISTINCT FROM 'DRAFT' THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Financial records are never deleted';
  END IF;
  RETURN OLD;
END;
$$;
DROP TRIGGER "invoice_lines_no_delete" ON "invoice_lines";
CREATE TRIGGER "invoice_lines_no_delete" BEFORE DELETE ON "invoice_lines"
FOR EACH ROW EXECUTE FUNCTION lucy_guard_draft_product_delete();
CREATE TRIGGER "invoice_line_products_no_delete" BEFORE DELETE ON "invoice_line_products"
FOR EACH ROW EXECUTE FUNCTION lucy_guard_draft_product_delete();

-- A reservation is taken by the finalization of the DRAFT it belongs to, for the exact quantity and variant of one product line
-- and at the branch of the invoice, under the lock of the stock level and only while that much is available (not expired, not
-- reserved elsewhere). It is released once, only when the invoice is CANCELLED, and never deleted. CONSUMED is the sale itself and
-- is not reachable yet.
CREATE FUNCTION lucy_guard_stock_reservation() RETURNS trigger
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
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'A stock reservation is immutable apart from being released once';
  END IF;
  IF OLD.status <> 'RESERVED' OR NEW.status <> 'RELEASED' THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'A stock reservation changes only from reserved to released';
  END IF;
  SELECT * INTO target FROM invoices WHERE id = OLD.invoice_id FOR SHARE;
  IF target.status IS DISTINCT FROM 'CANCELLED' THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'A reservation is released only when its invoice is cancelled';
  END IF;
  NEW.released_at := clock_timestamp();
  RETURN NEW;
END;
$$;
CREATE TRIGGER "stock_reservations_guard" BEFORE INSERT OR UPDATE OR DELETE ON "stock_reservations"
FOR EACH ROW EXECUTE FUNCTION lucy_guard_stock_reservation();
CREATE TRIGGER "stock_reservations_no_truncate" BEFORE TRUNCATE ON "stock_reservations"
FOR EACH STATEMENT EXECUTE FUNCTION lucy_reject_permanent_history_mutation();

-- The level cache follows the reservation: +quantity when it is taken, -quantity when it is released. The flag tells the level guard
-- that this write comes from here (transaction-local, switched off again at once).
CREATE FUNCTION lucy_apply_stock_reservation() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('lucy.stock_reservation', 'on', true);
  IF TG_OP = 'INSERT' THEN
    UPDATE stock_levels SET reserved = reserved + NEW.quantity
      WHERE branch_id = NEW.branch_id AND variant_id = NEW.variant_id;
  ELSE
    UPDATE stock_levels SET reserved = reserved - OLD.quantity
      WHERE branch_id = NEW.branch_id AND variant_id = NEW.variant_id;
  END IF;
  PERFORM set_config('lucy.stock_reservation', 'off', true);
  RETURN NULL;
END;
$$;
CREATE TRIGGER "stock_reservations_apply" AFTER INSERT OR UPDATE ON "stock_reservations"
FOR EACH ROW EXECUTE FUNCTION lucy_apply_stock_reservation();

-- Commit-time assertion (like the movement balance): the level's reserved quantity equals the sum of its RESERVED reservations.
CREATE FUNCTION lucy_check_stock_reservations() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  level_reserved integer;
  held bigint;
BEGIN
  SELECT s.reserved INTO level_reserved FROM stock_levels s WHERE s.branch_id = NEW.branch_id AND s.variant_id = NEW.variant_id;
  SELECT COALESCE(sum(r.quantity), 0) INTO held FROM stock_reservations r
    WHERE r.branch_id = NEW.branch_id AND r.variant_id = NEW.variant_id AND r.status = 'RESERVED';
  IF level_reserved IS DISTINCT FROM held THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'The reserved quantity must equal the sum of its open reservations';
  END IF;
  RETURN NULL;
END;
$$;
CREATE CONSTRAINT TRIGGER "stock_reservations_balance" AFTER INSERT OR UPDATE ON "stock_reservations"
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION lucy_check_stock_reservations();

-- Levels: written only from the movement and reservation triggers. `reserved` changes only from the reservation trigger and
-- `on_hand` never from there. (Replaces the P6-2 body, which forbade any change of `reserved`.)
CREATE OR REPLACE FUNCTION lucy_guard_stock_level() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'A stock level is never deleted';
  END IF;
  IF pg_trigger_depth() < 2 THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'A stock level changes only through a stock movement or a reservation';
  END IF;
  IF TG_OP = 'UPDATE' THEN
    IF (NEW.branch_id, NEW.variant_id, NEW.created_at) IS DISTINCT FROM (OLD.branch_id, OLD.variant_id, OLD.created_at) THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'A stock level identity is not changed here';
    END IF;
    IF current_setting('lucy.stock_reservation', true) = 'on' THEN
      IF NEW.on_hand IS DISTINCT FROM OLD.on_hand THEN
        RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'A reservation changes the reserved quantity only';
      END IF;
    ELSIF NEW.reserved IS DISTINCT FROM OLD.reserved THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'The reserved quantity changes only through a reservation';
    END IF;
    NEW.row_version := OLD.row_version + 1;
    NEW.updated_at := clock_timestamp();
  ELSE
    IF NEW.on_hand <> 0 OR NEW.reserved <> 0 OR NEW.row_version <> 1 THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'A stock level starts at zero';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

-- ------------------------------------------------------------------------------------- invoice guards
-- Invoice lifecycle guard: the P5-7 function with (a) the loyalty go-live rule kept for a COMBO_SALE only (a product sale never
-- depends on loyalty), (b) the channel in the identity and the shipping fee among the frozen amounts, (c) at finalization only a
-- published product with an active variant may remain on the invoice. A VISIT and a COMBO_SALE keep every original rule.
CREATE OR REPLACE FUNCTION lucy_guard_invoice() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  visit_status "VisitStatus";
  visit_branch uuid;
  payer_kind "UserKind";
  line_count integer;
  unpriced integer;
  line_total bigint;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'DRAFT' OR NEW.row_version <> 1 OR NEW.paid_seq <> 0 THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'An invoice starts as a DRAFT at version 1';
    END IF;
    IF NEW.kind = 'VISIT' THEN
      -- FOR SHARE serializes with any change of the visit (a completed visit is immutable).
      SELECT status, branch_id INTO visit_status, visit_branch FROM visits WHERE id = NEW.visit_id FOR SHARE;
      IF visit_status IS DISTINCT FROM 'COMPLETED' THEN
        RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'An invoice is created only for a completed visit';
      END IF;
      IF visit_branch IS DISTINCT FROM NEW.branch_id THEN
        RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'An invoice belongs to the branch of its visit';
      END IF;
    ELSIF NEW.kind = 'COMBO_SALE' AND NOT EXISTS (SELECT 1 FROM loyalty_go_live) THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'A combo is sold only once loyalty is live';
    END IF;
    IF NEW.business_date IS DISTINCT FROM lucy_branch_local_date(NEW.branch_id, NEW.created_at) THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Invoice business date must be the branch-local date of its creation';
    END IF;
  ELSE
    IF (NEW.id, NEW.code, NEW.kind, NEW.channel, NEW.branch_id, NEW.visit_id, NEW.business_date, NEW.created_by_user_id, NEW.created_at)
      IS DISTINCT FROM (OLD.id, OLD.code, OLD.kind, OLD.channel, OLD.branch_id, OLD.visit_id, OLD.business_date,
        OLD.created_by_user_id, OLD.created_at) THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Invoice identity cannot be rewritten';
    END IF;
    IF OLD.status = 'CANCELLED' AND NEW IS DISTINCT FROM OLD THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'A cancelled invoice is final';
    END IF;
    IF NEW IS DISTINCT FROM OLD AND NEW.row_version <> OLD.row_version + 1 THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Invoice changes bump the version by one';
    END IF;
    IF NEW.status <> OLD.status AND NOT (
      (OLD.status = 'DRAFT' AND NEW.status IN ('PENDING_PAYMENT', 'PAID', 'CANCELLED'))
      OR (OLD.status = 'PENDING_PAYMENT' AND NEW.status IN ('PAID', 'CANCELLED'))
      OR (OLD.status = 'PAID' AND NEW.status IN ('PENDING_PAYMENT', 'CANCELLED'))) THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Illegal invoice status transition';
    END IF;
    -- Once finalized, the payer, the calculation result and the finalization facts are frozen.
    IF OLD.status <> 'DRAFT'
      AND (NEW.payer_user_id, NEW.calculation_version, NEW.subtotal_vnd, NEW.discount_total_vnd, NEW.shipping_fee_vnd,
           NEW.total_vnd, NEW.finalized_at, NEW.finalized_by_user_id)
        IS DISTINCT FROM (OLD.payer_user_id, OLD.calculation_version, OLD.subtotal_vnd,
           OLD.discount_total_vnd, OLD.shipping_fee_vnd, OLD.total_vnd, OLD.finalized_at, OLD.finalized_by_user_id) THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'A finalized invoice keeps its payer, amounts and finalization facts';
    END IF;
    -- paid_seq counts paid episodes: +1 exactly when the invoice becomes PAID, otherwise unchanged.
    IF NEW.paid_seq IS DISTINCT FROM OLD.paid_seq
        + (CASE WHEN NEW.status = 'PAID' AND OLD.status <> 'PAID' THEN 1 ELSE 0 END) THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'The paid episode counter increments only when the invoice becomes paid';
    END IF;
    IF (OLD.status = 'PAID' AND NEW.status IN ('PAID', 'CANCELLED'))
      AND NEW.paid_at IS DISTINCT FROM OLD.paid_at THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'The paid time is a historical fact and is kept';
    END IF;
    IF NEW.status = 'CANCELLED' THEN
      IF NEW.cancelled_from_status IS DISTINCT FROM OLD.status THEN
        RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'A cancellation records the status it left';
      END IF;
      -- OP-7: a PAID invoice is cancellable only when it is a zero-balance transaction and no
      -- Payment row exists at all. Any payment (cash, provider, split; effective or reversed)
      -- follows the Q6 correction rules instead: reverse first, then cancel while PENDING_PAYMENT.
      IF OLD.status = 'PAID' AND (NEW.total_vnd <> 0
        OR EXISTS (SELECT 1 FROM payments WHERE invoice_id = OLD.id)) THEN
        RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'A paid invoice can be cancelled only as a zero-balance correction with no payment';
      END IF;
    END IF;
    -- Finalization: every line is priced with a quantity and the subtotal is the sum of the lines.
    IF OLD.status = 'DRAFT' AND NEW.status IN ('PENDING_PAYMENT', 'PAID') THEN
      SELECT count(*), count(*) FILTER (WHERE quantity IS NULL OR unit_price_vnd IS NULL),
        COALESCE(sum(gross_vnd), 0)
        INTO line_count, unpriced, line_total FROM invoice_lines WHERE invoice_id = OLD.id;
      IF line_count = 0 OR unpriced > 0 THEN
        RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Finalization needs every line priced with a quantity';
      END IF;
      IF NEW.subtotal_vnd <> line_total THEN
        RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'The finalized subtotal must be the sum of its lines';
      END IF;
      -- OP-2: only a receivable of exactly 0 is settled directly (paid_at = finalized_at); anything
      -- else waits for payments.
      IF NEW.status = 'PAID' AND (NEW.total_vnd <> 0 OR NEW.paid_at IS DISTINCT FROM NEW.finalized_at) THEN
        RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Only a zero-balance invoice is settled directly at finalization';
      END IF;
      IF EXISTS (
        SELECT 1 FROM invoice_line_products d
          JOIN product_variants v ON v.id = d.variant_id JOIN products p ON p.id = v.product_id
        WHERE d.invoice_id = OLD.id AND (p.status <> 'PUBLISHED' OR NOT v.is_active)) THEN
        RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Only a published product with an active variant is sold';
      END IF;
    END IF;
  END IF;
  IF NEW.payer_user_id IS NOT NULL
    AND (TG_OP = 'INSERT' OR NEW.payer_user_id IS DISTINCT FROM OLD.payer_user_id) THEN
    SELECT kind INTO payer_kind FROM users WHERE id = NEW.payer_user_id;
    IF payer_kind IS DISTINCT FROM 'CUSTOMER' THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'An invoice payer is a customer account';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

-- Invoice line guard: a line's kind follows its invoice's kind (VISIT: service or product; COMBO_SALE: its combo line;
-- PRODUCT_SALE: product lines), and a combo purchase line is priced by its combo and never edited.
CREATE OR REPLACE FUNCTION lucy_guard_invoice_line() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  invoice_status "InvoiceStatus";
  invoice_kind "InvoiceKind";
BEGIN
  -- FOR SHARE serializes with the invoice's finalization or cancellation.
  SELECT status, kind INTO invoice_status, invoice_kind FROM invoices WHERE id = NEW.invoice_id FOR SHARE;
  IF invoice_status IS DISTINCT FROM 'DRAFT' THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Invoice lines are created and priced only while the invoice is a draft';
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.row_version <> 1 THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'An invoice line starts at version 1';
    END IF;
    IF NOT ((invoice_kind = 'VISIT' AND NEW.kind IN ('SERVICE', 'PRODUCT'))
      OR (invoice_kind = 'COMBO_SALE' AND NEW.kind = 'COMBO_PURCHASE')
      OR (invoice_kind = 'PRODUCT_SALE' AND NEW.kind = 'PRODUCT')) THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'The line kind must match the invoice kind';
    END IF;
  ELSE
    IF (NEW.id, NEW.invoice_id, NEW.sequence, NEW.kind, NEW.item_code, NEW.name_vi, NEW.name_en, NEW.created_at)
      IS DISTINCT FROM (OLD.id, OLD.invoice_id, OLD.sequence, OLD.kind, OLD.item_code, OLD.name_vi,
        OLD.name_en, OLD.created_at) THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Invoice line identity and snapshot cannot be rewritten';
    END IF;
    IF NEW IS DISTINCT FROM OLD AND NEW.row_version <> OLD.row_version + 1 THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Invoice line changes bump the version by one';
    END IF;
    IF NEW.kind = 'COMBO_PURCHASE' AND NEW IS DISTINCT FROM OLD THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'A combo purchase line is priced by its combo and never edited';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

-- Commit-time integrity of one invoice: the P5-5 function (combo usage) with the content rule split by kind. A VISIT invoice keeps
-- "every performed service exactly once" for its SERVICE lines (its product lines are counted apart); a COMBO_SALE keeps its one
-- combo line; a PRODUCT_SALE carries product lines only and at least one once finalized. For every product line, on any invoice:
-- it has its detail, it is priced at the effective price its variant had at the recorded instant and, once the invoice is finalized,
-- that instant IS the finalization (the price is frozen); a finalized invoice reserves every product line, a cancelled one holds
-- nothing, and a draft holds nothing. The finalization and payment reconciliation rules are unchanged.
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
      WHERE l.invoice_id = target.id
        AND NOT EXISTS (
          SELECT 1 FROM stock_reservations r
          WHERE r.invoice_line_id = l.id AND r.invoice_id = target.id AND r.branch_id = target.branch_id
            AND r.variant_id = d.variant_id AND r.quantity = l.quantity)) THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'A finalized invoice reserves the stock of every product line';
    END IF;
    IF (target.status = 'CANCELLED' AND EXISTS (
          SELECT 1 FROM stock_reservations WHERE invoice_id = target.id AND status <> 'RELEASED'))
      OR (target.status <> 'CANCELLED' AND EXISTS (
          SELECT 1 FROM stock_reservations WHERE invoice_id = target.id AND status = 'RELEASED')) THEN
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

CREATE CONSTRAINT TRIGGER "invoice_line_products_integrity" AFTER INSERT OR UPDATE ON "invoice_line_products"
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION lucy_check_invoice_integrity();
CREATE CONSTRAINT TRIGGER "stock_reservations_integrity" AFTER INSERT OR UPDATE ON "stock_reservations"
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION lucy_check_invoice_integrity();

-- CREATE OR REPLACE drops function-level settings and CREATE FUNCTION starts without them: apply the Phase 1 convention
-- (fixed search_path, no PUBLIC execute) to every function this migration touches.
DO $$
DECLARE
  migration_schema text := current_schema();
  function_name text;
BEGIN
  FOREACH function_name IN ARRAY ARRAY[
    'lucy_guard_invoice_line_product', 'lucy_guard_draft_product_delete', 'lucy_guard_stock_reservation',
    'lucy_apply_stock_reservation', 'lucy_check_stock_reservations', 'lucy_guard_stock_level', 'lucy_guard_invoice',
    'lucy_guard_invoice_line', 'lucy_check_invoice_integrity'
  ] LOOP
    EXECUTE format('ALTER FUNCTION %I.%I() SET search_path TO pg_catalog, %I, pg_temp',
      migration_schema, function_name, migration_schema);
    EXECUTE format('REVOKE ALL ON FUNCTION %I.%I() FROM PUBLIC', migration_schema, function_name);
  END LOOP;
END;
$$;
