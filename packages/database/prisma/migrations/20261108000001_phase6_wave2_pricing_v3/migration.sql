-- Phase 6 P6-9 (T17, T18, T19; Q1, Q2, Q7; OQ-P6-20; OQ-59, OQ-65): the persistence of pricing `calculation_version = 3`. Additive.
--
-- Version 3 prices an invoice that has a product line per SIDE: SPA (service and combo lines) and BEAUTY (product lines). An invoice with
-- no product line stays on version 2 (OQ-59) and writes exactly the rows it always did. For a version 3 invoice:
--   * the SPA side is stored in the existing Phase 4/5 rows (program application, tier snapshot, birthday gift), the BEAUTY side in new
--     sibling rows (`invoice_beauty_applications`, `invoice_beauty_snapshots`); each wallet has its own tier snapshot;
--   * a shared (scope BOTH) program records the program-level eligible subtotal and amount that were split, and each side's application
--     is exactly its share by the cumulative primitive (T18);
--   * the usage ledger `discount_redemptions` is ONE row per (invoice, program) (the key widens from "one per invoice"): a program that
--     wins both sides is redeemed once, two different programs winning the two sides are two rows (Owner, 2026-10-08);
--   * every invoice line gets an immutable net allocation (`invoice_line_allocations`);
--   * every payment and reversal of a version 3 invoice is attributed to the sides (`payment_side_allocations`), written by triggers so no
--     payment writer changes; a version 2 invoice makes the triggers return at once.
-- The commit-time integrity check reads "discount = Spa part + Beauty part" for version 3 and is unchanged for every other invoice.

CREATE TYPE "PricingSide" AS ENUM ('SPA', 'BEAUTY');

-- ------------------------------------------------------------------------------------------ the split primitive (T18)
-- The SQL twin of `splitProRata` (apps/api/src/pos/split.ts): Ck = floor((2 * D * prefix + W) / (2 * W)); parity-tested.
CREATE FUNCTION lucy_cumulative_share(total bigint, prefix_weight bigint, total_weight bigint) RETURNS bigint
LANGUAGE sql IMMUTABLE AS $$
  SELECT floor((2::numeric * total * prefix_weight + total_weight) / (2::numeric * total_weight))::bigint
$$;

CREATE FUNCTION lucy_split_pro_rata(total bigint, weights bigint[]) RETURNS bigint[]
LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE
  weight_sum bigint := 0;
  prefix bigint := 0;
  previous bigint := 0;
  current_value bigint;
  result bigint[] := ARRAY[]::bigint[];
  w bigint;
BEGIN
  IF total < 0 THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'A split total cannot be negative';
  END IF;
  FOREACH w IN ARRAY weights LOOP
    IF w < 0 THEN
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'A split weight cannot be negative';
    END IF;
    weight_sum := weight_sum + w;
  END LOOP;
  IF weight_sum = 0 THEN
    IF total <> 0 THEN
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Nothing to split over: every weight is zero';
    END IF;
    FOREACH w IN ARRAY weights LOOP result := result || 0::bigint; END LOOP;
    RETURN result;
  END IF;
  FOREACH w IN ARRAY weights LOOP
    prefix := prefix + w;
    current_value := lucy_cumulative_share(total, prefix, weight_sum);
    result := result || (current_value - previous);
    previous := current_value;
  END LOOP;
  RETURN result;
END;
$$;

-- --------------------------------------------------------------------------- the usage ledger: one row per (invoice, program)
DROP INDEX "discount_redemptions_invoice_key";
CREATE UNIQUE INDEX "discount_redemptions_invoice_discount_key" ON "discount_redemptions"("invoice_id", "discount_id");
CREATE INDEX "discount_redemptions_invoice_idx" ON "discount_redemptions"("invoice_id");

-- ------------------------------------------------------------------ the Spa-side application learns the shared amount
-- A shared (BOTH) program is evaluated once on the eligible subtotal of both sides and its amount is split between them; the side's
-- application records its own share (`computed_amount_vnd`, on its own `eligible_subtotal_vnd`) and the program-level figures.
ALTER TABLE "invoice_discount_applications" ADD COLUMN "shared_eligible_subtotal_vnd" BIGINT;
ALTER TABLE "invoice_discount_applications" ADD COLUMN "shared_amount_vnd" BIGINT;
ALTER TABLE "invoice_discount_applications" DROP CONSTRAINT "invoice_discount_applications_amount";
ALTER TABLE "invoice_discount_applications"
  ADD CONSTRAINT "invoice_discount_applications_amount" CHECK (
    ("shared_amount_vnd" IS NULL AND "shared_eligible_subtotal_vnd" IS NULL
      AND "eligible_subtotal_vnd" > 0 AND "computed_amount_vnd" > 0
      AND "computed_amount_vnd" <= "eligible_subtotal_vnd"
      AND "computed_amount_vnd" = (CASE "kind"
        WHEN 'PERCENT' THEN ("eligible_subtotal_vnd" * "percent_bp" + 5000) / 10000
        ELSE LEAST("fixed_amount_vnd", "eligible_subtotal_vnd") END))
    -- A shared program (T18): the program amount on the whole eligible subtotal as in Phase 4, then the Spa share by the primitive
    -- with weights (Spa eligible, the rest).
    OR ("shared_amount_vnd" IS NOT NULL AND "shared_eligible_subtotal_vnd" IS NOT NULL
      AND "eligible_subtotal_vnd" > 0 AND "computed_amount_vnd" > 0
      AND "computed_amount_vnd" <= "eligible_subtotal_vnd"
      AND "shared_eligible_subtotal_vnd" >= "eligible_subtotal_vnd"
      AND "shared_amount_vnd" >= "computed_amount_vnd"
      AND "shared_amount_vnd" = (CASE "kind"
        WHEN 'PERCENT' THEN ("shared_eligible_subtotal_vnd" * "percent_bp" + 5000) / 10000
        ELSE LEAST("fixed_amount_vnd", "shared_eligible_subtotal_vnd") END)
      AND "computed_amount_vnd" = lucy_cumulative_share("shared_amount_vnd", "eligible_subtotal_vnd", "shared_eligible_subtotal_vnd"))
  );

