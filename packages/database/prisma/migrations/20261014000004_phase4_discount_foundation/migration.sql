-- Phase 4 Step 4, migration 5 of 5: the discount / voucher persistence foundation
-- (design 4.4, 8, OP-3 / OP-4 / OP-5 / OP-7).
--
-- DATABASE FOUNDATION ONLY. There is no discount engine, no eligibility evaluation, no voucher
-- validation and no redemption command here (Step 6). These tables only make the approved
-- structure and its permanent-history rules impossible to violate:
--   * programs are Owner-configured, versioned by appending immutable versions, never deleted;
--   * `requires_code = false` programs are code-less promotions, `true` programs own voucher codes;
--   * at most ONE applied benefit and ONE redemption per invoice (no stacking), both immutable;
--   * a redemption is released at most once by an append-only release record, and only for a
--     CANCELLED invoice (unpaid finalized cancellation or the OP-7 zero-balance correction);
--   * a benefit with a per-customer limit is redeemable only with an identified member payer (OP-3);
--   * the stored amount obeys the Q3 rule (percent in basis points, round half up to 1 VND).
-- No Phase 5 benefit type (member, tier, birthday, referral, loyalty) is modeled. Existing invoices,
-- visits and catalog data are untouched; every table starts empty.

CREATE TYPE "DiscountKind" AS ENUM ('PERCENT', 'FIXED_AMOUNT');
CREATE TYPE "DiscountScopeMode" AS ENUM ('ALL_SERVICES', 'SELECTED');
CREATE TYPE "DiscountReleaseCause" AS ENUM ('INVOICE_CANCELLED_UNPAID', 'ZERO_BALANCE_CORRECTION');

-- ------------------------------------------------------------------------------------ tables

CREATE TABLE "discounts" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "code" TEXT NOT NULL,
    "name_vi" TEXT NOT NULL,
    "name_en" TEXT NOT NULL,
    "requires_code" BOOLEAN NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "terminated_at" TIMESTAMPTZ(3),
    "terminated_by_user_id" UUID,
    "terminated_reason" TEXT,
    "row_version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "discounts_pkey" PRIMARY KEY ("id")
);

-- Immutable configuration: editing a program appends a version.
CREATE TABLE "discount_versions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "discount_id" UUID NOT NULL,
    "version_no" INTEGER NOT NULL,
    "kind" "DiscountKind" NOT NULL,
    "percent_bp" INTEGER,
    "fixed_amount_vnd" BIGINT,
    "valid_from" TIMESTAMPTZ(3) NOT NULL,
    "valid_until" TIMESTAMPTZ(3) NOT NULL,
    "min_spend_vnd" BIGINT NOT NULL DEFAULT 0,
    "scope_mode" "DiscountScopeMode" NOT NULL,
    "usage_limit_total" INTEGER,
    "usage_limit_per_customer" INTEGER,
    "created_by_user_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "discount_versions_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "discount_version_services" (
    "version_id" UUID NOT NULL,
    "service_id" UUID NOT NULL,

    CONSTRAINT "discount_version_services_pkey" PRIMARY KEY ("version_id", "service_id")
);

CREATE TABLE "discount_version_categories" (
    "version_id" UUID NOT NULL,
    "category_id" UUID NOT NULL,

    CONSTRAINT "discount_version_categories_pkey" PRIMARY KEY ("version_id", "category_id")
);

-- A redeemable code under a `requires_code` program.
CREATE TABLE "vouchers" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "discount_id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_by_user_id" UUID NOT NULL,
    "row_version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "vouchers_pkey" PRIMARY KEY ("id")
);

-- The codes supplied to a DRAFT invoice (the voucher candidates). One removal transition, draft only.
CREATE TABLE "invoice_voucher_entries" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "invoice_id" UUID NOT NULL,
    "voucher_id" UUID NOT NULL,
    "supplied_by_user_id" UUID NOT NULL,
    "supplied_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "removed_by_user_id" UUID,
    "removed_at" TIMESTAMPTZ(3),

    CONSTRAINT "invoice_voucher_entries_pkey" PRIMARY KEY ("id")
);

