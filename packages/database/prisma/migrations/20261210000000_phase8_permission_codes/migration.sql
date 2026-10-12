-- Phase 8 P8-2 (reports), migration 1: enum values only.
-- The four Phase 8 permission codes (design `PHASE8_REPORTS.md` section 7, approved by the Owner on 2026-10-12):
-- EXPORT_REPORTS, VIEW_STAFF_REPORTS, VIEW_PROFIT (GLOBAL_ONLY), VIEW_REVIEWS.
-- New enum values cannot be used in the transaction that adds them, so they are committed on their own here (as
-- 20261201000000_phase7_permission_codes did). The catalog rows are inserted by the operator sync (`pnpm db:permissions:sync`) and nobody
-- is granted anything by this migration. No existing behavior changes.
ALTER TYPE "PermissionCode" ADD VALUE 'EXPORT_REPORTS';
ALTER TYPE "PermissionCode" ADD VALUE 'VIEW_STAFF_REPORTS';
ALTER TYPE "PermissionCode" ADD VALUE 'VIEW_PROFIT';
ALTER TYPE "PermissionCode" ADD VALUE 'VIEW_REVIEWS';
