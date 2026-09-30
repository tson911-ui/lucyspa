-- Phase 4 Step 8, migration 2 of 2: the PayOS provider payment foundation (additive; nothing is dropped,
-- rewritten or backfilled, and no cash rule is loosened).
--
-- Owner answers Q7 (design 16.3) enforced here where the database can enforce them:
--   * a PayOS payment is created PENDING and becomes SUCCEEDED only by provider confirmation, which needs a
--     provider reference; staff have no path that marks a transfer received (no cash-style insert);
--   * at most ONE pending provider request per invoice (partial unique index);
--   * a confirmation that arrives after expiry/cancel is a NEW succeeded row pointing at the original;
--   * a provider payment is never reversed (the existing correction guard already refuses non-cash);
--   * an invoice with a pending provider request cannot be cancelled;
--   * one succeeded payment per provider order (a provider transaction is credited once).
-- Provider columns are NULL for cash and NOT NULL-shaped for PayOS. Cash rules and every Step 4 guard stay.

CREATE TYPE "PaymentAttemptKind" AS ENUM ('CREATE', 'CANCEL', 'STATUS_READ');
CREATE TYPE "PaymentAttemptOutcome" AS ENUM ('OK', 'REJECTED', 'UNREACHABLE');
CREATE TYPE "ProviderEventOutcome" AS ENUM ('APPLIED', 'IGNORED', 'ANOMALY');
CREATE TYPE "PaymentAnomalyKind" AS ENUM ('AMOUNT_MISMATCH', 'INVOICE_NOT_PAYABLE', 'EXCEEDS_BALANCE');
CREATE TYPE "PaymentAnomalyStatus" AS ENUM ('OPEN', 'REVIEWED');

-- ------------------------------------------------------------------------------ payments columns
ALTER TABLE "payments"
  ADD COLUMN "provider_order_code" BIGINT,
  ADD COLUMN "provider_payment_link_id" TEXT,
  ADD COLUMN "checkout_url" TEXT,
  ADD COLUMN "qr_code" TEXT,
  ADD COLUMN "expires_at" TIMESTAMPTZ(3),
  ADD COLUMN "provider_reference" TEXT,
  ADD COLUMN "late_of_payment_id" UUID;

ALTER TABLE "payments"
  ADD CONSTRAINT "payments_late_of_payment_id_fkey" FOREIGN KEY ("late_of_payment_id")
    REFERENCES "payments"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- Cash carries no provider data. A PayOS row has its order code and expiry, is exactly what was requested
-- (no tender/change), is SUCCEEDED iff it has a provider reference, and its link details are all-or-none
-- (they are attached after the provider answers).
ALTER TABLE "payments"
  ADD CONSTRAINT "payments_provider_columns" CHECK (
    ("method" = 'CASH'
      AND "provider_order_code" IS NULL AND "provider_payment_link_id" IS NULL AND "checkout_url" IS NULL
      AND "qr_code" IS NULL AND "expires_at" IS NULL AND "provider_reference" IS NULL
      AND "late_of_payment_id" IS NULL)
    OR ("method" = 'PAYOS'
      AND "provider_order_code" IS NOT NULL AND "provider_order_code" BETWEEN 1 AND 9007199254740991
      AND "expires_at" IS NOT NULL
      AND "tendered_vnd" = "amount_vnd" AND "change_vnd" = 0
      AND ("status" = 'SUCCEEDED') = ("provider_reference" IS NOT NULL)
      AND ("provider_reference" IS NULL OR "provider_reference" !~ '^[[:space:]]*$')
      AND ("late_of_payment_id" IS NULL OR "status" = 'SUCCEEDED')
      AND ("provider_payment_link_id" IS NULL) = ("checkout_url" IS NULL)
      AND ("qr_code" IS NULL) = ("checkout_url" IS NULL))
  ),
  -- Only a provider payment is ever pending (cash is created SUCCEEDED, payments_cash_succeeded).
  ADD CONSTRAINT "payments_pending_provider_only" CHECK ("status" <> 'PENDING' OR "method" = 'PAYOS');

-- At most one pending provider request per invoice (Q7 item 3); one row per provider order except a late
-- confirmation, which shares the order of the request it confirms; a provider order is credited once.
CREATE UNIQUE INDEX "payments_one_pending_key" ON "payments"("invoice_id") WHERE "status" = 'PENDING';
CREATE UNIQUE INDEX "payments_provider_order_key" ON "payments"("provider_order_code")
  WHERE "provider_order_code" IS NOT NULL AND "late_of_payment_id" IS NULL;
