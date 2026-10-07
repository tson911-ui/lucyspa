-- Phase 6 P6-2 (products and inventory foundation), migration 1 of 5: enum values only.
-- The eleven Phase 6 permission codes (design `PHASE6_PRODUCTS_INVENTORY_DESIGN.md` section 9, P6-T24, approved by the Owner
-- on 2026-10-07). New enum values cannot be used in the transaction that adds them, so they are committed on their own here
-- (as 20261027000000_phase5_permission_codes did); the catalog semantics that use them follow in the next migration.
-- Catalog rows are inserted by the operator sync (`pnpm db:permissions:sync`) and no role or user is granted anything by
-- this migration. No existing behavior changes.
ALTER TYPE "PermissionCode" ADD VALUE 'MANAGE_PRODUCTS';
ALTER TYPE "PermissionCode" ADD VALUE 'MANAGE_PRODUCT_PRICES';
ALTER TYPE "PermissionCode" ADD VALUE 'VIEW_PRODUCT_COST';
ALTER TYPE "PermissionCode" ADD VALUE 'VIEW_INVENTORY';
ALTER TYPE "PermissionCode" ADD VALUE 'MANAGE_STOCK_RECEIPTS';
ALTER TYPE "PermissionCode" ADD VALUE 'ADJUST_STOCK';
ALTER TYPE "PermissionCode" ADD VALUE 'IMPORT_PRODUCT_DATA';
ALTER TYPE "PermissionCode" ADD VALUE 'SELL_PRODUCTS';
ALTER TYPE "PermissionCode" ADD VALUE 'MANAGE_PRODUCT_RETURNS';
ALTER TYPE "PermissionCode" ADD VALUE 'REFUND_PRODUCTS';
ALTER TYPE "PermissionCode" ADD VALUE 'MANAGE_PRODUCT_CAMPAIGNS';
