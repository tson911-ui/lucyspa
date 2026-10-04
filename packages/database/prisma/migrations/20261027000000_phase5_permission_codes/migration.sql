-- Phase 5 P5-2 (loyalty foundation), migration 1 of 4: enum values only.
-- The eleven Phase 5 permission codes (design section 13, Owner-approved as P5-T13). New enum values
-- cannot be used in the transaction that adds them, so they are committed on their own here (as
-- 20261014000000_phase4_financial_enums did); the catalog semantics that use them follow in the next
-- migration. Catalog rows are inserted by the operator sync (`pnpm db:permissions:sync`) and no role or
-- user is granted anything by this migration.
ALTER TYPE "PermissionCode" ADD VALUE 'VIEW_LOYALTY';
ALTER TYPE "PermissionCode" ADD VALUE 'ADJUST_LOYALTY_POINTS';
ALTER TYPE "PermissionCode" ADD VALUE 'MANAGE_REFERRALS';
ALTER TYPE "PermissionCode" ADD VALUE 'MANAGE_COMBOS';
ALTER TYPE "PermissionCode" ADD VALUE 'SELL_COMBOS';
ALTER TYPE "PermissionCode" ADD VALUE 'CONSUME_COMBO_SESSIONS';
ALTER TYPE "PermissionCode" ADD VALUE 'RESTORE_COMBO_SESSIONS';
ALTER TYPE "PermissionCode" ADD VALUE 'MANAGE_BIRTHDAY_REWARDS';
ALTER TYPE "PermissionCode" ADD VALUE 'MANAGE_REWARD_CATALOG';
ALTER TYPE "PermissionCode" ADD VALUE 'ISSUE_REWARDS';
ALTER TYPE "PermissionCode" ADD VALUE 'VIEW_LOYALTY_EXCEPTIONS';
