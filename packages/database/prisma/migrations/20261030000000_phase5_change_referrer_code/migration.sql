-- Phase 5 P5-5, migration 1 of 2: the Owner-only permission that corrects a customer's referrer (Owner decision 2026-10-04,
-- design 2.5, same pattern as ACTIVATE_LOYALTY). Enum value only; it cannot be used in the transaction that adds it.
-- Catalog row: operator sync (`pnpm db:permissions:sync`). Nothing is granted.
ALTER TYPE "PermissionCode" ADD VALUE 'CHANGE_REFERRER';
