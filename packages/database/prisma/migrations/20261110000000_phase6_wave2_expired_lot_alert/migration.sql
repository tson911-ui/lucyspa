-- Phase 6 P6-11 (Owner, 2026-10-08, OQ-75 changed): the closed type/entity CHECKs of `notifications` learn one more stock alert.
-- A paid invoice that had to take stock from an EXPIRED lot (the last resort of the sale) tells the holders of the inventory
-- permission at its branch, naming the invoice, the product and the lot.
--   EXPIRED_LOT_SOLD   about one product variant at a branch -> entity 'ProductVariant' (like LOW_STOCK_REACHED)
-- Same method as 20261106000008: two constraints are widened (never narrowed), so every existing row still satisfies them; no row is
-- read, written or moved, and no column, index or trigger changes. `notifications_entity_type_check` already allows 'ProductVariant'
-- and `notifications_branch_scope` / `notifications_branch_entity` already fit (a branch is always present).

ALTER TABLE "notifications"
  DROP CONSTRAINT "notifications_type_check",
  ADD CONSTRAINT "notifications_type_check" CHECK ("type" IN (
    'BOOKING_CREATED', 'BOOKING_CANCELLED', 'LATE_CANCELLATION', 'BOOKING_NO_SHOW', 'CUSTOMER_ARRIVED',
    'BOOKING_KTV_CONFLICT', 'KTV_REASSIGNED', 'START_OVERDUE', 'PRE_END', 'END_OVERDUE',
    'LEAVE_REQUESTED', 'LEAVE_DECIDED',
    'INVOICE_PAID', 'INVOICE_CANCELLED', 'PAYOS_PAYMENT_SUCCEEDED', 'PAYOS_PAYMENT_ANOMALY', 'PAYMENT_REVERSED',
    'INVOICE_CANCELLED_ALERT', 'REVENUE_DAILY_SUMMARY',
    'LOW_STOCK_REACHED', 'EXPIRY_ALERT', 'EXPIRED_LOT_SOLD')),
  DROP CONSTRAINT "notifications_type_entity",
  ADD CONSTRAINT "notifications_type_entity" CHECK (
    (("type" LIKE 'LEAVE\_%') = ("entity_type" = 'LeaveRequest'))
    AND (("type" IN ('INVOICE_PAID', 'INVOICE_CANCELLED', 'PAYOS_PAYMENT_SUCCEEDED', 'PAYOS_PAYMENT_ANOMALY',
                     'PAYMENT_REVERSED', 'INVOICE_CANCELLED_ALERT')) = ("entity_type" = 'Invoice'))
    AND (("type" IN ('REVENUE_DAILY_SUMMARY', 'EXPIRY_ALERT')) = ("entity_type" = 'Branch'))
    AND (("type" IN ('LOW_STOCK_REACHED', 'EXPIRED_LOT_SOLD')) = ("entity_type" = 'ProductVariant')));
