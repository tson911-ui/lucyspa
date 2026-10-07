-- Phase 6 P6-2, migration 5 of 5: the inventory foundation (design section 4, P6-T13, P6-T14; Owner decisions P6-Q8, Q13, Q14).
-- Additive and Wave 1 only: new tables, empty, no table of POS, invoices, discounts, loyalty or payments is touched. No workflow
-- exists yet. Stock is per BRANCH (Q13). The kinds written in Wave 1 are OPENING (import), RECEIPT and ADJUSTMENT; the sale,
-- reversal, return, exchange and gift kinds and the reservation table arrive with the Wave 2 and 3 migrations that need an invoice.
--
--   suppliers; receipts (DRAFT -> CONFIRMED, immutable afterwards); lots with an optional expiry date;
--   an append-only movement ledger; per (branch, variant) stock levels and per-lot quantities that ONLY the movement trigger writes;
--   physical count sessions whose differences become COUNT_CORRECTION adjustments (never a silent overwrite, PRD 27.6).

CREATE TYPE "StockReceiptStatus" AS ENUM ('DRAFT', 'CONFIRMED', 'CANCELLED');
CREATE TYPE "StockMovementKind" AS ENUM ('OPENING', 'RECEIPT', 'ADJUSTMENT');
CREATE TYPE "StockAdjustmentReason" AS ENUM ('INTERNAL_USE', 'TESTER', 'DAMAGED', 'EXPIRED', 'LOSS', 'COUNT_CORRECTION');
CREATE TYPE "StockCountStatus" AS ENUM ('OPEN', 'APPROVED', 'CANCELLED');

-- ----------------------------------------------------------------------------------------- suppliers
CREATE TABLE "suppliers" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "name" TEXT NOT NULL,
    "contact_name" TEXT,
    "phone" TEXT,
    "email" TEXT,
    "address" TEXT,
    "notes" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "row_version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT clock_timestamp(),
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT clock_timestamp(),

    CONSTRAINT "suppliers_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "suppliers_name" CHECK (btrim("name") <> ''),
    CONSTRAINT "suppliers_version" CHECK ("row_version" >= 1)
);
CREATE UNIQUE INDEX "suppliers_name_key" ON "suppliers"(lower("name"));
CREATE TRIGGER lucy_suppliers_guard BEFORE UPDATE ON "suppliers" FOR EACH ROW EXECUTE FUNCTION lucy_guard_versioned_row();

