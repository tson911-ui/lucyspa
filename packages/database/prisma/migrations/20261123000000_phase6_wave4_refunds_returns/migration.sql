-- Phase 6 P6-21 (Wave 4: online returns, refunds and the failed delivery), migration 1 of 1 (design 2.38; OQ-97 to OQ-100; the Owner's words of
-- 2026-10-09). Additive: two tables, two columns, widened checks and the replaced bodies of three functions. No existing row is rewritten, no
-- permission is added or granted, nothing is deleted. A counter sale behaves exactly as before.
--
--   online_failed_delivery_settlements  ONE per online order whose delivery failed, the customer no longer wants the parcel and the parcel is
--                                  back at the shop (OQ-98): the goods paid, the cost the shop paid the carrier for the way there, the cost for
--                                  the way back, and the refund = max(0, goods - out - back), never above the goods paid. The arithmetic and
--                                  the inputs are checked by the database (the figures must be the real net amounts of the lines and the real
--                                  carrier cost on record). History: never changed or deleted.
--   product_refunds                a refund may belong to such a settlement (`settlement_id`); it then follows the cancellation of a SHIPPED
--                                  line with the cause DELIVERY_FAILED: whole line, an amount from 1 VND to the net share of the line (the share
--                                  of the settlement's refund), and the goods that came back may be put back in stock as sellable (a new lot
--                                  named after the refund). The refunds of one settlement add up to the settlement's refund exactly.
--   refund_reauthentication_uses   ONE password confirmation covers the refund of a settlement, whatever the number of its lines (the Owner's
--                                  rule is one confirmation per refund; the refund of a failed delivery is one refund).
--   online_return_costs            what the shop paid to have goods come back from a customer after a delivery (OQ-100): a cost of the shop,
--                                  recorded by staff, never deducted from the refund.
--   lucy_guard_product_return_case a return case may be opened on a delivered ONLINE line: the window counts from the DELIVERY (OQ-40).
--
-- Money is integer VND. Timestamps are UTC; business dates use the branch timezone.

-- ------------------------------------------------------------------------------------------- the settlement
CREATE TABLE "online_failed_delivery_settlements" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "order_id" UUID NOT NULL,
    "goods_paid_vnd" BIGINT NOT NULL,
    "carrier_fee_out_vnd" BIGINT NOT NULL,
    "carrier_fee_back_vnd" BIGINT NOT NULL,
    "refund_vnd" BIGINT NOT NULL,
    "restock" "ProductRefundRestock" NOT NULL,
    "method" "ProductRefundMethod",
    "bank_reference" VARCHAR(80),
    "reason" TEXT NOT NULL,
    "actor_user_id" UUID NOT NULL,
    "reauthenticated_at" TIMESTAMPTZ(3),
    "client_request_id" UUID NOT NULL,
    "occurred_at" TIMESTAMPTZ(3) NOT NULL DEFAULT clock_timestamp(),

    CONSTRAINT "online_failed_delivery_settlements_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "online_failed_delivery_settlements_money" CHECK (
      "goods_paid_vnd" >= 0 AND "carrier_fee_out_vnd" >= 0 AND "carrier_fee_back_vnd" >= 0 AND "refund_vnd" >= 0
      AND "refund_vnd" <= "goods_paid_vnd"
      AND "refund_vnd" = GREATEST(0, "goods_paid_vnd" - "carrier_fee_out_vnd" - "carrier_fee_back_vnd")),
    -- A refund of 0 moves no money: no method, no password. Any other refund names its method, and its password confirmation.
    CONSTRAINT "online_failed_delivery_settlements_method" CHECK (
      ("refund_vnd" = 0 AND "method" IS NULL AND "bank_reference" IS NULL AND "reauthenticated_at" IS NULL)
      OR ("refund_vnd" > 0 AND "method" IS NOT NULL AND "reauthenticated_at" IS NOT NULL
          AND (("method" = 'BANK_TRANSFER_MANUAL') = ("bank_reference" IS NOT NULL)))),
    -- Goods that are back but earn no refund have no refund to name a lot after: they enter stock through the stock count.
    CONSTRAINT "online_failed_delivery_settlements_restock" CHECK ("refund_vnd" > 0 OR "restock" = 'NOT_SELLABLE'),
    CONSTRAINT "online_failed_delivery_settlements_reason" CHECK (btrim("reason") <> '')
);
CREATE UNIQUE INDEX "online_failed_delivery_settlements_order_key" ON "online_failed_delivery_settlements"("order_id");
CREATE UNIQUE INDEX "online_failed_delivery_settlements_request_key"
  ON "online_failed_delivery_settlements"("actor_user_id", "client_request_id");
