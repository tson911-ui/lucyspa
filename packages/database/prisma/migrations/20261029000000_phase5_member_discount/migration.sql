-- Phase 5 P5-4: the Member Discount (tier) as a candidate of the best-offer selection (design 5.2-5.3, 6; calculation_version 2).
-- The Member Discount consumes nothing (no program, no voucher, no usage), so it has no application/redemption rows. Its authority is the
-- per-invoice loyalty snapshot written at finalization: the payer's Spa balance before the invoice, the tier, the applied basis points,
-- the candidates and the winner. This migration lets the snapshot carry the member amount and teaches the invoice integrity check that
-- the invoice discount is EITHER the applied program benefit OR the member amount, never both. Additive; existing rows are untouched.

ALTER TABLE "invoice_loyalty_snapshots" ADD COLUMN "member_amount_vnd" BIGINT NOT NULL DEFAULT 0;

ALTER TABLE "invoice_loyalty_snapshots"
  ADD CONSTRAINT "invoice_loyalty_snapshots_winner" CHECK (
    "winner_source" IS NULL OR "winner_source" IN ('PROMOTION', 'VOUCHER', 'MEMBER_TIER')
  ),
  -- PRD 16.1: the member benefit is computed on the eligible amount before any benefit, percent rounded half up to 1 VND (Phase 4 Q3);
  -- it is the invoice discount only when it won, and is 0 otherwise.
  ADD CONSTRAINT "invoice_loyalty_snapshots_member_amount" CHECK (
    ("winner_source" = 'MEMBER_TIER'
      AND "member_discount_bp" > 0 AND "eligible_spa_vnd" > 0 AND "member_amount_vnd" > 0
      AND "member_amount_vnd" <= "eligible_spa_vnd"
      AND "member_amount_vnd" = ("eligible_spa_vnd" * "member_discount_bp" + 5000) / 10000)
    OR (COALESCE("winner_source", '') <> 'MEMBER_TIER' AND "member_amount_vnd" = 0)
  );

-- The commit-time discount integrity of an invoice, now member-aware.
CREATE OR REPLACE FUNCTION lucy_check_invoice_discount() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  invoice_id_value uuid;
  target invoices%ROWTYPE;
  applied invoice_discount_applications%ROWTYPE;
  snap invoice_loyalty_snapshots%ROWTYPE;
  has_application boolean;
  has_redemption boolean;
  has_snapshot boolean;
  released boolean;
  expected bigint;
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
  SELECT * INTO snap FROM invoice_loyalty_snapshots WHERE invoice_id = target.id;
  has_snapshot := FOUND;
  has_redemption := EXISTS (SELECT 1 FROM discount_redemptions WHERE invoice_id = target.id);
  IF target.finalized_at IS NULL THEN
    -- A draft stores only header amounts and supplied entries; the benefit, redemption and tier snapshot are frozen at finalization.
    IF has_application OR has_redemption THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'A draft invoice has no applied benefit or redemption yet';
    END IF;
    IF has_snapshot THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'A draft invoice has no tier snapshot yet';
    END IF;
    RETURN NULL;
  END IF;
  -- Finalized: the header discount is exactly the winning benefit (0 when none won): the applied program benefit, or the member
  -- amount when the Member Discount won (then no program benefit is applied or redeemed). An applied benefit is redeemed exactly
  -- once, a voucher benefit had its code supplied, and the eligible subtotal cannot exceed the invoice subtotal.
  IF has_snapshot AND snap.winner_source = 'MEMBER_TIER' THEN
    IF has_application OR has_redemption THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'A member discount excludes every other benefit';
    END IF;
    expected := snap.member_amount_vnd;
  ELSE
    expected := COALESCE(applied.computed_amount_vnd, 0);
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

CREATE CONSTRAINT TRIGGER "invoice_loyalty_snapshots_discount_integrity" AFTER INSERT ON "invoice_loyalty_snapshots"
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION lucy_check_invoice_discount();

-- CREATE OR REPLACE drops the function-level settings: restore the Phase 1 convention (fixed search_path, no PUBLIC execute).
DO $$
DECLARE
  migration_schema text := current_schema();
BEGIN
  EXECUTE format('ALTER FUNCTION %I.%I() SET search_path TO pg_catalog, %I, pg_temp',
    migration_schema, 'lucy_check_invoice_discount', migration_schema);
  EXECUTE format('REVOKE ALL ON FUNCTION %I.%I() FROM PUBLIC', migration_schema, 'lucy_check_invoice_discount');
END;
$$;