-- -------------------------------------------------------------------------------------- stock receipts
CREATE TABLE "stock_receipts" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "code" VARCHAR(40) NOT NULL,
    "branch_id" UUID NOT NULL,
    "supplier_id" UUID,
    "receipt_date" DATE NOT NULL,
    "notes" TEXT,
    "status" "StockReceiptStatus" NOT NULL DEFAULT 'DRAFT',
    "created_by_user_id" UUID NOT NULL,
    "confirmed_by_user_id" UUID,
    "confirmed_at" TIMESTAMPTZ(3),
    "cancelled_by_user_id" UUID,
    "cancelled_at" TIMESTAMPTZ(3),
    "cancel_reason" TEXT,
    "row_version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT clock_timestamp(),
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT clock_timestamp(),

    CONSTRAINT "stock_receipts_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "stock_receipts_code" CHECK (btrim("code") <> ''),
    CONSTRAINT "stock_receipts_state_facts" CHECK (
      ("status" = 'CONFIRMED') = ("confirmed_at" IS NOT NULL AND "confirmed_by_user_id" IS NOT NULL)
      AND ("confirmed_at" IS NULL) = ("confirmed_by_user_id" IS NULL)
      AND (("status" = 'CANCELLED') = ("cancelled_at" IS NOT NULL AND "cancelled_by_user_id" IS NOT NULL
            AND "cancel_reason" IS NOT NULL AND btrim("cancel_reason") <> ''))
      AND ("cancelled_at" IS NULL) = ("cancelled_by_user_id" IS NULL)),
    CONSTRAINT "stock_receipts_version" CHECK ("row_version" >= 1)
);
CREATE UNIQUE INDEX "stock_receipts_code_key" ON "stock_receipts"("code");
CREATE INDEX "stock_receipts_branch_idx" ON "stock_receipts"("branch_id", "receipt_date" DESC, "id");
ALTER TABLE "stock_receipts" ADD CONSTRAINT "stock_receipts_branch_id_fkey"
  FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "stock_receipts" ADD CONSTRAINT "stock_receipts_supplier_id_fkey"
  FOREIGN KEY ("supplier_id") REFERENCES "suppliers"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "stock_receipts" ADD CONSTRAINT "stock_receipts_created_by_user_id_fkey"
  FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "stock_receipts" ADD CONSTRAINT "stock_receipts_confirmed_by_user_id_fkey"
  FOREIGN KEY ("confirmed_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "stock_receipts" ADD CONSTRAINT "stock_receipts_cancelled_by_user_id_fkey"
  FOREIGN KEY ("cancelled_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

CREATE TABLE "stock_receipt_lines" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "receipt_id" UUID NOT NULL,
    "line_no" SMALLINT NOT NULL,
    "variant_id" UUID NOT NULL,
    "quantity" INTEGER NOT NULL,
    "unit_cost_vnd" BIGINT,
    "lot_code" VARCHAR(64),
    "expiry_date" DATE,

    CONSTRAINT "stock_receipt_lines_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "stock_receipt_lines_quantity" CHECK ("quantity" > 0),
    CONSTRAINT "stock_receipt_lines_cost" CHECK ("unit_cost_vnd" IS NULL OR "unit_cost_vnd" >= 0),
    CONSTRAINT "stock_receipt_lines_lot" CHECK ("lot_code" IS NULL OR btrim("lot_code") <> ''),
    CONSTRAINT "stock_receipt_lines_no" CHECK ("line_no" >= 1)
);
CREATE UNIQUE INDEX "stock_receipt_lines_receipt_no_key" ON "stock_receipt_lines"("receipt_id", "line_no");
CREATE INDEX "stock_receipt_lines_variant_idx" ON "stock_receipt_lines"("variant_id");
ALTER TABLE "stock_receipt_lines" ADD CONSTRAINT "stock_receipt_lines_receipt_id_fkey"
  FOREIGN KEY ("receipt_id") REFERENCES "stock_receipts"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "stock_receipt_lines" ADD CONSTRAINT "stock_receipt_lines_variant_id_fkey"
  FOREIGN KEY ("variant_id") REFERENCES "product_variants"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- ------------------------------------------------------------------------------------------- lots
-- A lot is one received batch of a variant at a branch. Its identity, code, expiry and cost never change; its quantity is a
-- cache written only by the movement trigger (the lot quantity is the sum of its movements).
CREATE TABLE "inventory_lots" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "branch_id" UUID NOT NULL,
    "variant_id" UUID NOT NULL,
    "lot_code" VARCHAR(64) NOT NULL,
    "expiry_date" DATE,
    "unit_cost_vnd" BIGINT,
    "source_receipt_line_id" UUID,
    "quantity_on_hand" INTEGER NOT NULL DEFAULT 0,
    "created_by_user_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT clock_timestamp(),

    CONSTRAINT "inventory_lots_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "inventory_lots_code" CHECK (btrim("lot_code") <> ''),
    CONSTRAINT "inventory_lots_cost" CHECK ("unit_cost_vnd" IS NULL OR "unit_cost_vnd" >= 0),
    -- Never negative: a second sale of the last unit fails here, whoever commits second (design 4.5).
    CONSTRAINT "inventory_lots_quantity" CHECK ("quantity_on_hand" >= 0)
);
CREATE UNIQUE INDEX "inventory_lots_receipt_line_key" ON "inventory_lots"("source_receipt_line_id")
  WHERE "source_receipt_line_id" IS NOT NULL;