ALTER TABLE "online_failed_delivery_settlements" ADD CONSTRAINT "online_failed_delivery_settlements_order_fkey"
  FOREIGN KEY ("order_id") REFERENCES "product_orders"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "online_failed_delivery_settlements" ADD CONSTRAINT "online_failed_delivery_settlements_actor_fkey"
  FOREIGN KEY ("actor_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
CREATE TRIGGER "online_failed_delivery_settlements_guard" BEFORE INSERT OR UPDATE OR DELETE ON "online_failed_delivery_settlements"
FOR EACH ROW EXECUTE FUNCTION lucy_guard_online_history();
CREATE TRIGGER "online_failed_delivery_settlements_no_truncate" BEFORE TRUNCATE ON "online_failed_delivery_settlements"
FOR EACH STATEMENT EXECUTE FUNCTION lucy_guard_product_order_truncate();

-- The cost of a parcel coming back from a customer after the delivery (OQ-100).
CREATE TABLE "online_return_costs" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "case_id" UUID NOT NULL,
    "cost_vnd" BIGINT NOT NULL,
    "note" TEXT,
    "actor_user_id" UUID NOT NULL,
    "occurred_at" TIMESTAMPTZ(3) NOT NULL DEFAULT clock_timestamp(),

    CONSTRAINT "online_return_costs_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "online_return_costs_cost" CHECK ("cost_vnd" >= 0),
    CONSTRAINT "online_return_costs_note" CHECK ("note" IS NULL OR btrim("note") <> '')
);
CREATE INDEX "online_return_costs_case_idx" ON "online_return_costs"("case_id", "occurred_at", "id");
ALTER TABLE "online_return_costs" ADD CONSTRAINT "online_return_costs_case_fkey"
  FOREIGN KEY ("case_id") REFERENCES "product_return_cases"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "online_return_costs" ADD CONSTRAINT "online_return_costs_actor_fkey"
  FOREIGN KEY ("actor_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
CREATE TRIGGER "online_return_costs_guard" BEFORE INSERT OR UPDATE OR DELETE ON "online_return_costs"
FOR EACH ROW EXECUTE FUNCTION lucy_guard_online_history();
CREATE TRIGGER "online_return_costs_no_truncate" BEFORE TRUNCATE ON "online_return_costs"
FOR EACH STATEMENT EXECUTE FUNCTION lucy_guard_product_order_truncate();

-- ------------------------------------------------------------------------------------- refunds: the origin
ALTER TABLE "product_refunds" ADD COLUMN "settlement_id" UUID;
ALTER TABLE "product_refunds" ADD CONSTRAINT "product_refunds_settlement_id_fkey"
  FOREIGN KEY ("settlement_id") REFERENCES "online_failed_delivery_settlements"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
CREATE INDEX "product_refunds_settlement_idx" ON "product_refunds"("settlement_id") WHERE "settlement_id" IS NOT NULL;
ALTER TABLE "product_refunds" DROP CONSTRAINT "product_refunds_origin";
ALTER TABLE "product_refunds" ADD CONSTRAINT "product_refunds_origin" CHECK (
  ("return_case_id" IS NOT NULL AND "case_ordinal" IS NOT NULL AND "order_line_id" IS NULL AND "settlement_id" IS NULL)
  -- Goods that never left the shop (a cancelled line) put nothing back; the goods of a failed delivery may come back (the guard decides).
  OR ("return_case_id" IS NULL AND "case_ordinal" IS NULL AND "order_line_id" IS NOT NULL AND "settlement_id" IS NULL
      AND "restock" = 'NOT_SELLABLE')
  OR ("return_case_id" IS NULL AND "case_ordinal" IS NULL AND "order_line_id" IS NOT NULL AND "settlement_id" IS NOT NULL));

-- ONE password confirmation per refund: a settlement is one refund.
ALTER TABLE "refund_reauthentication_uses" ADD COLUMN "settlement_id" UUID;
ALTER TABLE "refund_reauthentication_uses" ADD CONSTRAINT "refund_reauthentication_uses_settlement_fkey"
  FOREIGN KEY ("settlement_id") REFERENCES "online_failed_delivery_settlements"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
CREATE UNIQUE INDEX "refund_reauthentication_uses_settlement_key" ON "refund_reauthentication_uses"("settlement_id")
  WHERE "settlement_id" IS NOT NULL;
ALTER TABLE "refund_reauthentication_uses" DROP CONSTRAINT "refund_reauthentication_uses_owner";
-- Exactly one thing used the confirmation: a refund, an exchange (P6-14) or a settlement.
ALTER TABLE "refund_reauthentication_uses" ADD CONSTRAINT "refund_reauthentication_uses_owner"
  CHECK (num_nonnulls("product_refund_id", "product_exchange_id", "settlement_id") = 1);

CREATE OR REPLACE FUNCTION lucy_check_refund_reauthentication_use() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.settlement_id IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM refund_reauthentication_uses u
      WHERE u.settlement_id = NEW.settlement_id AND u.actor_user_id = NEW.actor_user_id AND u.reauthenticated_at = NEW.reauthenticated_at) THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'The refund of a settlement uses the password confirmation of the settlement';
    END IF;
    RETURN NULL;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM refund_reauthentication_uses u
    WHERE u.product_refund_id = NEW.id AND u.actor_user_id = NEW.actor_user_id AND u.reauthenticated_at = NEW.reauthenticated_at) THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'A refund uses its own password confirmation once';
  END IF;
  RETURN NULL;
