-- Phase 4 Step 4, migration 4 of 5: the Invoice, Invoice line and Payment foundation
-- (design 4.1, 4.2, 4.5, 4.9, 5, 6, 9 and OP-2 / OP-6 / OP-7).
--
-- DATABASE FOUNDATION ONLY. Nothing here creates an invoice, prices a line, finalizes, cancels,
-- collects or reverses anything: those commands are Steps 5 to 8. The guards below make the
-- approved rules impossible to violate once those commands exist:
--   * ONE Visit -> at most ONE non-CANCELLED invoice (partial unique index);
--   * an invoice exists only for a COMPLETED visit and carries every DONE service line of it once;
--   * lines are immutable snapshots of the visit lines; only a DRAFT may be priced;
--   * a finalized invoice keeps its payer, lines, prices and amounts; a CANCELLED invoice is final;
--   * integer VND everywhere, no negative amount, no overpayment, no zero-VND payment;
--   * PAID <=> effective payments cover the receivable, INCLUDING a receivable of exactly 0 with no
--     Payment row (OP-2: a zero-balance invoice is settled at finalization and never gets a fake
--     payment), and PAID -> CANCELLED is possible only for such a zero-balance invoice with no
--     payment row at all (OP-7);
--   * payments and corrections are append-only records; collection time is the database clock.
-- Existing completed visits are NOT given invoices (no backfill); every table starts empty.

CREATE TYPE "InvoiceStatus" AS ENUM ('DRAFT', 'PENDING_PAYMENT', 'PAID', 'CANCELLED');
CREATE TYPE "InvoiceLineKind" AS ENUM ('SERVICE');
CREATE TYPE "PaymentMethod" AS ENUM ('CASH');
CREATE TYPE "PaymentStatus" AS ENUM ('PENDING', 'SUCCEEDED', 'FAILED', 'EXPIRED', 'CANCELLED');
CREATE TYPE "PaymentCorrectionKind" AS ENUM ('REVERSAL');

-- ------------------------------------------------------------------------------------ tables

CREATE TABLE "invoices" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "code" TEXT NOT NULL,
    "branch_id" UUID NOT NULL,
    "visit_id" UUID NOT NULL,
    "status" "InvoiceStatus" NOT NULL DEFAULT 'DRAFT',
    "payer_user_id" UUID,
    "business_date" DATE NOT NULL,
    "calculation_version" INTEGER NOT NULL,
    "subtotal_vnd" BIGINT NOT NULL DEFAULT 0,
    "discount_total_vnd" BIGINT NOT NULL DEFAULT 0,
    "total_vnd" BIGINT NOT NULL DEFAULT 0,
    "finalized_at" TIMESTAMPTZ(3),
    "finalized_by_user_id" UUID,
    "cancelled_at" TIMESTAMPTZ(3),
    "cancelled_by_user_id" UUID,
    "cancelled_from_status" "InvoiceStatus",
    "cancel_reason" TEXT,
    "paid_at" TIMESTAMPTZ(3),
    "paid_seq" INTEGER NOT NULL DEFAULT 0,
    "created_by_user_id" UUID NOT NULL,
    "row_version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "invoices_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "invoice_lines" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "invoice_id" UUID NOT NULL,
    "sequence" SMALLINT NOT NULL,
    "kind" "InvoiceLineKind" NOT NULL DEFAULT 'SERVICE',
    "item_code" TEXT NOT NULL,
    "name_vi" TEXT NOT NULL,
    "name_en" TEXT NOT NULL,
    "quantity" INTEGER,
    "unit_price_vnd" BIGINT,
    "gross_vnd" BIGINT,
    "price_set_by_user_id" UUID,
    "price_set_at" TIMESTAMPTZ(3),
    "row_version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "invoice_lines_pkey" PRIMARY KEY ("id")
);

-- The SERVICE detail of a line (1:1). It copies the visit-line snapshot, including the per-service
-- quantity limit that was snapshotted when the visit line was established (OP-1).
CREATE TABLE "invoice_line_services" (
    "invoice_line_id" UUID NOT NULL,
    "invoice_id" UUID NOT NULL,
    "visit_service_line_id" UUID NOT NULL,
    "service_id" UUID NOT NULL,
    "participant_id" UUID NOT NULL,
    "employee_user_id" UUID NOT NULL,
    "pricing_unit" "ServicePricingUnit" NOT NULL,
    "catalog_price_min_vnd" BIGINT NOT NULL,
    "catalog_price_max_vnd" BIGINT NOT NULL,
    "quantity_limit" INTEGER NOT NULL,
    "added_on_behalf" BOOLEAN NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "invoice_line_services_pkey" PRIMARY KEY ("invoice_line_id")
);

