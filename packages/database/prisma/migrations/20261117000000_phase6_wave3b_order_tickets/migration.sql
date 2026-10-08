-- Phase 6 P6-16 (Wave 3b: the digital ticket of a counter pre-order), migration 1 of 1 (design 2.8 OQ-35, OQ-P6-42; approved 2026-10-07).
-- Additive: one table, no existing row touched, no permission added or granted.
--
--   product_order_tickets   the secret link of a pre-order for a customer WITHOUT an account (a member sees the ticket inside their own
--                           invoice). Only the SHA-256 of a long random token is stored; the token itself is shown once to the staff member
--                           who made the link, who passes it on by hand (Zalo). One order has at most one active link; making a new one
--                           revokes the old one. A link row is history: it is revoked (once), never edited otherwise and never deleted.
--                           The link does not expire by itself: the Owner has not given a validity number (asked in the report).

CREATE TABLE "product_order_tickets" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "order_id" UUID NOT NULL,
    "token_hash" CHAR(64) NOT NULL,
    "created_by_user_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT clock_timestamp(),
    "revoked_at" TIMESTAMPTZ(3),
    "revoked_by_user_id" UUID,

    CONSTRAINT "product_order_tickets_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "product_order_tickets_hash" CHECK ("token_hash" ~ '^[0-9a-f]{64}$'),
    CONSTRAINT "product_order_tickets_revoked" CHECK (("revoked_at" IS NULL) = ("revoked_by_user_id" IS NULL))
);
CREATE UNIQUE INDEX "product_order_tickets_hash_key" ON "product_order_tickets"("token_hash");
-- At most one active link per order.
CREATE UNIQUE INDEX "product_order_tickets_active_key" ON "product_order_tickets"("order_id") WHERE "revoked_at" IS NULL;
CREATE INDEX "product_order_tickets_order_idx" ON "product_order_tickets"("order_id", "created_at");
ALTER TABLE "product_order_tickets" ADD CONSTRAINT "product_order_tickets_order_id_fkey"
  FOREIGN KEY ("order_id") REFERENCES "product_orders"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "product_order_tickets" ADD CONSTRAINT "product_order_tickets_created_by_user_id_fkey"
  FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "product_order_tickets" ADD CONSTRAINT "product_order_tickets_revoked_by_user_id_fkey"
  FOREIGN KEY ("revoked_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

CREATE FUNCTION lucy_guard_product_order_ticket() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'A ticket link is history and is never deleted';
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.revoked_at IS NOT NULL THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'A ticket link starts active';
    END IF;
    NEW.created_at := clock_timestamp();
    RETURN NEW;
  END IF;
  IF (NEW.id, NEW.order_id, NEW.token_hash, NEW.created_by_user_id, NEW.created_at)
    IS DISTINCT FROM (OLD.id, OLD.order_id, OLD.token_hash, OLD.created_by_user_id, OLD.created_at) THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'A ticket link is never rewritten';
  END IF;
  IF OLD.revoked_at IS NOT NULL OR NEW.revoked_at IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'A ticket link is revoked once';
  END IF;
  NEW.revoked_at := clock_timestamp();
  RETURN NEW;
END;
$$;
CREATE TRIGGER "product_order_tickets_guard" BEFORE INSERT OR UPDATE OR DELETE ON "product_order_tickets"
FOR EACH ROW EXECUTE FUNCTION lucy_guard_product_order_ticket();
CREATE TRIGGER "product_order_tickets_no_truncate" BEFORE TRUNCATE ON "product_order_tickets"
FOR EACH STATEMENT EXECUTE FUNCTION lucy_guard_product_order_truncate();

-- The Phase 1 convention (fixed search_path, no PUBLIC execute) for the function this migration creates.
DO $$
DECLARE
  migration_schema text := current_schema();
BEGIN
  EXECUTE format('ALTER FUNCTION %I.lucy_guard_product_order_ticket() SET search_path TO pg_catalog, %I, pg_temp', migration_schema, migration_schema);
  EXECUTE format('REVOKE ALL ON FUNCTION %I.lucy_guard_product_order_ticket() FROM PUBLIC', migration_schema);
END;
$$;