END;
$$;

-- --------------------------------------------------------------------------------------- the refund guard
-- Replaces the body of 20261120000000. Changes: (1) an ONLINE invoice has refunds too; (2) a refund of an order line may belong to a
-- settlement of a failed delivery: the line is CANCELLED with the cause DELIVERY_FAILED, the amount is from 1 VND to the net share of the
-- line, and the goods that came back may be sellable. Everything else is exactly as it was.
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
    SELECT o.* INTO oline FROM product_order_lines o WHERE o.id = NEW.order_line_id FOR SHARE;
    IF NOT FOUND OR oline.status <> 'CANCELLED' OR oline.cancel_cause = 'INVOICE_CANCELLED'
       OR oline.invoice_id <> NEW.invoice_id OR oline.invoice_line_id <> NEW.invoice_line_id OR oline.branch_id <> NEW.branch_id THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'A refund of an order line follows its cancellation by a person, for its own line';
    END IF;
    IF (oline.cancel_cause = 'DELIVERY_FAILED') <> (NEW.settlement_id IS NOT NULL) THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'The refund of a failed delivery belongs to its settlement, and only to it';
    END IF;
    IF NEW.quantity <> oline.quantity THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'A cancelled order line is refunded for all its units';
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
  -- A part of the share: a change of mind after the supplier order (the Owner or a manager decides, OQ-32) and the refund of a failed
  -- delivery (the goods minus both ways of the carrier, OQ-98; the settlement checks that the parts add up).
  IF NEW.order_line_id IS NOT NULL AND oline.cancel_cause IN ('CUSTOMER_CHANGED_MIND', 'DELIVERY_FAILED') THEN
    IF NEW.amount_vnd < 1 OR NEW.amount_vnd > after_share - before_share THEN
      RAISE EXCEPTION USING ERRCODE = '23514',
        MESSAGE = 'The refund of a change of mind or of a failed delivery is from 1 VND up to the net share of the line';
    END IF;
  ELSIF NEW.amount_vnd <> after_share - before_share THEN
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