-- ------------------------------------------------------------------------------ the Beauty-side application and tier snapshot
CREATE TABLE "invoice_beauty_applications" (
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
    "shared_eligible_subtotal_vnd" BIGINT,
    "shared_amount_vnd" BIGINT,
    "candidates" JSONB NOT NULL,
    "selection_reason" TEXT NOT NULL,
    "finalized_by_user_id" UUID NOT NULL,
    "applied_at" TIMESTAMPTZ(3) NOT NULL DEFAULT clock_timestamp(),

    CONSTRAINT "invoice_beauty_applications_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "invoice_beauty_applications_value" CHECK (
      ("kind" = 'PERCENT' AND "percent_bp" IS NOT NULL AND "percent_bp" BETWEEN 1 AND 10000
        AND "fixed_amount_vnd" IS NULL)
      OR ("kind" = 'FIXED_AMOUNT' AND "fixed_amount_vnd" IS NOT NULL AND "fixed_amount_vnd" > 0
        AND "percent_bp" IS NULL)
    ),
    CONSTRAINT "invoice_beauty_applications_amount" CHECK (
      ("shared_amount_vnd" IS NULL AND "shared_eligible_subtotal_vnd" IS NULL
        AND "eligible_subtotal_vnd" > 0 AND "computed_amount_vnd" > 0
        AND "computed_amount_vnd" <= "eligible_subtotal_vnd"
        AND "computed_amount_vnd" = (CASE "kind"
          WHEN 'PERCENT' THEN ("eligible_subtotal_vnd" * "percent_bp" + 5000) / 10000
          ELSE LEAST("fixed_amount_vnd", "eligible_subtotal_vnd") END))
      -- A shared program: the Beauty share is what the Spa share leaves of the program amount (weights = Spa eligible, Beauty eligible).
      OR ("shared_amount_vnd" IS NOT NULL AND "shared_eligible_subtotal_vnd" IS NOT NULL
        AND "eligible_subtotal_vnd" > 0 AND "computed_amount_vnd" > 0
        AND "computed_amount_vnd" <= "eligible_subtotal_vnd"
        AND "shared_eligible_subtotal_vnd" >= "eligible_subtotal_vnd"
        AND "shared_amount_vnd" >= "computed_amount_vnd"
        AND "shared_amount_vnd" = (CASE "kind"
          WHEN 'PERCENT' THEN ("shared_eligible_subtotal_vnd" * "percent_bp" + 5000) / 10000
          ELSE LEAST("fixed_amount_vnd", "shared_eligible_subtotal_vnd") END)
        AND "computed_amount_vnd" = "shared_amount_vnd" - lucy_cumulative_share("shared_amount_vnd",
          "shared_eligible_subtotal_vnd" - "eligible_subtotal_vnd", "shared_eligible_subtotal_vnd"))
    ),
    CONSTRAINT "invoice_beauty_applications_candidates" CHECK (jsonb_typeof("candidates") = 'array'),
    CONSTRAINT "invoice_beauty_applications_reason_nonblank" CHECK ("selection_reason" !~ '^[[:space:]]*$')
);

CREATE UNIQUE INDEX "invoice_beauty_applications_invoice_key" ON "invoice_beauty_applications"("invoice_id");

-- The Beauty wallet's tier snapshot: the payer's Beauty tier from the balance BEFORE the invoice, frozen with the candidates and the winner.
CREATE TABLE "invoice_beauty_snapshots" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "invoice_id" UUID NOT NULL,
    "payer_user_id" UUID NOT NULL,
    "balance_before" INTEGER NOT NULL,
    "tier" "LoyaltyTier" NOT NULL,
    "tier_table_version" INTEGER NOT NULL,
    "member_discount_bp" INTEGER NOT NULL,
    "calculation_version" INTEGER NOT NULL,
    "eligible_beauty_vnd" BIGINT NOT NULL,
    "member_amount_vnd" BIGINT NOT NULL DEFAULT 0,
    "candidates" JSONB NOT NULL,
    "winner_source" TEXT,
    "selection_reason" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT clock_timestamp(),

    CONSTRAINT "invoice_beauty_snapshots_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "invoice_beauty_snapshots_values" CHECK (
      "balance_before" >= 0 AND "member_discount_bp" BETWEEN 0 AND 10000 AND "tier_table_version" >= 1
      AND "calculation_version" >= 3 AND "eligible_beauty_vnd" >= 0
    ),
    CONSTRAINT "invoice_beauty_snapshots_tier_v1" CHECK (
      "tier_table_version" <> 1 OR (
        ("tier" = 'NONE' AND "balance_before" BETWEEN 0 AND 499 AND "member_discount_bp" = 0)
        OR ("tier" = 'SILVER' AND "balance_before" BETWEEN 500 AND 999 AND "member_discount_bp" = 300)
        OR ("tier" = 'GOLD' AND "balance_before" BETWEEN 1000 AND 2999 AND "member_discount_bp" = 400)
        OR ("tier" = 'PLATINUM' AND "balance_before" BETWEEN 3000 AND 4999 AND "member_discount_bp" = 500)
        OR ("tier" = 'DIAMOND' AND "balance_before" BETWEEN 5000 AND 9999 AND "member_discount_bp" = 700)
        OR ("tier" = 'RUBY' AND "balance_before" >= 10000 AND "member_discount_bp" = 900)
      )
    ),
    -- The Beauty side has no birthday gift (Q7), so its winner is a promotion, a voucher or the member tier.
    CONSTRAINT "invoice_beauty_snapshots_winner" CHECK (
      "winner_source" IS NULL OR "winner_source" IN ('PROMOTION', 'VOUCHER', 'MEMBER_TIER')
    ),
    CONSTRAINT "invoice_beauty_snapshots_member_amount" CHECK (
      ("winner_source" = 'MEMBER_TIER'
        AND "member_discount_bp" > 0 AND "eligible_beauty_vnd" > 0 AND "member_amount_vnd" > 0
        AND "member_amount_vnd" <= "eligible_beauty_vnd"
        AND "member_amount_vnd" = ("eligible_beauty_vnd" * "member_discount_bp" + 5000) / 10000)
      OR (COALESCE("winner_source", '') <> 'MEMBER_TIER' AND "member_amount_vnd" = 0)
    )
);

CREATE UNIQUE INDEX "invoice_beauty_snapshots_invoice_key" ON "invoice_beauty_snapshots"("invoice_id");
CREATE INDEX "invoice_beauty_snapshots_payer_idx" ON "invoice_beauty_snapshots"("payer_user_id");

