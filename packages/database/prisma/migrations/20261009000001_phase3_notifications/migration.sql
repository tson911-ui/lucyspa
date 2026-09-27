-- Phase 3 Step 9: inbox and recoverable warning timing only. No execution/occupancy changes.
CREATE TABLE notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  recipient_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  branch_id uuid NOT NULL REFERENCES branches(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  source_event_id uuid NOT NULL REFERENCES outbox_events(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  type text NOT NULL CHECK (type IN ('BOOKING_CREATED', 'BOOKING_CANCELLED', 'LATE_CANCELLATION',
    'BOOKING_NO_SHOW', 'CUSTOMER_ARRIVED', 'BOOKING_KTV_CONFLICT', 'KTV_REASSIGNED',
    'START_OVERDUE', 'PRE_END', 'END_OVERDUE')),
  entity_type text NOT NULL CHECK (entity_type IN ('Booking', 'Visit')),
  entity_id uuid NOT NULL,
  context_code text NOT NULL,
  action_at timestamptz(3) NOT NULL,
  created_at timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  read_at timestamptz(3),
  CONSTRAINT notifications_event_recipient_key UNIQUE (source_event_id, recipient_user_id)
);
CREATE INDEX notifications_inbox_idx ON notifications(recipient_user_id, created_at DESC, id DESC);
CREATE INDEX notifications_unread_idx ON notifications(recipient_user_id, read_at);

CREATE TABLE service_warning_schedules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  line_id uuid NOT NULL REFERENCES visit_service_lines(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  kind text NOT NULL CHECK (kind IN ('START_OVERDUE', 'PRE_END', 'END_OVERDUE')),
  target_at timestamptz(3) NOT NULL,
  due_at timestamptz(3) NOT NULL,
  created_at timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT service_warning_schedules_occurrence_key UNIQUE (line_id, kind, target_at)
);
-- Metadata for first scheduling is immutable; settings changes affect later schedules only.
CREATE FUNCTION protect_service_warning_schedule() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'warning schedules are immutable' USING ERRCODE = '23514';
END $$;
CREATE TRIGGER service_warning_schedules_immutable BEFORE UPDATE OR DELETE ON service_warning_schedules
FOR EACH ROW EXECUTE FUNCTION protect_service_warning_schedule();

-- Bounded UUID recovery pages skip historical final work; this SQL-only partial index
-- deliberately is not represented as an unfiltered Prisma index.
CREATE INDEX visit_service_lines_warning_recovery_idx ON visit_service_lines(id)
WHERE (status = 'PLANNED' AND start_overdue_warned_at IS NULL) OR status = 'IN_PROGRESS';