-- ----------------------------------------------------------------------------------- the return case guard
-- Replaces the body of 20261116000001. The window of a return starts when the goods are in the customer's hands: the hand-over of a
-- counter pre-order, the DELIVERY of an online line, the payment of an in-stock counter line (OQ-40). Everything else is as it was.
CREATE OR REPLACE FUNCTION lucy_guard_product_return_case() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  inv RECORD;
  sold integer;
  claimed integer;
  pre_order product_order_lines%ROWTYPE;
  ord_channel "InvoiceChannel";
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
    IF NEW.branch_id <> inv.branch_id THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'A return case belongs to the branch of its invoice';
    END IF;
    SELECT * INTO pre_order FROM product_order_lines WHERE invoice_line_id = NEW.invoice_line_id FOR SHARE;
    IF FOUND THEN
      SELECT channel INTO ord_channel FROM product_orders WHERE id = pre_order.order_id;
      IF pre_order.status <> 'COMPLETED' THEN
        RAISE EXCEPTION USING ERRCODE = '23514',
          MESSAGE = 'A pre-order line has a return case only after its goods were handed over and sold (an online line: delivered)';
      END IF;
      handover := CASE WHEN ord_channel = 'ONLINE' THEN pre_order.delivered_at ELSE pre_order.handed_over_at END;
    ELSE
      IF inv.channel <> 'COUNTER' THEN
        RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'An online line has a return case only after its delivery';
      END IF;
      handover := inv.paid_at;
    END IF;
    IF NEW.handover_at <> handover OR NEW.paid_seq <> inv.paid_seq THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'The return window starts when the goods were handed over or delivered';
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

-- ------------------------------------------------------------------------- the settlement, checked at commit
-- The settlement, the cancelled lines and the refunds tell one story: every line that is cancelled for a failed delivery belongs to the
-- settlement of its order; the order shipped and the parcel is back at the shop (a log says so) before the settlement; the figures are the
-- real ones (the goods are the net amounts of the lines, the cost out is the cost on record); the refunds of the settlement add up to its
-- refund exactly; and no line of the order is left shipped or delivered.
CREATE FUNCTION lucy_check_failed_delivery() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  order_id_value uuid;
  settled online_failed_delivery_settlements%ROWTYPE;
  goods bigint;
  refunded bigint;
  fee_out bigint;
BEGIN
  IF TG_TABLE_NAME = 'online_failed_delivery_settlements' THEN
    order_id_value := NEW.order_id;
  ELSIF TG_TABLE_NAME = 'product_order_lines' THEN
    order_id_value := NEW.order_id;
  ELSE
    SELECT o.order_id INTO order_id_value FROM product_order_lines o WHERE o.id = NEW.order_line_id;
  END IF;
  IF order_id_value IS NULL THEN
    RETURN NULL;
  END IF;
  SELECT * INTO settled FROM online_failed_delivery_settlements WHERE order_id = order_id_value;
  IF NOT FOUND THEN
    IF EXISTS (SELECT 1 FROM product_order_lines o WHERE o.order_id = order_id_value AND o.cancel_cause = 'DELIVERY_FAILED') THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'A line cancelled for a failed delivery has the settlement of its order';
    END IF;
    RETURN NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM online_order_logs g WHERE g.order_id = order_id_value AND g.kind = 'RETURNED_TO_SHOP') THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'A failed delivery is settled only after the parcel is back at the shop';
  END IF;
  IF EXISTS (SELECT 1 FROM product_order_lines o WHERE o.order_id = order_id_value AND o.status IN ('SHIPPED', 'COMPLETED')) THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'A settled failed delivery leaves no line shipped or delivered';
  END IF;
  SELECT COALESCE(sum(a.net_vnd), 0) INTO goods
    FROM product_order_lines o JOIN invoice_line_allocations a ON a.invoice_line_id = o.invoice_line_id
    WHERE o.order_id = order_id_value AND o.cancel_cause = 'DELIVERY_FAILED';
  IF goods <> settled.goods_paid_vnd THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'The goods paid of a settlement are the net amounts of the lines it cancels';
  END IF;
  SELECT COALESCE((SELECT c.carrier_fee_out_vnd FROM online_shipment_corrections c
                     WHERE c.shipment_id = s.id ORDER BY c.occurred_at DESC, c.id DESC LIMIT 1), s.carrier_fee_out_vnd)
    INTO fee_out FROM online_shipments s WHERE s.order_id = order_id_value;
  IF fee_out IS DISTINCT FROM settled.carrier_fee_out_vnd THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'The carrier cost out of a settlement is the cost on record';
  END IF;
  SELECT COALESCE(sum(r.amount_vnd), 0) INTO refunded FROM product_refunds r WHERE r.settlement_id = settled.id;
  IF refunded <> settled.refund_vnd THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'The refunds of a settlement add up to its refund';
  END IF;
  RETURN NULL;
