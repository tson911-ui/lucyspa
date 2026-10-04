-- Phase 5 P5-3, migration 1 of 2: the go-live activation permission (Owner decision 2026-10-04, design 2.5).
-- Enum value only; it cannot be used in the transaction that adds it. Catalog row: operator sync. Nothing is granted.
ALTER TYPE "PermissionCode" ADD VALUE 'ACTIVATE_LOYALTY';
