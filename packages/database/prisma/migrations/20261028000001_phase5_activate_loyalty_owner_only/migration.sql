-- Phase 5 P5-3, migration 2 of 2: catalog semantics and the Owner-only rule of ACTIVATE_LOYALTY.
-- The loyalty go-live switch is the Owner's alone (Owner decision 2026-10-04, design 2.5): the code is
-- GLOBAL_ONLY (STANDARD data) and SQL refuses to attach it to any role or per-user override, so only the virtual
-- Owner (who passes every permission check) can activate loyalty. No data is changed and nothing is granted.
ALTER TABLE "permissions" DROP CONSTRAINT "permissions_catalog_semantics";
ALTER TABLE "permissions"
  ADD CONSTRAINT "permissions_catalog_semantics" CHECK (
    (("code" IN ('MANAGE_SERVICE_PRICES', 'MANAGE_BOOKING_SETTINGS', 'MANAGE_DISCOUNTS', 'CREATE_VOUCHERS',
          'MANAGE_WEBSITE_CONTENT', 'ADJUST_LOYALTY_POINTS', 'MANAGE_COMBOS', 'RESTORE_COMBO_SESSIONS',
          'MANAGE_BIRTHDAY_REWARDS', 'MANAGE_REWARD_CATALOG', 'VIEW_LOYALTY_EXCEPTIONS', 'ACTIVATE_LOYALTY')
        AND "scope_capability" = 'GLOBAL_ONLY')
      OR ("code" NOT IN ('MANAGE_SERVICE_PRICES', 'MANAGE_BOOKING_SETTINGS', 'MANAGE_DISCOUNTS', 'CREATE_VOUCHERS',
          'MANAGE_WEBSITE_CONTENT', 'ADJUST_LOYALTY_POINTS', 'MANAGE_COMBOS', 'RESTORE_COMBO_SESSIONS',
          'MANAGE_BIRTHDAY_REWARDS', 'MANAGE_REWARD_CATALOG', 'VIEW_LOYALTY_EXCEPTIONS', 'ACTIVATE_LOYALTY')
        AND "scope_capability" = 'BRANCH_CAPABLE'))
    AND (("code" IN ('VIEW_EMPLOYEE_PAY', 'MANAGE_EMPLOYEE_PAY') AND "data_classification" = 'EMPLOYEE_PAY')
      OR ("code" IN ('VIEW_INVOICES', 'MANAGE_INVOICES', 'COLLECT_PAYMENTS', 'APPLY_DISCOUNTS',
          'MANAGE_DISCOUNTS', 'CREATE_VOUCHERS', 'CANCEL_INVOICES', 'CORRECT_PAYMENTS', 'VIEW_REVENUE',
          'ADJUST_LOYALTY_POINTS', 'RESTORE_COMBO_SESSIONS')
        AND "data_classification" = 'FINANCIAL')
      OR ("code" NOT IN ('VIEW_EMPLOYEE_PAY', 'MANAGE_EMPLOYEE_PAY', 'VIEW_INVOICES', 'MANAGE_INVOICES',
          'COLLECT_PAYMENTS', 'APPLY_DISCOUNTS', 'MANAGE_DISCOUNTS', 'CREATE_VOUCHERS', 'CANCEL_INVOICES',
          'CORRECT_PAYMENTS', 'VIEW_REVENUE', 'ADJUST_LOYALTY_POINTS', 'RESTORE_COMBO_SESSIONS')
        AND "data_classification" = 'STANDARD'))
  );

-- Owner-only permissions: a role or a user override may never carry them.
CREATE FUNCTION lucy_refuse_owner_only_permission() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM permissions p WHERE p.id = NEW.permission_id AND p.code = 'ACTIVATE_LOYALTY') THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'This permission belongs to the Owner and cannot be granted';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "role_permissions_owner_only" BEFORE INSERT OR UPDATE ON "role_permissions"
FOR EACH ROW EXECUTE FUNCTION lucy_refuse_owner_only_permission();
CREATE TRIGGER "user_permission_overrides_owner_only" BEFORE INSERT OR UPDATE ON "user_permission_overrides"
FOR EACH ROW EXECUTE FUNCTION lucy_refuse_owner_only_permission();

DO $$
DECLARE
  migration_schema text := current_schema();
BEGIN
  EXECUTE format('ALTER FUNCTION %I.%I() SET search_path TO pg_catalog, %I, pg_temp',
    migration_schema, 'lucy_refuse_owner_only_permission', migration_schema);
  EXECUTE format('REVOKE ALL ON FUNCTION %I.%I() FROM PUBLIC', migration_schema, 'lucy_refuse_owner_only_permission');
END;
$$;
