-- Phase 6 P6-20 (Wave 4: online fulfilment), migration 1 of 1 (design 2.38; T39, T41, OQ-90, OQ-94 to OQ-96, OQ-98; the Owner's words of 2026-10-09).
-- Additive: five tables and two checks. No existing row is rewritten, no permission is added or granted, nothing is deleted.
--
--   shipping_carriers          the carriers the shop uses, entered by the Owner (OQ-95: no carrier is invented); an optional tracking link
--                              template with {code}.
--   online_shipments           ONE per online order: the carrier, the tracking code and the cost the shop PAID the carrier for the way
--                              there (internal: only people who may refund see it). Never edited; a mistake is corrected by a new record.
--   online_shipment_corrections  a new tracking code and/or a new carrier cost, with a written reason (append-only).
--   online_address_corrections the delivery address changed after the order was placed (a wrong address found by the carrier), append-only.
--   online_order_logs          the history of the delivery: a failed attempt and its reason, each contact with the customer, a new delivery
--                              attempt, the customer no longer wanting the parcel, the parcel back at the shop, the delivery (staff or
--                              customer), a note. Append-only, written by the API.
--   online_order_scans         the daily 08:00 branch-local claim row of the online alert (parcels not shipped in time, parcels shipped more
--                              than 7 days ago with no delivery date).
--   product_order_lines        a SHIPPED or delivered line has the shipment of its order, and an order ships as ONE parcel: every line that is
--                              not cancelled ships together (checked at commit).
--
-- Money is integer VND and only the shipment cost lives here (an internal cost, never a price). Timestamps are UTC; business dates use the
-- branch timezone.

-- ----------------------------------------------------------------------------------------------- carriers
CREATE TABLE "shipping_carriers" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "name" VARCHAR(80) NOT NULL,
    "tracking_url_template" VARCHAR(300),
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_by_user_id" UUID NOT NULL,
    "row_version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT clock_timestamp(),
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT clock_timestamp(),

    CONSTRAINT "shipping_carriers_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "shipping_carriers_name" CHECK (btrim("name") <> ''),
    -- A tracking link is an https address with exactly one {code} place.
    CONSTRAINT "shipping_carriers_template" CHECK (
      "tracking_url_template" IS NULL
      OR ("tracking_url_template" ~ '^https://[^ ]+$'
          AND length("tracking_url_template") - length(replace("tracking_url_template", '{code}', '')) = 6))
);
CREATE UNIQUE INDEX "shipping_carriers_name_key" ON "shipping_carriers"(lower("name"));
ALTER TABLE "shipping_carriers" ADD CONSTRAINT "shipping_carriers_created_by_fkey"
  FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

CREATE FUNCTION lucy_guard_shipping_carrier() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'A carrier is history and is switched off, never deleted';
  END IF;
  IF TG_OP = 'UPDATE' THEN
    IF NEW IS DISTINCT FROM OLD AND NEW.row_version <> OLD.row_version + 1 THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'A carrier changes by one version at a time';
    END IF;
    IF (NEW.id, NEW.created_by_user_id, NEW.created_at) IS DISTINCT FROM (OLD.id, OLD.created_by_user_id, OLD.created_at) THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'The identity of a carrier never changes';
    END IF;
  END IF;
  NEW.updated_at := clock_timestamp();
  RETURN NEW;
END;
$$;
CREATE TRIGGER "shipping_carriers_guard" BEFORE UPDATE OR DELETE ON "shipping_carriers"
FOR EACH ROW EXECUTE FUNCTION lucy_guard_shipping_carrier();