CREATE UNIQUE INDEX "inventory_lots_branch_variant_id_key" ON "inventory_lots"("branch_id", "variant_id", "id");
CREATE INDEX "inventory_lots_variant_idx" ON "inventory_lots"("branch_id", "variant_id", "expiry_date");
CREATE INDEX "inventory_lots_expiry_idx" ON "inventory_lots"("branch_id", "expiry_date") WHERE "quantity_on_hand" > 0;
ALTER TABLE "inventory_lots" ADD CONSTRAINT "inventory_lots_branch_id_fkey"
  FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "inventory_lots" ADD CONSTRAINT "inventory_lots_variant_id_fkey"
  FOREIGN KEY ("variant_id") REFERENCES "product_variants"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "inventory_lots" ADD CONSTRAINT "inventory_lots_source_receipt_line_id_fkey"
  FOREIGN KEY ("source_receipt_line_id") REFERENCES "stock_receipt_lines"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "inventory_lots" ADD CONSTRAINT "inventory_lots_created_by_user_id_fkey"
  FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- ---------------------------------------------------------------------------------------- levels
-- One row per (branch, variant), created and changed only by the movement trigger. `reserved` stays 0 until the Wave 2
-- reservation table exists (design 4.5); `low_stock_alerted` is the "fire once on crossing" flag of design 4.6.
CREATE TABLE "stock_levels" (
    "branch_id" UUID NOT NULL,
    "variant_id" UUID NOT NULL,
    "on_hand" INTEGER NOT NULL DEFAULT 0,
    "reserved" INTEGER NOT NULL DEFAULT 0,
    "low_stock_alerted" BOOLEAN NOT NULL DEFAULT false,
    "row_version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT clock_timestamp(),
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT clock_timestamp(),

    CONSTRAINT "stock_levels_pkey" PRIMARY KEY ("branch_id", "variant_id"),
    CONSTRAINT "stock_levels_on_hand" CHECK ("on_hand" >= 0),
    CONSTRAINT "stock_levels_reserved" CHECK ("reserved" >= 0 AND "reserved" <= "on_hand"),
    CONSTRAINT "stock_levels_version" CHECK ("row_version" >= 1)
);
ALTER TABLE "stock_levels" ADD CONSTRAINT "stock_levels_branch_id_fkey"
  FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "stock_levels" ADD CONSTRAINT "stock_levels_variant_id_fkey"
  FOREIGN KEY ("variant_id") REFERENCES "product_variants"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- --------------------------------------------------------------------------------- physical counts
