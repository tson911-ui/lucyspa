-- Phase 4 Step 4, migration 2 of 5: catalog semantics of the financial permissions and the FINANCIAL
-- audit classification. No data is changed and nothing is granted.
--
-- MANAGE_DISCOUNTS and CREATE_VOUCHERS are GLOBAL_ONLY in V1 (design Q9) and join
-- MANAGE_SERVICE_PRICES and MANAGE_BOOKING_SETTINGS in the catalog rule; every other code stays
-- BRANCH_CAPABLE. The two pay codes stay EMPLOYEE_PAY; the nine financial codes are FINANCIAL data;
-- everything else is STANDARD. The existing overrides trigger already refuses a GLOBAL_ONLY code at a
-- branch scope by reading `permissions.scope_capability`, so it needs no change.
ALTER TABLE "permissions" DROP CONSTRAINT "permissions_catalog_semantics";
ALTER TABLE "permissions"
  ADD CONSTRAINT "permissions_catalog_semantics" CHECK (
    (("code" IN ('MANAGE_SERVICE_PRICES', 'MANAGE_BOOKING_SETTINGS', 'MANAGE_DISCOUNTS', 'CREATE_VOUCHERS')
        AND "scope_capability" = 'GLOBAL_ONLY')
      OR ("code" NOT IN ('MANAGE_SERVICE_PRICES', 'MANAGE_BOOKING_SETTINGS', 'MANAGE_DISCOUNTS', 'CREATE_VOUCHERS')
        AND "scope_capability" = 'BRANCH_CAPABLE'))
    AND (("code" IN ('VIEW_EMPLOYEE_PAY', 'MANAGE_EMPLOYEE_PAY') AND "data_classification" = 'EMPLOYEE_PAY')
      OR ("code" IN ('VIEW_INVOICES', 'MANAGE_INVOICES', 'COLLECT_PAYMENTS', 'APPLY_DISCOUNTS',
          'MANAGE_DISCOUNTS', 'CREATE_VOUCHERS', 'CANCEL_INVOICES', 'CORRECT_PAYMENTS', 'VIEW_REVENUE')
        AND "data_classification" = 'FINANCIAL')
      OR ("code" NOT IN ('VIEW_EMPLOYEE_PAY', 'MANAGE_EMPLOYEE_PAY', 'VIEW_INVOICES', 'MANAGE_INVOICES',
          'COLLECT_PAYMENTS', 'APPLY_DISCOUNTS', 'MANAGE_DISCOUNTS', 'CREATE_VOUCHERS', 'CANCEL_INVOICES',
          'CORRECT_PAYMENTS', 'VIEW_REVENUE')
        AND "data_classification" = 'STANDARD'))
  );

-- The financial audit actions of design section 12 (and any later INVOICE_/PAYMENT_/DISCOUNT_/VOUCHER_
-- action) are always classified FINANCIAL, like BASE_SALARY_CHANGED is always EMPLOYEE_PAY. No existing
-- audit action uses these prefixes. Nothing in this migration writes an audit event.
ALTER TABLE "audit_events"
  ADD CONSTRAINT "audit_events_financial_classification" CHECK (
    "action" !~ '^(INVOICE|PAYMENT|DISCOUNT|VOUCHER)_' OR "data_classification" = 'FINANCIAL'
  );
