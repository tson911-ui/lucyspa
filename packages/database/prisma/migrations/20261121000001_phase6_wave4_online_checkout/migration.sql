-- Phase 6 P6-19 (Wave 4: online orders), migration 2 of 2 (design 2.38, 18.3-18.5; T38-T42, OQ-89 to OQ-103, the Owner's words of 2026-10-09).
-- Additive: tables for the settings, the carts, the delivery details of an online order and the saved addresses; one column on each of
-- product_variants and invoice_line_products relaxed or added; the replaced bodies of the guards the 3b machinery put in the way of an online
-- order; widened notification checks. No row is rewritten, no permission is added or granted, nothing is deleted.
--
--   online_sales_settings   ONE row. The master switch "Bán online" is OFF by default (the Owner, 2026-10-09); it cannot be ON without a
--                           fulfilment branch (OQ-36). The limits and promises are the approved numbers of OQ-89, 92, 94. The shipping-fee
--                           setting (T40) is kept but OFF: while it is off an online order always has a fee of 0.
--   online_carts            one cart per account (OQ-89); the price is never kept in a cart, it is resolved again at checkout.
--   online_order_details    the delivery address of ONE online order, frozen at checkout (OQ-93), with the deadline of the unpaid order and the
--                           policy version the customer accepted (OQ-103).
--   customer_addresses      the addresses a member chose to keep (OQ-93).
--   product_orders          the COUNTER-only restriction goes: an online order has the member as customer and one order line per product line.
--   product_order_lines     status SHIPPED, then COMPLETED (delivered) for an online line; CANCELLED after a failed delivery.
--   stock_reservations      an in-stock online line keeps its ordinary invoice-line reservation from checkout; it is SOLD when the line ships
--                           (not at payment) and released when the line is cancelled by a person while the invoice stays paid.
--   invoice_line_products   an online line has no seller (W4-2): the column is nullable, required for a counter line, NULL for an online one.
--
-- Money is integer VND. Timestamps are UTC; business dates use the branch timezone.

-- ------------------------------------------------------------------------------------------------ settings
CREATE TABLE "online_sales_settings" (
    "id" SMALLINT NOT NULL DEFAULT 1,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "fulfilment_branch_id" UUID,
    "unpaid_timeout_minutes" SMALLINT NOT NULL DEFAULT 30,
    "max_unpaid_orders" SMALLINT NOT NULL DEFAULT 3,
    "max_cart_lines" SMALLINT NOT NULL DEFAULT 20,
    "max_line_quantity" SMALLINT NOT NULL DEFAULT 10,
    "ship_within_working_days" SMALLINT NOT NULL DEFAULT 2,
    "transit_days_min" SMALLINT NOT NULL DEFAULT 2,
    "transit_days_max" SMALLINT NOT NULL DEFAULT 5,
    "shipping_fee_enabled" BOOLEAN NOT NULL DEFAULT false,
    "shipping_fee_vnd" BIGINT NOT NULL DEFAULT 0,
    "free_shipping_threshold_vnd" BIGINT,
    "policy_version" INTEGER NOT NULL DEFAULT 1,
    "policy_vi" TEXT,
    "policy_en" TEXT,
    "updated_by_user_id" UUID,
    "row_version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT clock_timestamp(),
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT clock_timestamp(),

    CONSTRAINT "online_sales_settings_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "online_sales_settings_singleton" CHECK ("id" = 1),
    CONSTRAINT "online_sales_settings_branch" CHECK (NOT "enabled" OR "fulfilment_branch_id" IS NOT NULL),
    CONSTRAINT "online_sales_settings_timeout" CHECK ("unpaid_timeout_minutes" BETWEEN 5 AND 120),
    CONSTRAINT "online_sales_settings_unpaid" CHECK ("max_unpaid_orders" BETWEEN 1 AND 20),
    CONSTRAINT "online_sales_settings_cart" CHECK ("max_cart_lines" BETWEEN 1 AND 100 AND "max_line_quantity" BETWEEN 1 AND 100),
    CONSTRAINT "online_sales_settings_promises" CHECK (
      "ship_within_working_days" BETWEEN 1 AND 30 AND "transit_days_min" BETWEEN 0 AND 60
      AND "transit_days_max" BETWEEN "transit_days_min" AND 60),
    CONSTRAINT "online_sales_settings_fee" CHECK (
      "shipping_fee_vnd" >= 0 AND ("free_shipping_threshold_vnd" IS NULL OR "free_shipping_threshold_vnd" > 0)),
    CONSTRAINT "online_sales_settings_policy" CHECK (
      "policy_version" >= 1 AND ("policy_vi" IS NULL OR btrim("policy_vi") <> '') AND ("policy_en" IS NULL OR btrim("policy_en") <> ''))
);
ALTER TABLE "online_sales_settings" ADD CONSTRAINT "online_sales_settings_branch_fkey"
  FOREIGN KEY ("fulfilment_branch_id") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "online_sales_settings" ADD CONSTRAINT "online_sales_settings_updated_by_fkey"
  FOREIGN KEY ("updated_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
INSERT INTO "online_sales_settings" ("id") VALUES (1);

CREATE FUNCTION lucy_guard_online_sales_settings() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP <> 'UPDATE' THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'The online sales settings row is created by the migration and never deleted';
  END IF;
  IF NEW IS DISTINCT FROM OLD AND NEW.row_version <> OLD.row_version + 1 THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'The online sales settings change by one version at a time';
  END IF;
  -- A new policy text is a new version the customers accept again.
  IF (NEW.policy_vi, NEW.policy_en) IS DISTINCT FROM (OLD.policy_vi, OLD.policy_en) AND NEW.policy_version <= OLD.policy_version THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'A changed policy text is a new policy version';
  END IF;
  NEW.updated_at := clock_timestamp();
  RETURN NEW;
END;
$$;
CREATE TRIGGER "online_sales_settings_guard" BEFORE UPDATE OR DELETE ON "online_sales_settings"
FOR EACH ROW EXECUTE FUNCTION lucy_guard_online_sales_settings();

-- ------------------------------------------------------------------------------------------- the variant
-- OQ-91: a variant shows a buy button online unless this is switched off; ON by default (the Owner's approval).
ALTER TABLE "product_variants" ADD COLUMN "sell_online" BOOLEAN NOT NULL DEFAULT true;

-- ----------------------------------------------------------------------------------------------- carts
CREATE TABLE "online_carts" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "row_version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT clock_timestamp(),
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT clock_timestamp(),

    CONSTRAINT "online_carts_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "online_carts_user_key" ON "online_carts"("user_id");
ALTER TABLE "online_carts" ADD CONSTRAINT "online_carts_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

CREATE TABLE "online_cart_lines" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "cart_id" UUID NOT NULL,
    "variant_id" UUID NOT NULL,
    "quantity" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT clock_timestamp(),
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT clock_timestamp(),

    CONSTRAINT "online_cart_lines_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "online_cart_lines_quantity" CHECK ("quantity" BETWEEN 1 AND 100)
);
CREATE UNIQUE INDEX "online_cart_lines_variant_key" ON "online_cart_lines"("cart_id", "variant_id");
ALTER TABLE "online_cart_lines" ADD CONSTRAINT "online_cart_lines_cart_id_fkey"
  FOREIGN KEY ("cart_id") REFERENCES "online_carts"("id") ON DELETE CASCADE ON UPDATE RESTRICT;
ALTER TABLE "online_cart_lines" ADD CONSTRAINT "online_cart_lines_variant_id_fkey"
  FOREIGN KEY ("variant_id") REFERENCES "product_variants"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- ------------------------------------------------------------------------------------ saved addresses
CREATE TABLE "customer_addresses" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "recipient_name" VARCHAR(120) NOT NULL,
    "recipient_phone" VARCHAR(16) NOT NULL,
    "province_code" VARCHAR(40) NOT NULL,
    "ward" VARCHAR(120) NOT NULL,
    "street" VARCHAR(200) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT clock_timestamp(),

    CONSTRAINT "customer_addresses_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "customer_addresses_phone" CHECK (("recipient_phone" = lucy_phone_canonical("recipient_phone")) IS TRUE),
    CONSTRAINT "customer_addresses_text" CHECK (btrim("recipient_name") <> '' AND btrim("ward") <> '' AND btrim("street") <> '')
);
CREATE INDEX "customer_addresses_user_idx" ON "customer_addresses"("user_id", "created_at", "id");
ALTER TABLE "customer_addresses" ADD CONSTRAINT "customer_addresses_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- ----------------------------------------------------------------------------------- order details
CREATE TABLE "online_order_details" (
    "order_id" UUID NOT NULL,
    "recipient_name" VARCHAR(120) NOT NULL,
    "recipient_phone" VARCHAR(16) NOT NULL,
    "province_code" VARCHAR(40) NOT NULL,
    "province_name" VARCHAR(80) NOT NULL,
    "ward" VARCHAR(120) NOT NULL,
    "street" VARCHAR(200) NOT NULL,
    "deadline_at" TIMESTAMPTZ(3) NOT NULL,
    "policy_version" INTEGER NOT NULL,
    "policy_accepted_at" TIMESTAMPTZ(3) NOT NULL,
    "client_request_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT clock_timestamp(),

    CONSTRAINT "online_order_details_pkey" PRIMARY KEY ("order_id"),
    CONSTRAINT "online_order_details_phone" CHECK (("recipient_phone" = lucy_phone_canonical("recipient_phone")) IS TRUE),
    CONSTRAINT "online_order_details_text" CHECK (
      btrim("recipient_name") <> '' AND btrim("province_name") <> '' AND btrim("ward") <> '' AND btrim("street") <> ''),
    CONSTRAINT "online_order_details_policy" CHECK ("policy_version" >= 1)
);
CREATE UNIQUE INDEX "online_order_details_request_key" ON "online_order_details"("client_request_id");
ALTER TABLE "online_order_details" ADD CONSTRAINT "online_order_details_order_id_fkey"
  FOREIGN KEY ("order_id") REFERENCES "product_orders"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

CREATE FUNCTION lucy_guard_online_order_details() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  ord product_orders%ROWTYPE;
  target invoices%ROWTYPE;
BEGIN
  IF TG_OP <> 'INSERT' THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'The delivery details of an online order are frozen at checkout';
  END IF;
  SELECT * INTO ord FROM product_orders WHERE id = NEW.order_id;
  SELECT * INTO target FROM invoices WHERE id = ord.invoice_id FOR SHARE;
  IF ord.id IS NULL OR ord.channel <> 'ONLINE' OR target.status <> 'DRAFT' THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Delivery details are written by the checkout of an online order';
  END IF;
  IF NEW.deadline_at <= clock_timestamp() THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'The deadline of an unpaid online order lies in the future';
  END IF;
  NEW.created_at := clock_timestamp();
  RETURN NEW;
END;
$$;
CREATE TRIGGER "online_order_details_guard" BEFORE INSERT OR UPDATE OR DELETE ON "online_order_details"
FOR EACH ROW EXECUTE FUNCTION lucy_guard_online_order_details();

CREATE TRIGGER "online_order_details_no_truncate" BEFORE TRUNCATE ON "online_order_details"
FOR EACH STATEMENT EXECUTE FUNCTION lucy_guard_product_order_truncate();

-- Every online order has its details by commit (and only an online order has them).
CREATE FUNCTION lucy_check_online_order_details() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  order_id_value uuid;
  ord product_orders%ROWTYPE;
BEGIN
  IF TG_TABLE_NAME = 'product_orders' THEN
    order_id_value := NEW.id;
  ELSE
    order_id_value := NEW.order_id;
  END IF;
  SELECT * INTO ord FROM product_orders WHERE id = order_id_value;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;
  IF (ord.channel = 'ONLINE') <> EXISTS (SELECT 1 FROM online_order_details d WHERE d.order_id = ord.id) THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'An online order has its delivery details, and a counter order has none';
  END IF;
  RETURN NULL;
END;
$$;
CREATE CONSTRAINT TRIGGER "product_orders_online_details" AFTER INSERT ON "product_orders"
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION lucy_check_online_order_details();
CREATE CONSTRAINT TRIGGER "online_order_details_integrity" AFTER INSERT ON "online_order_details"
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION lucy_check_online_order_details();

-- The sweep that cancels the unpaid online orders reads the deadlines (a new table, so no index is added to the invoices).
CREATE INDEX "online_order_details_deadline_idx" ON "online_order_details"("deadline_at", "order_id");

-- (An online invoice always has a member as its payer: its order carries the member as customer, must equal the payer, and a finalized
-- online invoice always has its order, see product_orders_online_customer, lucy_guard_product_order and lucy_check_product_orders.)

-- ------------------------------------------------------------------------------------ orders: channel
ALTER TABLE "product_orders" DROP CONSTRAINT "product_orders_counter";
ALTER TABLE "product_orders" ADD CONSTRAINT "product_orders_online_customer"
  CHECK ("channel" = 'COUNTER' OR "customer_user_id" IS NOT NULL);

-- ------------------------------------------------------------------------------------- order lines: facts
ALTER TABLE "product_order_lines" ADD COLUMN "shipped_at" TIMESTAMPTZ(3);
ALTER TABLE "product_order_lines" ADD COLUMN "shipped_by_user_id" UUID;
ALTER TABLE "product_order_lines" ADD COLUMN "delivered_at" TIMESTAMPTZ(3);
ALTER TABLE "product_order_lines" ADD COLUMN "delivered_by_user_id" UUID;
ALTER TABLE "product_order_lines" ADD COLUMN "delivered_by_kind" VARCHAR(8);
ALTER TABLE "product_order_lines" ADD CONSTRAINT "product_order_lines_shipped_by_user_id_fkey"
  FOREIGN KEY ("shipped_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "product_order_lines" ADD CONSTRAINT "product_order_lines_delivered_by_user_id_fkey"
  FOREIGN KEY ("delivered_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "product_order_lines" ADD CONSTRAINT "product_order_lines_delivered_kind"
  CHECK ("delivered_by_kind" IS NULL OR "delivered_by_kind" IN ('STAFF', 'CUSTOMER'));

ALTER TABLE "product_order_lines" DROP CONSTRAINT "product_order_lines_facts";
ALTER TABLE "product_order_lines" ADD CONSTRAINT "product_order_lines_facts" CHECK (
  ("status" = 'AWAITING_PAYMENT' AND "paid_at" IS NULL AND "expected_from" IS NULL AND "ordered_at" IS NULL
    AND "ordered_by_user_id" IS NULL AND "arrived_at" IS NULL AND "handed_over_at" IS NULL AND "completed_at" IS NULL
    AND "cancelled_at" IS NULL AND "cancel_cause" IS NULL AND "shipped_at" IS NULL AND "delivered_at" IS NULL)
  OR ("status" = 'PAID' AND "paid_at" IS NOT NULL AND "expected_from" IS NOT NULL AND "ordered_at" IS NULL
    AND "ordered_by_user_id" IS NULL AND "arrived_at" IS NULL AND "handed_over_at" IS NULL AND "completed_at" IS NULL
    AND "cancelled_at" IS NULL AND "cancel_cause" IS NULL AND "shipped_at" IS NULL AND "delivered_at" IS NULL)
  OR ("status" = 'ORDERED' AND "paid_at" IS NOT NULL AND "expected_from" IS NOT NULL AND "ordered_at" IS NOT NULL
    AND "ordered_by_user_id" IS NOT NULL AND "arrived_at" IS NULL AND "handed_over_at" IS NULL AND "completed_at" IS NULL
    AND "cancelled_at" IS NULL AND "cancel_cause" IS NULL AND "shipped_at" IS NULL AND "delivered_at" IS NULL)
  OR ("status" = 'ARRIVED' AND "paid_at" IS NOT NULL AND "expected_from" IS NOT NULL AND "arrived_at" IS NOT NULL
    AND "handed_over_at" IS NULL AND "completed_at" IS NULL AND "cancelled_at" IS NULL AND "cancel_cause" IS NULL
    AND "shipped_at" IS NULL AND "delivered_at" IS NULL)
  OR ("status" = 'HANDED_OVER' AND "paid_at" IS NOT NULL AND "arrived_at" IS NOT NULL AND "handed_over_at" IS NOT NULL
    AND "handed_over_by_user_id" IS NOT NULL AND "handed_over_to" IS NOT NULL AND "completed_at" IS NULL
    AND "cancelled_at" IS NULL AND "cancel_cause" IS NULL AND "shipped_at" IS NULL AND "delivered_at" IS NULL)
  -- A counter line is COMPLETED by its hand-over; an online line (no hand-over) by its delivery.
  OR ("status" = 'COMPLETED' AND "paid_at" IS NOT NULL AND "completed_at" IS NOT NULL AND "cancelled_at" IS NULL
    AND "cancel_cause" IS NULL
    AND (("arrived_at" IS NOT NULL AND "handed_over_at" IS NOT NULL AND "handed_over_by_user_id" IS NOT NULL
          AND "handed_over_to" IS NOT NULL AND "shipped_at" IS NULL AND "delivered_at" IS NULL)
      OR ("handed_over_at" IS NULL AND "handed_over_to" IS NULL AND "shipped_at" IS NOT NULL AND "shipped_by_user_id" IS NOT NULL
          AND "delivered_at" IS NOT NULL AND "delivered_by_user_id" IS NOT NULL AND "delivered_by_kind" IS NOT NULL
          AND "delivered_at" >= "shipped_at")))
  OR ("status" = 'SHIPPED' AND "paid_at" IS NOT NULL AND "expected_from" IS NOT NULL AND "shipped_at" IS NOT NULL
    AND "shipped_by_user_id" IS NOT NULL AND "handed_over_at" IS NULL AND "completed_at" IS NULL AND "delivered_at" IS NULL
    AND "cancelled_at" IS NULL AND "cancel_cause" IS NULL)
  OR ("status" = 'CANCELLED' AND "cancelled_at" IS NOT NULL AND "cancel_cause" IS NOT NULL AND "handed_over_at" IS NULL
    AND "completed_at" IS NULL AND "delivered_at" IS NULL
    AND ("shipped_at" IS NULL OR "cancel_cause" = 'DELIVERY_FAILED')
    AND (("cancel_cause" = 'INVOICE_CANCELLED' AND "cancelled_by_user_id" IS NULL)
      OR ("cancel_cause" <> 'INVOICE_CANCELLED' AND "cancelled_by_user_id" IS NOT NULL AND "cancel_note" IS NOT NULL))));

CREATE INDEX "product_order_lines_shipped_idx" ON "product_order_lines"("branch_id", "shipped_at", "id") WHERE "status" = 'SHIPPED';

-- ----------------------------------------------------------------------------------- the invoice line
-- Replaces the P6-15 body. An online line needs a variant that is sold online (OQ-91) and has NO seller (W4-2); a counter line keeps every
-- rule it had, the seller included.
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
    IF target.channel = 'ONLINE' AND NOT chosen.sell_online THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'An online order takes only a variant that is sold online';
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
  IF target.channel = 'ONLINE' THEN
    IF NEW.seller_user_id IS NOT NULL THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'An online line has no seller';
    END IF;
  ELSIF NEW.seller_user_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'A counter line has a seller';
  ELSIF TG_OP = 'INSERT' OR NEW.seller_user_id IS DISTINCT FROM OLD.seller_user_id THEN
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
ALTER TABLE "invoice_line_products" ALTER COLUMN "seller_user_id" DROP NOT NULL;

-- ------------------------------------------------------------------------------------------ orders
-- Replaces the P6-15 body: the same rules; the channel check stays (an order has the channel of its invoice) and now allows ONLINE.
CREATE OR REPLACE FUNCTION lucy_record_product_order_event() RETURNS trigger
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
      WHEN 'SHIPPED' THEN NEW.shipped_by_user_id
      WHEN 'COMPLETED' THEN NEW.delivered_by_user_id
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

-- ----------------------------------------------------------------------------------- order lines: guard
-- Replaces the P6-17 body. The moves and facts of the counter are unchanged. An ONLINE order has a line for EVERY product line:
--   AWAITING_PAYMENT -> PAID -> (pre-order: ORDERED -> ARRIVED) -> SHIPPED -> COMPLETED (delivered)
--   a line is cancelled by a person before it ships (the causes of OQ-32/OQ-97), or after a failed delivery (DELIVERY_FAILED, OQ-98)
-- An in-stock online line goes PAID -> SHIPPED, a pre-order line ARRIVED -> SHIPPED. The hand-over is counter only; shipping is online only.
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
       OR detail.invoice_line_id IS NULL OR (detail.fulfilment_mode <> 'PRE_ORDER' AND ord.channel <> 'ONLINE') THEN
      RAISE EXCEPTION USING ERRCODE = '23514',
        MESSAGE = 'An order line is created by the finalization of a draft invoice, for a pre-order product line or a line of an online order';
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
    OR (OLD.status = 'PAID' AND NEW.status IN ('AWAITING_PAYMENT', 'ORDERED', 'ARRIVED', 'SHIPPED', 'CANCELLED'))
    OR (OLD.status = 'ORDERED' AND NEW.status IN ('ARRIVED', 'CANCELLED'))
    OR (OLD.status = 'ARRIVED' AND NEW.status IN ('HANDED_OVER', 'SHIPPED', 'CANCELLED'))
    OR (OLD.status = 'HANDED_OVER' AND NEW.status = 'COMPLETED')
    OR (OLD.status = 'SHIPPED' AND NEW.status IN ('COMPLETED', 'CANCELLED'))) THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Illegal order line status transition';
  END IF;
  SELECT * INTO target FROM invoices WHERE id = OLD.invoice_id FOR SHARE;
  SELECT * INTO ord FROM product_orders WHERE id = OLD.order_id;
  SELECT * INTO detail FROM invoice_line_products WHERE invoice_line_id = OLD.invoice_line_id;
  -- What an earlier status recorded is kept: these columns are written only by the move that sets them.
  IF NEW.status <> 'AWAITING_PAYMENT' AND OLD.status <> 'AWAITING_PAYMENT'
     AND (NEW.paid_at, NEW.expected_from, NEW.expected_to) IS DISTINCT FROM (OLD.paid_at, OLD.expected_from, OLD.expected_to) THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'The paid time and the expected range are fixed at payment';
  END IF;
  IF OLD.ordered_at IS NOT NULL AND (NEW.ordered_at, NEW.ordered_by_user_id, NEW.ordered_note)
       IS DISTINCT FROM (OLD.ordered_at, OLD.ordered_by_user_id, OLD.ordered_note) THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'What was recorded about the supplier order is kept';
  END IF;
  IF OLD.shipped_at IS NOT NULL AND (NEW.shipped_at, NEW.shipped_by_user_id) IS DISTINCT FROM (OLD.shipped_at, OLD.shipped_by_user_id) THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'What was recorded about the shipping is kept';
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
    IF target.status <> 'PENDING_PAYMENT' OR ord.channel <> 'COUNTER' THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'A counter order line awaits payment again only when its invoice is back to pending payment';
    END IF;
    NEW.paid_at := NULL;
    NEW.expected_from := NULL;
    NEW.expected_to := NULL;
  ELSIF NEW.status = 'ORDERED' THEN
    IF target.status <> 'PAID' OR detail.fulfilment_mode <> 'PRE_ORDER' THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Goods are ordered only for a paid pre-order line';
    END IF;
    NEW.ordered_at := clock_timestamp();
  ELSIF NEW.status = 'ARRIVED' THEN
    IF target.status <> 'PAID' OR detail.fulfilment_mode <> 'PRE_ORDER' THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Goods arrive only for a paid pre-order line';
    END IF;
    NEW.arrived_at := clock_timestamp();
  ELSIF NEW.status = 'HANDED_OVER' THEN
    IF target.status <> 'PAID' OR ord.channel <> 'COUNTER' THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Goods are handed over only at the counter, for a paid invoice';
    END IF;
    NEW.handed_over_at := clock_timestamp();
  ELSIF NEW.status = 'SHIPPED' THEN
    IF target.status <> 'PAID' OR ord.channel <> 'ONLINE' THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Goods are shipped only for a paid online order';
    END IF;
    IF (detail.fulfilment_mode = 'IN_STOCK' AND OLD.status <> 'PAID') OR (detail.fulfilment_mode = 'PRE_ORDER' AND OLD.status <> 'ARRIVED') THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'An in-stock line ships from paid and a pre-order line ships when its goods have arrived';
    END IF;
    NEW.shipped_at := clock_timestamp();
  ELSIF NEW.status = 'COMPLETED' THEN
    IF OLD.status = 'SHIPPED' THEN
      -- Staff may enter the day the carrier delivered (OQ-96); it lies between the shipping and now. Otherwise it is now.
      IF NEW.delivered_at IS NULL THEN
        NEW.delivered_at := clock_timestamp();
      ELSIF NEW.delivered_at < OLD.shipped_at OR NEW.delivered_at > clock_timestamp() THEN
        RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'The delivery time lies between the shipping and now';
      END IF;
    END IF;
    NEW.completed_at := clock_timestamp();
  ELSIF NEW.status = 'CANCELLED' THEN
    IF NEW.cancel_cause = 'INVOICE_CANCELLED' THEN
      IF target.status <> 'CANCELLED' OR OLD.status NOT IN ('AWAITING_PAYMENT', 'PAID') THEN
        RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'The cancellation of the invoice cancels an order line that was not yet ordered';
      END IF;
    ELSIF NEW.cancel_cause = 'DELIVERY_FAILED' THEN
      IF target.status <> 'PAID' OR ord.channel <> 'ONLINE' OR OLD.status <> 'SHIPPED' THEN
        RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'A failed delivery cancels a shipped line of a paid online order';
      END IF;
    ELSIF target.status <> 'PAID' OR OLD.status IN ('AWAITING_PAYMENT', 'SHIPPED') THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'A paid order line is cancelled while its invoice stays paid';
    ELSIF NEW.cancel_cause = 'CUSTOMER_CANCELLED_BEFORE_ORDERING' AND OLD.status <> 'PAID' THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'A cancellation before the supplier order is only for a line that was not ordered yet';
    ELSIF NEW.cancel_cause = 'SUPPLIER_CANNOT_DELIVER' AND (OLD.status NOT IN ('PAID', 'ORDERED') OR detail.fulfilment_mode <> 'PRE_ORDER') THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'A supplier that cannot deliver cancels a pre-order line whose goods have not arrived';
    ELSIF NEW.cancel_cause = 'CUSTOMER_CHANGED_MIND' AND OLD.status NOT IN ('ORDERED', 'ARRIVED') THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'A change of mind after the supplier order is for an ordered or arrived line';
    ELSIF NEW.cancel_cause = 'LATE_OVER_7_DAYS' AND (OLD.status NOT IN ('PAID', 'ORDERED') OR OLD.expected_to IS NULL
        OR detail.fulfilment_mode <> 'PRE_ORDER'
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

-- ------------------------------------------------------------------------------- reservations
-- Replaces the P6-15 body. INSERT and the counter rules are exactly as they were. Added, for the reservation of an ONLINE order:
--   an in-stock line's INVOICE_LINE reservation is CONSUMED only when its order line is SHIPPED (not at payment) and RELEASED when the
--   invoice is cancelled or when the line was cancelled by a person while the invoice stays paid; it is never given back;
--   a pre-order line's ORDER_LINE reservation is also CONSUMED at SHIPPED.
ALTER TABLE "stock_reservations" DROP CONSTRAINT "stock_reservations_facts";
ALTER TABLE "stock_reservations" ADD CONSTRAINT "stock_reservations_facts" CHECK (
  ("status" = 'RESERVED' AND "released_at" IS NULL AND "released_by_user_id" IS NULL AND "release_cause" IS NULL
    AND "consumed_paid_seq" IS NULL AND "consumed_at" IS NULL)
  OR ("status" = 'RELEASED' AND "released_at" IS NOT NULL AND "released_by_user_id" IS NOT NULL
      AND (("source" = 'INVOICE_LINE' AND "release_cause" IN ('INVOICE_CANCELLED_UNPAID', 'ZERO_BALANCE_CORRECTION', 'ORDER_LINE_CANCELLED'))
        OR ("source" = 'ORDER_LINE' AND "release_cause" = 'ORDER_LINE_CANCELLED'))
      AND "consumed_paid_seq" IS NULL AND "consumed_at" IS NULL)
  OR ("status" = 'CONSUMED' AND "consumed_paid_seq" >= 1 AND "consumed_at" IS NOT NULL
      AND "released_at" IS NULL AND "released_by_user_id" IS NULL AND "release_cause" IS NULL)
);

CREATE OR REPLACE FUNCTION lucy_guard_stock_reservation() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  target invoices%ROWTYPE;
  line invoice_lines%ROWTYPE;
  detail invoice_line_products%ROWTYPE;
  level stock_levels%ROWTYPE;
  held product_order_lines%ROWTYPE;
  online boolean;
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
         OR held.status NOT IN ('HANDED_OVER', 'SHIPPED', 'COMPLETED') THEN
        RAISE EXCEPTION USING ERRCODE = '23514',
          MESSAGE = 'Reserved goods are sold only when their pre-order line is handed over or shipped, at the current paid episode';
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
      MESSAGE = 'Goods reserved for an order line are sold when it is handed over or shipped or released when it is cancelled, and never given back';
  END IF;
  -- An in-stock line of an ONLINE order: sold when it ships, released when the invoice or the line is cancelled, never given back.
  SELECT EXISTS (SELECT 1 FROM product_orders o WHERE o.invoice_id = OLD.invoice_id AND o.channel = 'ONLINE') INTO online;
  IF online THEN
    SELECT * INTO held FROM product_order_lines WHERE invoice_line_id = OLD.invoice_line_id;
    IF OLD.status = 'RESERVED' AND NEW.status = 'CONSUMED' THEN
      IF target.status IS DISTINCT FROM 'PAID' OR NEW.consumed_paid_seq IS DISTINCT FROM target.paid_seq
         OR held.status NOT IN ('SHIPPED', 'COMPLETED') OR held.shipped_at IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = '23514',
          MESSAGE = 'Goods of an online order are sold only when their line is shipped, at the current paid episode';
      END IF;
      NEW.consumed_at := clock_timestamp();
      RETURN NEW;
    ELSIF OLD.status = 'RESERVED' AND NEW.status = 'RELEASED' THEN
      IF NOT (target.status = 'CANCELLED'
              OR (target.status = 'PAID' AND held.status = 'CANCELLED' AND held.cancel_cause <> 'INVOICE_CANCELLED'
                  AND NEW.release_cause = 'ORDER_LINE_CANCELLED')) THEN
        RAISE EXCEPTION USING ERRCODE = '23514',
          MESSAGE = 'A reservation of an online order is released when its invoice is cancelled or its line is cancelled by a person';
      END IF;
      NEW.released_at := clock_timestamp();
      RETURN NEW;
    END IF;
    RAISE EXCEPTION USING ERRCODE = '23514',
      MESSAGE = 'The goods of an online order are sold when the line ships or released when it is cancelled, and never given back';
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
-- Replaces the P6-17 body. A COUNTER invoice keeps exactly its rules (an order and a line for each pre-order line). An ONLINE invoice has one
-- order with a line for EVERY product line; the goods of each line follow the status of the line by the mode of the line.
CREATE OR REPLACE FUNCTION lucy_check_product_orders() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  invoice_id_value uuid;
  target invoices%ROWTYPE;
  pre_count integer;
  product_count integer;
  expected_count integer;
  order_count integer;
  line_count integer;
  online boolean;
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
  online := target.channel = 'ONLINE';
  SELECT count(*) FILTER (WHERE fulfilment_mode = 'PRE_ORDER'), count(*) INTO pre_count, product_count
    FROM invoice_line_products WHERE invoice_id = target.id;
  SELECT count(*) INTO order_count FROM product_orders WHERE invoice_id = target.id;
  SELECT count(*) INTO line_count FROM product_order_lines WHERE invoice_id = target.id;
  expected_count := CASE WHEN online THEN product_count ELSE pre_count END;
  IF target.finalized_at IS NULL THEN
    IF order_count > 0 OR line_count > 0 THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'A draft invoice has no product order';
    END IF;
    RETURN NULL;
  END IF;
  IF (expected_count = 0 AND (order_count > 0 OR line_count > 0))
     OR (expected_count > 0 AND (order_count <> 1 OR line_count <> expected_count)) THEN
    RAISE EXCEPTION USING ERRCODE = '23514',
      MESSAGE = 'A finalized invoice has one order with exactly one order line for each of its pre-order lines (every product line when online)';
  END IF;
  IF expected_count = 0 THEN
    RETURN NULL;
  END IF;
  IF EXISTS (
    SELECT 1 FROM invoice_line_products d JOIN invoice_lines l ON l.id = d.invoice_line_id
    WHERE d.invoice_id = target.id AND (online OR d.fulfilment_mode = 'PRE_ORDER')
      AND NOT EXISTS (SELECT 1 FROM product_order_lines o
        WHERE o.invoice_line_id = d.invoice_line_id AND o.variant_id = d.variant_id AND o.quantity = l.quantity
          AND o.branch_id = target.branch_id)) THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'An order line matches the variant and quantity of its product line';
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
      JOIN invoice_line_products d ON d.invoice_line_id = o.invoice_line_id
      LEFT JOIN stock_reservations r ON r.invoice_line_id = o.invoice_line_id
    WHERE o.invoice_id = target.id AND (
      (d.fulfilment_mode = 'PRE_ORDER' AND (
        (o.status IN ('AWAITING_PAYMENT', 'PAID', 'ORDERED') AND r.id IS NULL)
        OR (o.status = 'ARRIVED' AND r.source = 'ORDER_LINE' AND r.status = 'RESERVED' AND r.quantity = o.quantity
            AND r.variant_id = o.variant_id AND r.branch_id = o.branch_id)
        OR (o.status IN ('HANDED_OVER', 'SHIPPED') AND r.source = 'ORDER_LINE' AND r.status IN ('RESERVED', 'CONSUMED')
            AND r.quantity = o.quantity AND r.variant_id = o.variant_id AND r.branch_id = o.branch_id)
        -- A counter line is completed by the sale of its goods; an online line by its delivery, which may come before the consumer has
        -- recorded the sale (it follows within moments): the goods are then still held, never released.
        OR (o.status = 'COMPLETED' AND r.source = 'ORDER_LINE' AND r.quantity = o.quantity
            AND r.variant_id = o.variant_id AND r.branch_id = o.branch_id
            AND ((o.shipped_at IS NULL AND r.status = 'CONSUMED') OR (o.shipped_at IS NOT NULL AND r.status IN ('RESERVED', 'CONSUMED'))))
        OR (o.status = 'CANCELLED' AND (r.id IS NULL OR r.status = 'RELEASED'
            OR (o.cancel_cause = 'DELIVERY_FAILED' AND r.status = 'CONSUMED')))))
      OR (d.fulfilment_mode = 'IN_STOCK' AND (
        (o.status IN ('AWAITING_PAYMENT', 'PAID') AND r.source = 'INVOICE_LINE' AND r.status = 'RESERVED' AND r.quantity = o.quantity
            AND r.variant_id = o.variant_id AND r.branch_id = o.branch_id)
        OR (o.status = 'SHIPPED' AND r.source = 'INVOICE_LINE' AND r.status IN ('RESERVED', 'CONSUMED') AND r.quantity = o.quantity
            AND r.variant_id = o.variant_id AND r.branch_id = o.branch_id)
        OR (o.status = 'COMPLETED' AND r.source = 'INVOICE_LINE' AND r.status IN ('RESERVED', 'CONSUMED') AND r.quantity = o.quantity
            AND r.variant_id = o.variant_id AND r.branch_id = o.branch_id)
        OR (o.status = 'CANCELLED' AND (r.status = 'RELEASED' OR (o.cancel_cause = 'DELIVERY_FAILED' AND r.status = 'CONSUMED')))))
      ) IS NOT TRUE) THEN
    RAISE EXCEPTION USING ERRCODE = '23514',
      MESSAGE = 'The goods reserved for an order line follow its status: held until shipped or handed over, sold afterwards, released when cancelled';
  END IF;
  -- A line cancelled by a person on a paid invoice is refunded in full (OQ-32); a line with nothing paid for it needs no refund. A failed
  -- delivery (OQ-98) is settled by its own record: the settlement of the parcel, checked by the trigger of the refund Step.
  IF EXISTS (
    SELECT 1 FROM product_order_lines o JOIN invoice_line_allocations a ON a.invoice_line_id = o.invoice_line_id
    WHERE o.invoice_id = target.id AND o.status = 'CANCELLED' AND o.cancel_cause NOT IN ('INVOICE_CANCELLED', 'DELIVERY_FAILED')
      AND a.net_vnd > 0
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
-- A reservation of an in-stock online line is part of the same story, so its changes are checked too.
CREATE CONSTRAINT TRIGGER "online_line_reservations_integrity" AFTER INSERT OR UPDATE ON "stock_reservations"
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW WHEN (NEW.source = 'INVOICE_LINE') EXECUTE FUNCTION lucy_check_product_orders();
-- The order of a counter invoice is checked when its product details change; an online order when its details do, too.
CREATE CONSTRAINT TRIGGER "online_product_details_integrity" AFTER INSERT OR UPDATE ON "invoice_line_products"
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW WHEN (NEW.fulfilment_mode = 'IN_STOCK') EXECUTE FUNCTION lucy_check_product_orders();

-- ------------------------------------------------------------------------------------ notifications
-- Same method as 20261118000000: the closed type CHECK and the type/entity pairing are widened, never narrowed.
--   to the member, about the invoice:  ONLINE_ORDER_SHIPPED, ONLINE_ORDER_DELIVERED, ONLINE_ORDER_DELIVERY_FAILED, ONLINE_ORDER_CANCELLED,
--                                      ONLINE_ORDER_REFUNDED
--   to the queue holders:              ONLINE_ORDER_NEW (about the order), ONLINE_ORDER_ALERT (about the branch, the daily 08:00 scan)
ALTER TABLE "notifications"
  DROP CONSTRAINT "notifications_type_check",
  ADD CONSTRAINT "notifications_type_check" CHECK ("type" IN (
    'BOOKING_CREATED', 'BOOKING_CANCELLED', 'LATE_CANCELLATION', 'BOOKING_NO_SHOW', 'CUSTOMER_ARRIVED',
    'BOOKING_KTV_CONFLICT', 'KTV_REASSIGNED', 'START_OVERDUE', 'PRE_END', 'END_OVERDUE',
    'LEAVE_REQUESTED', 'LEAVE_DECIDED',
    'INVOICE_PAID', 'INVOICE_CANCELLED', 'PAYOS_PAYMENT_SUCCEEDED', 'PAYOS_PAYMENT_ANOMALY', 'PAYMENT_REVERSED',
    'INVOICE_CANCELLED_ALERT', 'REVENUE_DAILY_SUMMARY',
    'LOW_STOCK_REACHED', 'EXPIRY_ALERT', 'EXPIRED_LOT_SOLD', 'PRODUCT_RETURN_OPENED', 'PRODUCT_REFUND_MADE',
    'PRODUCT_ORDER_ARRIVED', 'PRODUCT_ORDER_ALERT',
    'ONLINE_ORDER_SHIPPED', 'ONLINE_ORDER_DELIVERED', 'ONLINE_ORDER_DELIVERY_FAILED', 'ONLINE_ORDER_CANCELLED',
    'ONLINE_ORDER_REFUNDED', 'ONLINE_ORDER_NEW', 'ONLINE_ORDER_ALERT')),
  DROP CONSTRAINT "notifications_type_entity",
  ADD CONSTRAINT "notifications_type_entity" CHECK (
    (("type" LIKE 'LEAVE\_%') = ("entity_type" = 'LeaveRequest'))
    AND (("type" IN ('INVOICE_PAID', 'INVOICE_CANCELLED', 'PAYOS_PAYMENT_SUCCEEDED', 'PAYOS_PAYMENT_ANOMALY',
                     'PAYMENT_REVERSED', 'INVOICE_CANCELLED_ALERT', 'PRODUCT_ORDER_ARRIVED',
                     'ONLINE_ORDER_SHIPPED', 'ONLINE_ORDER_DELIVERED', 'ONLINE_ORDER_DELIVERY_FAILED', 'ONLINE_ORDER_CANCELLED',
                     'ONLINE_ORDER_REFUNDED')) = ("entity_type" = 'Invoice'))
    AND (("type" IN ('REVENUE_DAILY_SUMMARY', 'EXPIRY_ALERT', 'PRODUCT_ORDER_ALERT', 'ONLINE_ORDER_ALERT')) = ("entity_type" = 'Branch'))
    AND (("type" IN ('LOW_STOCK_REACHED', 'EXPIRED_LOT_SOLD')) = ("entity_type" = 'ProductVariant'))
    AND (
      ("type" = 'PRODUCT_RETURN_OPENED' AND "entity_type" = 'ProductReturnCase')
      OR ("type" = 'PRODUCT_REFUND_MADE' AND "entity_type" IN ('ProductReturnCase', 'ProductOrder'))
      OR ("type" = 'ONLINE_ORDER_NEW' AND "entity_type" = 'ProductOrder')
      OR ("type" NOT IN ('PRODUCT_RETURN_OPENED', 'PRODUCT_REFUND_MADE', 'ONLINE_ORDER_NEW')
          AND "entity_type" NOT IN ('ProductReturnCase', 'ProductOrder'))));

-- The Phase 1 convention (fixed search_path, no PUBLIC execute) for every function this migration creates or replaces.
DO $$
DECLARE
  migration_schema text := current_schema();
  function_name text;
BEGIN
  FOREACH function_name IN ARRAY ARRAY[
    'lucy_guard_online_sales_settings', 'lucy_guard_online_order_details', 'lucy_check_online_order_details',
    'lucy_guard_invoice_line_product', 'lucy_record_product_order_event', 'lucy_guard_product_order_line',
    'lucy_guard_stock_reservation', 'lucy_check_product_orders'
  ] LOOP
    EXECUTE format('ALTER FUNCTION %I.%I() SET search_path TO pg_catalog, %I, pg_temp',
      migration_schema, function_name, migration_schema);
    EXECUTE format('REVOKE ALL ON FUNCTION %I.%I() FROM PUBLIC', migration_schema, function_name);
  END LOOP;
END;
$$;
