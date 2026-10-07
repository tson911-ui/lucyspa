-- Phase 6 P6-4: inventory workflows (design 4; P6-T14, P6-T16; Owner decisions P6-Q8, Q13, Q14 and the pre-order scope change 2.8).
-- Additive and Wave 1 only: new tables, two sequences, one new function and the replacement of the body of one P6-2 trigger
-- function. No table of POS, invoices, discounts, loyalty, payments or the outbox is touched (the alerts below are written to
-- Phase 6 tables and handed to the notification path by the worker, never by a trigger writing to the outbox).
--
--   * receipt and count codes come from two sequences (a gap after a rolled-back command is harmless);
--   * `lucy_available_stock(branch, variant)`: THE one definition of "available" (T14): the quantity of the lots that are not
--     expired in the BRANCH-LOCAL calendar (a lot is sellable through its expiry date and expired from the next day), minus the
--     reservations held on the level (zero until Wave 2). Every later reader (the public catalog, the POS) calls this function;
--   * low stock (T16): the movement trigger raises ONE alert row when a movement that takes stock out leaves a variant at or
--     below its threshold, and re-arms when the stock is above the threshold again. A threshold changed on its own fires nothing
--     until the next movement. The worker turns pending alert rows into in-app notices;
--   * expiry (T16, Q14): one scan row per branch per local day, written by the worker.

CREATE SEQUENCE "stock_receipt_code_seq" AS BIGINT START 1;
CREATE SEQUENCE "stock_count_code_seq" AS BIGINT START 1;

-- ---------------------------------------------------------------------------------------------------- availability
CREATE FUNCTION lucy_available_stock(p_branch uuid, p_variant uuid) RETURNS integer
LANGUAGE sql STABLE AS $$
  SELECT GREATEST(0,
    COALESCE((
      SELECT sum(l.quantity_on_hand)
      FROM inventory_lots l
      JOIN branches b ON b.id = l.branch_id
      WHERE l.branch_id = p_branch AND l.variant_id = p_variant
        AND (l.expiry_date IS NULL OR l.expiry_date >= (clock_timestamp() AT TIME ZONE b.timezone)::date)
    ), 0)
    - COALESCE((SELECT s.reserved FROM stock_levels s WHERE s.branch_id = p_branch AND s.variant_id = p_variant), 0)
  )::integer
$$;

-- --------------------------------------------------------------------------------------------- low-stock alerts
CREATE TABLE "inventory_low_stock_alerts" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "branch_id" UUID NOT NULL,
    "variant_id" UUID NOT NULL,
    "on_hand" INTEGER NOT NULL,
    "threshold" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT clock_timestamp(),
    "handled_at" TIMESTAMPTZ(3),
    "outcome" TEXT,

    CONSTRAINT "inventory_low_stock_alerts_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "inventory_low_stock_alerts_values" CHECK ("on_hand" >= 0 AND "threshold" >= 0),
    CONSTRAINT "inventory_low_stock_alerts_handled" CHECK (
      ("handled_at" IS NULL) = ("outcome" IS NULL)
      AND ("outcome" IS NULL OR "outcome" IN ('PUBLISHED', 'STALE', 'UNROUTABLE')))
);
CREATE INDEX "inventory_low_stock_alerts_pending_idx" ON "inventory_low_stock_alerts"("created_at", "id")
  WHERE "handled_at" IS NULL;
CREATE INDEX "inventory_low_stock_alerts_level_idx" ON "inventory_low_stock_alerts"("branch_id", "variant_id", "created_at");
ALTER TABLE "inventory_low_stock_alerts" ADD CONSTRAINT "inventory_low_stock_alerts_branch_id_fkey"
  FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "inventory_low_stock_alerts" ADD CONSTRAINT "inventory_low_stock_alerts_variant_id_fkey"
  FOREIGN KEY ("variant_id") REFERENCES "product_variants"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- An alert is history: it is handled once (the worker stamps `handled_at` and the outcome) and never changes or disappears.