CREATE TABLE "stock_count_sessions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "code" VARCHAR(40) NOT NULL,
    "branch_id" UUID NOT NULL,
    "status" "StockCountStatus" NOT NULL DEFAULT 'OPEN',
    "notes" TEXT,
    "created_by_user_id" UUID NOT NULL,
    "approved_by_user_id" UUID,
    "approved_at" TIMESTAMPTZ(3),
    "cancelled_by_user_id" UUID,
    "cancelled_at" TIMESTAMPTZ(3),
    "row_version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT clock_timestamp(),
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT clock_timestamp(),

    CONSTRAINT "stock_count_sessions_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "stock_count_sessions_code" CHECK (btrim("code") <> ''),
    CONSTRAINT "stock_count_sessions_state_facts" CHECK (
      (("status" = 'APPROVED') = ("approved_at" IS NOT NULL AND "approved_by_user_id" IS NOT NULL))
      AND ("approved_at" IS NULL) = ("approved_by_user_id" IS NULL)
      AND (("status" = 'CANCELLED') = ("cancelled_at" IS NOT NULL AND "cancelled_by_user_id" IS NOT NULL))
      AND ("cancelled_at" IS NULL) = ("cancelled_by_user_id" IS NULL)),
    CONSTRAINT "stock_count_sessions_version" CHECK ("row_version" >= 1)
);
CREATE UNIQUE INDEX "stock_count_sessions_code_key" ON "stock_count_sessions"("code");
CREATE INDEX "stock_count_sessions_branch_idx" ON "stock_count_sessions"("branch_id", "created_at" DESC, "id");
ALTER TABLE "stock_count_sessions" ADD CONSTRAINT "stock_count_sessions_branch_id_fkey"
  FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "stock_count_sessions" ADD CONSTRAINT "stock_count_sessions_created_by_user_id_fkey"
  FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "stock_count_sessions" ADD CONSTRAINT "stock_count_sessions_approved_by_user_id_fkey"
  FOREIGN KEY ("approved_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "stock_count_sessions" ADD CONSTRAINT "stock_count_sessions_cancelled_by_user_id_fkey"
  FOREIGN KEY ("cancelled_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- A count line states the counted quantity. At approval the system quantity (locked at that moment) and the difference are
-- stamped once; the difference is then carried out by COUNT_CORRECTION movements that reference this line.
CREATE TABLE "stock_count_lines" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "session_id" UUID NOT NULL,
    "variant_id" UUID NOT NULL,
    "counted_quantity" INTEGER NOT NULL,
    "system_quantity" INTEGER,
    "difference" INTEGER,

    CONSTRAINT "stock_count_lines_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "stock_count_lines_counted" CHECK ("counted_quantity" >= 0),
    CONSTRAINT "stock_count_lines_system" CHECK ("system_quantity" IS NULL OR "system_quantity" >= 0),
    CONSTRAINT "stock_count_lines_difference" CHECK (
      ("system_quantity" IS NULL AND "difference" IS NULL)
      OR ("system_quantity" IS NOT NULL AND "difference" = "counted_quantity" - "system_quantity"))
);
CREATE UNIQUE INDEX "stock_count_lines_session_variant_key" ON "stock_count_lines"("session_id", "variant_id");
ALTER TABLE "stock_count_lines" ADD CONSTRAINT "stock_count_lines_session_id_fkey"
  FOREIGN KEY ("session_id") REFERENCES "stock_count_sessions"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "stock_count_lines" ADD CONSTRAINT "stock_count_lines_variant_id_fkey"
  FOREIGN KEY ("variant_id") REFERENCES "product_variants"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- ------------------------------------------------------------------------------------- movements
CREATE TABLE "stock_movements" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "branch_id" UUID NOT NULL,
    "variant_id" UUID NOT NULL,
    "lot_id" UUID NOT NULL,
    "kind" "StockMovementKind" NOT NULL,
    "quantity_delta" INTEGER NOT NULL,
    "reason" "StockAdjustmentReason",
    "note" TEXT,
    "receipt_line_id" UUID,
    "count_line_id" UUID,
    "import_job_id" UUID,
    "idempotency_key" TEXT NOT NULL,
    "actor_user_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT clock_timestamp(),

    CONSTRAINT "stock_movements_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "stock_movements_delta" CHECK ("quantity_delta" <> 0),
    CONSTRAINT "stock_movements_key" CHECK (btrim("idempotency_key") <> ''),
    CONSTRAINT "stock_movements_note" CHECK ("note" IS NULL OR btrim("note") <> ''),
    -- The shape of each kind (design 4.2). An adjustment always has a reason (PRD 27.5); every reason except a count correction
    -- takes stock out; a count correction names the count line that explains it and may add or remove.
    CONSTRAINT "stock_movements_kind_shape" CHECK (
      ("kind" = 'RECEIPT' AND "quantity_delta" > 0 AND "receipt_line_id" IS NOT NULL AND "count_line_id" IS NULL
        AND "import_job_id" IS NULL AND "reason" IS NULL)
      OR ("kind" = 'OPENING' AND "quantity_delta" > 0 AND "import_job_id" IS NOT NULL AND "receipt_line_id" IS NULL
        AND "count_line_id" IS NULL AND "reason" IS NULL)
      OR ("kind" = 'ADJUSTMENT' AND "reason" IS NOT NULL AND "receipt_line_id" IS NULL AND "import_job_id" IS NULL
        AND (("reason" = 'COUNT_CORRECTION' AND "count_line_id" IS NOT NULL)
          OR ("reason" <> 'COUNT_CORRECTION' AND "count_line_id" IS NULL AND "quantity_delta" < 0)))
    )
);
CREATE UNIQUE INDEX "stock_movements_idempotency_key" ON "stock_movements"("idempotency_key");
CREATE UNIQUE INDEX "stock_movements_receipt_line_key" ON "stock_movements"("receipt_line_id") WHERE "kind" = 'RECEIPT';
CREATE INDEX "stock_movements_level_idx" ON "stock_movements"("branch_id", "variant_id", "created_at");
CREATE INDEX "stock_movements_lot_idx" ON "stock_movements"("lot_id");
CREATE INDEX "stock_movements_count_line_idx" ON "stock_movements"("count_line_id") WHERE "count_line_id" IS NOT NULL;
CREATE INDEX "stock_movements_import_idx" ON "stock_movements"("import_job_id") WHERE "import_job_id" IS NOT NULL;
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_lot_fkey"
  FOREIGN KEY ("branch_id", "variant_id", "lot_id") REFERENCES "inventory_lots"("branch_id", "variant_id", "id")
  ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_receipt_line_id_fkey"
  FOREIGN KEY ("receipt_line_id") REFERENCES "stock_receipt_lines"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_count_line_id_fkey"
  FOREIGN KEY ("count_line_id") REFERENCES "stock_count_lines"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_import_job_id_fkey"
  FOREIGN KEY ("import_job_id") REFERENCES "product_import_jobs"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_actor_user_id_fkey"
  FOREIGN KEY ("actor_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- ------------------------------------------------------------------------------------------ guards
-- Receipts: created as DRAFT; DRAFT -> CONFIRMED | CANCELLED; a confirmed or cancelled receipt is immutable and never deleted
-- (PRD 27.1). The time of confirmation and cancellation is the database clock. A receipt is confirmed only with lines.
CREATE FUNCTION lucy_guard_stock_receipt() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'A stock receipt is history and is never deleted';
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'DRAFT' THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'A stock receipt starts as a draft';
    END IF;
    RETURN NEW;
  END IF;
  IF OLD.status <> 'DRAFT' THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'A confirmed or cancelled receipt is immutable';
  END IF;
  IF NEW.branch_id IS DISTINCT FROM OLD.branch_id AND EXISTS (SELECT 1 FROM stock_receipt_lines l WHERE l.receipt_id = OLD.id) THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'The branch of a receipt with lines cannot change';
  END IF;
  IF NEW.status = 'CONFIRMED' THEN
    IF NOT EXISTS (SELECT 1 FROM stock_receipt_lines l WHERE l.receipt_id = OLD.id) THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'A receipt is confirmed only with at least one line';
    END IF;
    NEW.confirmed_at := clock_timestamp();
  ELSIF NEW.status = 'CANCELLED' THEN
    NEW.cancelled_at := clock_timestamp();
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER lucy_stock_receipts_guard BEFORE INSERT OR UPDATE OR DELETE ON "stock_receipts"
  FOR EACH ROW EXECUTE FUNCTION lucy_guard_stock_receipt();
CREATE TRIGGER lucy_stock_receipts_version BEFORE UPDATE ON "stock_receipts"
  FOR EACH ROW EXECUTE FUNCTION lucy_guard_versioned_row();

-- Receipt lines can only change while the receipt is a draft.
CREATE FUNCTION lucy_guard_stock_receipt_line() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  parent_status "StockReceiptStatus";
  parent_id uuid := CASE WHEN TG_OP = 'DELETE' THEN OLD.receipt_id ELSE NEW.receipt_id END;
BEGIN
  SELECT r.status INTO parent_status FROM stock_receipts r WHERE r.id = parent_id FOR SHARE;
  IF parent_status IS DISTINCT FROM 'DRAFT' THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Receipt lines change only while the receipt is a draft';
  END IF;
  IF TG_OP = 'UPDATE' AND (NEW.id IS DISTINCT FROM OLD.id OR NEW.receipt_id IS DISTINCT FROM OLD.receipt_id) THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'A receipt line identity is immutable';
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$;
CREATE TRIGGER lucy_stock_receipt_lines_guard BEFORE INSERT OR UPDATE OR DELETE ON "stock_receipt_lines"
  FOR EACH ROW EXECUTE FUNCTION lucy_guard_stock_receipt_line();

-- Lots: a lot starts empty; everything but its quantity is immutable; the quantity moves only through the movement trigger
-- (pg_trigger_depth() > 1 means the write comes from inside another trigger). A lot is never deleted.
CREATE FUNCTION lucy_guard_inventory_lot() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'A stock lot is history and is never deleted';
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.quantity_on_hand <> 0 THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'A lot starts empty; stock enters through a movement';
    END IF;
    IF NEW.source_receipt_line_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM stock_receipt_lines l JOIN stock_receipts r ON r.id = l.receipt_id
      WHERE l.id = NEW.source_receipt_line_id AND l.variant_id = NEW.variant_id AND r.branch_id = NEW.branch_id
    ) THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'A receipt lot matches the branch and variant of its receipt line';
    END IF;
    NEW.created_at := clock_timestamp();
    RETURN NEW;
  END IF;
  IF (NEW.id, NEW.branch_id, NEW.variant_id, NEW.lot_code, NEW.expiry_date, NEW.unit_cost_vnd, NEW.source_receipt_line_id,
      NEW.created_by_user_id, NEW.created_at)
    IS DISTINCT FROM (OLD.id, OLD.branch_id, OLD.variant_id, OLD.lot_code, OLD.expiry_date, OLD.unit_cost_vnd,
      OLD.source_receipt_line_id, OLD.created_by_user_id, OLD.created_at) THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'A stock lot is immutable except its quantity';
  END IF;
  IF NEW.quantity_on_hand IS DISTINCT FROM OLD.quantity_on_hand AND pg_trigger_depth() < 2 THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'A lot quantity changes only through a stock movement';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER lucy_inventory_lots_guard BEFORE INSERT OR UPDATE OR DELETE ON "inventory_lots"
  FOR EACH ROW EXECUTE FUNCTION lucy_guard_inventory_lot();

