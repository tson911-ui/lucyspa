-- Phase 5 P5-6: the birthday gift (design 6.3, 8; Owner decisions of 2026-10-04 in design 2.5, OQ-8). Additive.
--  * Ships EMPTY: no configuration row and no version exist after this migration; without one there is no birthday gift.
--  * MANAGE_BIRTHDAY_REWARDS becomes Owner only (SQL refuses to attach it to a role or an override), like ACTIVATE_LOYALTY.
--  * One configuration, versioned append-only. Every field is chosen explicitly (no column default) and the usage limit is
--    either a number per birthday year or an explicit "unlimited".
--  * The gift is a separate layer after the single ordinary winner: the invoice snapshot carries its amount, base and version,
--    a redemption row (append-only, released append-only on cancel) is its usage ledger, and the invoice integrity check now
--    reads "discount = ordinary part + birthday amount".
--  * lucy_birthday_occurrence is the one SQL definition of "the birthday this business date belongs to" (29 February is
--    28 February in a non-leap year); the API has a TypeScript twin and a parity test.

-- ------------------------------------------------------------------------------ MANAGE_BIRTHDAY_REWARDS (Owner only)
CREATE OR REPLACE FUNCTION lucy_refuse_owner_only_permission() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM permissions p WHERE p.id = NEW.permission_id
             AND p.code IN ('ACTIVATE_LOYALTY', 'CHANGE_REFERRER', 'MANAGE_BIRTHDAY_REWARDS')) THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'This permission belongs to the Owner and cannot be granted';
  END IF;
  RETURN NEW;
END;
$$;

-- ------------------------------------------------------------------------------ occurrence function
-- The birthday occurrence of `dob` whose window [b - before, b + after] contains `on_date`, or NULL. A 29 February birthday is
-- 28 February in a non-leap year (Owner, OQ-8). Windows are bounded (before + after <= 364) so at most one occurrence matches.
CREATE FUNCTION lucy_birthday_occurrence(dob date, on_date date, days_before integer, days_after integer) RETURNS date
LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE
  y integer;
  leap boolean;
  occurrence date;
BEGIN
  IF dob IS NULL OR on_date IS NULL OR NOT isfinite(dob) OR NOT isfinite(on_date) THEN RETURN NULL; END IF;
  FOR y IN (extract(year FROM on_date)::integer - 1) .. (extract(year FROM on_date)::integer + 1) LOOP
    leap := (y % 4 = 0 AND y % 100 <> 0) OR y % 400 = 0;
    IF extract(month FROM dob) = 2 AND extract(day FROM dob) = 29 AND NOT leap THEN
      occurrence := make_date(y, 2, 28);
    ELSE
      occurrence := make_date(y, extract(month FROM dob)::integer, extract(day FROM dob)::integer);
    END IF;
    IF on_date >= occurrence - days_before AND on_date <= occurrence + days_after THEN
      RETURN occurrence;
    END IF;
  END LOOP;
  RETURN NULL;
END;
$$;

-- ------------------------------------------------------------------------------ tables
-- At most one configuration; it is the row every birthday redemption serialises on (lock order, design 12.2).
CREATE TABLE "birthday_reward_configs" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "singleton" BOOLEAN NOT NULL DEFAULT true,
    "created_by_user_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT clock_timestamp(),

    CONSTRAINT "birthday_reward_configs_pkey" PRIMARY KEY ("id")
);

-- A version is immutable. The CURRENT version is the highest `version_no`; an edit, an activation and a deactivation are all
-- new versions. No column has a default: the Owner chooses every value, the usage limit included.
CREATE TABLE "birthday_reward_versions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "config_id" UUID NOT NULL,
    "version_no" INTEGER NOT NULL,
    "is_active" BOOLEAN NOT NULL,
    "kind" "DiscountKind" NOT NULL,
    "percent_bp" INTEGER,
    "fixed_amount_vnd" BIGINT,
    "min_spend_vnd" BIGINT NOT NULL,
    "window_days_before" INTEGER NOT NULL,
    "window_days_after" INTEGER NOT NULL,
    "combine_member" BOOLEAN NOT NULL,
    "combine_promotion" BOOLEAN NOT NULL,
    "combine_voucher" BOOLEAN NOT NULL,
    "usage_limit_unlimited" BOOLEAN NOT NULL,
    "usage_limit_per_year" INTEGER,
    "created_by_user_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT clock_timestamp(),

    CONSTRAINT "birthday_reward_versions_pkey" PRIMARY KEY ("id")
);