CREATE FUNCTION lucy_guard_inventory_alert() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'A stock alert is history and is never deleted';
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.handled_at IS NOT NULL THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'A stock alert starts unhandled';
    END IF;
    NEW.created_at := clock_timestamp();
    RETURN NEW;
  END IF;
  IF OLD.handled_at IS NOT NULL THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'A handled stock alert is immutable';
  END IF;
  IF (NEW.id, NEW.branch_id, NEW.variant_id, NEW.on_hand, NEW.threshold, NEW.created_at)
    IS DISTINCT FROM (OLD.id, OLD.branch_id, OLD.variant_id, OLD.on_hand, OLD.threshold, OLD.created_at) THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'A stock alert changes only by being handled';
  END IF;
  NEW.handled_at := clock_timestamp();
  RETURN NEW;
END;
$$;
CREATE TRIGGER lucy_inventory_alerts_guard BEFORE INSERT OR UPDATE OR DELETE ON "inventory_low_stock_alerts"
  FOR EACH ROW EXECUTE FUNCTION lucy_guard_inventory_alert();

-- ---------------------------------------------------------------------------------------------- expiry scans
CREATE TABLE "inventory_expiry_scans" (
    "branch_id" UUID NOT NULL,
    "business_date" DATE NOT NULL,
    "warning_days" INTEGER NOT NULL,
    "expiring_lots" INTEGER NOT NULL,
    "expired_lots" INTEGER NOT NULL,
    "outcome" TEXT NOT NULL,
    "scanned_at" TIMESTAMPTZ(3) NOT NULL DEFAULT clock_timestamp(),

    CONSTRAINT "inventory_expiry_scans_pkey" PRIMARY KEY ("branch_id", "business_date"),
    CONSTRAINT "inventory_expiry_scans_values" CHECK ("warning_days" >= 1 AND "expiring_lots" >= 0 AND "expired_lots" >= 0),
    CONSTRAINT "inventory_expiry_scans_outcome" CHECK ("outcome" IN ('PUBLISHED', 'NOTHING_TO_REPORT', 'UNROUTABLE'))
);
ALTER TABLE "inventory_expiry_scans" ADD CONSTRAINT "inventory_expiry_scans_branch_id_fkey"
  FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

CREATE FUNCTION lucy_guard_inventory_scan() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP <> 'INSERT' THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'An expiry scan is history and is never changed or deleted';
  END IF;
  NEW.scanned_at := clock_timestamp();
  RETURN NEW;
END;
$$;
CREATE TRIGGER lucy_inventory_scans_guard BEFORE INSERT OR UPDATE OR DELETE ON "inventory_expiry_scans"
  FOR EACH ROW EXECUTE FUNCTION lucy_guard_inventory_scan();

-- --------------------------------------------------------------------------------------------- the movement trigger
-- Replaces the body written in P6-2 (same name, same trigger): after the lot and the level move, the low-stock state follows.
CREATE OR REPLACE FUNCTION lucy_apply_stock_movement() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  level_on_hand integer;
  level_alerted boolean;
  level_threshold integer;
BEGIN
  UPDATE inventory_lots SET quantity_on_hand = quantity_on_hand + NEW.quantity_delta WHERE id = NEW.lot_id;
  INSERT INTO stock_levels AS s (branch_id, variant_id) VALUES (NEW.branch_id, NEW.variant_id)
    ON CONFLICT (branch_id, variant_id) DO NOTHING;
  UPDATE stock_levels SET on_hand = on_hand + NEW.quantity_delta
    WHERE branch_id = NEW.branch_id AND variant_id = NEW.variant_id
    RETURNING on_hand, low_stock_alerted INTO level_on_hand, level_alerted;
  SELECT v.low_stock_threshold INTO level_threshold FROM product_variants v WHERE v.id = NEW.variant_id;
  IF level_threshold IS NULL OR level_on_hand > level_threshold THEN
    IF level_alerted THEN
      UPDATE stock_levels SET low_stock_alerted = false
        WHERE branch_id = NEW.branch_id AND variant_id = NEW.variant_id;
    END IF;
  ELSIF NEW.quantity_delta < 0 AND NOT level_alerted THEN
    UPDATE stock_levels SET low_stock_alerted = true
      WHERE branch_id = NEW.branch_id AND variant_id = NEW.variant_id;
    INSERT INTO inventory_low_stock_alerts (branch_id, variant_id, on_hand, threshold)
      VALUES (NEW.branch_id, NEW.variant_id, level_on_hand, level_threshold);
  END IF;
  RETURN NULL;
END;
$$;