-- --------------------------------------------------------------------------------- net allocation of every line (T18, Q3)
CREATE TABLE "invoice_line_allocations" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "invoice_id" UUID NOT NULL,
    "invoice_line_id" UUID NOT NULL,
    "side" "PricingSide" NOT NULL,
    "gross_vnd" BIGINT NOT NULL,
    "discount_share_vnd" BIGINT NOT NULL,
    "net_vnd" BIGINT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT clock_timestamp(),

    CONSTRAINT "invoice_line_allocations_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "invoice_line_allocations_values" CHECK (
      "gross_vnd" >= 0 AND "discount_share_vnd" >= 0 AND "discount_share_vnd" <= "gross_vnd"
      AND "net_vnd" = "gross_vnd" - "discount_share_vnd"
    )
);

CREATE UNIQUE INDEX "invoice_line_allocations_line_key" ON "invoice_line_allocations"("invoice_line_id");
CREATE INDEX "invoice_line_allocations_invoice_idx" ON "invoice_line_allocations"("invoice_id", "side");

-- --------------------------------------------------------------------- payment attribution to the sides (T18, Q2)
-- Signed: a payment adds, its reversal mirrors it exactly. The sum per invoice is what has been attributed to each side; at PAID it
-- equals each side's net. Written only by the triggers below, only for a version 3 invoice.
CREATE TYPE "PaymentSideKind" AS ENUM ('PAYMENT', 'REVERSAL');

CREATE TABLE "payment_side_allocations" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "invoice_id" UUID NOT NULL,
    "payment_id" UUID NOT NULL,
    "side" "PricingSide" NOT NULL,
    "kind" "PaymentSideKind" NOT NULL,
    "amount_vnd" BIGINT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT clock_timestamp(),

    CONSTRAINT "payment_side_allocations_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "payment_side_allocations_nonzero" CHECK ("amount_vnd" <> 0)
);

CREATE UNIQUE INDEX "payment_side_allocations_payment_key" ON "payment_side_allocations"("payment_id", "side", "kind");
CREATE INDEX "payment_side_allocations_invoice_idx" ON "payment_side_allocations"("invoice_id", "side");