-- The single winning benefit, written once at finalization; no row exists when nothing won.
CREATE TABLE "invoice_discount_applications" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "invoice_id" UUID NOT NULL,
    "discount_id" UUID NOT NULL,
    "version_id" UUID NOT NULL,
    "voucher_id" UUID,
    "kind" "DiscountKind" NOT NULL,
    "percent_bp" INTEGER,
    "fixed_amount_vnd" BIGINT,
    "eligible_subtotal_vnd" BIGINT NOT NULL,
    "computed_amount_vnd" BIGINT NOT NULL,
    "candidates" JSONB NOT NULL,
    "selection_reason" TEXT NOT NULL,
    "finalized_by_user_id" UUID NOT NULL,
    "applied_at" TIMESTAMPTZ(3) NOT NULL DEFAULT clock_timestamp(),

    CONSTRAINT "invoice_discount_applications_pkey" PRIMARY KEY ("id")
);

-- The permanent usage ledger (design 4.4, PRD VoucherRedemption): written at finalization for the
-- winner only. `redeemed_at` is always the database clock (the guard overwrites any client value).
CREATE TABLE "discount_redemptions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "invoice_id" UUID NOT NULL,
    "discount_id" UUID NOT NULL,
    "version_id" UUID NOT NULL,
    "voucher_id" UUID,
    "payer_user_id" UUID,
    "redeemed_at" TIMESTAMPTZ(3) NOT NULL DEFAULT clock_timestamp(),

    CONSTRAINT "discount_redemptions_pkey" PRIMARY KEY ("id")
);

-- A redemption is ACTIVE iff it has no release row. The original redemption always stays.
CREATE TABLE "discount_redemption_releases" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "redemption_id" UUID NOT NULL,
    "released_at" TIMESTAMPTZ(3) NOT NULL DEFAULT clock_timestamp(),
    "released_by_user_id" UUID NOT NULL,
    "cause" "DiscountReleaseCause" NOT NULL,
    "reason" TEXT NOT NULL,

    CONSTRAINT "discount_redemption_releases_pkey" PRIMARY KEY ("id")
);

-- ---------------------------------------------------------------------- keys and indexes

CREATE UNIQUE INDEX "discounts_code_key" ON "discounts"("code");
CREATE UNIQUE INDEX "discount_versions_discount_version_key" ON "discount_versions"("discount_id", "version_no");
CREATE UNIQUE INDEX "discount_versions_discount_id_id_key" ON "discount_versions"("discount_id", "id");
CREATE UNIQUE INDEX "vouchers_code_key" ON "vouchers"("code");
-- Unique ACTIVE supplied code per invoice; a removed entry no longer blocks supplying it again.
CREATE UNIQUE INDEX "invoice_voucher_entries_active_key" ON "invoice_voucher_entries"("invoice_id", "voucher_id") WHERE "removed_at" IS NULL;
-- No stacking: one applied benefit and one redemption per invoice; one release per redemption.
CREATE UNIQUE INDEX "invoice_discount_applications_invoice_key" ON "invoice_discount_applications"("invoice_id");
CREATE UNIQUE INDEX "discount_redemptions_invoice_key" ON "discount_redemptions"("invoice_id");
CREATE INDEX "discount_redemptions_usage_idx" ON "discount_redemptions"("discount_id", "payer_user_id");
CREATE UNIQUE INDEX "discount_redemption_releases_redemption_key" ON "discount_redemption_releases"("redemption_id");

-- ------------------------------------------------------------------------ foreign keys

