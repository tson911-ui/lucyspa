-- Notification Center Step 1 (foundation). Additive and non-destructive: every existing
-- Phase 3 row stays valid; only constraints are relaxed or added, and no data is rewritten.

-- A notification about a person (leave request) has no single branch; Phase 3 types still
-- require one (see notifications_branch_scope below).
ALTER TABLE notifications ALTER COLUMN branch_id DROP NOT NULL;

-- Minimal structured facts (ids, dates, enums; validated in code) and archive state.
ALTER TABLE notifications
  ADD COLUMN params jsonb,
  ADD COLUMN archived_at timestamptz(3);

-- Allow the Leave types/entity. The Phase 3 members are unchanged.
ALTER TABLE notifications
  DROP CONSTRAINT notifications_type_check,
  ADD CONSTRAINT notifications_type_check CHECK (type IN (
    'BOOKING_CREATED', 'BOOKING_CANCELLED', 'LATE_CANCELLATION', 'BOOKING_NO_SHOW',
    'CUSTOMER_ARRIVED', 'BOOKING_KTV_CONFLICT', 'KTV_REASSIGNED', 'START_OVERDUE', 'PRE_END',
    'END_OVERDUE', 'LEAVE_REQUESTED', 'LEAVE_DECIDED')),
  DROP CONSTRAINT notifications_entity_type_check,
  ADD CONSTRAINT notifications_entity_type_check CHECK (entity_type IN ('Booking', 'Visit', 'LeaveRequest'));

-- Integrity rules that keep the two families consistent.
ALTER TABLE notifications
  ADD CONSTRAINT notifications_params_object CHECK (params IS NULL OR jsonb_typeof(params) = 'object'),
  ADD CONSTRAINT notifications_type_entity CHECK ((type LIKE 'LEAVE\_%') = (entity_type = 'LeaveRequest')),
  ADD CONSTRAINT notifications_branch_scope CHECK (branch_id IS NOT NULL OR entity_type = 'LeaveRequest');
