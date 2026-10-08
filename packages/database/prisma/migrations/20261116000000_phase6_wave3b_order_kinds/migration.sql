-- Phase 6 P6-15 (Wave 3b: product orders), migration 1 of 2: enum values only.
-- The permission code of the one new Wave 3b permission (design T36, approved by the Owner on 2026-10-08) and the second source of a
-- stock reservation (an order line, design 18.5). New enum values cannot be used in the transaction that adds them, so they are
-- committed on their own here; the migration that uses them follows. The permission row itself is inserted by the operator sync
-- (`pnpm db:permissions:sync`) and nobody is granted anything by this migration. No existing behavior changes.
ALTER TYPE "PermissionCode" ADD VALUE 'MANAGE_PRODUCT_ORDERS';
ALTER TYPE "StockReservationSource" ADD VALUE 'ORDER_LINE';