-- Cash shape (design 4.5). `collected_at` and `business_date` defaults are placeholders: the guard
-- below always overwrites them with the database clock, so no client value can backdate a payment.
CREATE TABLE "payments" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "invoice_id" UUID NOT NULL,
    "branch_id" UUID NOT NULL,
    "method" "PaymentMethod" NOT NULL,
    "status" "PaymentStatus" NOT NULL,
    "amount_due_vnd" BIGINT NOT NULL,
    "amount_vnd" BIGINT NOT NULL,
    "tendered_vnd" BIGINT NOT NULL,
    "change_vnd" BIGINT NOT NULL,
    "collected_by_user_id" UUID NOT NULL,
    "collected_at" TIMESTAMPTZ(3) NOT NULL DEFAULT clock_timestamp(),
    "business_date" DATE NOT NULL DEFAULT CURRENT_DATE,
    "idempotency_key" UUID NOT NULL,
    "row_version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payments_pkey" PRIMARY KEY ("id")
);

-- Append-only correction records; the original payment row is never edited (design 4.5, Q6).
CREATE TABLE "payment_corrections" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "payment_id" UUID NOT NULL,
    "kind" "PaymentCorrectionKind" NOT NULL DEFAULT 'REVERSAL',
    "reason" TEXT NOT NULL,
    "actor_user_id" UUID NOT NULL,
    "occurred_at" TIMESTAMPTZ(3) NOT NULL DEFAULT clock_timestamp(),

    CONSTRAINT "payment_corrections_pkey" PRIMARY KEY ("id")
);

-- ---------------------------------------------------------------------- keys and indexes

-- Invoice identity: the internal code (Q10) and ONE active invoice per visit (Q2). "Active" is any
-- status except CANCELLED, so cancelled history stays and a corrected invoice can be re-created.
CREATE UNIQUE INDEX "invoices_code_key" ON "invoices"("code");
CREATE UNIQUE INDEX "invoices_visit_active_key" ON "invoices"("visit_id") WHERE "status" <> 'CANCELLED';
CREATE INDEX "invoices_branch_date_idx" ON "invoices"("branch_id", "business_date", "status");
CREATE INDEX "invoices_payer_idx" ON "invoices"("payer_user_id", "created_at");

CREATE UNIQUE INDEX "invoice_lines_invoice_sequence_key" ON "invoice_lines"("invoice_id", "sequence");
CREATE UNIQUE INDEX "invoice_lines_invoice_id_id_key" ON "invoice_lines"("invoice_id", "id");

CREATE UNIQUE INDEX "invoice_line_services_invoice_visit_line_key" ON "invoice_line_services"("invoice_id", "visit_service_line_id");
CREATE INDEX "invoice_line_services_service_idx" ON "invoice_line_services"("service_id");
CREATE INDEX "invoice_line_services_employee_idx" ON "invoice_line_services"("employee_user_id");

CREATE UNIQUE INDEX "payments_collector_idempotency_key" ON "payments"("collected_by_user_id", "idempotency_key");
CREATE INDEX "payments_invoice_idx" ON "payments"("invoice_id");

CREATE UNIQUE INDEX "payment_corrections_payment_key" ON "payment_corrections"("payment_id");

-- ------------------------------------------------------------------------ foreign keys

ALTER TABLE "invoices" ADD CONSTRAINT "invoices_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_visit_id_fkey" FOREIGN KEY ("visit_id") REFERENCES "visits"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_payer_user_id_fkey" FOREIGN KEY ("payer_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_finalized_by_user_id_fkey" FOREIGN KEY ("finalized_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_cancelled_by_user_id_fkey" FOREIGN KEY ("cancelled_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

