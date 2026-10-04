-- Phase 5 P5-7, migration 1 of 2: the invoice line kind of a combo purchase (design 9.2, OQ-1).
-- A new enum value cannot be used in the transaction that adds it, so the value is added here alone and
-- the migration that follows (20261101000001) builds everything that refers to it.

ALTER TYPE "InvoiceLineKind" ADD VALUE 'COMBO_PURCHASE';
