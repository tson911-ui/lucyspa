-- Phase 5 P5-9: gift / benefit catalog framework (design 10, PRD 21). Additive; the catalog and every entitlement stay empty.
--
-- The P5-2 foundation already holds the catalog, the entitlements and the invoice redemptions. This step adds what a manual
-- "mark it used" needs, because `reward_redemptions` is tied to an invoice line:
--   * `reward_manual_uses`: one row per unit marked used by staff (append-only, go-live gated, never more than the quantity left);
--   * `reward_manual_use_restorations`: a mistaken use is corrected by ONE offset row with a reason (the use stays as history).
-- The remaining quantity of an entitlement is issued minus its active invoice redemptions minus its active manual uses; the
-- redemption guard of P5-2 is replaced so it counts both. Points are never touched: nothing here reads or writes a wallet.

-- ---------------------------------------------------------------------------------------------------------------- tables
CREATE TABLE "reward_manual_uses" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "entitlement_id" UUID NOT NULL,
    "branch_id" UUID NOT NULL,
    "used_by_user_id" UUID NOT NULL,
    "used_at" TIMESTAMPTZ(3) NOT NULL DEFAULT clock_timestamp(),
    "note" TEXT,

    CONSTRAINT "reward_manual_uses_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "reward_manual_uses_note" CHECK ("note" IS NULL OR btrim("note") <> '')
);

CREATE TABLE "reward_manual_use_restorations" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "use_id" UUID NOT NULL,
    "restored_at" TIMESTAMPTZ(3) NOT NULL DEFAULT clock_timestamp(),
    "restored_by_user_id" UUID NOT NULL,
    "reason" TEXT NOT NULL,

    CONSTRAINT "reward_manual_use_restorations_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "reward_manual_use_restorations_reason" CHECK (btrim("reason") <> '')
);

CREATE INDEX "reward_manual_uses_entitlement_idx" ON "reward_manual_uses"("entitlement_id", "used_at");
CREATE UNIQUE INDEX "reward_manual_use_restorations_use_key" ON "reward_manual_use_restorations"("use_id");

