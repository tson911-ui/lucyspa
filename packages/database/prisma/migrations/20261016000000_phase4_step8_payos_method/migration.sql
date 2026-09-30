-- Phase 4 Step 8, migration 1 of 2: the PayOS payment method (additive).
--
-- A new enum value cannot be used in the transaction that adds it, so this migration only adds the value;
-- migration 2 (20261016000001) uses it in constraints, guards and indexes.
ALTER TYPE "PaymentMethod" ADD VALUE 'PAYOS';