-- ------------------------------------------------------------------------------------------ foreign keys
ALTER TABLE "invoice_beauty_applications" ADD CONSTRAINT "invoice_beauty_applications_invoice_id_fkey" FOREIGN KEY ("invoice_id") REFERENCES "invoices"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "invoice_beauty_applications" ADD CONSTRAINT "invoice_beauty_applications_version_fkey" FOREIGN KEY ("discount_id", "version_id") REFERENCES "discount_versions"("discount_id", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "invoice_beauty_applications" ADD CONSTRAINT "invoice_beauty_applications_voucher_id_fkey" FOREIGN KEY ("voucher_id") REFERENCES "vouchers"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "invoice_beauty_applications" ADD CONSTRAINT "invoice_beauty_applications_finalized_by_user_id_fkey" FOREIGN KEY ("finalized_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "invoice_beauty_snapshots" ADD CONSTRAINT "invoice_beauty_snapshots_invoice_id_fkey" FOREIGN KEY ("invoice_id") REFERENCES "invoices"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "invoice_beauty_snapshots" ADD CONSTRAINT "invoice_beauty_snapshots_payer_user_id_fkey" FOREIGN KEY ("payer_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "invoice_line_allocations" ADD CONSTRAINT "invoice_line_allocations_line_fkey" FOREIGN KEY ("invoice_id", "invoice_line_id") REFERENCES "invoice_lines"("invoice_id", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "payment_side_allocations" ADD CONSTRAINT "payment_side_allocations_invoice_id_fkey" FOREIGN KEY ("invoice_id") REFERENCES "invoices"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "payment_side_allocations" ADD CONSTRAINT "payment_side_allocations_payment_id_fkey" FOREIGN KEY ("payment_id") REFERENCES "payments"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- ------------------------------------------------------------------------------------------------- guards
-- Spa-side application: unchanged, plus the scope (a program that may only discount products never applies to the Spa side).
CREATE OR REPLACE FUNCTION lucy_guard_discount_application() RETURNS trigger
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
  IF version.scope = 'PRODUCTS' THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'A program that may only discount products cannot apply to the Spa side';
  END IF;
  -- Only a shared (BOTH) program records a shared amount. A BOTH program applied by the version 2 engine (service-only invoice, which
  -- does not know the scope) is a plain application with no shared amount; the version 3 check below requires it for version 3.
  IF NEW.shared_amount_vnd IS NOT NULL AND version.scope <> 'BOTH' THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Only a shared (BOTH) program records a shared amount';
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

-- Beauty-side application: the same rules for a program that may discount products.
CREATE FUNCTION lucy_guard_beauty_application() RETURNS trigger
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
  IF version.scope = 'SERVICES' THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'A program that may only discount services cannot apply to the Beauty side';
  END IF;
  IF NEW.shared_amount_vnd IS NOT NULL AND version.scope <> 'BOTH' THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Only a shared (BOTH) program records a shared amount';
  END IF;
  IF NEW.shared_amount_vnd IS NULL AND version.scope = 'BOTH' THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'A shared (BOTH) program records its shared amount';
  END IF;
  SELECT requires_code INTO needs_code FROM discounts WHERE id = NEW.discount_id;
  IF NEW.voucher_id IS NULL THEN
    IF needs_code IS DISTINCT FROM false THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'A benefit without a voucher must come from a code-less promotion';
    END IF;
  ELSE
    SELECT discount_id INTO voucher_discount FROM vouchers WHERE id = NEW.voucher_id;
    IF needs_code IS DISTINCT FROM true OR voucher_discount IS DISTINCT FROM NEW.discount_id THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'A voucher benefit must use a code of its own program';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

-- Redemption: one row per (invoice, program). It records exactly a benefit applied to one of the invoice's sides; usage limits and the
-- member requirement are enforced under the program row lock as before, so two finalizations can never both take the last usage.
CREATE OR REPLACE FUNCTION lucy_guard_discount_redemption() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  target invoices%ROWTYPE;
  version discount_versions%ROWTYPE;
  active_total bigint;
  active_customer bigint;
BEGIN
  SELECT * INTO target FROM invoices WHERE id = NEW.invoice_id FOR SHARE;
  IF target.status IS DISTINCT FROM 'DRAFT' AND target.status IS DISTINCT FROM 'PENDING_PAYMENT'
    AND target.status IS DISTINCT FROM 'PAID' THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'A redemption is recorded for an invoice being finalized, never a cancelled one';
  END IF;
  IF NOT EXISTS (
      SELECT 1 FROM invoice_discount_applications a
      WHERE a.invoice_id = NEW.invoice_id AND a.discount_id = NEW.discount_id AND a.version_id = NEW.version_id
        AND a.voucher_id IS NOT DISTINCT FROM NEW.voucher_id)
    AND NOT EXISTS (
      SELECT 1 FROM invoice_beauty_applications b
      WHERE b.invoice_id = NEW.invoice_id AND b.discount_id = NEW.discount_id AND b.version_id = NEW.version_id
        AND b.voucher_id IS NOT DISTINCT FROM NEW.voucher_id) THEN
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

-- Beauty tier snapshot: a member payer, an invoice being finalized, and loyalty live (checked by the shared go-live trigger).
CREATE FUNCTION lucy_guard_invoice_beauty_snapshot() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  target invoices%ROWTYPE;
BEGIN
  SELECT i.* INTO target FROM invoices i WHERE i.id = NEW.invoice_id FOR SHARE;
  IF target.status IS NULL OR target.status = 'CANCELLED' THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'A tier snapshot belongs to an invoice being finalized, never a cancelled one';
  END IF;
  IF target.payer_user_id IS NULL OR target.payer_user_id IS DISTINCT FROM NEW.payer_user_id THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'A tier snapshot records the identified member payer of its invoice';
  END IF;
  NEW.created_at := clock_timestamp();
  RETURN NEW;
END;
$$;

-- Line allocation: written while the invoice is being finalized; the line's side follows its kind and the gross is the line's gross.
CREATE FUNCTION lucy_guard_invoice_line_allocation() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  invoice_status "InvoiceStatus";
  line invoice_lines%ROWTYPE;
BEGIN
  SELECT status INTO invoice_status FROM invoices WHERE id = NEW.invoice_id FOR SHARE;
  IF invoice_status IS DISTINCT FROM 'DRAFT' THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Line net amounts are written while the invoice is being finalized';
  END IF;
  SELECT * INTO line FROM invoice_lines WHERE id = NEW.invoice_line_id AND invoice_id = NEW.invoice_id;
  IF NOT FOUND OR line.gross_vnd IS DISTINCT FROM NEW.gross_vnd THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'A line allocation records the gross of its line';
  END IF;
  IF (line.kind = 'PRODUCT') <> (NEW.side = 'BEAUTY') THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'A product line belongs to the Beauty side and every other line to the Spa side';
  END IF;
  NEW.created_at := clock_timestamp();
  RETURN NEW;
END;
$$;

-- ------------------------------------------------------------------------------------ payment attribution (T18, Q2)
-- Runs when a payment becomes SUCCEEDED (insert or the PENDING -> SUCCEEDED update). Attributes the payment so that the cumulative
-- amount attributed to each side is the cumulative share of the effective paid amount (capped at the sum of the side nets): the delta
-- between that target and what is attributed now. A reversal removes exactly what its payment added, so after any sequence of
-- payments and reversals the NEXT payment realigns the sides, and at PAID each side holds exactly its net. A version 2 invoice
-- (every service-only invoice) returns at once and writes nothing.
CREATE FUNCTION lucy_allocate_payment_sides() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  target invoices%ROWTYPE;
  version_value integer;
  spa_net bigint;
  beauty_net bigint;
  net_total bigint;
  paid_cap bigint;
  attributed_spa bigint;
  attributed_beauty bigint;
  target_spa bigint;
  delta_spa bigint;
  delta_beauty bigint;
BEGIN
  IF NEW.status <> 'SUCCEEDED' OR (TG_OP = 'UPDATE' AND OLD.status = 'SUCCEEDED') THEN
    RETURN NULL;
  END IF;
  SELECT calculation_version INTO version_value FROM invoices WHERE id = NEW.invoice_id;
  IF version_value IS NULL OR version_value < 3 THEN
    RETURN NULL;
  END IF;
  -- Serialize with every other payment, reversal and cancellation of this invoice (the payment guard already holds this lock on insert).
  SELECT * INTO target FROM invoices WHERE id = NEW.invoice_id FOR UPDATE;
  SELECT COALESCE(sum(net_vnd) FILTER (WHERE side = 'SPA'), 0), COALESCE(sum(net_vnd) FILTER (WHERE side = 'BEAUTY'), 0)
    INTO spa_net, beauty_net FROM invoice_line_allocations WHERE invoice_id = target.id;
  net_total := spa_net + beauty_net;
  IF net_total = 0 THEN
    RETURN NULL;
  END IF;
  paid_cap := LEAST(lucy_invoice_effective_paid(target.id), net_total);
  SELECT COALESCE(sum(amount_vnd) FILTER (WHERE side = 'SPA'), 0), COALESCE(sum(amount_vnd) FILTER (WHERE side = 'BEAUTY'), 0)
    INTO attributed_spa, attributed_beauty FROM payment_side_allocations WHERE invoice_id = target.id;
  target_spa := lucy_cumulative_share(paid_cap, spa_net, net_total);
  delta_spa := target_spa - attributed_spa;
  delta_beauty := (paid_cap - target_spa) - attributed_beauty;
  IF delta_spa <> 0 THEN
    INSERT INTO payment_side_allocations (invoice_id, payment_id, side, kind, amount_vnd)
      VALUES (target.id, NEW.id, 'SPA', 'PAYMENT', delta_spa);
  END IF;
  IF delta_beauty <> 0 THEN
    INSERT INTO payment_side_allocations (invoice_id, payment_id, side, kind, amount_vnd)
      VALUES (target.id, NEW.id, 'BEAUTY', 'PAYMENT', delta_beauty);
  END IF;
  RETURN NULL;
END;
$$;

-- A reversal mirrors the attribution of the payment it reverses, exactly.
CREATE FUNCTION lucy_allocate_payment_reversal_sides() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  target_invoice uuid;
BEGIN
  SELECT invoice_id INTO target_invoice FROM payments WHERE id = NEW.payment_id;
  PERFORM 1 FROM invoices WHERE id = target_invoice AND calculation_version >= 3 FOR UPDATE;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;
  INSERT INTO payment_side_allocations (invoice_id, payment_id, side, kind, amount_vnd)
    SELECT a.invoice_id, a.payment_id, a.side, 'REVERSAL', -a.amount_vnd
    FROM payment_side_allocations a WHERE a.payment_id = NEW.payment_id AND a.kind = 'PAYMENT';
  RETURN NULL;
END;
$$;

-- At commit: what is attributed adds up to the effective paid amount (capped at the sum of the side nets) and, once the invoice is
-- fully paid, each side holds exactly its net. A shipping fee (Wave 4) is attributed to no side, so the equality is for fee 0 only.
CREATE FUNCTION lucy_check_payment_side_allocations() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  target invoices%ROWTYPE;
  spa_net bigint;
  beauty_net bigint;
  attributed_spa bigint;
  attributed_beauty bigint;
  effective bigint;
BEGIN
  SELECT * INTO target FROM invoices WHERE id = NEW.invoice_id;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;
  IF target.calculation_version < 3 THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Payment side attribution belongs to a version 3 invoice';
  END IF;
  SELECT COALESCE(sum(net_vnd) FILTER (WHERE side = 'SPA'), 0), COALESCE(sum(net_vnd) FILTER (WHERE side = 'BEAUTY'), 0)
    INTO spa_net, beauty_net FROM invoice_line_allocations WHERE invoice_id = target.id;
  SELECT COALESCE(sum(amount_vnd) FILTER (WHERE side = 'SPA'), 0), COALESCE(sum(amount_vnd) FILTER (WHERE side = 'BEAUTY'), 0)
    INTO attributed_spa, attributed_beauty FROM payment_side_allocations WHERE invoice_id = target.id;
  effective := lucy_invoice_effective_paid(target.id);
  IF target.shipping_fee_vnd = 0 THEN
    IF attributed_spa + attributed_beauty <> LEAST(effective, spa_net + beauty_net) THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'What is attributed to the sides must equal the effective payments';
    END IF;
    IF effective = spa_net + beauty_net AND (attributed_spa <> spa_net OR attributed_beauty <> beauty_net) THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'A fully paid invoice has each side paid exactly its net amount';
    END IF;
  END IF;
  RETURN NULL;
END;
$$;

-- --------------------------------------------------------------------------- commit-time integrity of a version 3 invoice
-- `discount = Spa part + Beauty part`; on each side either a program application or the member amount, never both (the Spa side adds
-- the birthday gift as in Phase 5); every applied program is redeemed exactly once and nothing else is; a program used on both sides is
-- a shared one with consistent amounts; every line has its net allocation and the allocations add up to the sides and the receivable.
CREATE FUNCTION lucy_check_invoice_pricing_v3(target_id uuid) RETURNS void
LANGUAGE plpgsql AS $$
DECLARE
  target invoices%ROWTYPE;
  spa_app invoice_discount_applications%ROWTYPE;
  beauty_app invoice_beauty_applications%ROWTYPE;
  spa_snap invoice_loyalty_snapshots%ROWTYPE;
  beauty_snap invoice_beauty_snapshots%ROWTYPE;
  gift birthday_redemptions%ROWTYPE;
  has_spa_app boolean;
  has_beauty_app boolean;
  has_spa_snap boolean;
  has_beauty_snap boolean;
  has_gift boolean;
  spa_discount bigint;
  beauty_discount bigint;
  spa_gross bigint;
  beauty_gross bigint;
  line_count integer;
  allocation_count integer;
  spa_shares bigint;
  beauty_shares bigint;
  net_sum bigint;
BEGIN
  SELECT * INTO target FROM invoices WHERE id = target_id;
  IF NOT FOUND THEN
    RETURN;
  END IF;
  SELECT * INTO spa_app FROM invoice_discount_applications WHERE invoice_id = target.id;
  has_spa_app := FOUND;
  SELECT * INTO beauty_app FROM invoice_beauty_applications WHERE invoice_id = target.id;
  has_beauty_app := FOUND;
  SELECT * INTO spa_snap FROM invoice_loyalty_snapshots WHERE invoice_id = target.id;
  has_spa_snap := FOUND;
  SELECT * INTO beauty_snap FROM invoice_beauty_snapshots WHERE invoice_id = target.id;
  has_beauty_snap := FOUND;
  SELECT * INTO gift FROM birthday_redemptions WHERE invoice_id = target.id;
  has_gift := FOUND;
  IF target.finalized_at IS NULL THEN
    IF has_spa_app OR has_beauty_app OR has_spa_snap OR has_beauty_snap OR has_gift
      OR EXISTS (SELECT 1 FROM discount_redemptions WHERE invoice_id = target.id)
      OR EXISTS (SELECT 1 FROM invoice_line_allocations WHERE invoice_id = target.id) THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'A draft invoice has no applied benefit, redemption, snapshot or line allocation yet';
    END IF;
    RETURN;
  END IF;
  -- The Spa part (the Phase 5 reading): the applied program benefit, or the member amount, or nothing when a lone birthday gift is
  -- the only benefit; plus the gift on top of a combinable ordinary benefit.
  IF has_spa_snap AND spa_snap.winner_source IN ('MEMBER_TIER', 'BIRTHDAY') THEN
    IF has_spa_app THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'A member discount or a lone birthday gift excludes every program benefit on the Spa side';
    END IF;
    spa_discount := CASE WHEN spa_snap.winner_source = 'MEMBER_TIER' THEN spa_snap.member_amount_vnd ELSE 0 END;
  ELSE
    spa_discount := COALESCE(spa_app.computed_amount_vnd, 0);
  END IF;
  IF has_spa_snap THEN
    spa_discount := spa_discount + spa_snap.birthday_amount_vnd;
  END IF;
  IF has_spa_snap AND spa_snap.winner_source IN ('PROMOTION', 'VOUCHER') AND NOT has_spa_app THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'A program benefit named by the snapshot must be applied';
  END IF;
  -- The Beauty part: the applied program benefit or the member amount, never both.
  IF has_beauty_snap AND beauty_snap.winner_source = 'MEMBER_TIER' THEN
    IF has_beauty_app THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'A member discount excludes every program benefit on the Beauty side';
    END IF;
    beauty_discount := beauty_snap.member_amount_vnd;
  ELSE
    beauty_discount := COALESCE(beauty_app.computed_amount_vnd, 0);
  END IF;
  IF has_beauty_snap AND beauty_snap.winner_source IN ('PROMOTION', 'VOUCHER') AND NOT has_beauty_app THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'A program benefit named by the snapshot must be applied';
  END IF;
  IF target.discount_total_vnd <> spa_discount + beauty_discount THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'The invoice discount total must equal the benefits applied to its sides';
  END IF;
  -- Eligible amounts never exceed the side they belong to.
  SELECT COALESCE(sum(gross_vnd) FILTER (WHERE kind <> 'PRODUCT'), 0), COALESCE(sum(gross_vnd) FILTER (WHERE kind = 'PRODUCT'), 0)
    INTO spa_gross, beauty_gross FROM invoice_lines WHERE invoice_id = target.id;
  IF (has_spa_snap AND spa_snap.eligible_spa_vnd > spa_gross) OR (has_spa_app AND spa_app.eligible_subtotal_vnd > spa_gross)
    OR (has_beauty_snap AND beauty_snap.eligible_beauty_vnd > beauty_gross)
    OR (has_beauty_app AND beauty_app.eligible_subtotal_vnd > beauty_gross) THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'The eligible subtotal cannot exceed the side it belongs to';
  END IF;
  IF (has_spa_app AND spa_app.voucher_id IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM invoice_voucher_entries e
        WHERE e.invoice_id = target.id AND e.voucher_id = spa_app.voucher_id AND e.removed_at IS NULL))
    OR (has_beauty_app AND beauty_app.voucher_id IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM invoice_voucher_entries e
        WHERE e.invoice_id = target.id AND e.voucher_id = beauty_app.voucher_id AND e.removed_at IS NULL)) THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'A voucher benefit needs its code supplied to the invoice';
  END IF;
  -- On a version 3 invoice every BOTH program is applied with its shared amount (the engine always splits it).
  IF (has_spa_app AND spa_app.shared_amount_vnd IS NULL AND EXISTS (
        SELECT 1 FROM discount_versions v WHERE v.id = spa_app.version_id AND v.scope = 'BOTH'))
    OR (has_beauty_app AND beauty_app.shared_amount_vnd IS NULL AND EXISTS (
        SELECT 1 FROM discount_versions v WHERE v.id = beauty_app.version_id AND v.scope = 'BOTH')) THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'A shared (BOTH) program on a version 3 invoice records its shared amount';
  END IF;
  -- A program applied to both sides is one shared program with one version and code, and its two shares are its amount.
  IF has_spa_app AND has_beauty_app AND spa_app.discount_id = beauty_app.discount_id THEN
    IF (spa_app.version_id, spa_app.voucher_id, spa_app.shared_amount_vnd, spa_app.shared_eligible_subtotal_vnd)
        IS DISTINCT FROM (beauty_app.version_id, beauty_app.voucher_id, beauty_app.shared_amount_vnd, beauty_app.shared_eligible_subtotal_vnd)
      OR spa_app.shared_amount_vnd IS NULL
      OR spa_app.eligible_subtotal_vnd + beauty_app.eligible_subtotal_vnd <> spa_app.shared_eligible_subtotal_vnd
      OR spa_app.computed_amount_vnd + beauty_app.computed_amount_vnd <> spa_app.shared_amount_vnd THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'A program applied to both sides is one shared program whose shares add up to its amount';
    END IF;
  END IF;
  -- Every applied program is redeemed exactly once (the unique key makes "at most once"), and nothing else is redeemed.
  IF EXISTS (
      SELECT 1 FROM (
        SELECT discount_id, version_id, voucher_id FROM invoice_discount_applications WHERE invoice_id = target.id
        UNION
        SELECT discount_id, version_id, voucher_id FROM invoice_beauty_applications WHERE invoice_id = target.id) applied
      WHERE NOT EXISTS (
        SELECT 1 FROM discount_redemptions r
        WHERE r.invoice_id = target.id AND r.discount_id = applied.discount_id AND r.version_id = applied.version_id
          AND r.voucher_id IS NOT DISTINCT FROM applied.voucher_id))
    OR EXISTS (
      SELECT 1 FROM discount_redemptions r
      WHERE r.invoice_id = target.id
        AND NOT EXISTS (SELECT 1 FROM invoice_discount_applications a
          WHERE a.invoice_id = target.id AND a.discount_id = r.discount_id AND a.version_id = r.version_id
            AND a.voucher_id IS NOT DISTINCT FROM r.voucher_id)
        AND NOT EXISTS (SELECT 1 FROM invoice_beauty_applications b
          WHERE b.invoice_id = target.id AND b.discount_id = r.discount_id AND b.version_id = r.version_id
            AND b.voucher_id IS NOT DISTINCT FROM r.voucher_id)) THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'An applied benefit is redeemed exactly once';
  END IF;
  -- The birthday gift (Spa side): worth money <=> exactly one redemption recording that amount.
  IF has_spa_snap AND (spa_snap.birthday_amount_vnd > 0) <> has_gift THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'A birthday gift is redeemed exactly once';
  END IF;
  IF has_gift AND (NOT has_spa_snap OR gift.amount_vnd <> spa_snap.birthday_amount_vnd) THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'A birthday redemption records exactly the gift of its invoice snapshot';
  END IF;
  -- Cancellation releases every redemption in the same transaction; nothing else does.
  IF EXISTS (
    SELECT 1 FROM discount_redemptions r
    WHERE r.invoice_id = target.id
      AND (target.status = 'CANCELLED') <> EXISTS (SELECT 1 FROM discount_redemption_releases l WHERE l.redemption_id = r.id)) THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'A redemption is released exactly when its invoice is cancelled';
  END IF;
  IF has_gift AND (target.status = 'CANCELLED') <> EXISTS (
    SELECT 1 FROM birthday_redemption_releases l WHERE l.redemption_id = gift.id) THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'A birthday redemption is released exactly when its invoice is cancelled';
  END IF;
  -- The line net amounts: every line has one, the shares add up to each side's discount, and the nets add up to the receivable.
  SELECT count(*) INTO line_count FROM invoice_lines WHERE invoice_id = target.id;
  SELECT count(*), COALESCE(sum(discount_share_vnd) FILTER (WHERE side = 'SPA'), 0),
         COALESCE(sum(discount_share_vnd) FILTER (WHERE side = 'BEAUTY'), 0), COALESCE(sum(net_vnd), 0)
    INTO allocation_count, spa_shares, beauty_shares, net_sum FROM invoice_line_allocations WHERE invoice_id = target.id;
  IF allocation_count <> line_count THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Every line of a version 3 invoice has its net allocation';
  END IF;
  IF spa_shares <> spa_discount OR beauty_shares <> beauty_discount THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'The line allocations must add up to the discount of each side';
  END IF;
  IF net_sum <> target.total_vnd - target.shipping_fee_vnd THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'The line net amounts must add up to the receivable without the shipping fee';
  END IF;
END;
$$;

-- The rows of the new tables belong to a version 3 invoice and re-run its check.
CREATE FUNCTION lucy_check_invoice_pricing_row() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  target invoices%ROWTYPE;
BEGIN
  SELECT * INTO target FROM invoices WHERE id = NEW.invoice_id;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;
  IF target.calculation_version < 3 THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Per-side pricing rows belong to a version 3 invoice';
  END IF;
  PERFORM lucy_check_invoice_pricing_v3(target.id);
  RETURN NULL;
END;
$$;

-- The Phase 4/5 check, unchanged for every invoice below version 3; a version 3 invoice goes to the check above.
CREATE OR REPLACE FUNCTION lucy_check_invoice_discount() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  invoice_id_value uuid;
  target invoices%ROWTYPE;
  applied invoice_discount_applications%ROWTYPE;
  snap invoice_loyalty_snapshots%ROWTYPE;
  gift birthday_redemptions%ROWTYPE;
  has_application boolean;
  has_redemption boolean;
  has_snapshot boolean;
  has_gift boolean;
  released boolean;
  expected bigint;
BEGIN
  IF TG_TABLE_NAME = 'invoices' THEN
    invoice_id_value := NEW.id;
  ELSIF TG_TABLE_NAME = 'discount_redemption_releases' THEN
    SELECT invoice_id INTO invoice_id_value FROM discount_redemptions WHERE id = NEW.redemption_id;
  ELSIF TG_TABLE_NAME = 'birthday_redemption_releases' THEN
    SELECT invoice_id INTO invoice_id_value FROM birthday_redemptions WHERE id = NEW.redemption_id;
  ELSE
    invoice_id_value := NEW.invoice_id;
  END IF;
  SELECT * INTO target FROM invoices WHERE id = invoice_id_value;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;
  IF target.calculation_version >= 3 THEN
    PERFORM lucy_check_invoice_pricing_v3(target.id);
    RETURN NULL;
  END IF;
  SELECT * INTO applied FROM invoice_discount_applications WHERE invoice_id = target.id;
  has_application := FOUND;
  SELECT * INTO snap FROM invoice_loyalty_snapshots WHERE invoice_id = target.id;
  has_snapshot := FOUND;
  SELECT * INTO gift FROM birthday_redemptions WHERE invoice_id = target.id;
  has_gift := FOUND;
  has_redemption := EXISTS (SELECT 1 FROM discount_redemptions WHERE invoice_id = target.id);
  IF target.finalized_at IS NULL THEN
    -- A draft stores only header amounts and supplied entries; the benefit, redemption and tier snapshot are frozen at finalization.
    IF has_application OR has_redemption OR has_gift THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'A draft invoice has no applied benefit or redemption yet';
    END IF;
    IF has_snapshot THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'A draft invoice has no tier snapshot yet';
    END IF;
    RETURN NULL;
  END IF;
  -- Finalized: the ordinary part is the applied program benefit, or the member amount when the Member Discount won, or nothing
  -- when the birthday gift is the only benefit (it won alone or replaced a smaller offer); then no program benefit is applied
  -- or redeemed. The gift adds its own amount on top of a combinable ordinary benefit.
  IF has_snapshot AND snap.winner_source IN ('MEMBER_TIER', 'BIRTHDAY') THEN
    IF has_application OR has_redemption THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'A member discount or a lone birthday gift excludes every program benefit';
    END IF;
    expected := CASE WHEN snap.winner_source = 'MEMBER_TIER' THEN snap.member_amount_vnd ELSE 0 END;
  ELSE
    expected := COALESCE(applied.computed_amount_vnd, 0);
  END IF;
  IF has_snapshot THEN
    expected := expected + snap.birthday_amount_vnd;
  END IF;
  IF target.discount_total_vnd <> expected THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'The invoice discount total must equal its applied benefit';
  END IF;
  IF has_snapshot AND snap.winner_source IN ('PROMOTION', 'VOUCHER') AND NOT has_application THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'A program benefit named by the snapshot must be applied';
  END IF;
  IF has_snapshot AND snap.eligible_spa_vnd > target.subtotal_vnd THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'The eligible subtotal cannot exceed the invoice subtotal';
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
  -- The birthday gift: worth money <=> exactly one redemption recording that amount.
  IF has_snapshot AND (snap.birthday_amount_vnd > 0) <> has_gift THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'A birthday gift is redeemed exactly once';
  END IF;
  IF has_gift AND (NOT has_snapshot OR gift.amount_vnd <> snap.birthday_amount_vnd) THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'A birthday redemption records exactly the gift of its invoice snapshot';
  END IF;
  -- Cancellation releases the redemption in the same transaction (design 5.5); nothing else does.
  released := EXISTS (
    SELECT 1 FROM discount_redemption_releases l JOIN discount_redemptions r ON r.id = l.redemption_id
    WHERE r.invoice_id = target.id);
  IF has_redemption AND (target.status = 'CANCELLED') <> released THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'A redemption is released exactly when its invoice is cancelled';
  END IF;
  released := EXISTS (
    SELECT 1 FROM birthday_redemption_releases l JOIN birthday_redemptions r ON r.id = l.redemption_id
    WHERE r.invoice_id = target.id);
  IF has_gift AND (target.status = 'CANCELLED') <> released THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'A birthday redemption is released exactly when its invoice is cancelled';
  END IF;
  RETURN NULL;
END;
$$;

-- ------------------------------------------------------------------------------------------------ triggers
CREATE TRIGGER "invoice_beauty_applications_guard" BEFORE INSERT ON "invoice_beauty_applications"
FOR EACH ROW EXECUTE FUNCTION lucy_guard_beauty_application();
CREATE TRIGGER "invoice_beauty_snapshots_a_live" BEFORE INSERT ON "invoice_beauty_snapshots"
FOR EACH ROW EXECUTE FUNCTION lucy_require_loyalty_go_live();
CREATE TRIGGER "invoice_beauty_snapshots_guard" BEFORE INSERT ON "invoice_beauty_snapshots"
FOR EACH ROW EXECUTE FUNCTION lucy_guard_invoice_beauty_snapshot();
CREATE TRIGGER "invoice_line_allocations_guard" BEFORE INSERT ON "invoice_line_allocations"
FOR EACH ROW EXECUTE FUNCTION lucy_guard_invoice_line_allocation();

CREATE CONSTRAINT TRIGGER "invoice_beauty_applications_integrity" AFTER INSERT ON "invoice_beauty_applications"
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION lucy_check_invoice_pricing_row();
CREATE CONSTRAINT TRIGGER "invoice_beauty_snapshots_integrity" AFTER INSERT ON "invoice_beauty_snapshots"
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION lucy_check_invoice_pricing_row();
CREATE CONSTRAINT TRIGGER "invoice_line_allocations_integrity" AFTER INSERT ON "invoice_line_allocations"
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION lucy_check_invoice_pricing_row();

CREATE TRIGGER "payments_side_allocation" AFTER INSERT OR UPDATE ON "payments"
FOR EACH ROW EXECUTE FUNCTION lucy_allocate_payment_sides();
CREATE TRIGGER "payment_corrections_side_allocation" AFTER INSERT ON "payment_corrections"
FOR EACH ROW EXECUTE FUNCTION lucy_allocate_payment_reversal_sides();
CREATE CONSTRAINT TRIGGER "payment_side_allocations_integrity" AFTER INSERT ON "payment_side_allocations"
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION lucy_check_payment_side_allocations();

-- History is permanent: every new table is append-only and never truncated.
CREATE TRIGGER "invoice_beauty_applications_append_only" BEFORE UPDATE OR DELETE ON "invoice_beauty_applications" FOR EACH ROW EXECUTE FUNCTION lucy_reject_permanent_history_mutation();
CREATE TRIGGER "invoice_beauty_snapshots_append_only" BEFORE UPDATE OR DELETE ON "invoice_beauty_snapshots" FOR EACH ROW EXECUTE FUNCTION lucy_reject_permanent_history_mutation();
CREATE TRIGGER "invoice_line_allocations_append_only" BEFORE UPDATE OR DELETE ON "invoice_line_allocations" FOR EACH ROW EXECUTE FUNCTION lucy_reject_permanent_history_mutation();
CREATE TRIGGER "payment_side_allocations_append_only" BEFORE UPDATE OR DELETE ON "payment_side_allocations" FOR EACH ROW EXECUTE FUNCTION lucy_reject_permanent_history_mutation();
CREATE TRIGGER "invoice_beauty_applications_no_truncate" BEFORE TRUNCATE ON "invoice_beauty_applications" FOR EACH STATEMENT EXECUTE FUNCTION lucy_reject_permanent_history_mutation();
CREATE TRIGGER "invoice_beauty_snapshots_no_truncate" BEFORE TRUNCATE ON "invoice_beauty_snapshots" FOR EACH STATEMENT EXECUTE FUNCTION lucy_reject_permanent_history_mutation();
CREATE TRIGGER "invoice_line_allocations_no_truncate" BEFORE TRUNCATE ON "invoice_line_allocations" FOR EACH STATEMENT EXECUTE FUNCTION lucy_reject_permanent_history_mutation();
CREATE TRIGGER "payment_side_allocations_no_truncate" BEFORE TRUNCATE ON "payment_side_allocations" FOR EACH STATEMENT EXECUTE FUNCTION lucy_reject_permanent_history_mutation();

-- Function hardening (the Phase 1 convention): a fixed search_path and no PUBLIC execute, for everything this migration creates or replaces.
DO $$
DECLARE
  migration_schema text := current_schema();
  function_name text;
BEGIN
  FOREACH function_name IN ARRAY ARRAY[
    'lucy_guard_discount_application', 'lucy_guard_beauty_application', 'lucy_guard_discount_redemption',
    'lucy_guard_invoice_beauty_snapshot', 'lucy_guard_invoice_line_allocation', 'lucy_allocate_payment_sides',
    'lucy_allocate_payment_reversal_sides', 'lucy_check_payment_side_allocations', 'lucy_check_invoice_pricing_row',
    'lucy_check_invoice_discount'
  ] LOOP
    EXECUTE format('ALTER FUNCTION %I.%I() SET search_path TO pg_catalog, %I, pg_temp',
      migration_schema, function_name, migration_schema);
    EXECUTE format('REVOKE ALL ON FUNCTION %I.%I() FROM PUBLIC', migration_schema, function_name);
  END LOOP;
  EXECUTE format('ALTER FUNCTION %I.lucy_cumulative_share(bigint, bigint, bigint) SET search_path TO pg_catalog, %I, pg_temp',
    migration_schema, migration_schema);
  EXECUTE format('REVOKE ALL ON FUNCTION %I.lucy_cumulative_share(bigint, bigint, bigint) FROM PUBLIC', migration_schema);
  EXECUTE format('ALTER FUNCTION %I.lucy_split_pro_rata(bigint, bigint[]) SET search_path TO pg_catalog, %I, pg_temp',
    migration_schema, migration_schema);
  EXECUTE format('REVOKE ALL ON FUNCTION %I.lucy_split_pro_rata(bigint, bigint[]) FROM PUBLIC', migration_schema);
  EXECUTE format('ALTER FUNCTION %I.lucy_check_invoice_pricing_v3(uuid) SET search_path TO pg_catalog, %I, pg_temp',
    migration_schema, migration_schema);
  EXECUTE format('REVOKE ALL ON FUNCTION %I.lucy_check_invoice_pricing_v3(uuid) FROM PUBLIC', migration_schema);
END;
$$;
