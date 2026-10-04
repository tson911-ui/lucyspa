-- Phase 5 P5-2, migration 3 of 4: the loyalty database foundation (design sections 3, 4, 5.3, 7).
-- Tables only, all empty: no wallet, ledger entry, referral or snapshot is created and nothing is backfilled
-- (P5-Q1). Every table that records a customer fact refuses an insert while the go-live switch is OFF
-- (P5-T2: NO ROW in loyalty_go_live means OFF, the default). No business workflow exists yet.

CREATE TYPE "LoyaltyWallet" AS ENUM ('SPA', 'BEAUTY');
CREATE TYPE "LoyaltyLedgerKind" AS ENUM ('EARN', 'EARN_REVERSAL', 'REFERRAL_AWARD', 'MANUAL_ADJUSTMENT', 'MANUAL_CORRECTION');
CREATE TYPE "LoyaltyTier" AS ENUM ('NONE', 'SILVER', 'GOLD', 'PLATINUM', 'DIAMOND', 'RUBY');
CREATE TYPE "ReferralBindSource" AS ENUM ('SIGNUP', 'COUNTER');

-- ------------------------------------------------------------------------------------ go-live switch
CREATE TABLE "loyalty_go_live" (
    "id" SMALLINT NOT NULL DEFAULT 1,
    "go_live_at" TIMESTAMPTZ(3) NOT NULL DEFAULT clock_timestamp(),
    "activated_by_user_id" UUID NOT NULL,

    CONSTRAINT "loyalty_go_live_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "loyalty_go_live_singleton" CHECK ("id" = 1)
);

-- --------------------------------------------------------------------------------------- wallets
CREATE TABLE "loyalty_wallets" (
    "user_id" UUID NOT NULL,
    "wallet" "LoyaltyWallet" NOT NULL,
    "balance_points" INTEGER NOT NULL DEFAULT 0,
    "row_version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT clock_timestamp(),
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT clock_timestamp(),

    CONSTRAINT "loyalty_wallets_pkey" PRIMARY KEY ("user_id", "wallet"),
    -- P5-Q5: the balance never goes below 0.
    CONSTRAINT "loyalty_wallets_balance" CHECK ("balance_points" >= 0),
    CONSTRAINT "loyalty_wallets_version" CHECK ("row_version" >= 1)
);

-- ------------------------------------------------------------------------------------------ ledger
CREATE TABLE "loyalty_ledger_entries" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "wallet" "LoyaltyWallet" NOT NULL,
    "kind" "LoyaltyLedgerKind" NOT NULL,
    "points" INTEGER NOT NULL,
    "shortfall_points" INTEGER NOT NULL DEFAULT 0,
    "idempotency_key" TEXT NOT NULL,
    "invoice_id" UUID,
    "paid_seq" INTEGER,
    "referral_id" UUID,
    "reverses_entry_id" UUID,
    "corrects_entry_id" UUID,
    "reason" TEXT,
    "actor_user_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT clock_timestamp(),

    CONSTRAINT "loyalty_ledger_entries_pkey" PRIMARY KEY ("id"),
    -- Whole points only. A negative entry may be partly or wholly absorbed (P5-Q5): `points` is the applied
    -- amount (possibly 0) and `shortfall_points` the remainder; a shortfall exists only on a non-positive entry.
    CONSTRAINT "loyalty_ledger_entries_amounts" CHECK (
      ("points" <> 0 OR "shortfall_points" > 0)
      AND "shortfall_points" >= 0
      AND ("shortfall_points" = 0 OR "points" <= 0)
    ),
    CONSTRAINT "loyalty_ledger_entries_key" CHECK (btrim("idempotency_key") <> ''),
    -- The shape of each kind (design 3.1 and 11.3).
    CONSTRAINT "loyalty_ledger_entries_kind_shape" CHECK (
      ("kind" = 'EARN' AND "points" > 0 AND "invoice_id" IS NOT NULL AND "paid_seq" IS NOT NULL AND "paid_seq" >= 1
        AND "referral_id" IS NULL AND "reverses_entry_id" IS NULL AND "corrects_entry_id" IS NULL
        AND "actor_user_id" IS NULL AND "reason" IS NULL)
      OR ("kind" = 'EARN_REVERSAL' AND "points" <= 0 AND "reverses_entry_id" IS NOT NULL AND "invoice_id" IS NOT NULL
        AND "paid_seq" IS NOT NULL AND "paid_seq" >= 1 AND "referral_id" IS NULL AND "corrects_entry_id" IS NULL
        AND "actor_user_id" IS NULL)
      OR ("kind" = 'REFERRAL_AWARD' AND "points" > 0 AND "referral_id" IS NOT NULL AND "invoice_id" IS NULL
        AND "paid_seq" IS NULL AND "reverses_entry_id" IS NULL AND "corrects_entry_id" IS NULL
        AND "actor_user_id" IS NULL AND "reason" IS NULL)
      OR ("kind" = 'MANUAL_ADJUSTMENT' AND "actor_user_id" IS NOT NULL AND "reason" IS NOT NULL AND btrim("reason") <> ''
        AND "invoice_id" IS NULL AND "paid_seq" IS NULL AND "referral_id" IS NULL
        AND "reverses_entry_id" IS NULL AND "corrects_entry_id" IS NULL)
      OR ("kind" = 'MANUAL_CORRECTION' AND "actor_user_id" IS NOT NULL AND "reason" IS NOT NULL AND btrim("reason") <> ''
        AND "corrects_entry_id" IS NOT NULL AND "invoice_id" IS NULL AND "paid_seq" IS NULL AND "referral_id" IS NULL
        AND "reverses_entry_id" IS NULL)
    )
);