-- Levels: written only from the movement trigger. `reserved` cannot change yet (no reservation table in Wave 1).
CREATE FUNCTION lucy_guard_stock_level() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'A stock level is never deleted';
  END IF;
  IF pg_trigger_depth() < 2 THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'A stock level changes only through a stock movement';
  END IF;
  IF TG_OP = 'UPDATE' THEN
    IF (NEW.branch_id, NEW.variant_id, NEW.created_at) IS DISTINCT FROM (OLD.branch_id, OLD.variant_id, OLD.created_at)
      OR NEW.reserved IS DISTINCT FROM OLD.reserved THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'A stock level identity and reservation are not changed here';
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
CREATE TRIGGER lucy_stock_levels_guard BEFORE INSERT OR UPDATE OR DELETE ON "stock_levels"
  FOR EACH ROW EXECUTE FUNCTION lucy_guard_stock_level();

-- Count sessions: OPEN -> APPROVED | CANCELLED, then immutable; never deleted. Times come from the database clock.
CREATE FUNCTION lucy_guard_stock_count_session() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'A stock count is history and is never deleted';
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'OPEN' THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'A stock count starts open';
    END IF;
    RETURN NEW;
  END IF;
  IF OLD.status <> 'OPEN' THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'A finished stock count is immutable';
  END IF;
  IF NEW.branch_id IS DISTINCT FROM OLD.branch_id THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'The branch of a stock count cannot change';
  END IF;
  IF NEW.status = 'APPROVED' THEN
    NEW.approved_at := clock_timestamp();
  ELSIF NEW.status = 'CANCELLED' THEN
    NEW.cancelled_at := clock_timestamp();
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER lucy_stock_count_sessions_guard BEFORE INSERT OR UPDATE OR DELETE ON "stock_count_sessions"
  FOR EACH ROW EXECUTE FUNCTION lucy_guard_stock_count_session();
