-- Phase 6 P6-19 (Wave 4: online orders), migration 1 of 2: enum values only (design 2.38).
-- A line of an online order that left in a parcel (SHIPPED), and the cancellation of a line whose delivery failed and whose goods came back
-- (DELIVERY_FAILED, OQ-98). New enum values cannot be used in the transaction that adds them, so they are committed on their own here; the
-- migration that uses them follows. No existing behavior changes and no existing row is touched.
ALTER TYPE "ProductOrderLineStatus" ADD VALUE 'SHIPPED';
ALTER TYPE "ProductOrderCancelCause" ADD VALUE 'DELIVERY_FAILED';
