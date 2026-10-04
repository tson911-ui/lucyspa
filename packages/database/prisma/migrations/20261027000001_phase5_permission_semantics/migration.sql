-- Phase 5 P5-2, migration 2 of 4: catalog semantics of the Phase 5 permissions. No data is changed and
-- nothing is granted.
--
-- GLOBAL_ONLY (never grantable at a branch scope; the existing overrides trigger already refuses a
-- GLOBAL_ONLY code below GLOBAL by reading `permissions.scope_capability`, so it needs no change):
-- the previous five plus ADJUST_LOYALTY_POINTS, MANAGE_COMBOS, RESTORE_COMBO_SESSIONS,
-- MANAGE_BIRTHDAY_REWARDS, MANAGE_REWARD_CATALOG and VIEW_LOYALTY_EXCEPTIONS (design 13: "Owner-level").
-- FINANCIAL data: the nine Phase 4 codes plus ADJUST_LOYALTY_POINTS and RESTORE_COMBO_SESSIONS (design 13).
-- EMPLOYEE_PAY: the two pay codes, unchanged. Everything else is STANDARD.
ALTER TABLE "permissions" DROP CONSTRAINT "permissions_catalog_semantics";
ALTER TABLE "permissions"
  ADD CONSTRAINT "permissions_catalog_semantics" CHECK (
    (("code" IN ('MANAGE_SERVICE_PRICES', 'MANAGE_BOOKING_SETTINGS', 'MANAGE_DISCOUNTS', 'CREATE_VOUCHERS',
          'MANAGE_WEBSITE_CONTENT', 'ADJUST_LOYALTY_POINTS', 'MANAGE_COMBOS', 'RESTORE_COMBO_SESSIONS',
          'MANAGE_BIRTHDAY_REWARDS', 'MANAGE_REWARD_CATALOG', 'VIEW_LOYALTY_EXCEPTIONS')
        AND "scope_capability" = 'GLOBAL_ONLY')
      OR ("code" NOT IN ('MANAGE_SERVICE_PRICES', 'MANAGE_BOOKING_SETTINGS', 'MANAGE_DISCOUNTS', 'CREATE_VOUCHERS',
          'MANAGE_WEBSITE_CONTENT', 'ADJUST_LOYALTY_POINTS', 'MANAGE_COMBOS', 'RESTORE_COMBO_SESSIONS',
          'MANAGE_BIRTHDAY_REWARDS', 'MANAGE_REWARD_CATALOG', 'VIEW_LOYALTY_EXCEPTIONS')
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