CREATE UNIQUE INDEX "payments_provider_succeeded_key" ON "payments"("provider_order_code")
  WHERE "provider_order_code" IS NOT NULL AND "status" = 'SUCCEEDED';
CREATE UNIQUE INDEX "payments_late_of_key" ON "payments"("late_of_payment_id") WHERE "late_of_payment_id" IS NOT NULL;

-- ------------------------------------------------------------------------------ provider tables
CREATE TABLE "payment_attempts" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "payment_id" UUID NOT NULL,
    "kind" "PaymentAttemptKind" NOT NULL,
    "outcome" "PaymentAttemptOutcome" NOT NULL,
    "provider_code" TEXT,
    "actor_user_id" UUID,
    "occurred_at" TIMESTAMPTZ(3) NOT NULL DEFAULT clock_timestamp(),

    CONSTRAINT "payment_attempts_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "payment_provider_events" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "dedupe_key" TEXT NOT NULL,
    "signature_valid" BOOLEAN NOT NULL,
    "order_code" BIGINT,
    "amount_vnd" BIGINT,
    "provider_reference" TEXT,
    "raw_payload" JSONB NOT NULL,
    "outcome" "ProviderEventOutcome" NOT NULL,
    "outcome_detail" TEXT NOT NULL,
    "payment_id" UUID,
    "received_at" TIMESTAMPTZ(3) NOT NULL DEFAULT clock_timestamp(),

    CONSTRAINT "payment_provider_events_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "payment_anomalies" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "kind" "PaymentAnomalyKind" NOT NULL,
    "status" "PaymentAnomalyStatus" NOT NULL DEFAULT 'OPEN',
    "invoice_id" UUID NOT NULL,
    "payment_id" UUID,
    "branch_id" UUID NOT NULL,
    "provider_event_id" UUID,
    "order_code" BIGINT NOT NULL,
    "provider_reference" TEXT NOT NULL,
    "expected_amount_vnd" BIGINT,
    "received_amount_vnd" BIGINT NOT NULL,
    "invoice_status" "InvoiceStatus" NOT NULL,
    "opened_at" TIMESTAMPTZ(3) NOT NULL DEFAULT clock_timestamp(),
    "reviewed_by_user_id" UUID,
    "reviewed_at" TIMESTAMPTZ(3),
    "review_note" TEXT,
    "row_version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "payment_anomalies_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "invoice_management_notes" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "invoice_id" UUID NOT NULL,
    "branch_id" UUID NOT NULL,
    "author_user_id" UUID NOT NULL,
    "note" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT clock_timestamp(),

    CONSTRAINT "invoice_management_notes_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "payment_attempts_payment_idx" ON "payment_attempts"("payment_id", "occurred_at");
CREATE UNIQUE INDEX "payment_provider_events_dedupe_key" ON "payment_provider_events"("dedupe_key");
CREATE INDEX "payment_provider_events_order_idx" ON "payment_provider_events"("order_code");
CREATE UNIQUE INDEX "payment_anomalies_order_reference_key" ON "payment_anomalies"("order_code", "provider_reference");
CREATE INDEX "payment_anomalies_branch_status_idx" ON "payment_anomalies"("branch_id", "status", "opened_at");
CREATE INDEX "payment_anomalies_invoice_idx" ON "payment_anomalies"("invoice_id");
CREATE INDEX "invoice_management_notes_invoice_idx" ON "invoice_management_notes"("invoice_id", "created_at");

