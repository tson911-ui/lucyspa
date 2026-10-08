-- Phase 6 P6-13 (Wave 3: refunds per product line), migration 1 of 2: enum values only.
-- A new enum value cannot be used in the transaction that adds it, so the two values are committed on their own here (as
-- 20261109000000 did) and the migration that follows (20261113000001) builds everything that uses them.
--   * StockMovementKind REFUND_RETURN: returned goods that the refunding person recorded as sellable go back into stock, in a new lot.
--   * LoyaltyLedgerKind REFUND_REVERSAL: the Beauty points taken back by a product refund (PRD 28.6), a linked entry; the earn entry stays.

ALTER TYPE "StockMovementKind" ADD VALUE 'REFUND_RETURN';
ALTER TYPE "LoyaltyLedgerKind" ADD VALUE 'REFUND_REVERSAL';