CREATE UNIQUE INDEX "loyalty_ledger_entries_idempotency_key" ON "loyalty_ledger_entries"("idempotency_key");
CREATE UNIQUE INDEX "loyalty_ledger_entries_reverses_key" ON "loyalty_ledger_entries"("reverses_entry_id");
CREATE UNIQUE INDEX "loyalty_ledger_entries_corrects_key" ON "loyalty_ledger_entries"("corrects_entry_id");
CREATE INDEX "loyalty_ledger_entries_wallet_idx" ON "loyalty_ledger_entries"("user_id", "wallet", "created_at");
CREATE INDEX "loyalty_ledger_entries_invoice_idx" ON "loyalty_ledger_entries"("invoice_id", "paid_seq");
-- One referral award per referral and wallet (PRD 20.3: once per referred customer, in each wallet).
CREATE UNIQUE INDEX "loyalty_ledger_entries_referral_award_key" ON "loyalty_ledger_entries"("referral_id", "wallet")
  WHERE "kind" = 'REFERRAL_AWARD';

-- ----------------------------------------------------------------------------------------- referrals
CREATE TABLE "referrals" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "referred_user_id" UUID NOT NULL,
    "referrer_user_id" UUID NOT NULL,
    "bound_via" "ReferralBindSource" NOT NULL,
    "bound_by_user_id" UUID,
    "bound_at" TIMESTAMPTZ(3) NOT NULL DEFAULT clock_timestamp(),
    "awarded_at" TIMESTAMPTZ(3),
    "awarded_invoice_id" UUID,
    "awarded_paid_seq" INTEGER,

    CONSTRAINT "referrals_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "referrals_distinct" CHECK ("referred_user_id" <> "referrer_user_id"),
    -- A counter binding names the staff member; a signup binding is the customer's own.
    CONSTRAINT "referrals_bound_by" CHECK (
      ("bound_via" = 'COUNTER' AND "bound_by_user_id" IS NOT NULL)
      OR ("bound_via" = 'SIGNUP' AND "bound_by_user_id" IS NULL)
    ),
    CONSTRAINT "referrals_award_facts" CHECK (
      ("awarded_at" IS NULL AND "awarded_invoice_id" IS NULL AND "awarded_paid_seq" IS NULL)
      OR ("awarded_at" IS NOT NULL AND "awarded_invoice_id" IS NOT NULL AND "awarded_paid_seq" IS NOT NULL
        AND "awarded_paid_seq" >= 1)
    )
);

