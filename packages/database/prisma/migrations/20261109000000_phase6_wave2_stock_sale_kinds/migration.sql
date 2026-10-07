-- Phase 6 P6-10 (Wave 2: stock consumption), migration 1 of 2: enum values only.
-- A new enum value cannot be used in the transaction that adds it, so the two values are committed on their own here (as
-- 20261107000000_phase6_wave2_invoice_kinds did) and the migration that follows (20261109000001) builds everything that uses them.
--   * StockMovementKind SALE: stock leaves a lot because a paid invoice consumed its reservation (design 4.5, T15).
--   * StockMovementKind SALE_REVERSAL: the exact opposite, when the paid episode ends (payment reversed, invoice cancelled).

ALTER TYPE "StockMovementKind" ADD VALUE 'SALE';
ALTER TYPE "StockMovementKind" ADD VALUE 'SALE_REVERSAL';
