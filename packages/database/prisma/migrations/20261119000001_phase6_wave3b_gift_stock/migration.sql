-- Phase 6 P6-18 (Wave 3b: stock of product gifts, Owner decision Q10; design 4.7), migration 2 of 2.
-- Additive: one nullable column on each of two tables, replaced bodies of two guards, one new commit-time check. No row is rewritten, no
-- permission is added or granted. Rewards stay apart from money, invoices and points.
--
--   reward_catalog_items   `variant_id`: a PRODUCT_GIFT item may be linked to a product variant. A gift with no variant (any created before
--                          Phase 6) deducts nothing. The link may change only while no unit of the item has ever been used.
--   stock_movements        kinds GIFT_OUT (one unit leaves the lot the use took it from, FEFO) and GIFT_RETURN (a manager's restore of a
--                          mistaken use puts that unit back into the SAME lot). `reward_manual_use_id` names the use.
--   commit-time            a use of a linked gift has taken exactly one unit, and a restored one has put exactly that unit back; a use of an
--                          unlinked gift moved no stock.

-- ----------------------------------------------------------------------------------------------- the gift item
ALTER TABLE "reward_catalog_items" ADD COLUMN "variant_id" UUID;
ALTER TABLE "reward_catalog_items" ADD CONSTRAINT "reward_catalog_items_variant_id_fkey"
  FOREIGN KEY ("variant_id") REFERENCES "product_variants"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "reward_catalog_items" ADD CONSTRAINT "reward_catalog_items_variant_kind"
  CHECK ("variant_id" IS NULL OR "kind" = 'PRODUCT_GIFT');
CREATE INDEX "reward_catalog_items_variant_idx" ON "reward_catalog_items"("variant_id") WHERE "variant_id" IS NOT NULL;

-- Replaces the P5-1 body: the same identity and version rules, and the stock link of a gift changes only before any unit was used.
CREATE OR REPLACE FUNCTION lucy_guard_reward_catalog_item() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.row_version <> 1 THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'A catalog item starts at version 1';
    END IF;
    NEW.created_at := clock_timestamp();
    NEW.updated_at := NEW.created_at;
    RETURN NEW;
  END IF;
  IF (NEW.id, NEW.code, NEW.kind, NEW.service_id, NEW.created_by_user_id, NEW.created_at)
    IS DISTINCT FROM (OLD.id, OLD.code, OLD.kind, OLD.service_id, OLD.created_by_user_id, OLD.created_at) THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'A catalog item identity is immutable';
  END IF;
  IF NEW.variant_id IS DISTINCT FROM OLD.variant_id AND EXISTS (
    SELECT 1 FROM reward_manual_uses u JOIN reward_entitlements e ON e.id = u.entitlement_id WHERE e.catalog_item_id = OLD.id) THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'The stock link of a gift cannot change once a unit was used';
  END IF;
  IF NEW.row_version IS DISTINCT FROM OLD.row_version + 1 THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'A catalog item update must advance its version by one';
  END IF;
  NEW.updated_at := clock_timestamp();
  RETURN NEW;
END;
$$;

-- ------------------------------------------------------------------------------------------- the movements
ALTER TABLE "stock_movements" ADD COLUMN "reward_manual_use_id" UUID;
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_reward_manual_use_id_fkey"
  FOREIGN KEY ("reward_manual_use_id") REFERENCES "reward_manual_uses"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
CREATE INDEX "stock_movements_gift_idx" ON "stock_movements"("reward_manual_use_id") WHERE "reward_manual_use_id" IS NOT NULL;

-- The shape of each movement kind: unchanged for the seven that exist; a gift movement is one unit and names the use, nothing else.
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
  OR ("kind" = 'GIFT_OUT' AND "quantity_delta" = -1 AND "reward_manual_use_id" IS NOT NULL AND "product_refund_id" IS NULL
    AND "product_exchange_id" IS NULL AND "invoice_line_id" IS NULL AND "paid_seq" IS NULL AND "reason" IS NULL
    AND "receipt_line_id" IS NULL AND "count_line_id" IS NULL AND "import_job_id" IS NULL)
  OR ("kind" = 'GIFT_RETURN' AND "quantity_delta" = 1 AND "reward_manual_use_id" IS NOT NULL AND "product_refund_id" IS NULL
    AND "product_exchange_id" IS NULL AND "invoice_line_id" IS NULL AND "paid_seq" IS NULL AND "reason" IS NULL
    AND "receipt_line_id" IS NULL AND "count_line_id" IS NULL AND "import_job_id" IS NULL)
);

-- Only a gift movement names a use, and every gift movement does.
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_gift_link"
  CHECK (("kind" IN ('GIFT_OUT', 'GIFT_RETURN')) = ("reward_manual_use_id" IS NOT NULL));

