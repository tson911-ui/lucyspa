-- Phase 9 P9-7: re-sync and change detection (docs/PHASE9_PRODUCT_IMPORT.md section 10).
-- Additive: one enum, one table, and the closed type/entity CHECKs of `notifications` widened (never narrowed) so a scan that found
-- changes can tell the holders of REVIEW_SUPPLIER_IMPORTS. No existing row is read, written or moved.
--
-- source_changes: what a scan found different on a supplier product, kept until a person acknowledges it. `source_records.last_changes`
-- only remembers the latest scan, so a price change would vanish at the next unchanged scan; this table is the review queue
-- ("Thay đổi"). A change is only a note for a person: it never edits a candidate, a product, a price or an image. Append-only; the one
-- allowed update is to acknowledge a row, once.

CREATE TYPE "SourceChangeKind" AS ENUM ('PRICE_CHANGED', 'CONTENT_CHANGED', 'IMAGE_CHANGED', 'SOURCE_REMOVED', 'SOURCE_RETURNED');

CREATE TABLE "source_changes" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    -- Strictly increasing: the order of the queue never depends on a timestamp tie.
    "seq" BIGSERIAL NOT NULL,
    "source_record_id" UUID NOT NULL,
    "scan_id" UUID NOT NULL,
    "kind" "SourceChangeKind" NOT NULL,
    -- Small and structured: the before/after of the fields that changed, never a whole page. A price inside it is reference data only
    -- and is cut from the response of anyone without MANAGE_PRODUCT_PRICES.
    "detail" JSONB NOT NULL DEFAULT '{}',
    "detected_at" TIMESTAMPTZ(3) NOT NULL DEFAULT clock_timestamp(),
    "acknowledged_by_user_id" UUID,
    "acknowledged_at" TIMESTAMPTZ(3),

    CONSTRAINT "source_changes_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "source_changes_detail" CHECK (jsonb_typeof("detail") = 'object'),
    CONSTRAINT "source_changes_acknowledged" CHECK (("acknowledged_by_user_id" IS NULL) = ("acknowledged_at" IS NULL))
);
-- One note per kind per product per scan, so a retried unit of work cannot raise the same change twice.
CREATE UNIQUE INDEX "source_changes_scan_key" ON "source_changes"("source_record_id", "scan_id", "kind");
CREATE INDEX "source_changes_record_idx" ON "source_changes"("source_record_id", "seq" DESC);
CREATE INDEX "source_changes_open_idx" ON "source_changes"("seq" DESC) WHERE "acknowledged_at" IS NULL;
CREATE INDEX "source_changes_scan_idx" ON "source_changes"("scan_id");
ALTER TABLE "source_changes" ADD CONSTRAINT "source_changes_source_record_id_fkey" FOREIGN KEY ("source_record_id")
  REFERENCES "source_records"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "source_changes" ADD CONSTRAINT "source_changes_scan_id_fkey" FOREIGN KEY ("scan_id")
  REFERENCES "import_scans"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "source_changes" ADD CONSTRAINT "source_changes_acknowledged_by_user_id_fkey" FOREIGN KEY ("acknowledged_by_user_id")
  REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

CREATE FUNCTION lucy_guard_source_change() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'source_changes rows are history and are never deleted';
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.acknowledged_at IS NOT NULL THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'A change starts unacknowledged';
    END IF;
    RETURN NEW;
  END IF;
  -- Update: only an acknowledgement, once. Everything else is fixed.
  IF OLD.acknowledged_at IS NOT NULL THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'A change is acknowledged once';
  END IF;
  IF (to_jsonb(NEW) - 'acknowledged_by_user_id' - 'acknowledged_at') IS DISTINCT FROM
     (to_jsonb(OLD) - 'acknowledged_by_user_id' - 'acknowledged_at') THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'A change cannot be edited; it can only be acknowledged';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER lucy_source_changes_guard BEFORE INSERT OR UPDATE OR DELETE ON "source_changes"
  FOR EACH ROW EXECUTE FUNCTION lucy_guard_source_change();