ALTER TABLE "discounts" ADD CONSTRAINT "discounts_terminated_by_user_id_fkey" FOREIGN KEY ("terminated_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

ALTER TABLE "discount_versions" ADD CONSTRAINT "discount_versions_discount_id_fkey" FOREIGN KEY ("discount_id") REFERENCES "discounts"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "discount_versions" ADD CONSTRAINT "discount_versions_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

ALTER TABLE "discount_version_services" ADD CONSTRAINT "discount_version_services_version_id_fkey" FOREIGN KEY ("version_id") REFERENCES "discount_versions"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "discount_version_services" ADD CONSTRAINT "discount_version_services_service_id_fkey" FOREIGN KEY ("service_id") REFERENCES "services"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "discount_version_categories" ADD CONSTRAINT "discount_version_categories_version_id_fkey" FOREIGN KEY ("version_id") REFERENCES "discount_versions"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "discount_version_categories" ADD CONSTRAINT "discount_version_categories_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "service_categories"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

ALTER TABLE "vouchers" ADD CONSTRAINT "vouchers_discount_id_fkey" FOREIGN KEY ("discount_id") REFERENCES "discounts"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "vouchers" ADD CONSTRAINT "vouchers_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

ALTER TABLE "invoice_voucher_entries" ADD CONSTRAINT "invoice_voucher_entries_invoice_id_fkey" FOREIGN KEY ("invoice_id") REFERENCES "invoices"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "invoice_voucher_entries" ADD CONSTRAINT "invoice_voucher_entries_voucher_id_fkey" FOREIGN KEY ("voucher_id") REFERENCES "vouchers"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "invoice_voucher_entries" ADD CONSTRAINT "invoice_voucher_entries_supplied_by_user_id_fkey" FOREIGN KEY ("supplied_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "invoice_voucher_entries" ADD CONSTRAINT "invoice_voucher_entries_removed_by_user_id_fkey" FOREIGN KEY ("removed_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

ALTER TABLE "invoice_discount_applications" ADD CONSTRAINT "invoice_discount_applications_invoice_id_fkey" FOREIGN KEY ("invoice_id") REFERENCES "invoices"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "invoice_discount_applications" ADD CONSTRAINT "invoice_discount_applications_version_fkey" FOREIGN KEY ("discount_id", "version_id") REFERENCES "discount_versions"("discount_id", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "invoice_discount_applications" ADD CONSTRAINT "invoice_discount_applications_voucher_id_fkey" FOREIGN KEY ("voucher_id") REFERENCES "vouchers"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "invoice_discount_applications" ADD CONSTRAINT "invoice_discount_applications_finalized_by_user_id_fkey" FOREIGN KEY ("finalized_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

ALTER TABLE "discount_redemptions" ADD CONSTRAINT "discount_redemptions_invoice_id_fkey" FOREIGN KEY ("invoice_id") REFERENCES "invoices"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "discount_redemptions" ADD CONSTRAINT "discount_redemptions_discount_id_fkey" FOREIGN KEY ("discount_id") REFERENCES "discounts"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "discount_redemptions" ADD CONSTRAINT "discount_redemptions_version_id_fkey" FOREIGN KEY ("version_id") REFERENCES "discount_versions"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "discount_redemptions" ADD CONSTRAINT "discount_redemptions_voucher_id_fkey" FOREIGN KEY ("voucher_id") REFERENCES "vouchers"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "discount_redemptions" ADD CONSTRAINT "discount_redemptions_payer_user_id_fkey" FOREIGN KEY ("payer_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

ALTER TABLE "discount_redemption_releases" ADD CONSTRAINT "discount_redemption_releases_redemption_id_fkey" FOREIGN KEY ("redemption_id") REFERENCES "discount_redemptions"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "discount_redemption_releases" ADD CONSTRAINT "discount_redemption_releases_released_by_user_id_fkey" FOREIGN KEY ("released_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- ------------------------------------------------------------------------ CHECK constraints

ALTER TABLE "discounts"
  ADD CONSTRAINT "discounts_code_canonical" CHECK ("code" ~ '^[A-Z][A-Z0-9_]{0,63}$'),
  ADD CONSTRAINT "discounts_names_nonblank" CHECK ("name_vi" !~ '^[[:space:]]*$' AND "name_en" !~ '^[[:space:]]*$'),
  ADD CONSTRAINT "discounts_version_positive" CHECK ("row_version" > 0),
  -- Early termination is one fact: when, by whom, why.
  ADD CONSTRAINT "discounts_termination_facts" CHECK (
    ("terminated_at" IS NULL) = ("terminated_by_user_id" IS NULL)
    AND ("terminated_at" IS NULL) = ("terminated_reason" IS NULL)
    AND ("terminated_reason" IS NULL OR "terminated_reason" !~ '^[[:space:]]*$')
  );

ALTER TABLE "discount_versions"
  ADD CONSTRAINT "discount_versions_number_positive" CHECK ("version_no" >= 1),
  -- Q4: a percentage (basis points 1..10000) or a fixed amount (integer VND > 0), never a free
  -- value typed by staff and never both.
  ADD CONSTRAINT "discount_versions_value" CHECK (
    ("kind" = 'PERCENT' AND "percent_bp" IS NOT NULL AND "percent_bp" BETWEEN 1 AND 10000
      AND "fixed_amount_vnd" IS NULL)
    OR ("kind" = 'FIXED_AMOUNT' AND "fixed_amount_vnd" IS NOT NULL AND "fixed_amount_vnd" > 0
      AND "percent_bp" IS NULL)
  ),
  ADD CONSTRAINT "discount_versions_validity" CHECK (
    isfinite("valid_from") AND isfinite("valid_until") AND "valid_until" > "valid_from"
  ),
  ADD CONSTRAINT "discount_versions_min_spend" CHECK ("min_spend_vnd" >= 0),
  -- NULL means unlimited.
  ADD CONSTRAINT "discount_versions_limits" CHECK (
    ("usage_limit_total" IS NULL OR "usage_limit_total" >= 1)
    AND ("usage_limit_per_customer" IS NULL OR "usage_limit_per_customer" >= 1)
  );

ALTER TABLE "vouchers"
  -- Canonical voucher code: upper-case letters, digits, "_" and "-", no spaces.
  ADD CONSTRAINT "vouchers_code_canonical" CHECK ("code" ~ '^[A-Z0-9][A-Z0-9_-]{0,63}$'),
  ADD CONSTRAINT "vouchers_version_positive" CHECK ("row_version" > 0);

ALTER TABLE "invoice_voucher_entries"
  ADD CONSTRAINT "invoice_voucher_entries_removal_facts" CHECK (
    ("removed_at" IS NULL) = ("removed_by_user_id" IS NULL)
    AND ("removed_at" IS NULL OR "removed_at" >= "supplied_at")
  );

ALTER TABLE "invoice_discount_applications"
  ADD CONSTRAINT "invoice_discount_applications_value" CHECK (
    ("kind" = 'PERCENT' AND "percent_bp" IS NOT NULL AND "percent_bp" BETWEEN 1 AND 10000
      AND "fixed_amount_vnd" IS NULL)
    OR ("kind" = 'FIXED_AMOUNT' AND "fixed_amount_vnd" IS NOT NULL AND "fixed_amount_vnd" > 0
      AND "percent_bp" IS NULL)
  ),
  -- Q3 / design 7.3: PERCENT rounds half up to 1 VND in integer arithmetic; FIXED_AMOUNT is capped by
  -- the eligible subtotal. A winning benefit is worth more than 0 (no row otherwise).
  ADD CONSTRAINT "invoice_discount_applications_amount" CHECK (
    "eligible_subtotal_vnd" > 0 AND "computed_amount_vnd" > 0
    AND "computed_amount_vnd" <= "eligible_subtotal_vnd"
    AND "computed_amount_vnd" = (CASE "kind"
      WHEN 'PERCENT' THEN ("eligible_subtotal_vnd" * "percent_bp" + 5000) / 10000
      ELSE LEAST("fixed_amount_vnd", "eligible_subtotal_vnd") END)
  ),
  ADD CONSTRAINT "invoice_discount_applications_candidates" CHECK (jsonb_typeof("candidates") = 'array'),
  ADD CONSTRAINT "invoice_discount_applications_reason_nonblank" CHECK ("selection_reason" !~ '^[[:space:]]*$');

ALTER TABLE "discount_redemption_releases"
  ADD CONSTRAINT "discount_redemption_releases_reason_nonblank" CHECK ("reason" !~ '^[[:space:]]*$');

-- ------------------------------------------------------------------------------- functions

CREATE FUNCTION lucy_guard_discount() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF (NEW.id, NEW.code, NEW.requires_code, NEW.created_at)
    IS DISTINCT FROM (OLD.id, OLD.code, OLD.requires_code, OLD.created_at) THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'A discount program keeps its identity, code and code requirement';
  END IF;
  -- Early termination is permanent.
  IF OLD.terminated_at IS NOT NULL
    AND (NEW.terminated_at, NEW.terminated_by_user_id, NEW.terminated_reason)
      IS DISTINCT FROM (OLD.terminated_at, OLD.terminated_by_user_id, OLD.terminated_reason) THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'A terminated discount program cannot be reopened';
  END IF;
  IF NEW IS DISTINCT FROM OLD AND NEW.row_version <> OLD.row_version + 1 THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Discount program changes bump the version by one';
  END IF;
  RETURN NEW;
END;
$$;

CREATE FUNCTION lucy_guard_voucher() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  needs_code boolean;
BEGIN
  IF TG_OP = 'INSERT' THEN
    SELECT requires_code INTO needs_code FROM discounts WHERE id = NEW.discount_id;
    IF needs_code IS DISTINCT FROM true THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Voucher codes belong only to programs that require a code';
    END IF;
    IF NEW.row_version <> 1 THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'A voucher starts at version 1';
    END IF;
  ELSE
    IF (NEW.id, NEW.discount_id, NEW.code, NEW.created_by_user_id, NEW.created_at)
      IS DISTINCT FROM (OLD.id, OLD.discount_id, OLD.code, OLD.created_by_user_id, OLD.created_at) THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'A voucher keeps its program and code';
    END IF;
    IF NEW IS DISTINCT FROM OLD AND NEW.row_version <> OLD.row_version + 1 THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Voucher changes bump the version by one';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

-- Supplied voucher entries change only while the invoice is a DRAFT, and only by their one removal.
CREATE FUNCTION lucy_guard_invoice_voucher_entry() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  invoice_status "InvoiceStatus";
BEGIN
  SELECT status INTO invoice_status FROM invoices WHERE id = NEW.invoice_id FOR SHARE;
  IF invoice_status IS DISTINCT FROM 'DRAFT' THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Voucher codes are supplied or removed only while the invoice is a draft';
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.removed_at IS NOT NULL THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'A voucher entry is supplied before it is removed';
    END IF;
  ELSE
    IF (NEW.id, NEW.invoice_id, NEW.voucher_id, NEW.supplied_by_user_id, NEW.supplied_at)
      IS DISTINCT FROM (OLD.id, OLD.invoice_id, OLD.voucher_id, OLD.supplied_by_user_id, OLD.supplied_at)
      OR OLD.removed_at IS NOT NULL THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'A voucher entry has one removal transition and nothing else changes';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE FUNCTION lucy_guard_discount_application() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  invoice_status "InvoiceStatus";
  version discount_versions%ROWTYPE;
  needs_code boolean;
  voucher_discount uuid;
BEGIN
  SELECT status INTO invoice_status FROM invoices WHERE id = NEW.invoice_id FOR SHARE;
  IF invoice_status IS DISTINCT FROM 'DRAFT' THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'The winning benefit is written while the invoice is being finalized';
  END IF;
  SELECT * INTO version FROM discount_versions WHERE id = NEW.version_id;
  IF (NEW.kind, NEW.percent_bp, NEW.fixed_amount_vnd)
    IS DISTINCT FROM (version.kind, version.percent_bp, version.fixed_amount_vnd) THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'The applied rule must copy its program version';
  END IF;
  SELECT requires_code INTO needs_code FROM discounts WHERE id = NEW.discount_id;
  IF NEW.voucher_id IS NULL THEN
    -- A code-less promotion is an automatic candidate (OP-5).
    IF needs_code IS DISTINCT FROM false THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'A benefit without a voucher must come from a code-less promotion';
    END IF;
  ELSE
    -- A voucher benefit needs a code of its own program.
    SELECT discount_id INTO voucher_discount FROM vouchers WHERE id = NEW.voucher_id;
    IF needs_code IS DISTINCT FROM true OR voucher_discount IS DISTINCT FROM NEW.discount_id THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'A voucher benefit must use a code of its own program';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

-- Redemption: written once for the winner; usage limits and the OP-3 member requirement are
-- enforced under the program row lock, so two finalizations can never both consume the last usage.
CREATE FUNCTION lucy_guard_discount_redemption() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  target invoices%ROWTYPE;
  applied invoice_discount_applications%ROWTYPE;
  version discount_versions%ROWTYPE;
  active_total bigint;
  active_customer bigint;
BEGIN
  SELECT * INTO target FROM invoices WHERE id = NEW.invoice_id FOR SHARE;
  IF target.status IS DISTINCT FROM 'DRAFT' AND target.status IS DISTINCT FROM 'PENDING_PAYMENT'
    AND target.status IS DISTINCT FROM 'PAID' THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'A redemption is recorded for an invoice being finalized, never a cancelled one';
  END IF;
  SELECT * INTO applied FROM invoice_discount_applications WHERE invoice_id = NEW.invoice_id;
  IF NOT FOUND OR (NEW.discount_id, NEW.version_id, NEW.voucher_id)
    IS DISTINCT FROM (applied.discount_id, applied.version_id, applied.voucher_id) THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'A redemption records exactly the applied benefit of its invoice';
  END IF;
  -- The payer is the invoice's payer; a guest payer is NULL and never fabricated from other data.
  IF NEW.payer_user_id IS DISTINCT FROM target.payer_user_id THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'A redemption records the payer of its invoice';
  END IF;
  SELECT * INTO version FROM discount_versions WHERE id = NEW.version_id;
  -- OP-3: a per-customer-limited benefit is redeemable only with an identified member payer.
  IF version.usage_limit_per_customer IS NOT NULL AND NEW.payer_user_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'A per-customer limited benefit needs an identified member payer';
  END IF;
  -- Lock the program row (design 14) and count ACTIVE redemptions: those without a release record.
  PERFORM 1 FROM discounts WHERE id = NEW.discount_id FOR UPDATE;
  SELECT count(*) INTO active_total FROM discount_redemptions r
    WHERE r.discount_id = NEW.discount_id
      AND NOT EXISTS (SELECT 1 FROM discount_redemption_releases l WHERE l.redemption_id = r.id);
  IF version.usage_limit_total IS NOT NULL AND active_total >= version.usage_limit_total THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'The total usage limit of the benefit is reached';
  END IF;
  IF version.usage_limit_per_customer IS NOT NULL THEN
    SELECT count(*) INTO active_customer FROM discount_redemptions r
      WHERE r.discount_id = NEW.discount_id AND r.payer_user_id = NEW.payer_user_id
        AND NOT EXISTS (SELECT 1 FROM discount_redemption_releases l WHERE l.redemption_id = r.id);
    IF active_customer >= version.usage_limit_per_customer THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'The per-customer usage limit of the benefit is reached';
    END IF;
  END IF;
  NEW.redeemed_at := clock_timestamp();
  RETURN NEW;
END;
$$;

-- Release: only for a redemption of a CANCELLED invoice, with a cause that matches how the invoice was
-- cancelled (unpaid finalized cancellation, or the OP-7 zero-balance correction), at most once.
CREATE FUNCTION lucy_guard_discount_release() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  redeemed discount_redemptions%ROWTYPE;
  target invoices%ROWTYPE;
BEGIN
  SELECT * INTO redeemed FROM discount_redemptions WHERE id = NEW.redemption_id;
  SELECT * INTO target FROM invoices WHERE id = redeemed.invoice_id FOR SHARE;
  IF target.status IS DISTINCT FROM 'CANCELLED' THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'A redemption is released only when its invoice is cancelled';
  END IF;
  IF (NEW.cause = 'INVOICE_CANCELLED_UNPAID' AND target.cancelled_from_status IS DISTINCT FROM 'PENDING_PAYMENT')
    OR (NEW.cause = 'ZERO_BALANCE_CORRECTION' AND target.cancelled_from_status IS DISTINCT FROM 'PAID') THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'The release cause must match how the invoice was cancelled';
  END IF;
  -- Same lock as redemption counting: capacity returns exactly once and is never half-released.
  PERFORM 1 FROM discounts WHERE id = redeemed.discount_id FOR UPDATE;
  NEW.released_at := clock_timestamp();
  RETURN NEW;
END;
$$;

-- Commit-time consistency of the discount facts of one invoice (deferred constraint trigger).
CREATE FUNCTION lucy_check_invoice_discount() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  invoice_id_value uuid;
  target invoices%ROWTYPE;
  applied invoice_discount_applications%ROWTYPE;
  has_application boolean;
  has_redemption boolean;
  released boolean;
BEGIN
  IF TG_TABLE_NAME = 'invoices' THEN
    invoice_id_value := NEW.id;
  ELSIF TG_TABLE_NAME = 'discount_redemption_releases' THEN
    SELECT invoice_id INTO invoice_id_value FROM discount_redemptions WHERE id = NEW.redemption_id;
  ELSE
    invoice_id_value := NEW.invoice_id;
  END IF;
  SELECT * INTO target FROM invoices WHERE id = invoice_id_value;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;
  SELECT * INTO applied FROM invoice_discount_applications WHERE invoice_id = target.id;
  has_application := FOUND;
  has_redemption := EXISTS (SELECT 1 FROM discount_redemptions WHERE invoice_id = target.id);
  IF target.finalized_at IS NULL THEN
    -- A draft stores only header amounts and supplied entries; the benefit and redemption are frozen at finalization.
    IF has_application OR has_redemption THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'A draft invoice has no applied benefit or redemption yet';
    END IF;
    RETURN NULL;
  END IF;
  -- Finalized: the header discount is exactly the applied benefit (0 when none won), an applied
  -- benefit is redeemed exactly once, a voucher benefit had its code supplied, and the eligible
  -- subtotal cannot exceed the invoice subtotal.
  IF target.discount_total_vnd <> COALESCE(applied.computed_amount_vnd, 0) THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'The invoice discount total must equal its applied benefit';
  END IF;
  IF has_application <> has_redemption THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'An applied benefit is redeemed exactly once';
  END IF;
  IF has_application AND applied.eligible_subtotal_vnd > target.subtotal_vnd THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'The eligible subtotal cannot exceed the invoice subtotal';
  END IF;
  IF has_application AND applied.voucher_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM invoice_voucher_entries e
    WHERE e.invoice_id = target.id AND e.voucher_id = applied.voucher_id AND e.removed_at IS NULL) THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'A voucher benefit needs its code supplied to the invoice';
  END IF;
  -- Cancellation releases the redemption in the same transaction (design 5.5); nothing else does.
  released := EXISTS (
    SELECT 1 FROM discount_redemption_releases l JOIN discount_redemptions r ON r.id = l.redemption_id
    WHERE r.invoice_id = target.id);
  IF has_redemption AND (target.status = 'CANCELLED') <> released THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'A redemption is released exactly when its invoice is cancelled';
  END IF;
  RETURN NULL;
END;
$$;

-- A SELECTED version names at least one service or category; ALL_SERVICES names none.
CREATE FUNCTION lucy_check_discount_version_scope() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  version_id_value uuid;
  mode "DiscountScopeMode";
  scope_rows bigint;
BEGIN
  IF TG_TABLE_NAME = 'discount_versions' THEN
    version_id_value := NEW.id;
  ELSE
    version_id_value := NEW.version_id;
  END IF;
  SELECT scope_mode INTO mode FROM discount_versions WHERE id = version_id_value;
  SELECT (SELECT count(*) FROM discount_version_services WHERE version_id = version_id_value)
    + (SELECT count(*) FROM discount_version_categories WHERE version_id = version_id_value) INTO scope_rows;
  IF (mode = 'SELECTED' AND scope_rows = 0) OR (mode = 'ALL_SERVICES' AND scope_rows > 0) THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'A selected-scope version names its services or categories and an all-services version names none';
  END IF;
  RETURN NULL;
END;
$$;

-- --------------------------------------------------------------------------------- triggers

CREATE TRIGGER "discounts_guard" BEFORE UPDATE ON "discounts"
FOR EACH ROW EXECUTE FUNCTION lucy_guard_discount();
CREATE TRIGGER "vouchers_guard" BEFORE INSERT OR UPDATE ON "vouchers"
FOR EACH ROW EXECUTE FUNCTION lucy_guard_voucher();
CREATE TRIGGER "invoice_voucher_entries_guard" BEFORE INSERT OR UPDATE ON "invoice_voucher_entries"
FOR EACH ROW EXECUTE FUNCTION lucy_guard_invoice_voucher_entry();
CREATE TRIGGER "invoice_discount_applications_guard" BEFORE INSERT ON "invoice_discount_applications"
FOR EACH ROW EXECUTE FUNCTION lucy_guard_discount_application();
CREATE TRIGGER "discount_redemptions_guard" BEFORE INSERT ON "discount_redemptions"
FOR EACH ROW EXECUTE FUNCTION lucy_guard_discount_redemption();
CREATE TRIGGER "discount_redemption_releases_guard" BEFORE INSERT ON "discount_redemption_releases"
FOR EACH ROW EXECUTE FUNCTION lucy_guard_discount_release();

CREATE CONSTRAINT TRIGGER "invoices_discount_integrity" AFTER INSERT OR UPDATE ON "invoices"
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION lucy_check_invoice_discount();
CREATE CONSTRAINT TRIGGER "invoice_voucher_entries_integrity" AFTER INSERT OR UPDATE ON "invoice_voucher_entries"
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION lucy_check_invoice_discount();
CREATE CONSTRAINT TRIGGER "invoice_discount_applications_integrity" AFTER INSERT ON "invoice_discount_applications"
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION lucy_check_invoice_discount();
CREATE CONSTRAINT TRIGGER "discount_redemptions_integrity" AFTER INSERT ON "discount_redemptions"
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION lucy_check_invoice_discount();
CREATE CONSTRAINT TRIGGER "discount_redemption_releases_integrity" AFTER INSERT ON "discount_redemption_releases"
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION lucy_check_invoice_discount();

CREATE CONSTRAINT TRIGGER "discount_versions_scope_integrity" AFTER INSERT ON "discount_versions"
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION lucy_check_discount_version_scope();
CREATE CONSTRAINT TRIGGER "discount_version_services_scope_integrity" AFTER INSERT ON "discount_version_services"
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION lucy_check_discount_version_scope();
CREATE CONSTRAINT TRIGGER "discount_version_categories_scope_integrity" AFTER INSERT ON "discount_version_categories"
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION lucy_check_discount_version_scope();

-- Permanent history: programs, vouchers and entries are never deleted (they keep their few allowed
-- updates above); versions, scope rows, applications, redemptions and releases are append-only.
CREATE TRIGGER "discounts_no_delete" BEFORE DELETE ON "discounts" FOR EACH ROW EXECUTE FUNCTION lucy_reject_financial_delete();
CREATE TRIGGER "vouchers_no_delete" BEFORE DELETE ON "vouchers" FOR EACH ROW EXECUTE FUNCTION lucy_reject_financial_delete();
CREATE TRIGGER "invoice_voucher_entries_no_delete" BEFORE DELETE ON "invoice_voucher_entries" FOR EACH ROW EXECUTE FUNCTION lucy_reject_financial_delete();
CREATE TRIGGER "discount_versions_append_only" BEFORE UPDATE OR DELETE ON "discount_versions" FOR EACH ROW EXECUTE FUNCTION lucy_reject_permanent_history_mutation();
CREATE TRIGGER "discount_version_services_append_only" BEFORE UPDATE OR DELETE ON "discount_version_services" FOR EACH ROW EXECUTE FUNCTION lucy_reject_permanent_history_mutation();
CREATE TRIGGER "discount_version_categories_append_only" BEFORE UPDATE OR DELETE ON "discount_version_categories" FOR EACH ROW EXECUTE FUNCTION lucy_reject_permanent_history_mutation();
CREATE TRIGGER "invoice_discount_applications_append_only" BEFORE UPDATE OR DELETE ON "invoice_discount_applications" FOR EACH ROW EXECUTE FUNCTION lucy_reject_permanent_history_mutation();
CREATE TRIGGER "discount_redemptions_append_only" BEFORE UPDATE OR DELETE ON "discount_redemptions" FOR EACH ROW EXECUTE FUNCTION lucy_reject_permanent_history_mutation();
CREATE TRIGGER "discount_redemption_releases_append_only" BEFORE UPDATE OR DELETE ON "discount_redemption_releases" FOR EACH ROW EXECUTE FUNCTION lucy_reject_permanent_history_mutation();

CREATE TRIGGER "discounts_no_truncate" BEFORE TRUNCATE ON "discounts" FOR EACH STATEMENT EXECUTE FUNCTION lucy_reject_permanent_history_mutation();
CREATE TRIGGER "discount_versions_no_truncate" BEFORE TRUNCATE ON "discount_versions" FOR EACH STATEMENT EXECUTE FUNCTION lucy_reject_permanent_history_mutation();
CREATE TRIGGER "discount_version_services_no_truncate" BEFORE TRUNCATE ON "discount_version_services" FOR EACH STATEMENT EXECUTE FUNCTION lucy_reject_permanent_history_mutation();
CREATE TRIGGER "discount_version_categories_no_truncate" BEFORE TRUNCATE ON "discount_version_categories" FOR EACH STATEMENT EXECUTE FUNCTION lucy_reject_permanent_history_mutation();
CREATE TRIGGER "vouchers_no_truncate" BEFORE TRUNCATE ON "vouchers" FOR EACH STATEMENT EXECUTE FUNCTION lucy_reject_permanent_history_mutation();
CREATE TRIGGER "invoice_voucher_entries_no_truncate" BEFORE TRUNCATE ON "invoice_voucher_entries" FOR EACH STATEMENT EXECUTE FUNCTION lucy_reject_permanent_history_mutation();
CREATE TRIGGER "invoice_discount_applications_no_truncate" BEFORE TRUNCATE ON "invoice_discount_applications" FOR EACH STATEMENT EXECUTE FUNCTION lucy_reject_permanent_history_mutation();
CREATE TRIGGER "discount_redemptions_no_truncate" BEFORE TRUNCATE ON "discount_redemptions" FOR EACH STATEMENT EXECUTE FUNCTION lucy_reject_permanent_history_mutation();
CREATE TRIGGER "discount_redemption_releases_no_truncate" BEFORE TRUNCATE ON "discount_redemption_releases" FOR EACH STATEMENT EXECUTE FUNCTION lucy_reject_permanent_history_mutation();

-- Function hardening (the Phase 1 convention): a fixed search_path and no PUBLIC execute.
DO $$
DECLARE
  migration_schema text := current_schema();
  function_name text;
BEGIN
  FOREACH function_name IN ARRAY ARRAY[
    'lucy_guard_discount', 'lucy_guard_voucher', 'lucy_guard_invoice_voucher_entry',
    'lucy_guard_discount_application', 'lucy_guard_discount_redemption', 'lucy_guard_discount_release',
    'lucy_check_invoice_discount', 'lucy_check_discount_version_scope'
  ] LOOP
    EXECUTE format('ALTER FUNCTION %I.%I() SET search_path TO pg_catalog, %I, pg_temp',
      migration_schema, function_name, migration_schema);
    EXECUTE format('REVOKE ALL ON FUNCTION %I.%I() FROM PUBLIC', migration_schema, function_name);
  END LOOP;
END;
$$;
