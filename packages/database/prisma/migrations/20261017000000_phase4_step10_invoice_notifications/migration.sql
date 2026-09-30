-- Phase 4 Step 10: invoice / revenue notifications (Owner answers Q8, design section 17.1). Additive:
-- nothing is dropped, rewritten or backfilled, and every existing notification row stays valid.
--
--   1. outbox_consumptions: the multi-consumer contract of design 15.2. Financial events never use
--      published_at; each consumer records its own handling (UNIQUE(event_id, consumer)).
--   2. notifications: the closed type/entity CHECKs learn the invoice + revenue-summary types and the
--      Invoice / Branch entities. Type <-> entity pairing stays enforced in both directions.
--   3. One REVENUE_SUMMARY_DUE outbox event per (branch, business date): the source event of the 21:30
--      daily summary. The partial unique index makes the worker's schedule idempotent.

-- ----------------------------------------------------------------------------- 1. consumptions
CREATE TABLE "outbox_consumptions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "event_id" UUID NOT NULL,
    "consumer" TEXT NOT NULL,
    "outcome" TEXT NOT NULL,
    "consumed_at" TIMESTAMPTZ(3) NOT NULL DEFAULT clock_timestamp(),

    CONSTRAINT "outbox_consumptions_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "outbox_consumptions_event_id_fkey" FOREIGN KEY ("event_id")
      REFERENCES "outbox_events"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT "outbox_consumptions_consumer_check" CHECK ("consumer" ~ '^[a-z][a-z0-9_]{0,63}$'),
    CONSTRAINT "outbox_consumptions_outcome_check" CHECK ("outcome" IN ('PUBLISHED', 'SKIPPED', 'UNROUTABLE'))
);
CREATE UNIQUE INDEX "outbox_consumptions_event_consumer_key" ON "outbox_consumptions"("event_id", "consumer");

-- Consumption history is permanent (PRD 40): never edited, deleted or truncated.
CREATE TRIGGER "outbox_consumptions_append_only" BEFORE UPDATE OR DELETE ON "outbox_consumptions"
FOR EACH ROW EXECUTE FUNCTION lucy_reject_permanent_history_mutation();
CREATE TRIGGER "outbox_consumptions_no_truncate" BEFORE TRUNCATE ON "outbox_consumptions"
FOR EACH STATEMENT EXECUTE FUNCTION lucy_reject_permanent_history_mutation();

-- A consumer reads its pending events of given types in id order.
CREATE INDEX "outbox_events_type_id_idx" ON "outbox_events"("event_type", "id");

-- ----------------------------------------------------------------------------- 2. notifications
ALTER TABLE "notifications"
  DROP CONSTRAINT "notifications_type_check",
  ADD CONSTRAINT "notifications_type_check" CHECK ("type" IN (
    'BOOKING_CREATED', 'BOOKING_CANCELLED', 'LATE_CANCELLATION', 'BOOKING_NO_SHOW',
    'CUSTOMER_ARRIVED', 'BOOKING_KTV_CONFLICT', 'KTV_REASSIGNED', 'START_OVERDUE', 'PRE_END',
    'END_OVERDUE', 'LEAVE_REQUESTED', 'LEAVE_DECIDED',
    'INVOICE_PAID', 'INVOICE_CANCELLED', 'PAYOS_PAYMENT_SUCCEEDED', 'PAYOS_PAYMENT_ANOMALY',
    'PAYMENT_REVERSED', 'INVOICE_CANCELLED_ALERT', 'REVENUE_DAILY_SUMMARY')),
  DROP CONSTRAINT "notifications_entity_type_check",
  ADD CONSTRAINT "notifications_entity_type_check" CHECK ("entity_type" IN
    ('Booking', 'Visit', 'LeaveRequest', 'Invoice', 'Branch')),
  DROP CONSTRAINT "notifications_type_entity",
  ADD CONSTRAINT "notifications_type_entity" CHECK (
    (("type" LIKE 'LEAVE\_%') = ("entity_type" = 'LeaveRequest'))
    AND (("type" IN ('INVOICE_PAID', 'INVOICE_CANCELLED', 'PAYOS_PAYMENT_SUCCEEDED',
                     'PAYOS_PAYMENT_ANOMALY', 'PAYMENT_REVERSED', 'INVOICE_CANCELLED_ALERT'))
         = ("entity_type" = 'Invoice'))
    AND (("type" = 'REVENUE_DAILY_SUMMARY') = ("entity_type" = 'Branch'))
  ),
  -- The revenue summary is about its branch: the entity IS the notification's branch.
  ADD CONSTRAINT "notifications_branch_entity" CHECK (
    "entity_type" <> 'Branch' OR "branch_id" = "entity_id"
  );

-- ----------------------------------------------------------------------------- 3. daily summary
CREATE UNIQUE INDEX "outbox_revenue_summary_due_key"
  ON "outbox_events"("aggregate_id", (("payload" ->> 'businessDate')))
  WHERE "event_type" = 'REVENUE_SUMMARY_DUE';