-- The usage ledger: written at finalization when the gift applies; ACTIVE iff it has no release row.
CREATE TABLE "birthday_redemptions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "invoice_id" UUID NOT NULL,
    "config_id" UUID NOT NULL,
    "version_id" UUID NOT NULL,
    "payer_user_id" UUID NOT NULL,
    "birthday_on" DATE NOT NULL,
    "amount_vnd" BIGINT NOT NULL,
    "redeemed_at" TIMESTAMPTZ(3) NOT NULL DEFAULT clock_timestamp(),

    CONSTRAINT "birthday_redemptions_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "birthday_redemption_releases" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "redemption_id" UUID NOT NULL,
    "released_at" TIMESTAMPTZ(3) NOT NULL DEFAULT clock_timestamp(),
    "released_by_user_id" UUID NOT NULL,
    "cause" "DiscountReleaseCause" NOT NULL,
    "reason" TEXT NOT NULL,

    CONSTRAINT "birthday_redemption_releases_pkey" PRIMARY KEY ("id")
);

-- The snapshot carries the gift: its amount (0 = none), the base it was computed on (the amount left after the best offer)
-- and the winner `BIRTHDAY` when it is the only benefit of the invoice.
ALTER TABLE "invoice_loyalty_snapshots" ADD COLUMN "birthday_amount_vnd" BIGINT NOT NULL DEFAULT 0;
ALTER TABLE "invoice_loyalty_snapshots" ADD COLUMN "birthday_base_vnd" BIGINT NOT NULL DEFAULT 0;

-- ------------------------------------------------------------------------------ keys, indexes, foreign keys
CREATE UNIQUE INDEX "birthday_reward_configs_singleton_key" ON "birthday_reward_configs"("singleton");
CREATE UNIQUE INDEX "birthday_reward_versions_config_version_key" ON "birthday_reward_versions"("config_id", "version_no");
CREATE UNIQUE INDEX "birthday_reward_versions_config_id_id_key" ON "birthday_reward_versions"("config_id", "id");
CREATE UNIQUE INDEX "birthday_redemptions_invoice_key" ON "birthday_redemptions"("invoice_id");
CREATE INDEX "birthday_redemptions_usage_idx" ON "birthday_redemptions"("config_id", "payer_user_id", "birthday_on");
CREATE UNIQUE INDEX "birthday_redemption_releases_redemption_key" ON "birthday_redemption_releases"("redemption_id");