CREATE TRIGGER lucy_stock_count_sessions_version BEFORE UPDATE ON "stock_count_sessions"
  FOR EACH ROW EXECUTE FUNCTION lucy_guard_versioned_row();

-- Count lines: added, changed and removed only while the session is OPEN; at approval the system quantity and the difference
-- are stamped once (the session may already read APPROVED inside that same transaction).
CREATE FUNCTION lucy_guard_stock_count_line() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  parent_status "StockCountStatus";
  parent_id uuid := CASE WHEN TG_OP = 'DELETE' THEN OLD.session_id ELSE NEW.session_id END;
BEGIN
  SELECT s.status INTO parent_status FROM stock_count_sessions s WHERE s.id = parent_id FOR SHARE;
  IF TG_OP = 'INSERT' THEN
    IF parent_status IS DISTINCT FROM 'OPEN' OR NEW.system_quantity IS NOT NULL THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Count lines are added to an open count, unstamped';
    END IF;
    RETURN NEW;
  END IF;
  IF TG_OP = 'DELETE' THEN
    IF parent_status IS DISTINCT FROM 'OPEN' OR OLD.system_quantity IS NOT NULL THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'A count line is removed only from an open count';
    END IF;
    RETURN OLD;
  END IF;
  IF (NEW.id, NEW.session_id, NEW.variant_id) IS DISTINCT FROM (OLD.id, OLD.session_id, OLD.variant_id) THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'A count line identity is immutable';
  END IF;
  IF OLD.system_quantity IS NOT NULL THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'A stamped count line is immutable';
  END IF;
  IF NEW.system_quantity IS NOT NULL THEN
    IF parent_status NOT IN ('OPEN', 'APPROVED') OR NEW.counted_quantity IS DISTINCT FROM OLD.counted_quantity THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'A count line is stamped once, at approval, without changing the count';
    END IF;
  ELSIF parent_status IS DISTINCT FROM 'OPEN' THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'A count line changes only while the count is open';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER lucy_stock_count_lines_guard BEFORE INSERT OR UPDATE OR DELETE ON "stock_count_lines"
  FOR EACH ROW EXECUTE FUNCTION lucy_guard_stock_count_line();