-- Permanent: one referrer per referred customer, never changed (PRD 20.2).
CREATE UNIQUE INDEX "referrals_referred_key" ON "referrals"("referred_user_id");
CREATE INDEX "referrals_referrer_idx" ON "referrals"("referrer_user_id");

-- ------------------------------------------------------------------------- invoice tier snapshot
CREATE TABLE "invoice_loyalty_snapshots" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "invoice_id" UUID NOT NULL,
    "payer_user_id" UUID NOT NULL,
    "wallet" "LoyaltyWallet" NOT NULL,
    "balance_before" INTEGER NOT NULL,
    "tier" "LoyaltyTier" NOT NULL,
    "tier_table_version" INTEGER NOT NULL,
    "member_discount_bp" INTEGER NOT NULL,
    "calculation_version" INTEGER NOT NULL,
    "eligible_spa_vnd" BIGINT NOT NULL,
    "eligible_beauty_vnd" BIGINT NOT NULL DEFAULT 0,
    "candidates" JSONB NOT NULL,
    "winner_source" TEXT,
    "selection_reason" TEXT,
    "birthday_config_version" INTEGER,
    "birthday_result" JSONB,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT clock_timestamp(),

    CONSTRAINT "invoice_loyalty_snapshots_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "invoice_loyalty_snapshots_values" CHECK (
      "balance_before" >= 0 AND "member_discount_bp" BETWEEN 0 AND 10000 AND "tier_table_version" >= 1
      AND "calculation_version" >= 2 AND "eligible_spa_vnd" >= 0 AND "eligible_beauty_vnd" >= 0
    ),
    -- The locked tier table of PRD 18.5 (version 1): tier, balance range and Member Discount (basis points)
    -- always agree. A later table is a new `tier_table_version`, added by a migration, never a rewrite.
    CONSTRAINT "invoice_loyalty_snapshots_tier_v1" CHECK (
      "tier_table_version" <> 1 OR (
        ("tier" = 'NONE' AND "balance_before" BETWEEN 0 AND 499 AND "member_discount_bp" = 0)
        OR ("tier" = 'SILVER' AND "balance_before" BETWEEN 500 AND 999 AND "member_discount_bp" = 300)
        OR ("tier" = 'GOLD' AND "balance_before" BETWEEN 1000 AND 2999 AND "member_discount_bp" = 400)
        OR ("tier" = 'PLATINUM' AND "balance_before" BETWEEN 3000 AND 4999 AND "member_discount_bp" = 500)
        OR ("tier" = 'DIAMOND' AND "balance_before" BETWEEN 5000 AND 9999 AND "member_discount_bp" = 700)
        OR ("tier" = 'RUBY' AND "balance_before" >= 10000 AND "member_discount_bp" = 900)
      )
    )
);

CREATE UNIQUE INDEX "invoice_loyalty_snapshots_invoice_key" ON "invoice_loyalty_snapshots"("invoice_id");
CREATE INDEX "invoice_loyalty_snapshots_payer_idx" ON "invoice_loyalty_snapshots"("payer_user_id");

