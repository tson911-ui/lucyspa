-- Phase 7 P7-2 (payroll, tips and shop funds), migration 1 of 2: enum values only.
-- The five Phase 7 permission codes (design `PHASE7_PAYROLL_FUNDS.md` section 9, approved by the Owner on 2026-10-11).
-- New enum values cannot be used in the transaction that adds them, so they are committed on their own here (as
-- 20261125000000_phase9_permission_codes did); the catalog semantics and the tables follow in the next migration. The catalog rows
-- are inserted by the operator sync (`pnpm db:permissions:sync`) and nobody is granted anything by this migration. No existing
-- behavior changes.
ALTER TYPE "PermissionCode" ADD VALUE 'MANAGE_PAY_RULES';
ALTER TYPE "PermissionCode" ADD VALUE 'MANAGE_PAYROLL';
ALTER TYPE "PermissionCode" ADD VALUE 'APPROVE_PAYROLL';
ALTER TYPE "PermissionCode" ADD VALUE 'VIEW_CASH';
ALTER TYPE "PermissionCode" ADD VALUE 'MANAGE_CASH';