-- Movements: append-only. Before the insert the movement is checked against its lot, receipt line, count line or import job;
-- after the insert the same transaction moves the lot quantity and the (branch, variant) level (lot row first, then level row,
-- always in that order). A movement that would take a lot or a level below zero fails on the CHECK of that table.
CREATE FUNCTION lucy_guard_stock_movement() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  line stock_receipt_lines%ROWTYPE;
  receipt stock_receipts%ROWTYPE;
  lot inventory_lots%ROWTYPE;
  counted stock_count_lines%ROWTYPE;
  count_session stock_count_sessions%ROWTYPE;
  job product_import_jobs%ROWTYPE;
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
  END IF;
  NEW.created_at := clock_timestamp();
  RETURN NEW;
END;
$$;
CREATE TRIGGER lucy_stock_movements_guard BEFORE INSERT OR UPDATE OR DELETE ON "stock_movements"
  FOR EACH ROW EXECUTE FUNCTION lucy_guard_stock_movement();

CREATE FUNCTION lucy_apply_stock_movement() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  UPDATE inventory_lots SET quantity_on_hand = quantity_on_hand + NEW.quantity_delta WHERE id = NEW.lot_id;
  INSERT INTO stock_levels AS s (branch_id, variant_id) VALUES (NEW.branch_id, NEW.variant_id)
    ON CONFLICT (branch_id, variant_id) DO NOTHING;
  UPDATE stock_levels SET on_hand = on_hand + NEW.quantity_delta
    WHERE branch_id = NEW.branch_id AND variant_id = NEW.variant_id;
  RETURN NULL;
