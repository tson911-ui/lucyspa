-- Phase 6 P6-13 follow-up (Owner, 2026-10-08, P13-3 and the added notice). Additive: one table, one guard, one constraint trigger, two
-- widened CHECKs of `notifications`. No existing row is rewritten, no permission is added or granted.
--
--   refund_reauthentication_uses   a password confirmation is used by ONE refund, never by two ("password re-entry once per refund, no
--                                  5-minute window"): the pair (person, instant of the confirmation) is the key, so a second refund
--                                  made on the same confirmation is refused by the database even if the application forgot. The table is
--                                  also the pool the exchange of P6-14 draws from (one password cannot cover a refund and an exchange).
--   notifications                  PRODUCT_REFUND_MADE: every product refund tells the Owner in-app (invoice, product, quantity, amount,
--                                  method, who refunded). About one return case, like PRODUCT_RETURN_OPENED.

CREATE TABLE "refund_reauthentication_uses" (
    "actor_user_id" UUID NOT NULL,
    "reauthenticated_at" TIMESTAMPTZ(3) NOT NULL,
    "product_refund_id" UUID,
    "used_at" TIMESTAMPTZ(3) NOT NULL DEFAULT clock_timestamp(),

    CONSTRAINT "refund_reauthentication_uses_pkey" PRIMARY KEY ("actor_user_id", "reauthenticated_at"),
    -- Exactly one thing used the confirmation. P6-14 adds the exchange column and widens this check.
    CONSTRAINT "refund_reauthentication_uses_owner" CHECK ("product_refund_id" IS NOT NULL)
);
CREATE UNIQUE INDEX "refund_reauthentication_uses_refund_key" ON "refund_reauthentication_uses"("product_refund_id")
  WHERE "product_refund_id" IS NOT NULL;
ALTER TABLE "refund_reauthentication_uses" ADD CONSTRAINT "refund_reauthentication_uses_actor_user_id_fkey"
  FOREIGN KEY ("actor_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "refund_reauthentication_uses" ADD CONSTRAINT "refund_reauthentication_uses_product_refund_id_fkey"
  FOREIGN KEY ("product_refund_id") REFERENCES "product_refunds"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- History: a use is never changed, deleted or truncated.
CREATE FUNCTION lucy_guard_refund_reauthentication_use() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP <> 'INSERT' THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'A password confirmation use is history and is never changed or deleted';
  END IF;
  NEW.used_at := clock_timestamp();
  RETURN NEW;
END;
$$;
CREATE TRIGGER lucy_refund_reauthentication_uses_guard BEFORE INSERT OR UPDATE OR DELETE ON "refund_reauthentication_uses"
  FOR EACH ROW EXECUTE FUNCTION lucy_guard_refund_reauthentication_use();
CREATE TRIGGER lucy_refund_reauthentication_uses_no_truncate BEFORE TRUNCATE ON "refund_reauthentication_uses"
  FOR EACH STATEMENT EXECUTE FUNCTION lucy_guard_product_refund_truncate();

-- Every NEW refund (made after this migration) names its own use of its confirmation, checked at commit so the order of the two inserts in
-- the transaction does not matter. Refunds written before this migration are untouched (the trigger fires on INSERT only).
CREATE FUNCTION lucy_check_refund_reauthentication_use() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM refund_reauthentication_uses u
    WHERE u.product_refund_id = NEW.id AND u.actor_user_id = NEW.actor_user_id AND u.reauthenticated_at = NEW.reauthenticated_at) THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'A refund uses its own password confirmation once';
  END IF;
  RETURN NULL;
END;
$$;
CREATE CONSTRAINT TRIGGER lucy_product_refunds_reauthentication AFTER INSERT ON "product_refunds"
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION lucy_check_refund_reauthentication_use();

-- ------------------------------------------------------------------------------------ notifications
-- Same method as 20261111000000: the closed type CHECK and the type/entity pairing are widened, never narrowed.
ALTER TABLE "notifications"
  DROP CONSTRAINT "notifications_type_check",
  ADD CONSTRAINT "notifications_type_check" CHECK ("type" IN (
    'BOOKING_CREATED', 'BOOKING_CANCELLED', 'LATE_CANCELLATION', 'BOOKING_NO_SHOW', 'CUSTOMER_ARRIVED',
    'BOOKING_KTV_CONFLICT', 'KTV_REASSIGNED', 'START_OVERDUE', 'PRE_END', 'END_OVERDUE',
    'LEAVE_REQUESTED', 'LEAVE_DECIDED',
    'INVOICE_PAID', 'INVOICE_CANCELLED', 'PAYOS_PAYMENT_SUCCEEDED', 'PAYOS_PAYMENT_ANOMALY', 'PAYMENT_REVERSED',
    'INVOICE_CANCELLED_ALERT', 'REVENUE_DAILY_SUMMARY',
    'LOW_STOCK_REACHED', 'EXPIRY_ALERT', 'EXPIRED_LOT_SOLD', 'PRODUCT_RETURN_OPENED', 'PRODUCT_REFUND_MADE')),
  DROP CONSTRAINT "notifications_type_entity",
  ADD CONSTRAINT "notifications_type_entity" CHECK (
    (("type" LIKE 'LEAVE\_%') = ("entity_type" = 'LeaveRequest'))
    AND (("type" IN ('INVOICE_PAID', 'INVOICE_CANCELLED', 'PAYOS_PAYMENT_SUCCEEDED', 'PAYOS_PAYMENT_ANOMALY',
                     'PAYMENT_REVERSED', 'INVOICE_CANCELLED_ALERT')) = ("entity_type" = 'Invoice'))
    AND (("type" IN ('REVENUE_DAILY_SUMMARY', 'EXPIRY_ALERT')) = ("entity_type" = 'Branch'))
    AND (("type" IN ('LOW_STOCK_REACHED', 'EXPIRED_LOT_SOLD')) = ("entity_type" = 'ProductVariant'))
    AND (("type" IN ('PRODUCT_RETURN_OPENED', 'PRODUCT_REFUND_MADE')) = ("entity_type" = 'ProductReturnCase')));

-- The Phase 1 convention (fixed search_path, no PUBLIC execute) for the functions this migration adds.
DO $$
DECLARE
  migration_schema text := current_schema();
  function_name text;
BEGIN
  FOREACH function_name IN ARRAY ARRAY[
    'lucy_guard_refund_reauthentication_use', 'lucy_check_refund_reauthentication_use'
  ] LOOP
    EXECUTE format('ALTER FUNCTION %I.%I() SET search_path TO pg_catalog, %I, pg_temp',
      migration_schema, function_name, migration_schema);
    EXECUTE format('REVOKE ALL ON FUNCTION %I.%I() FROM PUBLIC', migration_schema, function_name);
  END LOOP;
END;
$$;
