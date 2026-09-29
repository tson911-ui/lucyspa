-- Phase 4 Step 4 (POS database foundation), migration 1 of 5: enum values only.
-- The nine locked financial permission codes (design Q9) and the FINANCIAL data classification
-- (design 11.4). New enum values cannot be used in the transaction that adds them, so they are
-- committed on their own here (as 20261005000000_phase3_permission_codes did); the catalog
-- semantics that use them follow in the next migration. Catalog rows are inserted by the operator
-- sync (`pnpm db:permissions:sync`) and no role or user is granted anything by this migration.
ALTER TYPE "PermissionCode" ADD VALUE 'VIEW_INVOICES';
ALTER TYPE "PermissionCode" ADD VALUE 'MANAGE_INVOICES';
ALTER TYPE "PermissionCode" ADD VALUE 'COLLECT_PAYMENTS';
ALTER TYPE "PermissionCode" ADD VALUE 'APPLY_DISCOUNTS';
ALTER TYPE "PermissionCode" ADD VALUE 'MANAGE_DISCOUNTS';
ALTER TYPE "PermissionCode" ADD VALUE 'CREATE_VOUCHERS';
ALTER TYPE "PermissionCode" ADD VALUE 'CANCEL_INVOICES';
ALTER TYPE "PermissionCode" ADD VALUE 'CORRECT_PAYMENTS';
ALTER TYPE "PermissionCode" ADD VALUE 'VIEW_REVENUE';

ALTER TYPE "DataClassification" ADD VALUE 'FINANCIAL';