END;
$$;
CREATE TRIGGER lucy_stock_movements_apply AFTER INSERT ON "stock_movements"
  FOR EACH ROW EXECUTE FUNCTION lucy_apply_stock_movement();

-- ---------------------------------------------------------------------------- commit-time invariants
-- Deferred reconciliation (like the loyalty balance): at commit the level equals the sum of its movements and the lot equals
-- the sum of its movements. The movement trigger is the only writer, so this is an assertion that catches any bug.
CREATE FUNCTION lucy_check_stock_balance() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  level_qty integer;
  level_sum bigint;
  lot_qty integer;
  lot_sum bigint;
BEGIN
  SELECT s.on_hand INTO level_qty FROM stock_levels s WHERE s.branch_id = NEW.branch_id AND s.variant_id = NEW.variant_id;
  SELECT COALESCE(sum(m.quantity_delta), 0) INTO level_sum FROM stock_movements m
    WHERE m.branch_id = NEW.branch_id AND m.variant_id = NEW.variant_id;
  SELECT l.quantity_on_hand INTO lot_qty FROM inventory_lots l WHERE l.id = NEW.lot_id;
  SELECT COALESCE(sum(m.quantity_delta), 0) INTO lot_sum FROM stock_movements m WHERE m.lot_id = NEW.lot_id;
  IF level_qty IS DISTINCT FROM level_sum OR lot_qty IS DISTINCT FROM lot_sum THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Stock on hand must equal the sum of its movements';
  END IF;
  RETURN NULL;
END;
$$;
CREATE CONSTRAINT TRIGGER lucy_stock_movements_balance AFTER INSERT ON "stock_movements"
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION lucy_check_stock_balance();

-- A CONFIRMED receipt has exactly one RECEIPT movement per line, for that line's quantity (checked at commit, so the
-- confirmation, the lots and the movements are written together or not at all).
CREATE FUNCTION lucy_check_receipt_complete() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.status = 'CONFIRMED' AND EXISTS (
    SELECT 1 FROM stock_receipt_lines l
    WHERE l.receipt_id = NEW.id AND NOT EXISTS (
      SELECT 1 FROM stock_movements m
      WHERE m.kind = 'RECEIPT' AND m.receipt_line_id = l.id AND m.quantity_delta = l.quantity)
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'A confirmed receipt has a stock movement for every line';
  END IF;
  RETURN NULL;
END;
$$;
CREATE CONSTRAINT TRIGGER lucy_stock_receipts_complete AFTER UPDATE ON "stock_receipts"
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION lucy_check_receipt_complete();

-- An APPROVED count has every line stamped, and each stamped line's difference equals the sum of the COUNT_CORRECTION
-- movements that reference it (checked at commit).
CREATE FUNCTION lucy_check_stock_count_complete() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.status = 'APPROVED' AND (
    EXISTS (SELECT 1 FROM stock_count_lines l WHERE l.session_id = NEW.id AND l.system_quantity IS NULL)
    OR NOT EXISTS (SELECT 1 FROM stock_count_lines l WHERE l.session_id = NEW.id)
    OR EXISTS (
      SELECT 1 FROM stock_count_lines l
      WHERE l.session_id = NEW.id
        AND l.difference IS DISTINCT FROM (
          SELECT COALESCE(sum(m.quantity_delta), 0) FROM stock_movements m WHERE m.count_line_id = l.id)
    )
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '23514',
      MESSAGE = 'An approved count has every line stamped and its differences carried out by correction movements';
  END IF;
  RETURN NULL;
END;
$$;
CREATE CONSTRAINT TRIGGER lucy_stock_count_sessions_complete AFTER UPDATE ON "stock_count_sessions"
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION lucy_check_stock_count_complete();