ALTER TABLE "invoice_lines" ADD CONSTRAINT "invoice_lines_invoice_id_fkey" FOREIGN KEY ("invoice_id") REFERENCES "invoices"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "invoice_lines" ADD CONSTRAINT "invoice_lines_price_set_by_user_id_fkey" FOREIGN KEY ("price_set_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

ALTER TABLE "invoice_line_services" ADD CONSTRAINT "invoice_line_services_line_fkey" FOREIGN KEY ("invoice_id", "invoice_line_id") REFERENCES "invoice_lines"("invoice_id", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "invoice_line_services" ADD CONSTRAINT "invoice_line_services_visit_service_line_id_fkey" FOREIGN KEY ("visit_service_line_id") REFERENCES "visit_service_lines"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "invoice_line_services" ADD CONSTRAINT "invoice_line_services_service_id_fkey" FOREIGN KEY ("service_id") REFERENCES "services"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "invoice_line_services" ADD CONSTRAINT "invoice_line_services_participant_id_fkey" FOREIGN KEY ("participant_id") REFERENCES "visit_participants"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "invoice_line_services" ADD CONSTRAINT "invoice_line_services_employee_user_id_fkey" FOREIGN KEY ("employee_user_id") REFERENCES "employee_profiles"("user_id") ON DELETE RESTRICT ON UPDATE RESTRICT;

ALTER TABLE "payments" ADD CONSTRAINT "payments_invoice_id_fkey" FOREIGN KEY ("invoice_id") REFERENCES "invoices"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "payments" ADD CONSTRAINT "payments_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "payments" ADD CONSTRAINT "payments_collected_by_user_id_fkey" FOREIGN KEY ("collected_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

ALTER TABLE "payment_corrections" ADD CONSTRAINT "payment_corrections_payment_id_fkey" FOREIGN KEY ("payment_id") REFERENCES "payments"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "payment_corrections" ADD CONSTRAINT "payment_corrections_actor_user_id_fkey" FOREIGN KEY ("actor_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- ------------------------------------------------------------------------ CHECK constraints

ALTER TABLE "invoices"
  -- Q10: INV-YYMMDD-XXXXXX, the date being the branch-local business date, the suffix the BK-
  -- code alphabet (no 0, 1, I, O). This is an internal receipt code, not an official e-invoice number.
  ADD CONSTRAINT "invoices_code_format" CHECK (
    "code" ~ '^INV-[0-9]{6}-[A-HJ-NP-Z2-9]{6}$'
    AND substring("code" FROM 5 FOR 6) = to_char("business_date", 'YYMMDD')
  ),
  ADD CONSTRAINT "invoices_business_date_finite" CHECK (isfinite("business_date")),
  ADD CONSTRAINT "invoices_version_positive" CHECK ("row_version" > 0),
  ADD CONSTRAINT "invoices_calculation_version" CHECK ("calculation_version" >= 1),
  -- Q3: integer VND; the receivable is exactly subtotal minus the benefit and may be 0 (OP-2).
  ADD CONSTRAINT "invoices_money" CHECK (
    "subtotal_vnd" >= 0 AND "discount_total_vnd" >= 0 AND "total_vnd" >= 0
    AND "discount_total_vnd" <= "subtotal_vnd"
    AND "total_vnd" = "subtotal_vnd" - "discount_total_vnd"
  ),
  ADD CONSTRAINT "invoices_paid_seq_nonnegative" CHECK ("paid_seq" >= 0),
  ADD CONSTRAINT "invoices_cancel_reason_nonblank" CHECK ("cancel_reason" IS NULL OR "cancel_reason" !~ '^[[:space:]]*$'),
  -- One stored status: exactly the facts of the current status are set (section 6 of the design).
  -- A zero-balance PAID invoice has finalized_at = paid_at and no Payment row; an OP-7 cancellation
  -- leaves paid_at / paid_seq as historical facts and records cancelled_from_status = PAID.
  ADD CONSTRAINT "invoices_status_facts" CHECK (
    ("status" = 'DRAFT'
      AND "finalized_at" IS NULL AND "finalized_by_user_id" IS NULL
      AND "cancelled_at" IS NULL AND "cancelled_by_user_id" IS NULL
      AND "cancelled_from_status" IS NULL AND "cancel_reason" IS NULL
      AND "paid_at" IS NULL AND "paid_seq" = 0)
    OR ("status" = 'PENDING_PAYMENT'
      AND "finalized_at" IS NOT NULL AND "finalized_by_user_id" IS NOT NULL
      AND "cancelled_at" IS NULL AND "cancelled_by_user_id" IS NULL
      AND "cancelled_from_status" IS NULL AND "cancel_reason" IS NULL
      AND "paid_at" IS NULL AND "total_vnd" > 0)
    OR ("status" = 'PAID'
      AND "finalized_at" IS NOT NULL AND "finalized_by_user_id" IS NOT NULL
      AND "cancelled_at" IS NULL AND "cancelled_by_user_id" IS NULL
      AND "cancelled_from_status" IS NULL AND "cancel_reason" IS NULL
      AND "paid_at" IS NOT NULL AND "paid_seq" >= 1)
    OR ("status" = 'CANCELLED'
      AND "cancelled_at" IS NOT NULL AND "cancelled_by_user_id" IS NOT NULL
      AND "cancel_reason" IS NOT NULL
      AND "cancelled_from_status" IS NOT NULL
      AND "cancelled_from_status" IN ('DRAFT', 'PENDING_PAYMENT', 'PAID')
      AND (("cancelled_from_status" = 'DRAFT') = ("finalized_at" IS NULL))
      AND (("finalized_at" IS NULL) = ("finalized_by_user_id" IS NULL))
      AND ("cancelled_from_status" <> 'DRAFT' OR ("paid_at" IS NULL AND "paid_seq" = 0))
      AND ("cancelled_from_status" <> 'PENDING_PAYMENT' OR "paid_at" IS NULL)
      AND ("cancelled_from_status" <> 'PAID'
        OR ("total_vnd" = 0 AND "paid_seq" = 1 AND "paid_at" IS NOT NULL)))
  ),
  ADD CONSTRAINT "invoices_time_order" CHECK (
    ("finalized_at" IS NULL OR "finalized_at" >= "created_at")
    AND ("cancelled_at" IS NULL OR "cancelled_at" >= "created_at")
    AND ("finalized_at" IS NULL OR "cancelled_at" IS NULL OR "cancelled_at" >= "finalized_at")
    AND ("paid_at" IS NULL OR "finalized_at" IS NULL OR "paid_at" >= "finalized_at")
  );

ALTER TABLE "invoice_lines"
  ADD CONSTRAINT "invoice_lines_sequence_positive" CHECK ("sequence" >= 1),
  ADD CONSTRAINT "invoice_lines_text_nonblank" CHECK (
    "item_code" !~ '^[[:space:]]*$' AND "name_vi" !~ '^[[:space:]]*$' AND "name_en" !~ '^[[:space:]]*$'
  ),
  ADD CONSTRAINT "invoice_lines_version_positive" CHECK ("row_version" > 0),
  -- Quantity is a positive integer; price a non-negative integer VND; the gross is exactly
  -- quantity x price once both are set and NULL until then (a DRAFT may be unpriced).
  ADD CONSTRAINT "invoice_lines_quantity_positive" CHECK ("quantity" IS NULL OR "quantity" >= 1),
  ADD CONSTRAINT "invoice_lines_price_nonnegative" CHECK ("unit_price_vnd" IS NULL OR "unit_price_vnd" >= 0),
  ADD CONSTRAINT "invoice_lines_gross" CHECK (
    ("quantity" IS NOT NULL AND "unit_price_vnd" IS NOT NULL AND "gross_vnd" IS NOT NULL
      AND "gross_vnd" = "quantity"::bigint * "unit_price_vnd")
    OR ("gross_vnd" IS NULL AND ("quantity" IS NULL OR "unit_price_vnd" IS NULL))
  ),
  ADD CONSTRAINT "invoice_lines_price_facts" CHECK (("price_set_by_user_id" IS NULL) = ("price_set_at" IS NULL));

ALTER TABLE "invoice_line_services"
  ADD CONSTRAINT "invoice_line_services_range" CHECK (
    "catalog_price_min_vnd" >= 0 AND "catalog_price_min_vnd" <= "catalog_price_max_vnd"
  ),
  -- Same rule as the catalog and the visit line: PER_SERVICE is exactly one unit.
  ADD CONSTRAINT "invoice_line_services_quantity_limit" CHECK (
    "quantity_limit" >= 1 AND ("pricing_unit" <> 'PER_SERVICE' OR "quantity_limit" = 1)
  );

ALTER TABLE "payments"
  ADD CONSTRAINT "payments_version_positive" CHECK ("row_version" > 0),
  -- No zero-VND payment can exist: a zero-balance invoice has no Payment row (OP-2). The credited
  -- amount never exceeds the balance due when it was recorded; change is exactly tendered - credited.
  ADD CONSTRAINT "payments_amounts" CHECK (
    "amount_vnd" > 0 AND "amount_due_vnd" >= "amount_vnd"
    AND "tendered_vnd" >= "amount_vnd" AND "change_vnd" = "tendered_vnd" - "amount_vnd"
  ),
  -- Cash rows are created directly SUCCEEDED (design 4.5); Step 8 relaxes this per method.
  ADD CONSTRAINT "payments_cash_succeeded" CHECK ("method" <> 'CASH' OR "status" = 'SUCCEEDED');

ALTER TABLE "payment_corrections"
  ADD CONSTRAINT "payment_corrections_reason_nonblank" CHECK ("reason" !~ '^[[:space:]]*$');

-- ------------------------------------------------------------------------------- functions

-- The credited amount that still counts: SUCCEEDED payments without a correction record.
CREATE FUNCTION lucy_invoice_effective_paid(invoice uuid) RETURNS bigint
LANGUAGE sql STABLE AS $$
  SELECT COALESCE(SUM(p.amount_vnd), 0)::bigint FROM payments p
  WHERE p.invoice_id = invoice AND p.status = 'SUCCEEDED'
    AND NOT EXISTS (SELECT 1 FROM payment_corrections c WHERE c.payment_id = p.id)
$$;

CREATE FUNCTION lucy_reject_financial_delete() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Financial records are never deleted';
END;
$$;

-- Invoice lifecycle guard (design 5.1, 6, 9 and OP-2 / OP-7).
CREATE FUNCTION lucy_guard_invoice() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  visit_status "VisitStatus";
  visit_branch uuid;
  payer_kind "UserKind";
  line_count integer;
  unpriced integer;
  line_total bigint;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'DRAFT' OR NEW.row_version <> 1 OR NEW.paid_seq <> 0 THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'An invoice starts as a DRAFT at version 1';
    END IF;
    -- FOR SHARE serializes with any change of the visit (a completed visit is immutable).
    SELECT status, branch_id INTO visit_status, visit_branch FROM visits WHERE id = NEW.visit_id FOR SHARE;
    IF visit_status IS DISTINCT FROM 'COMPLETED' THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'An invoice is created only for a completed visit';
    END IF;
    IF visit_branch IS DISTINCT FROM NEW.branch_id THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'An invoice belongs to the branch of its visit';
    END IF;
    IF NEW.business_date IS DISTINCT FROM lucy_branch_local_date(NEW.branch_id, NEW.created_at) THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Invoice business date must be the branch-local date of its creation';
    END IF;
  ELSE
    IF (NEW.id, NEW.code, NEW.branch_id, NEW.visit_id, NEW.business_date, NEW.created_by_user_id, NEW.created_at)
      IS DISTINCT FROM (OLD.id, OLD.code, OLD.branch_id, OLD.visit_id, OLD.business_date,
        OLD.created_by_user_id, OLD.created_at) THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Invoice identity cannot be rewritten';
    END IF;
    IF OLD.status = 'CANCELLED' AND NEW IS DISTINCT FROM OLD THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'A cancelled invoice is final';
    END IF;
    IF NEW IS DISTINCT FROM OLD AND NEW.row_version <> OLD.row_version + 1 THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Invoice changes bump the version by one';
    END IF;
    IF NEW.status <> OLD.status AND NOT (
      (OLD.status = 'DRAFT' AND NEW.status IN ('PENDING_PAYMENT', 'PAID', 'CANCELLED'))
      OR (OLD.status = 'PENDING_PAYMENT' AND NEW.status IN ('PAID', 'CANCELLED'))
      OR (OLD.status = 'PAID' AND NEW.status IN ('PENDING_PAYMENT', 'CANCELLED'))) THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Illegal invoice status transition';
    END IF;
    -- Once finalized, the payer, the calculation result and the finalization facts are frozen.
    IF OLD.status <> 'DRAFT'
      AND (NEW.payer_user_id, NEW.calculation_version, NEW.subtotal_vnd, NEW.discount_total_vnd,
           NEW.total_vnd, NEW.finalized_at, NEW.finalized_by_user_id)
        IS DISTINCT FROM (OLD.payer_user_id, OLD.calculation_version, OLD.subtotal_vnd,
           OLD.discount_total_vnd, OLD.total_vnd, OLD.finalized_at, OLD.finalized_by_user_id) THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'A finalized invoice keeps its payer, amounts and finalization facts';
    END IF;
    -- paid_seq counts paid episodes: +1 exactly when the invoice becomes PAID, otherwise unchanged.
    IF NEW.paid_seq IS DISTINCT FROM OLD.paid_seq
        + (CASE WHEN NEW.status = 'PAID' AND OLD.status <> 'PAID' THEN 1 ELSE 0 END) THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'The paid episode counter increments only when the invoice becomes paid';
    END IF;
    IF (OLD.status = 'PAID' AND NEW.status IN ('PAID', 'CANCELLED'))
      AND NEW.paid_at IS DISTINCT FROM OLD.paid_at THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'The paid time is a historical fact and is kept';
    END IF;
    IF NEW.status = 'CANCELLED' THEN
      IF NEW.cancelled_from_status IS DISTINCT FROM OLD.status THEN
        RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'A cancellation records the status it left';
      END IF;
      -- OP-7: a PAID invoice is cancellable only when it is a zero-balance transaction and no
      -- Payment row exists at all. Any payment (cash, provider, split; effective or reversed)
      -- follows the Q6 correction rules instead: reverse first, then cancel while PENDING_PAYMENT.
      IF OLD.status = 'PAID' AND (NEW.total_vnd <> 0
        OR EXISTS (SELECT 1 FROM payments WHERE invoice_id = OLD.id)) THEN
        RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'A paid invoice can be cancelled only as a zero-balance correction with no payment';
      END IF;
    END IF;
    -- Finalization: every line is priced with a quantity and the subtotal is the sum of the lines.
    IF OLD.status = 'DRAFT' AND NEW.status IN ('PENDING_PAYMENT', 'PAID') THEN
      SELECT count(*), count(*) FILTER (WHERE quantity IS NULL OR unit_price_vnd IS NULL),
        COALESCE(sum(gross_vnd), 0)
        INTO line_count, unpriced, line_total FROM invoice_lines WHERE invoice_id = OLD.id;
      IF line_count = 0 OR unpriced > 0 THEN
        RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Finalization needs every line priced with a quantity';
      END IF;
      IF NEW.subtotal_vnd <> line_total THEN
        RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'The finalized subtotal must be the sum of its lines';
      END IF;
      -- OP-2: only a receivable of exactly 0 is settled directly (paid_at = finalized_at); anything
      -- else waits for payments.
      IF NEW.status = 'PAID' AND (NEW.total_vnd <> 0 OR NEW.paid_at IS DISTINCT FROM NEW.finalized_at) THEN
        RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Only a zero-balance invoice is settled directly at finalization';
      END IF;
    END IF;
  END IF;
  IF NEW.payer_user_id IS NOT NULL
    AND (TG_OP = 'INSERT' OR NEW.payer_user_id IS DISTINCT FROM OLD.payer_user_id) THEN
    SELECT kind INTO payer_kind FROM users WHERE id = NEW.payer_user_id;
    IF payer_kind IS DISTINCT FROM 'CUSTOMER' THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'An invoice payer is a customer account';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE FUNCTION lucy_guard_invoice_line() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  invoice_status "InvoiceStatus";
BEGIN
  -- FOR SHARE serializes with the invoice's finalization or cancellation.
  SELECT status INTO invoice_status FROM invoices WHERE id = NEW.invoice_id FOR SHARE;
  IF invoice_status IS DISTINCT FROM 'DRAFT' THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Invoice lines are created and priced only while the invoice is a draft';
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.row_version <> 1 THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'An invoice line starts at version 1';
    END IF;
  ELSE
    IF (NEW.id, NEW.invoice_id, NEW.sequence, NEW.kind, NEW.item_code, NEW.name_vi, NEW.name_en, NEW.created_at)
      IS DISTINCT FROM (OLD.id, OLD.invoice_id, OLD.sequence, OLD.kind, OLD.item_code, OLD.name_vi,
        OLD.name_en, OLD.created_at) THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Invoice line identity and snapshot cannot be rewritten';
    END IF;
    IF NEW IS DISTINCT FROM OLD AND NEW.row_version <> OLD.row_version + 1 THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Invoice line changes bump the version by one';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE FUNCTION lucy_guard_invoice_line_service() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  invoice_status "InvoiceStatus";
  invoice_visit uuid;
  line invoice_lines%ROWTYPE;
  visit_line visit_service_lines%ROWTYPE;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Invoice service details are recorded once';
  END IF;
  SELECT status, visit_id INTO invoice_status, invoice_visit FROM invoices WHERE id = NEW.invoice_id FOR SHARE;
  IF invoice_status IS DISTINCT FROM 'DRAFT' THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Invoice service details are created only while the invoice is a draft';
  END IF;
  SELECT * INTO line FROM invoice_lines WHERE id = NEW.invoice_line_id;
  IF line.kind IS DISTINCT FROM 'SERVICE' THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'A service detail belongs to a SERVICE line';
  END IF;
  SELECT * INTO visit_line FROM visit_service_lines WHERE id = NEW.visit_service_line_id;
  IF visit_line.status IS DISTINCT FROM 'DONE' OR visit_line.visit_id IS DISTINCT FROM invoice_visit THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'An invoice line invoices a performed service of its own visit';
  END IF;
  -- Snapshot consistency: the invoice copies the visit-line snapshot exactly (never the live catalog).
  IF (NEW.service_id, NEW.participant_id, NEW.employee_user_id, NEW.pricing_unit,
      NEW.catalog_price_min_vnd, NEW.catalog_price_max_vnd, NEW.quantity_limit, NEW.added_on_behalf)
    IS DISTINCT FROM (visit_line.service_id, visit_line.participant_id, visit_line.employee_user_id,
      visit_line.catalog_pricing_unit, visit_line.catalog_price_min_vnd, visit_line.catalog_price_max_vnd,
      visit_line.max_quantity_snapshot, visit_line.added_on_behalf)
    OR (line.item_code, line.name_vi, line.name_en)
      IS DISTINCT FROM (visit_line.service_code, visit_line.service_name_vi, visit_line.service_name_en) THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'The invoice line must copy the visit line snapshot';
  END IF;
  RETURN NEW;
END;
$$;

-- Payment guard: cash is recorded against a finalized unpaid invoice, at the invoice's branch, for
-- exactly the invoice balance at that moment, with the database clock as the collection time.
CREATE FUNCTION lucy_guard_payment() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  target invoices%ROWTYPE;
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
  ELSE
    -- Only a pending payment reaches a terminal status; no amount, tender, collector, time or link ever changes.
    IF (NEW.id, NEW.invoice_id, NEW.branch_id, NEW.method, NEW.amount_due_vnd, NEW.amount_vnd,
        NEW.tendered_vnd, NEW.change_vnd, NEW.collected_by_user_id, NEW.collected_at, NEW.business_date,
        NEW.idempotency_key, NEW.created_at)
      IS DISTINCT FROM (OLD.id, OLD.invoice_id, OLD.branch_id, OLD.method, OLD.amount_due_vnd,
        OLD.amount_vnd, OLD.tendered_vnd, OLD.change_vnd, OLD.collected_by_user_id, OLD.collected_at,
        OLD.business_date, OLD.idempotency_key, OLD.created_at)
      OR (OLD.status <> 'PENDING' AND NEW IS DISTINCT FROM OLD)
      OR (NEW IS DISTINCT FROM OLD AND NEW.row_version <> OLD.row_version + 1) THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'A recorded payment cannot be rewritten';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

-- Corrections: a cash payment of an invoice that is still PENDING_PAYMENT or PAID, reversed once,
-- with the database clock as the reversal time. A provider-confirmed payment is never reversed (Q6).
CREATE FUNCTION lucy_guard_payment_correction() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  target payments%ROWTYPE;
  owner_invoice invoices%ROWTYPE;
BEGIN
  SELECT * INTO target FROM payments WHERE id = NEW.payment_id;
  SELECT * INTO owner_invoice FROM invoices WHERE id = target.invoice_id FOR UPDATE;
  IF target.method IS DISTINCT FROM 'CASH' THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Only a cash payment can be reversed';
  END IF;
  IF target.status IS DISTINCT FROM 'SUCCEEDED' THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Only a succeeded payment can be reversed';
  END IF;
  IF owner_invoice.status NOT IN ('PENDING_PAYMENT', 'PAID') THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'A payment is reversed while its invoice is awaiting payment or paid';
  END IF;
  NEW.occurred_at := clock_timestamp();
  RETURN NEW;
END;
$$;

-- Commit-time integrity of one invoice (design 4.2, 9): a deferred constraint trigger on every table
-- that can change the answer, so intermediate states inside a transaction are allowed but no
-- inconsistent invoice can be committed.
CREATE FUNCTION lucy_check_invoice_integrity() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  invoice_id_value uuid;
  target invoices%ROWTYPE;
  line_count integer;
  detail_count integer;
  done_count integer;
  unpriced integer;
  line_total bigint;
  effective bigint;
BEGIN
  IF TG_TABLE_NAME = 'invoices' THEN
    invoice_id_value := NEW.id;
  ELSIF TG_TABLE_NAME = 'payment_corrections' THEN
    SELECT invoice_id INTO invoice_id_value FROM payments WHERE id = NEW.payment_id;
  ELSE
    invoice_id_value := NEW.invoice_id;
  END IF;
  SELECT * INTO target FROM invoices WHERE id = invoice_id_value;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;
  -- Every performed (DONE) service of the visit is on the invoice exactly once, each with its detail
  -- (the unique keys make "at most once"; the counts make "at least once").
  SELECT count(*) INTO line_count FROM invoice_lines WHERE invoice_id = target.id;
  SELECT count(*) INTO detail_count FROM invoice_line_services WHERE invoice_id = target.id;
  SELECT count(*) INTO done_count FROM visit_service_lines WHERE visit_id = target.visit_id AND status = 'DONE';
  IF line_count = 0 OR line_count <> detail_count OR line_count <> done_count THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'An invoice carries every performed service of its visit exactly once';
  END IF;
  -- A price lies inside the snapshotted range and a quantity within the snapshotted limit.
  IF EXISTS (
    SELECT 1 FROM invoice_lines l JOIN invoice_line_services s ON s.invoice_line_id = l.id
    WHERE l.invoice_id = target.id
      AND ((l.unit_price_vnd IS NOT NULL
          AND (l.unit_price_vnd < s.catalog_price_min_vnd OR l.unit_price_vnd > s.catalog_price_max_vnd))
        OR (l.quantity IS NOT NULL AND l.quantity > s.quantity_limit))) THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'A line price must lie in the snapshotted range and its quantity within the snapshotted limit';
  END IF;
  IF target.finalized_at IS NOT NULL THEN
    SELECT count(*) FILTER (WHERE quantity IS NULL OR unit_price_vnd IS NULL), COALESCE(sum(gross_vnd), 0)
      INTO unpriced, line_total FROM invoice_lines WHERE invoice_id = target.id;
    IF unpriced > 0 OR target.subtotal_vnd <> line_total THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'A finalized invoice has every line priced and its subtotal is the sum of its lines';
    END IF;
  END IF;
  -- Reconciliation (design 9): 0 <= effective <= receivable; PAID <=> effective = receivable
  -- (also for a receivable of 0 with no payment, OP-2); PENDING_PAYMENT <=> effective < receivable;
  -- a draft has no payment; a cancelled invoice has no effective payment.
  effective := lucy_invoice_effective_paid(target.id);
  IF effective > target.total_vnd
    OR (target.status = 'DRAFT' AND EXISTS (SELECT 1 FROM payments WHERE invoice_id = target.id))
    OR (target.status = 'PAID' AND effective <> target.total_vnd)
    OR (target.status = 'PENDING_PAYMENT' AND effective >= target.total_vnd)
    OR (target.status = 'CANCELLED' AND effective <> 0) THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Payments must reconcile with the invoice status and receivable';
  END IF;
  RETURN NULL;
END;
$$;

-- --------------------------------------------------------------------------------- triggers

CREATE TRIGGER "invoices_guard" BEFORE INSERT OR UPDATE ON "invoices"
FOR EACH ROW EXECUTE FUNCTION lucy_guard_invoice();
CREATE TRIGGER "invoice_lines_guard" BEFORE INSERT OR UPDATE ON "invoice_lines"
FOR EACH ROW EXECUTE FUNCTION lucy_guard_invoice_line();
CREATE TRIGGER "invoice_line_services_guard" BEFORE INSERT OR UPDATE ON "invoice_line_services"
FOR EACH ROW EXECUTE FUNCTION lucy_guard_invoice_line_service();
CREATE TRIGGER "payments_guard" BEFORE INSERT OR UPDATE ON "payments"
FOR EACH ROW EXECUTE FUNCTION lucy_guard_payment();
CREATE TRIGGER "payment_corrections_guard" BEFORE INSERT ON "payment_corrections"
FOR EACH ROW EXECUTE FUNCTION lucy_guard_payment_correction();

CREATE CONSTRAINT TRIGGER "invoices_integrity" AFTER INSERT OR UPDATE ON "invoices"
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION lucy_check_invoice_integrity();
CREATE CONSTRAINT TRIGGER "invoice_lines_integrity" AFTER INSERT OR UPDATE ON "invoice_lines"
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION lucy_check_invoice_integrity();
CREATE CONSTRAINT TRIGGER "invoice_line_services_integrity" AFTER INSERT ON "invoice_line_services"
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION lucy_check_invoice_integrity();
CREATE CONSTRAINT TRIGGER "payments_integrity" AFTER INSERT OR UPDATE ON "payments"
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION lucy_check_invoice_integrity();
CREATE CONSTRAINT TRIGGER "payment_corrections_integrity" AFTER INSERT ON "payment_corrections"
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION lucy_check_invoice_integrity();

-- Financial history is never deleted or truncated. Corrections are permanent (append-only).
CREATE TRIGGER "invoices_no_delete" BEFORE DELETE ON "invoices" FOR EACH ROW EXECUTE FUNCTION lucy_reject_financial_delete();
CREATE TRIGGER "invoice_lines_no_delete" BEFORE DELETE ON "invoice_lines" FOR EACH ROW EXECUTE FUNCTION lucy_reject_financial_delete();
CREATE TRIGGER "invoice_line_services_no_delete" BEFORE DELETE ON "invoice_line_services" FOR EACH ROW EXECUTE FUNCTION lucy_reject_financial_delete();
CREATE TRIGGER "payments_no_delete" BEFORE DELETE ON "payments" FOR EACH ROW EXECUTE FUNCTION lucy_reject_financial_delete();
CREATE TRIGGER "invoices_no_truncate" BEFORE TRUNCATE ON "invoices" FOR EACH STATEMENT EXECUTE FUNCTION lucy_reject_permanent_history_mutation();
CREATE TRIGGER "invoice_lines_no_truncate" BEFORE TRUNCATE ON "invoice_lines" FOR EACH STATEMENT EXECUTE FUNCTION lucy_reject_permanent_history_mutation();
CREATE TRIGGER "invoice_line_services_no_truncate" BEFORE TRUNCATE ON "invoice_line_services" FOR EACH STATEMENT EXECUTE FUNCTION lucy_reject_permanent_history_mutation();
CREATE TRIGGER "payments_no_truncate" BEFORE TRUNCATE ON "payments" FOR EACH STATEMENT EXECUTE FUNCTION lucy_reject_permanent_history_mutation();
CREATE TRIGGER "payment_corrections_append_only" BEFORE UPDATE OR DELETE ON "payment_corrections"
FOR EACH ROW EXECUTE FUNCTION lucy_reject_permanent_history_mutation();
CREATE TRIGGER "payment_corrections_no_truncate" BEFORE TRUNCATE ON "payment_corrections"
FOR EACH STATEMENT EXECUTE FUNCTION lucy_reject_permanent_history_mutation();

-- Function hardening (the Phase 1 convention): a fixed search_path and no PUBLIC execute.
DO $$
DECLARE
  migration_schema text := current_schema();
  function_name text;
BEGIN
  FOREACH function_name IN ARRAY ARRAY[
    'lucy_reject_financial_delete', 'lucy_guard_invoice', 'lucy_guard_invoice_line',
    'lucy_guard_invoice_line_service', 'lucy_guard_payment', 'lucy_guard_payment_correction',
    'lucy_check_invoice_integrity'
  ] LOOP
    EXECUTE format('ALTER FUNCTION %I.%I() SET search_path TO pg_catalog, %I, pg_temp',
      migration_schema, function_name, migration_schema);
    EXECUTE format('REVOKE ALL ON FUNCTION %I.%I() FROM PUBLIC', migration_schema, function_name);
  END LOOP;
  EXECUTE format('ALTER FUNCTION %I.lucy_invoice_effective_paid(uuid) SET search_path TO pg_catalog, %I, pg_temp',
    migration_schema, migration_schema);
  EXECUTE format('REVOKE ALL ON FUNCTION %I.lucy_invoice_effective_paid(uuid) FROM PUBLIC', migration_schema);
END;
$$;