ALTER TABLE "reward_manual_uses" ADD CONSTRAINT "reward_manual_uses_entitlement_id_fkey"
  FOREIGN KEY ("entitlement_id") REFERENCES "reward_entitlements"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "reward_manual_uses" ADD CONSTRAINT "reward_manual_uses_branch_id_fkey"
  FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "reward_manual_uses" ADD CONSTRAINT "reward_manual_uses_used_by_user_id_fkey"
  FOREIGN KEY ("used_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "reward_manual_use_restorations" ADD CONSTRAINT "reward_manual_use_restorations_use_id_fkey"
  FOREIGN KEY ("use_id") REFERENCES "reward_manual_uses"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "reward_manual_use_restorations" ADD CONSTRAINT "reward_manual_use_restorations_restored_by_user_id_fkey"
  FOREIGN KEY ("restored_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- ---------------------------------------------------------------------------------------------------------------- guards
-- Units of an entitlement in use right now: invoice redemptions not released, manual uses not restored. Deliberately VOLATILE:
-- under READ COMMITTED a STABLE function would count with the snapshot taken before the entitlement lock was won.
CREATE FUNCTION lucy_reward_units_in_use(entitlement_ref uuid) RETURNS integer
LANGUAGE sql VOLATILE AS $$
  SELECT (
    SELECT count(*) FROM reward_redemptions r
      WHERE r.entitlement_id = entitlement_ref
        AND NOT EXISTS (SELECT 1 FROM reward_redemption_releases l WHERE l.redemption_id = r.id)
  )::integer + (
    SELECT count(*) FROM reward_manual_uses u
      WHERE u.entitlement_id = entitlement_ref
        AND NOT EXISTS (SELECT 1 FROM reward_manual_use_restorations o WHERE o.use_id = u.id)
  )::integer;
$$;

-- A manual use, under the entitlement row lock (design 12.2: the customer rows first, then the reward rows): the entitlement is
-- not voided and not expired, and fewer units than were issued are in use. The use is stamped with the database clock.
CREATE FUNCTION lucy_guard_reward_manual_use() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  entitlement reward_entitlements%ROWTYPE;
BEGIN
  SELECT e.* INTO entitlement FROM reward_entitlements e WHERE e.id = NEW.entitlement_id FOR UPDATE;
  IF entitlement.voided_at IS NOT NULL OR (entitlement.expires_at IS NOT NULL AND entitlement.expires_at <= clock_timestamp()) THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'A voided or expired entitlement cannot be used';
  END IF;
  IF lucy_reward_units_in_use(NEW.entitlement_id) >= entitlement.quantity_issued THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'The entitlement has no quantity left';
  END IF;
  NEW.used_at := clock_timestamp();
  RETURN NEW;
END;
$$;

-- A restoration locks the entitlement first, so it serializes with a use and a void; it is stamped with the database clock.
CREATE FUNCTION lucy_guard_reward_manual_use_restoration() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  used reward_manual_uses%ROWTYPE;
BEGIN
  SELECT u.* INTO used FROM reward_manual_uses u WHERE u.id = NEW.use_id;
  PERFORM 1 FROM reward_entitlements e WHERE e.id = used.entitlement_id FOR UPDATE;
  NEW.restored_at := clock_timestamp();
  RETURN NEW;
END;
$$;

-- The P5-2 redemption guard, now counting the manual uses too (the only change is the quantity check).
CREATE OR REPLACE FUNCTION lucy_guard_reward_redemption() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  entitlement reward_entitlements%ROWTYPE;
  item reward_catalog_items%ROWTYPE;
  target invoices%ROWTYPE;
  performed_service uuid;
BEGIN
  -- Lock order (design 12.2, P5-T12): the invoice first, then the reward rows.
  SELECT i.* INTO target FROM invoices i JOIN invoice_lines l ON l.invoice_id = i.id
    WHERE l.id = NEW.invoice_line_id FOR SHARE OF i;
  SELECT e.* INTO entitlement FROM reward_entitlements e WHERE e.id = NEW.entitlement_id FOR UPDATE;
  SELECT c.* INTO item FROM reward_catalog_items c WHERE c.id = entitlement.catalog_item_id;
  IF entitlement.voided_at IS NOT NULL OR (entitlement.expires_at IS NOT NULL AND entitlement.expires_at <= clock_timestamp()) THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'A voided or expired entitlement cannot be redeemed';
  END IF;
  IF target.status IS NULL OR target.status = 'CANCELLED' THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'An entitlement is redeemed on an invoice being finalized, never a cancelled one';
  END IF;
  IF target.branch_id IS DISTINCT FROM NEW.branch_id THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'A redemption records the branch of its invoice';
  END IF;
  IF item.service_id IS NOT NULL THEN
    SELECT d.service_id INTO performed_service FROM invoice_line_services d WHERE d.invoice_line_id = NEW.invoice_line_id;
    IF performed_service IS DISTINCT FROM item.service_id THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'The entitlement is redeemed only for its own service';
    END IF;
  END IF;
  IF lucy_reward_units_in_use(NEW.entitlement_id) >= entitlement.quantity_issued THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'The entitlement has no quantity left';
  END IF;
  NEW.redeemed_at := clock_timestamp();
  RETURN NEW;
END;
$$;

-- ------------------------------------------------------------------------------------------------------------- triggers
CREATE TRIGGER "reward_manual_uses_a_live" BEFORE INSERT ON "reward_manual_uses"
FOR EACH ROW EXECUTE FUNCTION lucy_require_loyalty_go_live();
CREATE TRIGGER "reward_manual_uses_guard" BEFORE INSERT ON "reward_manual_uses"
FOR EACH ROW EXECUTE FUNCTION lucy_guard_reward_manual_use();
CREATE TRIGGER "reward_manual_uses_append_only" BEFORE UPDATE OR DELETE ON "reward_manual_uses"
FOR EACH ROW EXECUTE FUNCTION lucy_reject_permanent_history_mutation();
CREATE TRIGGER "reward_manual_uses_no_truncate" BEFORE TRUNCATE ON "reward_manual_uses"
FOR EACH STATEMENT EXECUTE FUNCTION lucy_reject_permanent_history_mutation();
CREATE TRIGGER "reward_manual_use_restorations_guard" BEFORE INSERT ON "reward_manual_use_restorations"
FOR EACH ROW EXECUTE FUNCTION lucy_guard_reward_manual_use_restoration();
CREATE TRIGGER "reward_manual_use_restorations_append_only" BEFORE UPDATE OR DELETE ON "reward_manual_use_restorations"
FOR EACH ROW EXECUTE FUNCTION lucy_reject_permanent_history_mutation();
CREATE TRIGGER "reward_manual_use_restorations_no_truncate" BEFORE TRUNCATE ON "reward_manual_use_restorations"
FOR EACH STATEMENT EXECUTE FUNCTION lucy_reject_permanent_history_mutation();

-- Function hardening (the Phase 1 convention). CREATE OR REPLACE drops function-level settings, so the replaced redemption
-- guard gets them again here.
DO $$
DECLARE
  migration_schema text := current_schema();
  function_name text;
BEGIN
  FOREACH function_name IN ARRAY ARRAY[
    'lucy_guard_reward_manual_use', 'lucy_guard_reward_manual_use_restoration', 'lucy_guard_reward_redemption'
  ] LOOP
    EXECUTE format('ALTER FUNCTION %I.%I() SET search_path TO pg_catalog, %I, pg_temp',
      migration_schema, function_name, migration_schema);
    EXECUTE format('REVOKE ALL ON FUNCTION %I.%I() FROM PUBLIC', migration_schema, function_name);
  END LOOP;
  EXECUTE format('ALTER FUNCTION %I.lucy_reward_units_in_use(uuid) SET search_path TO pg_catalog, %I, pg_temp',
    migration_schema, migration_schema);
  EXECUTE format('REVOKE ALL ON FUNCTION %I.lucy_reward_units_in_use(uuid) FROM PUBLIC', migration_schema);
END;
$$;