-- ------------------------------------------------------------------------------------ foreign keys
ALTER TABLE "loyalty_go_live" ADD CONSTRAINT "loyalty_go_live_activated_by_user_id_fkey"
  FOREIGN KEY ("activated_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "loyalty_wallets" ADD CONSTRAINT "loyalty_wallets_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "loyalty_ledger_entries" ADD CONSTRAINT "loyalty_ledger_entries_wallet_fkey"
  FOREIGN KEY ("user_id", "wallet") REFERENCES "loyalty_wallets"("user_id", "wallet") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "loyalty_ledger_entries" ADD CONSTRAINT "loyalty_ledger_entries_invoice_id_fkey"
  FOREIGN KEY ("invoice_id") REFERENCES "invoices"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "loyalty_ledger_entries" ADD CONSTRAINT "loyalty_ledger_entries_referral_id_fkey"
  FOREIGN KEY ("referral_id") REFERENCES "referrals"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "loyalty_ledger_entries" ADD CONSTRAINT "loyalty_ledger_entries_reverses_entry_id_fkey"
  FOREIGN KEY ("reverses_entry_id") REFERENCES "loyalty_ledger_entries"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "loyalty_ledger_entries" ADD CONSTRAINT "loyalty_ledger_entries_corrects_entry_id_fkey"
  FOREIGN KEY ("corrects_entry_id") REFERENCES "loyalty_ledger_entries"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "loyalty_ledger_entries" ADD CONSTRAINT "loyalty_ledger_entries_actor_user_id_fkey"
  FOREIGN KEY ("actor_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "referrals" ADD CONSTRAINT "referrals_referred_user_id_fkey"
  FOREIGN KEY ("referred_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "referrals" ADD CONSTRAINT "referrals_referrer_user_id_fkey"
  FOREIGN KEY ("referrer_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "referrals" ADD CONSTRAINT "referrals_bound_by_user_id_fkey"
  FOREIGN KEY ("bound_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "referrals" ADD CONSTRAINT "referrals_awarded_invoice_id_fkey"
  FOREIGN KEY ("awarded_invoice_id") REFERENCES "invoices"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "invoice_loyalty_snapshots" ADD CONSTRAINT "invoice_loyalty_snapshots_invoice_id_fkey"
  FOREIGN KEY ("invoice_id") REFERENCES "invoices"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "invoice_loyalty_snapshots" ADD CONSTRAINT "invoice_loyalty_snapshots_payer_user_id_fkey"
  FOREIGN KEY ("payer_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- ------------------------------------------------------------------------------------------ guards
-- The go-live switch (P5-T2): inserted once; the instant is the database clock, so it can neither be
-- backdated (no backfill, P5-Q1) nor scheduled; it is never updated or deleted.
CREATE FUNCTION lucy_guard_loyalty_go_live() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  NEW.go_live_at := clock_timestamp();
  RETURN NEW;
END;
$$;

-- Used by every table that records a customer fact: while no go-live row exists, loyalty is dormant.
CREATE FUNCTION lucy_require_loyalty_go_live() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM loyalty_go_live) THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Loyalty is not live: the go-live switch is off';
  END IF;
  RETURN NEW;
END;
$$;

-- A wallet belongs to a customer account (never an employee or the Owner) and starts at 0.
CREATE FUNCTION lucy_guard_loyalty_wallet() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  owner_kind "UserKind";
BEGIN
  IF TG_OP = 'INSERT' THEN
    SELECT u.kind INTO owner_kind FROM users u WHERE u.id = NEW.user_id;
    IF owner_kind IS DISTINCT FROM 'CUSTOMER' THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'A loyalty wallet belongs to a customer account';
    END IF;
    IF NEW.balance_points <> 0 OR NEW.row_version <> 1 THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'A loyalty wallet starts at 0 points';
    END IF;
    NEW.created_at := clock_timestamp();
    NEW.updated_at := NEW.created_at;
    RETURN NEW;
  END IF;
  IF (NEW.user_id, NEW.wallet, NEW.created_at) IS DISTINCT FROM (OLD.user_id, OLD.wallet, OLD.created_at) THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'A loyalty wallet identity is immutable';
  END IF;
  IF NEW.row_version IS DISTINCT FROM OLD.row_version + 1 THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'A loyalty wallet update must advance its version by one';
  END IF;
  NEW.updated_at := clock_timestamp();
  RETURN NEW;
END;
$$;

-- Commit-time invariant: the balance cache always equals the sum of the permanent ledger (deferred).
CREATE FUNCTION lucy_check_loyalty_balance() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  stored integer;
  ledger bigint;
BEGIN
  SELECT w.balance_points INTO stored FROM loyalty_wallets w WHERE w.user_id = NEW.user_id AND w.wallet = NEW.wallet;
  SELECT COALESCE(sum(e.points), 0) INTO ledger FROM loyalty_ledger_entries e
    WHERE e.user_id = NEW.user_id AND e.wallet = NEW.wallet;
  IF stored IS DISTINCT FROM ledger THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'A wallet balance must equal the sum of its ledger entries';
  END IF;
  RETURN NULL;
END;
$$;

-- Ledger entry. EARN is only for the payer of a PAID invoice at its current paid episode, and only for an
-- episode paid at or after go-live (P5-Q1, P5-Q2); a reversal targets an earn entry of the same episode;
-- a correction targets an entry of the same wallet; a referral award goes to the referrer.
CREATE FUNCTION lucy_guard_loyalty_ledger() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  target invoices%ROWTYPE;
  other loyalty_ledger_entries%ROWTYPE;
  live timestamptz;
  referral referrals%ROWTYPE;
BEGIN
  NEW.created_at := clock_timestamp();
  IF NEW.kind = 'EARN' THEN
    SELECT i.* INTO target FROM invoices i WHERE i.id = NEW.invoice_id FOR SHARE;
    SELECT g.go_live_at INTO live FROM loyalty_go_live g;
    IF target.status IS DISTINCT FROM 'PAID' OR target.paid_seq IS DISTINCT FROM NEW.paid_seq THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Points are earned only for the current paid episode of a paid invoice';
    END IF;
    IF target.payer_user_id IS NULL OR target.payer_user_id IS DISTINCT FROM NEW.user_id THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Points are earned by the member payer of the invoice only';
    END IF;
    IF target.paid_at < live THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'No points are earned for an invoice paid before go-live';
    END IF;
  ELSIF NEW.kind = 'EARN_REVERSAL' THEN
    SELECT e.* INTO other FROM loyalty_ledger_entries e WHERE e.id = NEW.reverses_entry_id;
    IF NOT FOUND OR other.kind IS DISTINCT FROM 'EARN'
      OR (other.user_id, other.wallet, other.invoice_id, other.paid_seq)
        IS DISTINCT FROM (NEW.user_id, NEW.wallet, NEW.invoice_id, NEW.paid_seq) THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'A reversal targets the earn entry of the same wallet and paid episode';
    END IF;
    IF -NEW.points + NEW.shortfall_points <> other.points THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'A reversal is for the full earned amount (applied plus shortfall)';
    END IF;
  ELSIF NEW.kind = 'MANUAL_CORRECTION' THEN
    SELECT e.* INTO other FROM loyalty_ledger_entries e WHERE e.id = NEW.corrects_entry_id;
    IF NOT FOUND OR other.id = NEW.id OR (other.user_id, other.wallet) IS DISTINCT FROM (NEW.user_id, NEW.wallet) THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'A correction targets another entry of the same wallet';
    END IF;
  ELSIF NEW.kind = 'REFERRAL_AWARD' THEN
    SELECT r.* INTO referral FROM referrals r WHERE r.id = NEW.referral_id;
    IF NOT FOUND OR referral.referrer_user_id IS DISTINCT FROM NEW.user_id THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'A referral award goes to the referrer of that referral';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

-- Referral: both sides are customer accounts; permanent identity; the award is stamped once.
CREATE FUNCTION lucy_guard_referral() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  user_kind "UserKind";
  target invoices%ROWTYPE;
BEGIN
  IF TG_OP = 'INSERT' THEN
    SELECT u.kind INTO user_kind FROM users u WHERE u.id = NEW.referred_user_id;
    IF user_kind IS DISTINCT FROM 'CUSTOMER' THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'The referred person is a customer account';
    END IF;
    SELECT u.kind INTO user_kind FROM users u WHERE u.id = NEW.referrer_user_id;
    IF user_kind IS DISTINCT FROM 'CUSTOMER' THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'The referrer is a customer account';
    END IF;
    IF NEW.awarded_at IS NOT NULL THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'A referral is created unawarded';
    END IF;
    NEW.bound_at := clock_timestamp();
    RETURN NEW;
  END IF;
  IF (NEW.id, NEW.referred_user_id, NEW.referrer_user_id, NEW.bound_via, NEW.bound_by_user_id, NEW.bound_at)
    IS DISTINCT FROM (OLD.id, OLD.referred_user_id, OLD.referrer_user_id, OLD.bound_via, OLD.bound_by_user_id, OLD.bound_at) THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'A referral relationship is permanent';
  END IF;
  IF OLD.awarded_at IS NOT NULL THEN
    IF (NEW.awarded_at, NEW.awarded_invoice_id, NEW.awarded_paid_seq)
      IS DISTINCT FROM (OLD.awarded_at, OLD.awarded_invoice_id, OLD.awarded_paid_seq) THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'A referral is awarded at most once';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.awarded_at IS NOT NULL THEN
    SELECT i.* INTO target FROM invoices i WHERE i.id = NEW.awarded_invoice_id FOR SHARE;
    IF target.status IS DISTINCT FROM 'PAID' OR target.paid_seq IS DISTINCT FROM NEW.awarded_paid_seq THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'A referral is awarded for a paid invoice at its current paid episode';
    END IF;
    NEW.awarded_at := clock_timestamp();
  END IF;
  RETURN NEW;
END;
$$;

-- Commit-time invariant: an awarded referral has exactly one SPA and one BEAUTY award entry, both to the
-- referrer; an unawarded referral has none (PRD 20.3: +10 Spa AND +10 Beauty, once, independent credits).
CREATE FUNCTION lucy_check_referral_award() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  ref_id uuid;
  target referrals%ROWTYPE;
  spa integer;
  beauty integer;
  total integer;
BEGIN
  IF TG_TABLE_NAME = 'referrals' THEN ref_id := NEW.id; ELSE ref_id := NEW.referral_id; END IF;
  SELECT r.* INTO target FROM referrals r WHERE r.id = ref_id;
  SELECT count(*) FILTER (WHERE e.wallet = 'SPA' AND e.user_id = target.referrer_user_id),
         count(*) FILTER (WHERE e.wallet = 'BEAUTY' AND e.user_id = target.referrer_user_id),
         count(*)
    INTO spa, beauty, total
    FROM loyalty_ledger_entries e WHERE e.referral_id = ref_id AND e.kind = 'REFERRAL_AWARD';
  IF target.awarded_at IS NULL AND total <> 0 THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Referral award entries exist only for an awarded referral';
  END IF;
  IF target.awarded_at IS NOT NULL AND (spa <> 1 OR beauty <> 1 OR total <> 2) THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'An awarded referral has exactly one Spa and one Beauty award entry';
  END IF;
  RETURN NULL;
END;
$$;

-- Snapshot: written for a finalized invoice (inside its finalizing transaction) with an identified payer.
CREATE FUNCTION lucy_guard_invoice_loyalty_snapshot() RETURNS trigger
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

-- ---------------------------------------------------------------------------------------- triggers
CREATE TRIGGER "loyalty_go_live_guard" BEFORE INSERT ON "loyalty_go_live"
FOR EACH ROW EXECUTE FUNCTION lucy_guard_loyalty_go_live();
CREATE TRIGGER "loyalty_go_live_immutable" BEFORE UPDATE OR DELETE ON "loyalty_go_live"
FOR EACH ROW EXECUTE FUNCTION lucy_reject_permanent_history_mutation();
CREATE TRIGGER "loyalty_go_live_no_truncate" BEFORE TRUNCATE ON "loyalty_go_live"
FOR EACH STATEMENT EXECUTE FUNCTION lucy_reject_permanent_history_mutation();

CREATE TRIGGER "loyalty_wallets_a_live" BEFORE INSERT ON "loyalty_wallets"
FOR EACH ROW EXECUTE FUNCTION lucy_require_loyalty_go_live();
CREATE TRIGGER "loyalty_wallets_guard" BEFORE INSERT OR UPDATE ON "loyalty_wallets"
FOR EACH ROW EXECUTE FUNCTION lucy_guard_loyalty_wallet();
CREATE TRIGGER "loyalty_wallets_no_delete" BEFORE DELETE ON "loyalty_wallets"
FOR EACH ROW EXECUTE FUNCTION lucy_reject_financial_delete();
CREATE TRIGGER "loyalty_wallets_no_truncate" BEFORE TRUNCATE ON "loyalty_wallets"
FOR EACH STATEMENT EXECUTE FUNCTION lucy_reject_permanent_history_mutation();
CREATE CONSTRAINT TRIGGER "loyalty_wallets_balance_integrity" AFTER INSERT OR UPDATE ON "loyalty_wallets"
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION lucy_check_loyalty_balance();

CREATE TRIGGER "loyalty_ledger_entries_a_live" BEFORE INSERT ON "loyalty_ledger_entries"
FOR EACH ROW EXECUTE FUNCTION lucy_require_loyalty_go_live();
CREATE TRIGGER "loyalty_ledger_entries_guard" BEFORE INSERT ON "loyalty_ledger_entries"
FOR EACH ROW EXECUTE FUNCTION lucy_guard_loyalty_ledger();
CREATE TRIGGER "loyalty_ledger_entries_append_only" BEFORE UPDATE OR DELETE ON "loyalty_ledger_entries"
FOR EACH ROW EXECUTE FUNCTION lucy_reject_permanent_history_mutation();
CREATE TRIGGER "loyalty_ledger_entries_no_truncate" BEFORE TRUNCATE ON "loyalty_ledger_entries"
FOR EACH STATEMENT EXECUTE FUNCTION lucy_reject_permanent_history_mutation();
CREATE CONSTRAINT TRIGGER "loyalty_ledger_entries_balance_integrity" AFTER INSERT ON "loyalty_ledger_entries"
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION lucy_check_loyalty_balance();
CREATE CONSTRAINT TRIGGER "loyalty_ledger_entries_referral_integrity" AFTER INSERT ON "loyalty_ledger_entries"
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW WHEN (NEW."kind" = 'REFERRAL_AWARD')
EXECUTE FUNCTION lucy_check_referral_award();

CREATE TRIGGER "referrals_a_live" BEFORE INSERT ON "referrals"
FOR EACH ROW EXECUTE FUNCTION lucy_require_loyalty_go_live();
CREATE TRIGGER "referrals_guard" BEFORE INSERT OR UPDATE ON "referrals"
FOR EACH ROW EXECUTE FUNCTION lucy_guard_referral();
CREATE TRIGGER "referrals_no_delete" BEFORE DELETE ON "referrals"
FOR EACH ROW EXECUTE FUNCTION lucy_reject_permanent_history_mutation();
CREATE TRIGGER "referrals_no_truncate" BEFORE TRUNCATE ON "referrals"
FOR EACH STATEMENT EXECUTE FUNCTION lucy_reject_permanent_history_mutation();
CREATE CONSTRAINT TRIGGER "referrals_award_integrity" AFTER INSERT OR UPDATE ON "referrals"
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION lucy_check_referral_award();

CREATE TRIGGER "invoice_loyalty_snapshots_a_live" BEFORE INSERT ON "invoice_loyalty_snapshots"
FOR EACH ROW EXECUTE FUNCTION lucy_require_loyalty_go_live();
CREATE TRIGGER "invoice_loyalty_snapshots_guard" BEFORE INSERT ON "invoice_loyalty_snapshots"
FOR EACH ROW EXECUTE FUNCTION lucy_guard_invoice_loyalty_snapshot();
CREATE TRIGGER "invoice_loyalty_snapshots_append_only" BEFORE UPDATE OR DELETE ON "invoice_loyalty_snapshots"
FOR EACH ROW EXECUTE FUNCTION lucy_reject_permanent_history_mutation();
CREATE TRIGGER "invoice_loyalty_snapshots_no_truncate" BEFORE TRUNCATE ON "invoice_loyalty_snapshots"
FOR EACH STATEMENT EXECUTE FUNCTION lucy_reject_permanent_history_mutation();

-- Function hardening (the Phase 1 convention): a fixed search_path and no PUBLIC execute.
DO $$
DECLARE
  migration_schema text := current_schema();
  function_name text;
BEGIN
  FOREACH function_name IN ARRAY ARRAY[
    'lucy_guard_loyalty_go_live', 'lucy_require_loyalty_go_live', 'lucy_guard_loyalty_wallet',
    'lucy_check_loyalty_balance', 'lucy_guard_loyalty_ledger', 'lucy_guard_referral',
    'lucy_check_referral_award', 'lucy_guard_invoice_loyalty_snapshot'
  ] LOOP
    EXECUTE format('ALTER FUNCTION %I.%I() SET search_path TO pg_catalog, %I, pg_temp',
      migration_schema, function_name, migration_schema);
    EXECUTE format('REVOKE ALL ON FUNCTION %I.%I() FROM PUBLIC', migration_schema, function_name);
  END LOOP;
END;
$$;
