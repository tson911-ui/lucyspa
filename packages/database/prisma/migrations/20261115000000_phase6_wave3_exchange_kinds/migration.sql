-- Phase 6 P6-14 (Wave 3: exchanges of a returned product line), migration 1 of 2: enum values only.
-- A new enum value cannot be used in the transaction that adds it, so it is committed on its own here (as 20261113000000 did) and the
-- migration that follows (20261115000001) builds everything that uses it.
--   * StockMovementKind EXCHANGE_RETURN: returned goods that the person recorded as sellable go back into stock, in a new lot named after
--     the return case. The replacement leaves stock as an ordinary sale of its invoice line (the SALE movement), so it needs no kind.

ALTER TYPE "StockMovementKind" ADD VALUE 'EXCHANGE_RETURN';