ALTER TABLE "payment_attempts"
  ADD CONSTRAINT "payment_attempts_payment_id_fkey" FOREIGN KEY ("payment_id") REFERENCES "payments"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  ADD CONSTRAINT "payment_attempts_actor_user_id_fkey" FOREIGN KEY ("actor_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "payment_anomalies"
  ADD CONSTRAINT "payment_anomalies_invoice_id_fkey" FOREIGN KEY ("invoice_id") REFERENCES "invoices"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  ADD CONSTRAINT "payment_anomalies_payment_id_fkey" FOREIGN KEY ("payment_id") REFERENCES "payments"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  ADD CONSTRAINT "payment_anomalies_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  -- Deferred: the anomaly is written before the inbox row that records the same outcome (one transaction).
  ADD CONSTRAINT "payment_anomalies_provider_event_id_fkey" FOREIGN KEY ("provider_event_id") REFERENCES "payment_provider_events"("id") ON DELETE RESTRICT ON UPDATE RESTRICT DEFERRABLE INITIALLY DEFERRED,
  ADD CONSTRAINT "payment_anomalies_reviewed_by_user_id_fkey" FOREIGN KEY ("reviewed_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "invoice_management_notes"
  ADD CONSTRAINT "invoice_management_notes_invoice_id_fkey" FOREIGN KEY ("invoice_id") REFERENCES "invoices"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  ADD CONSTRAINT "invoice_management_notes_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  ADD CONSTRAINT "invoice_management_notes_author_user_id_fkey" FOREIGN KEY ("author_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

ALTER TABLE "payment_provider_events"
  ADD CONSTRAINT "payment_provider_events_authentic" CHECK ("signature_valid"),
  ADD CONSTRAINT "payment_provider_events_dedupe_nonblank" CHECK ("dedupe_key" !~ '^[[:space:]]*$');
ALTER TABLE "payment_anomalies"
  ADD CONSTRAINT "payment_anomalies_version_positive" CHECK ("row_version" > 0),
  ADD CONSTRAINT "payment_anomalies_amounts" CHECK (
    "received_amount_vnd" > 0 AND ("expected_amount_vnd" IS NULL OR "expected_amount_vnd" > 0)
  ),
  ADD CONSTRAINT "payment_anomalies_reference_nonblank" CHECK ("provider_reference" !~ '^[[:space:]]*$'),
  -- OPEN has no review; REVIEWED names who, when and a non-blank note.
  ADD CONSTRAINT "payment_anomalies_review_shape" CHECK (
    ("status" = 'OPEN' AND "reviewed_by_user_id" IS NULL AND "reviewed_at" IS NULL AND "review_note" IS NULL)
    OR ("status" = 'REVIEWED' AND "reviewed_by_user_id" IS NOT NULL AND "reviewed_at" IS NOT NULL
      AND "review_note" IS NOT NULL AND "review_note" !~ '^[[:space:]]*$')
  );
ALTER TABLE "invoice_management_notes"
  ADD CONSTRAINT "invoice_management_notes_note_nonblank" CHECK ("note" !~ '^[[:space:]]*$');

-- ------------------------------------------------------------------------------- guards

-- Payment guard, extended for provider payments. Cash behaviour is unchanged. A PayOS payment is inserted
-- PENDING (or, for a late confirmation, SUCCEEDED pointing at the expired/cancelled/failed request it
-- confirms) against an invoice that awaits payment for exactly the current balance; afterwards only
-- PENDING -> SUCCEEDED (needs a provider reference; stamps the database clock as the collection time),
-- PENDING -> EXPIRED/CANCELLED/FAILED, and the one-time attachment of the provider link details are allowed.
CREATE OR REPLACE FUNCTION lucy_guard_payment() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  target invoices%ROWTYPE;
  original payments%ROWTYPE;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.row_version <> 1 THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'A payment starts at version 1';
    END IF;
    -- FOR UPDATE serializes concurrent payments, reversals, finalization and cancellation of one
    -- invoice even if a caller forgot to lock it, so two cashiers can never jointly overpay.
    SELECT * INTO target FROM invoices WHERE id = NEW.invoice_id FOR UPDATE;
    IF target.status IS DISTINCT FROM 'PENDING_PAYMENT' THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'A payment is recorded only against a finalized invoice awaiting payment';
    END IF;
    IF NEW.branch_id IS DISTINCT FROM target.branch_id THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'A payment belongs to the branch of its invoice';
    END IF;
    -- OP-6: the recorded time is the database clock, never a client value (no backdating).
    NEW.collected_at := clock_timestamp();
    NEW.business_date := lucy_branch_local_date(NEW.branch_id, NEW.collected_at);
    IF NEW.collected_at < target.finalized_at THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'A payment cannot precede the invoice finalization';
    END IF;
    IF NEW.amount_due_vnd IS DISTINCT FROM target.total_vnd - lucy_invoice_effective_paid(target.id) THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'The recorded amount due must equal the invoice balance';
    END IF;
    IF NEW.method = 'PAYOS' THEN
      IF NEW.status = 'PENDING' THEN
        IF NEW.late_of_payment_id IS NOT NULL OR NEW.provider_reference IS NOT NULL THEN
          RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'A provider request starts pending and unconfirmed';
        END IF;
        IF NEW.expires_at <= NEW.collected_at OR NEW.expires_at > NEW.collected_at + interval '1 day' THEN
          RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'A provider request expires within one day';
        END IF;
      ELSIF NEW.status = 'SUCCEEDED' THEN
        -- Only a late confirmation is inserted succeeded; it confirms an earlier request that had ended.
        IF NEW.late_of_payment_id IS NULL THEN
          RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'A provider payment succeeds only by confirmation of its request';
        END IF;
        SELECT * INTO original FROM payments WHERE id = NEW.late_of_payment_id;
        IF original.method IS DISTINCT FROM 'PAYOS'
          OR original.status NOT IN ('EXPIRED', 'CANCELLED', 'FAILED')
          OR original.invoice_id IS DISTINCT FROM NEW.invoice_id
          OR original.late_of_payment_id IS NOT NULL
          OR original.provider_order_code IS DISTINCT FROM NEW.provider_order_code THEN
          RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'A late confirmation refers to the ended request of the same provider order';
        END IF;
      ELSE
        RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'A provider payment is created pending';
      END IF;
    END IF;
  ELSE
    IF OLD.status <> 'PENDING' THEN
      -- Terminal payments are history: nothing ever changes.
      IF NEW IS DISTINCT FROM OLD THEN
        RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'A recorded payment cannot be rewritten';
      END IF;
      RETURN NEW;
    END IF;
    -- OLD is PENDING (only a provider payment can be). Identity, amounts, order and expiry never change.
    IF (NEW.id, NEW.invoice_id, NEW.branch_id, NEW.method, NEW.amount_due_vnd, NEW.amount_vnd,
        NEW.tendered_vnd, NEW.change_vnd, NEW.collected_by_user_id, NEW.idempotency_key, NEW.created_at,
        NEW.provider_order_code, NEW.expires_at, NEW.late_of_payment_id)
      IS DISTINCT FROM (OLD.id, OLD.invoice_id, OLD.branch_id, OLD.method, OLD.amount_due_vnd,
        OLD.amount_vnd, OLD.tendered_vnd, OLD.change_vnd, OLD.collected_by_user_id, OLD.idempotency_key,
        OLD.created_at, OLD.provider_order_code, OLD.expires_at, OLD.late_of_payment_id)
      OR (NEW IS DISTINCT FROM OLD AND NEW.row_version <> OLD.row_version + 1) THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'A recorded payment cannot be rewritten';
    END IF;
    -- The provider link details are attached once (NULL -> value) and never changed afterwards.
    IF (OLD.provider_payment_link_id IS NOT NULL
        AND NEW.provider_payment_link_id IS DISTINCT FROM OLD.provider_payment_link_id)
      OR (OLD.checkout_url IS NOT NULL AND NEW.checkout_url IS DISTINCT FROM OLD.checkout_url)
      OR (OLD.qr_code IS NOT NULL AND NEW.qr_code IS DISTINCT FROM OLD.qr_code) THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'The provider link details are attached once';
    END IF;
    IF NEW.status = 'SUCCEEDED' THEN
      -- Confirmation: the invoice must still await payment; the collection time is the database clock.
      SELECT * INTO target FROM invoices WHERE id = NEW.invoice_id FOR UPDATE;
      IF target.status IS DISTINCT FROM 'PENDING_PAYMENT' THEN
        RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'A provider payment is confirmed only against a finalized invoice awaiting payment';
      END IF;
      NEW.collected_at := clock_timestamp();
      NEW.business_date := lucy_branch_local_date(NEW.branch_id, NEW.collected_at);
      IF NEW.collected_at < target.finalized_at THEN
        RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'A payment cannot precede the invoice finalization';
      END IF;
    ELSIF (NEW.collected_at, NEW.business_date) IS DISTINCT FROM (OLD.collected_at, OLD.business_date) THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'A recorded payment cannot be rewritten';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

-- An invoice with a pending provider request is not cancelled (the request is cancelled or ends first).
CREATE FUNCTION lucy_guard_invoice_pending_provider() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.status = 'CANCELLED' AND OLD.status IS DISTINCT FROM 'CANCELLED'
    AND EXISTS (SELECT 1 FROM payments WHERE invoice_id = OLD.id AND status = 'PENDING') THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'An invoice with a pending provider request cannot be cancelled';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "invoices_pending_provider_guard" BEFORE UPDATE ON "invoices"
FOR EACH ROW EXECUTE FUNCTION lucy_guard_invoice_pending_provider();

-- An anomaly is reviewed once: OPEN -> REVIEWED changes only the review facts and the version.
CREATE FUNCTION lucy_guard_payment_anomaly() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status <> 'OPEN' OR NEW.status <> 'REVIEWED'
    OR (NEW.id, NEW.kind, NEW.invoice_id, NEW.payment_id, NEW.branch_id, NEW.provider_event_id, NEW.order_code,
        NEW.provider_reference, NEW.expected_amount_vnd, NEW.received_amount_vnd, NEW.invoice_status, NEW.opened_at)
      IS DISTINCT FROM (OLD.id, OLD.kind, OLD.invoice_id, OLD.payment_id, OLD.branch_id, OLD.provider_event_id,
        OLD.order_code, OLD.provider_reference, OLD.expected_amount_vnd, OLD.received_amount_vnd,
        OLD.invoice_status, OLD.opened_at)
    OR NEW.row_version <> OLD.row_version + 1 THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'A payment anomaly is only reviewed once; its facts never change';
  END IF;
  NEW.reviewed_at := clock_timestamp();
  RETURN NEW;
END;
$$;
CREATE TRIGGER "payment_anomalies_guard" BEFORE UPDATE ON "payment_anomalies"
FOR EACH ROW EXECUTE FUNCTION lucy_guard_payment_anomaly();

-- A management note belongs to the invoice's branch and exists only for an invoice that took a confirmed
-- PayOS payment (Q7 item 8); the time is the database clock.
CREATE FUNCTION lucy_guard_invoice_management_note() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  target invoices%ROWTYPE;
BEGIN
  SELECT * INTO target FROM invoices WHERE id = NEW.invoice_id;
  IF NEW.branch_id IS DISTINCT FROM target.branch_id THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'A management note belongs to the branch of its invoice';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM payments WHERE invoice_id = NEW.invoice_id AND method = 'PAYOS' AND status = 'SUCCEEDED') THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'A management note exists only for an invoice settled by a confirmed PayOS payment';
  END IF;
  NEW.created_at := clock_timestamp();
  RETURN NEW;
END;
$$;
CREATE TRIGGER "invoice_management_notes_guard" BEFORE INSERT ON "invoice_management_notes"
FOR EACH ROW EXECUTE FUNCTION lucy_guard_invoice_management_note();

-- ------------------------------------------------------------------- append-only history
CREATE TRIGGER "payment_attempts_append_only" BEFORE UPDATE OR DELETE ON "payment_attempts"
FOR EACH ROW EXECUTE FUNCTION lucy_reject_permanent_history_mutation();
CREATE TRIGGER "payment_attempts_no_truncate" BEFORE TRUNCATE ON "payment_attempts"
FOR EACH STATEMENT EXECUTE FUNCTION lucy_reject_permanent_history_mutation();
CREATE TRIGGER "payment_provider_events_append_only" BEFORE UPDATE OR DELETE ON "payment_provider_events"
FOR EACH ROW EXECUTE FUNCTION lucy_reject_permanent_history_mutation();
CREATE TRIGGER "payment_provider_events_no_truncate" BEFORE TRUNCATE ON "payment_provider_events"
FOR EACH STATEMENT EXECUTE FUNCTION lucy_reject_permanent_history_mutation();
CREATE TRIGGER "payment_anomalies_no_delete" BEFORE DELETE ON "payment_anomalies"
FOR EACH ROW EXECUTE FUNCTION lucy_reject_financial_delete();
CREATE TRIGGER "payment_anomalies_no_truncate" BEFORE TRUNCATE ON "payment_anomalies"
FOR EACH STATEMENT EXECUTE FUNCTION lucy_reject_permanent_history_mutation();
CREATE TRIGGER "invoice_management_notes_append_only" BEFORE UPDATE OR DELETE ON "invoice_management_notes"
FOR EACH ROW EXECUTE FUNCTION lucy_reject_permanent_history_mutation();
CREATE TRIGGER "invoice_management_notes_no_truncate" BEFORE TRUNCATE ON "invoice_management_notes"
FOR EACH STATEMENT EXECUTE FUNCTION lucy_reject_permanent_history_mutation();

-- Function hardening (the Phase 1 convention): a fixed search_path and no PUBLIC execute, also for the
-- replaced payment guard (CREATE OR REPLACE resets the function settings).
DO $$
DECLARE
  migration_schema text := current_schema();
  function_name text;
BEGIN
  FOREACH function_name IN ARRAY ARRAY[
    'lucy_guard_payment', 'lucy_guard_invoice_pending_provider', 'lucy_guard_payment_anomaly',
    'lucy_guard_invoice_management_note'
  ] LOOP
    EXECUTE format('ALTER FUNCTION %I.%I() SET search_path TO pg_catalog, %I, pg_temp',
      migration_schema, function_name, migration_schema);
    EXECUTE format('REVOKE ALL ON FUNCTION %I.%I() FROM PUBLIC', migration_schema, function_name);
  END LOOP;
END;
$$;