-- Movements. Replaces the P6-13 body: every earlier kind is checked exactly as before; a gift movement belongs to a use at its own branch of
-- a gift linked to its variant, takes one unit once, and goes back only after the use is restored, into the lot it came from.
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
  gift_use reward_manual_uses%ROWTYPE;
  gift_variant uuid;
  gift_taken bigint;
  gift_given_back bigint;
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
  ELSIF NEW.kind IN ('GIFT_OUT', 'GIFT_RETURN') THEN
    SELECT u.* INTO gift_use FROM reward_manual_uses u WHERE u.id = NEW.reward_manual_use_id;
    SELECT i.variant_id INTO gift_variant FROM reward_manual_uses u
      JOIN reward_entitlements e ON e.id = u.entitlement_id
      JOIN reward_catalog_items i ON i.id = e.catalog_item_id
      WHERE u.id = NEW.reward_manual_use_id;
    IF NOT FOUND OR gift_use.branch_id <> NEW.branch_id OR gift_variant IS DISTINCT FROM NEW.variant_id THEN
      RAISE EXCEPTION USING ERRCODE = '23514',
        MESSAGE = 'A gift movement belongs to a use at its own branch of a gift linked to its variant';
    END IF;
    SELECT COALESCE(-sum(m.quantity_delta), 0) INTO gift_taken FROM stock_movements m
      WHERE m.reward_manual_use_id = NEW.reward_manual_use_id AND m.kind = 'GIFT_OUT';
    IF NEW.kind = 'GIFT_OUT' THEN
      IF gift_taken - NEW.quantity_delta > 1 THEN
        RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'A gift use takes one unit';
      END IF;
    ELSE
      IF NOT EXISTS (SELECT 1 FROM reward_manual_use_restorations r WHERE r.use_id = NEW.reward_manual_use_id) THEN
        RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'A gift goes back to stock only when its use is restored';
      END IF;
      IF NOT EXISTS (SELECT 1 FROM stock_movements m WHERE m.reward_manual_use_id = NEW.reward_manual_use_id
                       AND m.kind = 'GIFT_OUT' AND m.lot_id = NEW.lot_id) THEN
        RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'A gift goes back to the lot it was taken from';
      END IF;
      SELECT COALESCE(sum(m.quantity_delta), 0) INTO gift_given_back FROM stock_movements m
        WHERE m.reward_manual_use_id = NEW.reward_manual_use_id AND m.kind = 'GIFT_RETURN';
      IF gift_given_back + NEW.quantity_delta > gift_taken THEN
        RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'A gift goes back no more than it took';
      END IF;
    END IF;
  END IF;
  NEW.created_at := clock_timestamp();
  RETURN NEW;
END;
$$;

-- Commit-time: a use of a gift linked to a product took exactly one unit; a restored use put exactly that unit back; a use of a gift that is
-- not linked moved no stock (no phantom stock, and a unit is never lost).
CREATE FUNCTION lucy_check_gift_stock() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  target_use uuid;
  linked uuid;
  restored boolean;
  taken bigint;
  given_back bigint;
BEGIN
  IF TG_TABLE_NAME = 'reward_manual_uses' THEN
    target_use := NEW.id;
  ELSIF TG_TABLE_NAME = 'reward_manual_use_restorations' THEN
    target_use := NEW.use_id;
  ELSE
    target_use := NEW.reward_manual_use_id;
  END IF;
  SELECT i.variant_id INTO linked FROM reward_manual_uses u
    JOIN reward_entitlements e ON e.id = u.entitlement_id
    JOIN reward_catalog_items i ON i.id = e.catalog_item_id
    WHERE u.id = target_use;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;
  restored := EXISTS (SELECT 1 FROM reward_manual_use_restorations r WHERE r.use_id = target_use);
  SELECT COALESCE(-sum(m.quantity_delta) FILTER (WHERE m.kind = 'GIFT_OUT'), 0),
         COALESCE(sum(m.quantity_delta) FILTER (WHERE m.kind = 'GIFT_RETURN'), 0)
    INTO taken, given_back FROM stock_movements m WHERE m.reward_manual_use_id = target_use;
  IF taken <> (CASE WHEN linked IS NULL THEN 0 ELSE 1 END)
     OR given_back <> (CASE WHEN linked IS NOT NULL AND restored THEN 1 ELSE 0 END) THEN
    RAISE EXCEPTION USING ERRCODE = '23514',
      MESSAGE = 'A use of a gift linked to a product takes exactly one unit, a restore puts it back, and an unlinked gift moves no stock';
  END IF;
  RETURN NULL;
END;
$$;
CREATE CONSTRAINT TRIGGER "reward_manual_uses_gift_balance" AFTER INSERT ON "reward_manual_uses"
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION lucy_check_gift_stock();
CREATE CONSTRAINT TRIGGER "reward_manual_use_restorations_gift_balance" AFTER INSERT ON "reward_manual_use_restorations"
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION lucy_check_gift_stock();
CREATE CONSTRAINT TRIGGER "stock_movements_gift_balance" AFTER INSERT ON "stock_movements"
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW WHEN (NEW.reward_manual_use_id IS NOT NULL) EXECUTE FUNCTION lucy_check_gift_stock();

-- CREATE OR REPLACE drops function-level settings and CREATE FUNCTION starts without them: apply the Phase 1 convention
-- (fixed search_path, no PUBLIC execute) to every function this migration touches.
DO $$
DECLARE
  migration_schema text := current_schema();
  function_name text;
BEGIN
  FOREACH function_name IN ARRAY ARRAY[
    'lucy_guard_reward_catalog_item', 'lucy_guard_stock_movement', 'lucy_check_gift_stock'
  ] LOOP
    EXECUTE format('ALTER FUNCTION %I.%I() SET search_path TO pg_catalog, %I, pg_temp',
      migration_schema, function_name, migration_schema);
    EXECUTE format('REVOKE ALL ON FUNCTION %I.%I() FROM PUBLIC', migration_schema, function_name);
  END LOOP;
END;
$$;
