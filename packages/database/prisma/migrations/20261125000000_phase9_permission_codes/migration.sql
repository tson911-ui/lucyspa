-- Phase 9 P9-2 (supplier product import), migration 1 of 2: enum values only.
-- The two Phase 9 permission codes (design `PHASE9_PRODUCT_IMPORT.md` section 11, P9-T8, approved by the Owner on 2026-10-10).
-- New enum values cannot be used in the transaction that adds them, so they are committed on their own here (as
-- 20261106000000_phase6_permission_codes did); the catalog semantics and the tables follow in the next migration. The catalog rows
-- are inserted by the operator sync (`pnpm db:permissions:sync`) and nobody is granted anything by this migration. No existing
-- behavior changes.
ALTER TYPE "PermissionCode" ADD VALUE 'MANAGE_SUPPLIER_SOURCES';
ALTER TYPE "PermissionCode" ADD VALUE 'REVIEW_SUPPLIER_IMPORTS';
