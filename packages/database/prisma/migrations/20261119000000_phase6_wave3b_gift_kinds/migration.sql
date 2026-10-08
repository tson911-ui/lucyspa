-- Phase 6 P6-18 (Wave 3b: stock of product gifts, Owner decision Q10), migration 1 of 2: enum values only.
-- A new enum value cannot be used in the transaction that adds it, so the two values are committed on their own here (as 20261113000000
-- did) and the migration that follows (20261119000001) builds everything that uses them.
--   * StockMovementKind GIFT_OUT: one unit of a product gift leaves the stock of the branch where staff mark the gift as used.
--   * StockMovementKind GIFT_RETURN: a manager's restore of a mistaken "used" puts that unit back into the lot it came from.

ALTER TYPE "StockMovementKind" ADD VALUE 'GIFT_OUT';
ALTER TYPE "StockMovementKind" ADD VALUE 'GIFT_RETURN';