CREATE TRIGGER lucy_source_changes_no_truncate BEFORE TRUNCATE ON "source_changes"
  FOR EACH STATEMENT EXECUTE FUNCTION lucy_refuse_change();

-- ------------------------------------------------------------------------------------ notifications
-- Same method as 20261121000001: the closed type CHECK and the type/entity pairing are widened, never narrowed.
--   SUPPLIER_IMPORT_CHANGES  about one supplier source (entity 'SupplierSource'), to the holders of REVIEW_SUPPLIER_IMPORTS. A source has
--   no branch, so the branch scope rule learns this entity next to 'LeaveRequest'.
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
    'ONLINE_ORDER_REFUNDED', 'ONLINE_ORDER_NEW', 'ONLINE_ORDER_ALERT', 'SUPPLIER_IMPORT_CHANGES')),
  DROP CONSTRAINT "notifications_entity_type_check",
  ADD CONSTRAINT "notifications_entity_type_check" CHECK ("entity_type" IN
    ('Booking', 'Visit', 'LeaveRequest', 'Invoice', 'Branch', 'ProductVariant', 'ProductReturnCase', 'ProductOrder', 'SupplierSource')),
  DROP CONSTRAINT "notifications_branch_scope",
  ADD CONSTRAINT "notifications_branch_scope" CHECK ("branch_id" IS NOT NULL OR "entity_type" IN ('LeaveRequest', 'SupplierSource')),
  DROP CONSTRAINT "notifications_type_entity",
  ADD CONSTRAINT "notifications_type_entity" CHECK (
    (("type" LIKE 'LEAVE\_%') = ("entity_type" = 'LeaveRequest'))
    AND (("type" IN ('INVOICE_PAID', 'INVOICE_CANCELLED', 'PAYOS_PAYMENT_SUCCEEDED', 'PAYOS_PAYMENT_ANOMALY',
                     'PAYMENT_REVERSED', 'INVOICE_CANCELLED_ALERT', 'PRODUCT_ORDER_ARRIVED',
                     'ONLINE_ORDER_SHIPPED', 'ONLINE_ORDER_DELIVERED', 'ONLINE_ORDER_DELIVERY_FAILED', 'ONLINE_ORDER_CANCELLED',
                     'ONLINE_ORDER_REFUNDED')) = ("entity_type" = 'Invoice'))
    AND (("type" IN ('REVENUE_DAILY_SUMMARY', 'EXPIRY_ALERT', 'PRODUCT_ORDER_ALERT', 'ONLINE_ORDER_ALERT')) = ("entity_type" = 'Branch'))
    AND (("type" IN ('LOW_STOCK_REACHED', 'EXPIRED_LOT_SOLD')) = ("entity_type" = 'ProductVariant'))
    AND (("type" = 'SUPPLIER_IMPORT_CHANGES') = ("entity_type" = 'SupplierSource'))
    AND (
      ("type" = 'PRODUCT_RETURN_OPENED' AND "entity_type" = 'ProductReturnCase')
      OR ("type" = 'PRODUCT_REFUND_MADE' AND "entity_type" IN ('ProductReturnCase', 'ProductOrder'))
      OR ("type" = 'ONLINE_ORDER_NEW' AND "entity_type" = 'ProductOrder')
      OR ("type" NOT IN ('PRODUCT_RETURN_OPENED', 'PRODUCT_REFUND_MADE', 'ONLINE_ORDER_NEW')
          AND "entity_type" NOT IN ('ProductReturnCase', 'ProductOrder'))));

-- The Phase 1 convention (fixed search_path, no PUBLIC execute) for the function this migration creates.
DO $$
DECLARE
  migration_schema text := current_schema();
BEGIN
  EXECUTE format('ALTER FUNCTION %I.lucy_guard_source_change() SET search_path TO pg_catalog, %I, pg_temp', migration_schema, migration_schema);
  EXECUTE format('REVOKE ALL ON FUNCTION %I.lucy_guard_source_change() FROM PUBLIC', migration_schema);
END;
$$;
