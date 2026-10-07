-- Phase 6 P6-4: the closed type/entity CHECKs of `notifications` learn the two stock alerts (design 4.6, P6-T16).
-- The only change to an existing table in Wave 1: two constraints are widened (same method as Phase 4 Step 10), never narrowed,
-- so every existing row still satisfies them; no row is read, written or moved, and no column, index or trigger changes.
--   LOW_STOCK_REACHED  about one variant at a branch   -> entity 'ProductVariant' (the row also carries the branch)
--   EXPIRY_ALERT       the daily expiry scan of a branch -> entity 'Branch' (like the revenue summary)
-- `notifications_branch_scope` and `notifications_branch_entity` already fit both (a branch is always present; a Branch entity
-- is the row's own branch) and stay as they are.

ALTER TABLE "notifications"
  DROP CONSTRAINT "notifications_type_check",
  ADD CONSTRAINT "notifications_type_check" CHECK ("type" IN (
    'BOOKING_CREATED', 'BOOKING_CANCELLED', 'LATE_CANCELLATION', 'BOOKING_NO_SHOW', 'CUSTOMER_ARRIVED',
    'BOOKING_KTV_CONFLICT', 'KTV_REASSIGNED', 'START_OVERDUE', 'PRE_END', 'END_OVERDUE',
    'LEAVE_REQUESTED', 'LEAVE_DECIDED',
    'INVOICE_PAID', 'INVOICE_CANCELLED', 'PAYOS_PAYMENT_SUCCEEDED', 'PAYOS_PAYMENT_ANOMALY', 'PAYMENT_REVERSED',
    'INVOICE_CANCELLED_ALERT', 'REVENUE_DAILY_SUMMARY',
    'LOW_STOCK_REACHED', 'EXPIRY_ALERT')),
  DROP CONSTRAINT "notifications_entity_type_check",
  ADD CONSTRAINT "notifications_entity_type_check" CHECK ("entity_type" IN
    ('Booking', 'Visit', 'LeaveRequest', 'Invoice', 'Branch', 'ProductVariant')),
  DROP CONSTRAINT "notifications_type_entity",
  ADD CONSTRAINT "notifications_type_entity" CHECK (
    (("type" LIKE 'LEAVE\_%') = ("entity_type" = 'LeaveRequest'))
    AND (("type" IN ('INVOICE_PAID', 'INVOICE_CANCELLED', 'PAYOS_PAYMENT_SUCCEEDED', 'PAYOS_PAYMENT_ANOMALY',
                     'PAYMENT_REVERSED', 'INVOICE_CANCELLED_ALERT')) = ("entity_type" = 'Invoice'))
    AND (("type" IN ('REVENUE_DAILY_SUMMARY', 'EXPIRY_ALERT')) = ("entity_type" = 'Branch'))
    AND (("type" = 'LOW_STOCK_REACHED') = ("entity_type" = 'ProductVariant')));