-- ----------------------------------------------------------------------------------------------- shipments
CREATE TABLE "online_shipments" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "order_id" UUID NOT NULL,
    "carrier_id" UUID NOT NULL,
    "carrier_name" VARCHAR(80) NOT NULL,
    "tracking_code" VARCHAR(80) NOT NULL,
    "carrier_fee_out_vnd" BIGINT NOT NULL,
    "shipped_at" TIMESTAMPTZ(3) NOT NULL,
    "shipped_by_user_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT clock_timestamp(),

    CONSTRAINT "online_shipments_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "online_shipments_code" CHECK (btrim("tracking_code") <> '' AND "tracking_code" = btrim("tracking_code")),
    CONSTRAINT "online_shipments_fee" CHECK ("carrier_fee_out_vnd" >= 0)
);
CREATE UNIQUE INDEX "online_shipments_order_key" ON "online_shipments"("order_id");
ALTER TABLE "online_shipments" ADD CONSTRAINT "online_shipments_order_id_fkey"
  FOREIGN KEY ("order_id") REFERENCES "product_orders"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "online_shipments" ADD CONSTRAINT "online_shipments_carrier_id_fkey"
  FOREIGN KEY ("carrier_id") REFERENCES "shipping_carriers"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "online_shipments" ADD CONSTRAINT "online_shipments_shipped_by_fkey"
  FOREIGN KEY ("shipped_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

CREATE TABLE "online_shipment_corrections" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "shipment_id" UUID NOT NULL,
    "tracking_code" VARCHAR(80) NOT NULL,
    "carrier_fee_out_vnd" BIGINT NOT NULL,
    "reason" TEXT NOT NULL,
    "actor_user_id" UUID NOT NULL,
    "occurred_at" TIMESTAMPTZ(3) NOT NULL DEFAULT clock_timestamp(),

    CONSTRAINT "online_shipment_corrections_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "online_shipment_corrections_code" CHECK (btrim("tracking_code") <> '' AND "tracking_code" = btrim("tracking_code")),
    CONSTRAINT "online_shipment_corrections_fee" CHECK ("carrier_fee_out_vnd" >= 0),
    CONSTRAINT "online_shipment_corrections_reason" CHECK (btrim("reason") <> '')
);
CREATE INDEX "online_shipment_corrections_shipment_idx" ON "online_shipment_corrections"("shipment_id", "occurred_at", "id");
ALTER TABLE "online_shipment_corrections" ADD CONSTRAINT "online_shipment_corrections_shipment_fkey"
  FOREIGN KEY ("shipment_id") REFERENCES "online_shipments"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "online_shipment_corrections" ADD CONSTRAINT "online_shipment_corrections_actor_fkey"
  FOREIGN KEY ("actor_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- --------------------------------------------------------------------------------------- address changes
CREATE TABLE "online_address_corrections" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "order_id" UUID NOT NULL,
    "recipient_name" VARCHAR(120) NOT NULL,
    "recipient_phone" VARCHAR(16) NOT NULL,
    "province_code" VARCHAR(40) NOT NULL,
    "province_name" VARCHAR(80) NOT NULL,
    "ward" VARCHAR(120) NOT NULL,
    "street" VARCHAR(200) NOT NULL,
    "reason" TEXT NOT NULL,
    "actor_user_id" UUID NOT NULL,
    "occurred_at" TIMESTAMPTZ(3) NOT NULL DEFAULT clock_timestamp(),

    CONSTRAINT "online_address_corrections_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "online_address_corrections_phone" CHECK (("recipient_phone" = lucy_phone_canonical("recipient_phone")) IS TRUE),
    CONSTRAINT "online_address_corrections_text" CHECK (
      btrim("recipient_name") <> '' AND btrim("province_name") <> '' AND btrim("ward") <> '' AND btrim("street") <> ''
      AND btrim("reason") <> '')
);
CREATE INDEX "online_address_corrections_order_idx" ON "online_address_corrections"("order_id", "occurred_at", "id");
ALTER TABLE "online_address_corrections" ADD CONSTRAINT "online_address_corrections_order_fkey"
  FOREIGN KEY ("order_id") REFERENCES "product_orders"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "online_address_corrections" ADD CONSTRAINT "online_address_corrections_actor_fkey"
  FOREIGN KEY ("actor_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- -------------------------------------------------------------------------------------------------- logs
CREATE TABLE "online_order_logs" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "order_id" UUID NOT NULL,
    "kind" VARCHAR(32) NOT NULL,
    "reason_code" VARCHAR(32),
    "note" TEXT,
    "actor_kind" VARCHAR(8) NOT NULL,
    "actor_user_id" UUID,
    "occurred_at" TIMESTAMPTZ(3) NOT NULL DEFAULT clock_timestamp(),

    CONSTRAINT "online_order_logs_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "online_order_logs_kind" CHECK ("kind" IN (
      'DELIVERY_FAILED', 'CONTACTED', 'REDELIVERY', 'RETURN_STARTED', 'RETURNED_TO_SHOP', 'DELIVERED', 'NOTE')),
    CONSTRAINT "online_order_logs_reason" CHECK (
      ("kind" = 'DELIVERY_FAILED' AND "reason_code" IN ('CUSTOMER_UNREACHABLE', 'CUSTOMER_AWAY', 'WRONG_ADDRESS', 'REFUSED', 'OTHER'))
      OR ("kind" <> 'DELIVERY_FAILED' AND "reason_code" IS NULL)),
    CONSTRAINT "online_order_logs_note" CHECK ("note" IS NULL OR btrim("note") <> ''),
    -- A contact, a failed attempt and a return say what happened; a delivery needs no words.
    CONSTRAINT "online_order_logs_words" CHECK ("kind" IN ('DELIVERED', 'REDELIVERY') OR "note" IS NOT NULL),
    CONSTRAINT "online_order_logs_actor" CHECK (
      ("actor_kind" = 'SYSTEM' AND "actor_user_id" IS NULL) OR ("actor_kind" IN ('STAFF', 'CUSTOMER') AND "actor_user_id" IS NOT NULL))
);
CREATE INDEX "online_order_logs_order_idx" ON "online_order_logs"("order_id", "occurred_at", "id");
ALTER TABLE "online_order_logs" ADD CONSTRAINT "online_order_logs_order_fkey"
  FOREIGN KEY ("order_id") REFERENCES "product_orders"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "online_order_logs" ADD CONSTRAINT "online_order_logs_actor_fkey"
  FOREIGN KEY ("actor_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- The records above are history: written once, never changed, never deleted, never truncated.
CREATE FUNCTION lucy_guard_online_history() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP <> 'INSERT' THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'The record of a shipment, an address change or a delivery event is history and is never changed or deleted';
  END IF;
  NEW.occurred_at := COALESCE(NEW.occurred_at, clock_timestamp());
  RETURN NEW;
END;
$$;
CREATE FUNCTION lucy_guard_online_shipment() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  ord product_orders%ROWTYPE;
BEGIN
  IF TG_OP <> 'INSERT' THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'A shipment is history and is corrected by a new record, never changed or deleted';
  END IF;
  SELECT * INTO ord FROM product_orders WHERE id = NEW.order_id;
  IF ord.id IS NULL OR ord.channel <> 'ONLINE' THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'A shipment belongs to an online order';
  END IF;
  NEW.created_at := clock_timestamp();
  RETURN NEW;
END;
$$;
CREATE TRIGGER "online_shipments_guard" BEFORE INSERT OR UPDATE OR DELETE ON "online_shipments"
FOR EACH ROW EXECUTE FUNCTION lucy_guard_online_shipment();
CREATE TRIGGER "online_shipment_corrections_guard" BEFORE INSERT OR UPDATE OR DELETE ON "online_shipment_corrections"
FOR EACH ROW EXECUTE FUNCTION lucy_guard_online_history();
CREATE TRIGGER "online_address_corrections_guard" BEFORE INSERT OR UPDATE OR DELETE ON "online_address_corrections"
FOR EACH ROW EXECUTE FUNCTION lucy_guard_online_history();
CREATE TRIGGER "online_order_logs_guard" BEFORE INSERT OR UPDATE OR DELETE ON "online_order_logs"
FOR EACH ROW EXECUTE FUNCTION lucy_guard_online_history();
CREATE TRIGGER "online_shipments_no_truncate" BEFORE TRUNCATE ON "online_shipments"
FOR EACH STATEMENT EXECUTE FUNCTION lucy_guard_product_order_truncate();
CREATE TRIGGER "online_shipment_corrections_no_truncate" BEFORE TRUNCATE ON "online_shipment_corrections"
FOR EACH STATEMENT EXECUTE FUNCTION lucy_guard_product_order_truncate();
CREATE TRIGGER "online_address_corrections_no_truncate" BEFORE TRUNCATE ON "online_address_corrections"
FOR EACH STATEMENT EXECUTE FUNCTION lucy_guard_product_order_truncate();
CREATE TRIGGER "online_order_logs_no_truncate" BEFORE TRUNCATE ON "online_order_logs"
FOR EACH STATEMENT EXECUTE FUNCTION lucy_guard_product_order_truncate();

-- ---------------------------------------------------------------------------------------------- the scan
CREATE TABLE "online_order_scans" (
    "branch_id" UUID NOT NULL,
    "business_date" DATE NOT NULL,
    "unshipped_orders" INTEGER NOT NULL,
    "undelivered_orders" INTEGER NOT NULL,
    "outcome" TEXT NOT NULL,
    "scanned_at" TIMESTAMPTZ(3) NOT NULL DEFAULT clock_timestamp(),

    CONSTRAINT "online_order_scans_pkey" PRIMARY KEY ("branch_id", "business_date"),
    CONSTRAINT "online_order_scans_values" CHECK ("unshipped_orders" >= 0 AND "undelivered_orders" >= 0),
    CONSTRAINT "online_order_scans_outcome" CHECK ("outcome" IN ('PUBLISHED', 'NOTHING_TO_REPORT', 'UNROUTABLE'))
);
ALTER TABLE "online_order_scans" ADD CONSTRAINT "online_order_scans_branch_fkey"
  FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
CREATE TRIGGER "online_order_scans_guard" BEFORE UPDATE OR DELETE ON "online_order_scans"
FOR EACH ROW EXECUTE FUNCTION lucy_guard_online_history();
CREATE TRIGGER "online_order_scans_no_truncate" BEFORE TRUNCATE ON "online_order_scans"
FOR EACH STATEMENT EXECUTE FUNCTION lucy_guard_product_order_truncate();

-- ------------------------------------------------------------------------------------------ the queue
-- Where each online order stands, for the screens of the people who pack and ship (one reading, so every list and count agrees):
--   UNPAID           not paid (waiting, or cancelled before any payment): not in the staff queue
--   CANCELLED        paid, and every line was cancelled (refunded before shipping, or settled after a failed delivery)
--   DONE             every line that is not cancelled was delivered
--   DELIVERY_FAILED  shipped, and the last word on the delivery is a failed attempt, a customer who no longer wants it, or the parcel back
--   SHIPPED          shipped and on its way
--   TO_SHIP          every line that is not cancelled is ready to pack (in stock and paid, or a pre-order whose goods arrived)
--   WAITING_GOODS    some pre-order line still waits for its goods
CREATE VIEW "online_order_states" AS
SELECT p.id AS order_id, p.branch_id, p.code,
  CASE
    WHEN i.status <> 'PAID' AND i.paid_seq = 0 THEN 'UNPAID'
    WHEN s.live = 0 THEN 'CANCELLED'
    WHEN s.live = s.done THEN 'DONE'
    WHEN s.shipped > 0 AND f.kind IN ('DELIVERY_FAILED', 'RETURN_STARTED', 'RETURNED_TO_SHOP') THEN 'DELIVERY_FAILED'
    WHEN s.shipped > 0 THEN 'SHIPPED'
    WHEN s.live = s.ready THEN 'TO_SHIP'
    ELSE 'WAITING_GOODS'
  END AS queue_state,
  s.ready_at, s.shipped_at, f.kind AS last_delivery_event
FROM product_orders p
  JOIN invoices i ON i.id = p.invoice_id
  CROSS JOIN LATERAL (
    SELECT count(*) FILTER (WHERE l.status <> 'CANCELLED') AS live,
           count(*) FILTER (WHERE l.status = 'COMPLETED') AS done,
           count(*) FILTER (WHERE l.status = 'SHIPPED') AS shipped,
           count(*) FILTER (WHERE (d.fulfilment_mode = 'PRE_ORDER' AND l.status = 'ARRIVED')
                              OR (d.fulfilment_mode = 'IN_STOCK' AND l.status = 'PAID')) AS ready,
           max(CASE WHEN l.status <> 'CANCELLED' THEN CASE WHEN d.fulfilment_mode = 'PRE_ORDER' THEN l.arrived_at ELSE l.paid_at END END) AS ready_at,
           max(l.shipped_at) AS shipped_at
    FROM product_order_lines l JOIN invoice_line_products d ON d.invoice_line_id = l.invoice_line_id
    WHERE l.order_id = p.id) s
  LEFT JOIN LATERAL (
    SELECT g.kind FROM online_order_logs g
    WHERE g.order_id = p.id AND g.kind IN ('DELIVERY_FAILED', 'REDELIVERY', 'RETURN_STARTED', 'RETURNED_TO_SHOP', 'DELIVERED')
    ORDER BY g.occurred_at DESC, g.id DESC LIMIT 1) f ON true
WHERE p.channel = 'ONLINE';

-- ------------------------------------------------------------------------------ one parcel, one shipment
-- At commit: a line that SHIPPED (or was delivered) has the shipment of its order, and every line of the order that is not cancelled
-- shipped with it (one order, one parcel, OQ-90). A line cancelled after a failed delivery was shipped like the others.
CREATE FUNCTION lucy_check_online_parcel() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  order_id_value uuid;
BEGIN
  order_id_value := NEW.order_id;
  IF EXISTS (SELECT 1 FROM product_order_lines o WHERE o.order_id = order_id_value AND o.shipped_at IS NOT NULL)
     AND NOT EXISTS (SELECT 1 FROM online_shipments s WHERE s.order_id = order_id_value) THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'A shipped line has the shipment of its order';
  END IF;
  IF EXISTS (SELECT 1 FROM online_shipments s WHERE s.order_id = order_id_value)
     AND EXISTS (SELECT 1 FROM product_order_lines o WHERE o.order_id = order_id_value AND o.shipped_at IS NOT NULL)
     AND EXISTS (
       SELECT 1 FROM product_order_lines o
       WHERE o.order_id = order_id_value AND o.shipped_at IS NULL AND o.status <> 'CANCELLED') THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'An order ships as one parcel: every line that is not cancelled ships together';
  END IF;
  IF EXISTS (SELECT 1 FROM online_shipments s WHERE s.order_id = order_id_value)
     AND NOT EXISTS (SELECT 1 FROM product_order_lines o WHERE o.order_id = order_id_value AND o.shipped_at IS NOT NULL) THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'A shipment carries at least one shipped line';
  END IF;
  RETURN NULL;
END;
$$;
CREATE CONSTRAINT TRIGGER "online_lines_parcel" AFTER INSERT OR UPDATE ON "product_order_lines"
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW WHEN (NEW.shipped_at IS NOT NULL OR NEW.status = 'CANCELLED') EXECUTE FUNCTION lucy_check_online_parcel();
CREATE CONSTRAINT TRIGGER "online_shipments_parcel" AFTER INSERT ON "online_shipments"
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION lucy_check_online_parcel();

-- The Phase 1 convention (fixed search_path, no PUBLIC execute) for every function this migration creates.
DO $$
DECLARE
  migration_schema text := current_schema();
  function_name text;
BEGIN
  FOREACH function_name IN ARRAY ARRAY[
    'lucy_guard_shipping_carrier', 'lucy_guard_online_history', 'lucy_guard_online_shipment', 'lucy_check_online_parcel'
  ] LOOP
    EXECUTE format('ALTER FUNCTION %I.%I() SET search_path TO pg_catalog, %I, pg_temp',
      migration_schema, function_name, migration_schema);
    EXECUTE format('REVOKE ALL ON FUNCTION %I.%I() FROM PUBLIC', migration_schema, function_name);
  END LOOP;
END;
$$;