END;
$$;
CREATE CONSTRAINT TRIGGER "online_settlements_integrity" AFTER INSERT ON "online_failed_delivery_settlements"
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION lucy_check_failed_delivery();
CREATE CONSTRAINT TRIGGER "online_settlement_lines_integrity" AFTER UPDATE ON "product_order_lines"
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW WHEN (NEW.cancel_cause = 'DELIVERY_FAILED') EXECUTE FUNCTION lucy_check_failed_delivery();
CREATE CONSTRAINT TRIGGER "online_settlement_refunds_integrity" AFTER INSERT ON "product_refunds"
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW WHEN (NEW.settlement_id IS NOT NULL) EXECUTE FUNCTION lucy_check_failed_delivery();

-- A shipped line that is cancelled for a failed delivery needs the parcel to be back first (the guard on the line says WHEN a line may be
-- cancelled this way; this says the evidence exists): the log "back at the shop".
CREATE FUNCTION lucy_guard_failed_delivery_cancel() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM online_order_logs g WHERE g.order_id = NEW.order_id AND g.kind = 'RETURNED_TO_SHOP') THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'A shipped line is cancelled for a failed delivery only after the parcel is back at the shop';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "product_order_lines_failed_delivery" BEFORE UPDATE ON "product_order_lines"
FOR EACH ROW WHEN (NEW.status = 'CANCELLED' AND NEW.cancel_cause = 'DELIVERY_FAILED' AND OLD.status IS DISTINCT FROM NEW.status)
EXECUTE FUNCTION lucy_guard_failed_delivery_cancel();

-- The Phase 1 convention (fixed search_path, no PUBLIC execute) for every function this migration creates or replaces.
DO $$
DECLARE
  migration_schema text := current_schema();
  function_name text;
BEGIN
  FOREACH function_name IN ARRAY ARRAY[
    'lucy_check_refund_reauthentication_use', 'lucy_guard_product_refund', 'lucy_guard_product_return_case',
    'lucy_check_failed_delivery', 'lucy_guard_failed_delivery_cancel'
  ] LOOP
    EXECUTE format('ALTER FUNCTION %I.%I() SET search_path TO pg_catalog, %I, pg_temp',
      migration_schema, function_name, migration_schema);
    EXECUTE format('REVOKE ALL ON FUNCTION %I.%I() FROM PUBLIC', migration_schema, function_name);
  END LOOP;
END;
$$;

-- ---------------------------------------------------------------------------------- invoice integrity (live order, cancelled line)
-- Same function as before (20261116000001); the only change is that a line cancelled before shipping releases its own reservation while the
-- invoice stays paid (OQ-97). The other reservations of the invoice stay held.
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
          -- Wave 4: on a live online order the reservation of a line that was cancelled before shipping is released with it.
          SELECT 1 FROM stock_reservations r WHERE r.invoice_id = target.id AND r.source = 'INVOICE_LINE' AND r.status = 'RELEASED'
            AND NOT EXISTS (SELECT 1 FROM product_order_lines o WHERE o.invoice_line_id = r.invoice_line_id AND o.status = 'CANCELLED'))) THEN
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