ALTER TABLE "birthday_reward_configs" ADD CONSTRAINT "birthday_reward_configs_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "birthday_reward_versions" ADD CONSTRAINT "birthday_reward_versions_config_id_fkey" FOREIGN KEY ("config_id") REFERENCES "birthday_reward_configs"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "birthday_reward_versions" ADD CONSTRAINT "birthday_reward_versions_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "birthday_redemptions" ADD CONSTRAINT "birthday_redemptions_invoice_id_fkey" FOREIGN KEY ("invoice_id") REFERENCES "invoices"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "birthday_redemptions" ADD CONSTRAINT "birthday_redemptions_version_fkey" FOREIGN KEY ("config_id", "version_id") REFERENCES "birthday_reward_versions"("config_id", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "birthday_redemptions" ADD CONSTRAINT "birthday_redemptions_payer_user_id_fkey" FOREIGN KEY ("payer_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "birthday_redemption_releases" ADD CONSTRAINT "birthday_redemption_releases_redemption_id_fkey" FOREIGN KEY ("redemption_id") REFERENCES "birthday_redemptions"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "birthday_redemption_releases" ADD CONSTRAINT "birthday_redemption_releases_released_by_user_id_fkey" FOREIGN KEY ("released_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- ------------------------------------------------------------------------------ CHECK constraints
ALTER TABLE "birthday_reward_configs"
  ADD CONSTRAINT "birthday_reward_configs_singleton_true" CHECK ("singleton");

ALTER TABLE "birthday_reward_versions"
  ADD CONSTRAINT "birthday_reward_versions_number_positive" CHECK ("version_no" >= 1),
  -- Money gifts only (Owner, OQ-8 #5): a percentage (basis points 1..10000) or a fixed amount (integer VND > 0), never both.
  ADD CONSTRAINT "birthday_reward_versions_value" CHECK (
    ("kind" = 'PERCENT' AND "percent_bp" IS NOT NULL AND "percent_bp" BETWEEN 1 AND 10000
      AND "fixed_amount_vnd" IS NULL)
    OR ("kind" = 'FIXED_AMOUNT' AND "fixed_amount_vnd" IS NOT NULL AND "fixed_amount_vnd" > 0
      AND "percent_bp" IS NULL)
  ),
  ADD CONSTRAINT "birthday_reward_versions_min_spend" CHECK ("min_spend_vnd" >= 0),
  -- The window around the birthday, in days; bounded so one business date belongs to at most one birthday.
  ADD CONSTRAINT "birthday_reward_versions_window" CHECK (
    "window_days_before" >= 0 AND "window_days_after" >= 0 AND "window_days_before" + "window_days_after" <= 364
  ),
  -- The usage limit is explicit: N uses per customer per birthday year, or unlimited. Never both, never neither.
  ADD CONSTRAINT "birthday_reward_versions_usage_limit" CHECK (
    ("usage_limit_unlimited" AND "usage_limit_per_year" IS NULL)
    OR (NOT "usage_limit_unlimited" AND "usage_limit_per_year" IS NOT NULL AND "usage_limit_per_year" >= 1)
  );

ALTER TABLE "birthday_redemptions"
  ADD CONSTRAINT "birthday_redemptions_amount_positive" CHECK ("amount_vnd" > 0);

ALTER TABLE "birthday_redemption_releases"
  ADD CONSTRAINT "birthday_redemption_releases_reason_nonblank" CHECK ("reason" !~ '^[[:space:]]*$');

ALTER TABLE "invoice_loyalty_snapshots" DROP CONSTRAINT "invoice_loyalty_snapshots_winner";
ALTER TABLE "invoice_loyalty_snapshots"
  ADD CONSTRAINT "invoice_loyalty_snapshots_winner" CHECK (
    "winner_source" IS NULL OR "winner_source" IN ('PROMOTION', 'VOUCHER', 'MEMBER_TIER', 'BIRTHDAY')
  ),
  -- A gift worth money names the version it was computed under and a base inside the eligible amount; `BIRTHDAY` as the winner
  -- means it is the only benefit.
  ADD CONSTRAINT "invoice_loyalty_snapshots_birthday" CHECK (
    "birthday_amount_vnd" >= 0 AND "birthday_base_vnd" >= 0
    AND (("birthday_amount_vnd" = 0 AND "birthday_base_vnd" = 0 AND COALESCE("winner_source", '') <> 'BIRTHDAY')
      OR ("birthday_amount_vnd" > 0 AND "birthday_config_version" IS NOT NULL
          AND "birthday_base_vnd" > 0 AND "birthday_base_vnd" <= "eligible_spa_vnd"
          AND "birthday_amount_vnd" <= "birthday_base_vnd"))
  );

-- ------------------------------------------------------------------------------ guards
-- A new version is the next number, written under the configuration row lock (the same row finalizations lock).
CREATE FUNCTION lucy_guard_birthday_version() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  latest integer;
BEGIN
  PERFORM 1 FROM birthday_reward_configs WHERE id = NEW.config_id FOR UPDATE;
  SELECT COALESCE(max(version_no), 0) INTO latest FROM birthday_reward_versions WHERE config_id = NEW.config_id;
  IF NEW.version_no <> latest + 1 THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'A birthday reward version must be the next version number';
  END IF;
  NEW.created_at := clock_timestamp();
  RETURN NEW;
END;
$$;

-- Redemption: written once, for the invoice's payer, under the CURRENT active version, while loyalty is live. The window, the
-- minimum spend, the amount and the per-birthday usage limit are re-verified under the configuration row lock, so two
-- finalizations of one payer can never both take the last use.
CREATE FUNCTION lucy_guard_birthday_redemption() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  target invoices%ROWTYPE;
  snap invoice_loyalty_snapshots%ROWTYPE;
  ver birthday_reward_versions%ROWTYPE;
  latest integer;
  dob date;
  occurrence date;
  expected_amount bigint;
  active_uses bigint;
BEGIN
  SELECT * INTO target FROM invoices WHERE id = NEW.invoice_id FOR SHARE;
  IF target.status IS DISTINCT FROM 'DRAFT' AND target.status IS DISTINCT FROM 'PENDING_PAYMENT'
    AND target.status IS DISTINCT FROM 'PAID' THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'A birthday gift is recorded for an invoice being finalized, never a cancelled one';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM loyalty_go_live) THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'The birthday gift needs loyalty to be live';
  END IF;
  IF target.payer_user_id IS NULL OR NEW.payer_user_id IS DISTINCT FROM target.payer_user_id THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'A birthday gift records the identified payer of its invoice';
  END IF;
  SELECT * INTO snap FROM invoice_loyalty_snapshots WHERE invoice_id = NEW.invoice_id;
  IF NOT FOUND OR snap.birthday_amount_vnd <> NEW.amount_vnd THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'A birthday redemption records exactly the gift of its invoice snapshot';
  END IF;
  SELECT * INTO ver FROM birthday_reward_versions WHERE id = NEW.version_id;
  PERFORM 1 FROM birthday_reward_configs WHERE id = NEW.config_id FOR UPDATE;
  SELECT max(version_no) INTO latest FROM birthday_reward_versions WHERE config_id = NEW.config_id;
  IF ver.version_no <> latest OR NOT ver.is_active OR snap.birthday_config_version IS DISTINCT FROM ver.version_no THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'The birthday gift must come from the current active version';
  END IF;
  SELECT date_of_birth INTO dob FROM customer_profiles WHERE user_id = NEW.payer_user_id;
  occurrence := lucy_birthday_occurrence(dob, target.business_date, ver.window_days_before, ver.window_days_after);
  IF occurrence IS NULL OR occurrence <> NEW.birthday_on THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'The invoice date is outside the birthday window of the payer';
  END IF;
  IF snap.eligible_spa_vnd < ver.min_spend_vnd THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'The invoice is below the minimum spend of the birthday gift';
  END IF;
  expected_amount := CASE ver.kind
    WHEN 'PERCENT' THEN (snap.birthday_base_vnd * ver.percent_bp + 5000) / 10000
    ELSE LEAST(ver.fixed_amount_vnd, snap.birthday_base_vnd) END;
  IF expected_amount <> NEW.amount_vnd THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'The birthday gift amount does not match its version and base';
  END IF;
  IF NOT ver.usage_limit_unlimited THEN
    SELECT count(*) INTO active_uses FROM birthday_redemptions r
      WHERE r.config_id = NEW.config_id AND r.payer_user_id = NEW.payer_user_id
        AND extract(year FROM r.birthday_on) = extract(year FROM NEW.birthday_on)
        AND NOT EXISTS (SELECT 1 FROM birthday_redemption_releases l WHERE l.redemption_id = r.id);
    IF active_uses >= ver.usage_limit_per_year THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'The birthday usage limit of this customer is reached';
    END IF;
  END IF;
  NEW.redeemed_at := clock_timestamp();
  RETURN NEW;
END;
$$;

-- Release: only for a redemption of a CANCELLED invoice, with a cause matching how it was cancelled, at most once.
CREATE FUNCTION lucy_guard_birthday_release() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  redeemed birthday_redemptions%ROWTYPE;
  target invoices%ROWTYPE;
BEGIN
  SELECT * INTO redeemed FROM birthday_redemptions WHERE id = NEW.redemption_id;
  SELECT * INTO target FROM invoices WHERE id = redeemed.invoice_id FOR SHARE;
  IF target.status IS DISTINCT FROM 'CANCELLED' THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'A birthday redemption is released only when its invoice is cancelled';
  END IF;
  IF (NEW.cause = 'INVOICE_CANCELLED_UNPAID' AND target.cancelled_from_status IS DISTINCT FROM 'PENDING_PAYMENT')
    OR (NEW.cause = 'ZERO_BALANCE_CORRECTION' AND target.cancelled_from_status IS DISTINCT FROM 'PAID') THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'The release cause must match how the invoice was cancelled';
  END IF;
  PERFORM 1 FROM birthday_reward_configs WHERE id = redeemed.config_id FOR UPDATE;
  NEW.released_at := clock_timestamp();
  RETURN NEW;
END;
$$;

-- ------------------------------------------------------------------------------ invoice integrity (birthday-aware)
-- The header discount is the ORDINARY part (the applied program benefit, or the member amount, or 0 when the gift is the only
-- benefit) PLUS the birthday amount. The gift has exactly one redemption when it is worth money, and it is released exactly
-- when the invoice is cancelled.
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

-- ------------------------------------------------------------------------------ triggers
CREATE TRIGGER "birthday_reward_versions_guard" BEFORE INSERT ON "birthday_reward_versions"
FOR EACH ROW EXECUTE FUNCTION lucy_guard_birthday_version();
CREATE TRIGGER "birthday_redemptions_guard" BEFORE INSERT ON "birthday_redemptions"
FOR EACH ROW EXECUTE FUNCTION lucy_guard_birthday_redemption();
CREATE TRIGGER "birthday_redemption_releases_guard" BEFORE INSERT ON "birthday_redemption_releases"
FOR EACH ROW EXECUTE FUNCTION lucy_guard_birthday_release();

CREATE CONSTRAINT TRIGGER "birthday_redemptions_integrity" AFTER INSERT ON "birthday_redemptions"
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION lucy_check_invoice_discount();
CREATE CONSTRAINT TRIGGER "birthday_redemption_releases_integrity" AFTER INSERT ON "birthday_redemption_releases"
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION lucy_check_invoice_discount();

-- History is permanent: versions, redemptions and releases are append-only; the configuration is never deleted or truncated.
CREATE TRIGGER "birthday_reward_configs_no_delete" BEFORE DELETE ON "birthday_reward_configs" FOR EACH ROW EXECUTE FUNCTION lucy_reject_financial_delete();
CREATE TRIGGER "birthday_reward_configs_no_update" BEFORE UPDATE ON "birthday_reward_configs" FOR EACH ROW EXECUTE FUNCTION lucy_reject_permanent_history_mutation();
CREATE TRIGGER "birthday_reward_versions_append_only" BEFORE UPDATE OR DELETE ON "birthday_reward_versions" FOR EACH ROW EXECUTE FUNCTION lucy_reject_permanent_history_mutation();
CREATE TRIGGER "birthday_redemptions_append_only" BEFORE UPDATE OR DELETE ON "birthday_redemptions" FOR EACH ROW EXECUTE FUNCTION lucy_reject_permanent_history_mutation();
CREATE TRIGGER "birthday_redemption_releases_append_only" BEFORE UPDATE OR DELETE ON "birthday_redemption_releases" FOR EACH ROW EXECUTE FUNCTION lucy_reject_permanent_history_mutation();
CREATE TRIGGER "birthday_reward_configs_no_truncate" BEFORE TRUNCATE ON "birthday_reward_configs" FOR EACH STATEMENT EXECUTE FUNCTION lucy_reject_permanent_history_mutation();
CREATE TRIGGER "birthday_reward_versions_no_truncate" BEFORE TRUNCATE ON "birthday_reward_versions" FOR EACH STATEMENT EXECUTE FUNCTION lucy_reject_permanent_history_mutation();
CREATE TRIGGER "birthday_redemptions_no_truncate" BEFORE TRUNCATE ON "birthday_redemptions" FOR EACH STATEMENT EXECUTE FUNCTION lucy_reject_permanent_history_mutation();
CREATE TRIGGER "birthday_redemption_releases_no_truncate" BEFORE TRUNCATE ON "birthday_redemption_releases" FOR EACH STATEMENT EXECUTE FUNCTION lucy_reject_permanent_history_mutation();

-- CREATE OR REPLACE drops function-level settings and CREATE FUNCTION starts without them: apply the Phase 1 convention
-- (fixed search_path, no PUBLIC execute) to every function this migration touches.
DO $$
DECLARE
  migration_schema text := current_schema();
  function_name text;
BEGIN
  FOREACH function_name IN ARRAY ARRAY[
    'lucy_refuse_owner_only_permission', 'lucy_birthday_occurrence', 'lucy_guard_birthday_version',
    'lucy_guard_birthday_redemption', 'lucy_guard_birthday_release', 'lucy_check_invoice_discount'
  ] LOOP
    EXECUTE format('ALTER FUNCTION %I.%I(%s) SET search_path TO pg_catalog, %I, pg_temp',
      migration_schema, function_name,
      CASE WHEN function_name = 'lucy_birthday_occurrence' THEN 'date, date, integer, integer' ELSE '' END,
      migration_schema);
    EXECUTE format('REVOKE ALL ON FUNCTION %I.%I(%s) FROM PUBLIC',
      migration_schema, function_name,
      CASE WHEN function_name = 'lucy_birthday_occurrence' THEN 'date, date, integer, integer' ELSE '' END);
  END LOOP;
END;
$$;
