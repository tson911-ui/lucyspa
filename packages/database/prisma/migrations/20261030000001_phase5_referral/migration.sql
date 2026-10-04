-- Phase 5 P5-5, migration 2 of 2: referral (design 7; Owner decisions of 2026-10-04 in design 2.5). Additive.
--  * CHANGE_REFERRER is Owner only: GLOBAL_ONLY, never carried by a role or an override.
--  * A referrer typed at signup is kept on the registration intent (canonical phone) and resolved when the account is created.
--  * visit_participants gets a canonical phone (generated, indexed) so "brand-new customer" (P5-Q4) can match guest phones.
--  * referrals can be BOUND while go-live is OFF (relaxed guard); the AWARD still needs go-live ON and a payment at or after it.
--  * The referrer can be changed ONLY by the Owner and ONLY before the award, through an append-only history row (old, new, actor, time).

-- ------------------------------------------------------------------------------ CHANGE_REFERRER (Owner only)
ALTER TABLE "permissions" DROP CONSTRAINT "permissions_catalog_semantics";
ALTER TABLE "permissions"
  ADD CONSTRAINT "permissions_catalog_semantics" CHECK (
    (("code" IN ('MANAGE_SERVICE_PRICES', 'MANAGE_BOOKING_SETTINGS', 'MANAGE_DISCOUNTS', 'CREATE_VOUCHERS',
          'MANAGE_WEBSITE_CONTENT', 'ADJUST_LOYALTY_POINTS', 'MANAGE_COMBOS', 'RESTORE_COMBO_SESSIONS',
          'MANAGE_BIRTHDAY_REWARDS', 'MANAGE_REWARD_CATALOG', 'VIEW_LOYALTY_EXCEPTIONS', 'ACTIVATE_LOYALTY',
          'CHANGE_REFERRER')
        AND "scope_capability" = 'GLOBAL_ONLY')
      OR ("code" NOT IN ('MANAGE_SERVICE_PRICES', 'MANAGE_BOOKING_SETTINGS', 'MANAGE_DISCOUNTS', 'CREATE_VOUCHERS',
          'MANAGE_WEBSITE_CONTENT', 'ADJUST_LOYALTY_POINTS', 'MANAGE_COMBOS', 'RESTORE_COMBO_SESSIONS',
          'MANAGE_BIRTHDAY_REWARDS', 'MANAGE_REWARD_CATALOG', 'VIEW_LOYALTY_EXCEPTIONS', 'ACTIVATE_LOYALTY',
          'CHANGE_REFERRER')
        AND "scope_capability" = 'BRANCH_CAPABLE'))
    AND (("code" IN ('VIEW_EMPLOYEE_PAY', 'MANAGE_EMPLOYEE_PAY') AND "data_classification" = 'EMPLOYEE_PAY')
      OR ("code" IN ('VIEW_INVOICES', 'MANAGE_INVOICES', 'COLLECT_PAYMENTS', 'APPLY_DISCOUNTS',
          'MANAGE_DISCOUNTS', 'CREATE_VOUCHERS', 'CANCEL_INVOICES', 'CORRECT_PAYMENTS', 'VIEW_REVENUE',
          'ADJUST_LOYALTY_POINTS', 'RESTORE_COMBO_SESSIONS')
        AND "data_classification" = 'FINANCIAL')
      OR ("code" NOT IN ('VIEW_EMPLOYEE_PAY', 'MANAGE_EMPLOYEE_PAY', 'VIEW_INVOICES', 'MANAGE_INVOICES',
          'COLLECT_PAYMENTS', 'APPLY_DISCOUNTS', 'MANAGE_DISCOUNTS', 'CREATE_VOUCHERS', 'CANCEL_INVOICES',
          'CORRECT_PAYMENTS', 'VIEW_REVENUE', 'ADJUST_LOYALTY_POINTS', 'RESTORE_COMBO_SESSIONS')
        AND "data_classification" = 'STANDARD'))
  );

CREATE OR REPLACE FUNCTION lucy_refuse_owner_only_permission() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM permissions p WHERE p.id = NEW.permission_id
             AND p.code IN ('ACTIVATE_LOYALTY', 'CHANGE_REFERRER')) THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'This permission belongs to the Owner and cannot be granted';
  END IF;
  RETURN NEW;
END;
$$;

-- ------------------------------------------------------------------------------ registration intent
ALTER TABLE "registration_intents" ADD COLUMN "referrer_phone_canonical" VARCHAR(16);

-- ------------------------------------------------------------------------------ canonical participant phone (P5-T10)
-- The SQL twin of normalizePhone for matching: spaces, dots, dashes and brackets removed, 0084 and a national leading 0
-- become +84, an international +number is kept. It does not judge validity (a valid canonical phone of a user only ever
-- equals the result for the same number); anything unparseable gives NULL and never matches.
CREATE FUNCTION lucy_phone_canonical(input text) RETURNS varchar(16)
LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE
  digits text;
BEGIN
  IF input IS NULL OR length(input) > 128 OR input !~ '^[0-9+ ().-]+$' THEN RETURN NULL; END IF;
  digits := regexp_replace(input, '[ ().-]', '', 'g');
  IF digits LIKE '0084%' THEN digits := '+84' || substr(digits, 5); END IF;
  IF digits ~ '^00' THEN RETURN NULL; END IF;
  IF digits ~ '^0[0-9]+$' THEN
    digits := '+84' || substr(digits, 2);
  ELSIF digits !~ '^\+[1-9][0-9]+$' OR digits LIKE '+840%' THEN
    RETURN NULL;
  END IF;
  IF length(digits) > 16 THEN RETURN NULL; END IF;
  RETURN digits;
END;
$$;

ALTER TABLE "visit_participants"
  ADD COLUMN "phone_canonical" VARCHAR(16) GENERATED ALWAYS AS (lucy_phone_canonical("phone")) STORED;
CREATE INDEX "visit_participants_phone_canonical_idx" ON "visit_participants"("phone_canonical")
  WHERE "phone_canonical" IS NOT NULL;

-- ------------------------------------------------------------------------------ referral history (Owner correction)
CREATE TABLE "referral_changes" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "referral_id" UUID NOT NULL,
    "old_referrer_user_id" UUID NOT NULL,
    "new_referrer_user_id" UUID NOT NULL,
    "reason" TEXT NOT NULL,
    "actor_user_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT clock_timestamp(),

    CONSTRAINT "referral_changes_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "referral_changes_distinct" CHECK ("old_referrer_user_id" <> "new_referrer_user_id"),
    CONSTRAINT "referral_changes_reason" CHECK (length(btrim("reason")) BETWEEN 1 AND 500)
);
CREATE INDEX "referral_changes_referral_idx" ON "referral_changes"("referral_id", "created_at");

ALTER TABLE "referral_changes" ADD CONSTRAINT "referral_changes_referral_id_fkey"
  FOREIGN KEY ("referral_id") REFERENCES "referrals"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "referral_changes" ADD CONSTRAINT "referral_changes_old_referrer_user_id_fkey"
  FOREIGN KEY ("old_referrer_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "referral_changes" ADD CONSTRAINT "referral_changes_new_referrer_user_id_fkey"
  FOREIGN KEY ("new_referrer_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "referral_changes" ADD CONSTRAINT "referral_changes_actor_user_id_fkey"
  FOREIGN KEY ("actor_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- A history row is only for the Owner, only for a referral that is not awarded yet, and records the referrer that is current.
CREATE FUNCTION lucy_guard_referral_change() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  target referrals%ROWTYPE;
  actor_kind "UserKind";
  new_kind "UserKind";
BEGIN
  SELECT r.* INTO target FROM referrals r WHERE r.id = NEW.referral_id FOR SHARE;
  SELECT u.kind INTO actor_kind FROM users u WHERE u.id = NEW.actor_user_id;
  IF actor_kind IS DISTINCT FROM 'OWNER' THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Only the Owner changes a referrer';
  END IF;
  IF target.awarded_at IS NOT NULL THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'The referrer is locked once the reward has been granted';
  END IF;
  IF target.referrer_user_id IS DISTINCT FROM NEW.old_referrer_user_id THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'A referrer change records the referrer that is current';
  END IF;
  SELECT u.kind INTO new_kind FROM users u WHERE u.id = NEW.new_referrer_user_id;
  IF new_kind IS DISTINCT FROM 'CUSTOMER' OR NEW.new_referrer_user_id = target.referred_user_id THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'The new referrer is another customer account';
  END IF;
  NEW.created_at := clock_timestamp();
  RETURN NEW;
END;
$$;
CREATE TRIGGER "referral_changes_guard" BEFORE INSERT ON "referral_changes"
FOR EACH ROW EXECUTE FUNCTION lucy_guard_referral_change();
CREATE TRIGGER "referral_changes_append_only" BEFORE UPDATE OR DELETE ON "referral_changes"
FOR EACH ROW EXECUTE FUNCTION lucy_reject_permanent_history_mutation();
CREATE TRIGGER "referral_changes_no_truncate" BEFORE TRUNCATE ON "referral_changes"
FOR EACH STATEMENT EXECUTE FUNCTION lucy_reject_permanent_history_mutation();

-- ------------------------------------------------------------------------------ referrals: bind while OFF, change before the award
-- A referral can be recorded before go-live (the reward is only ever granted after it).
DROP TRIGGER "referrals_a_live" ON "referrals";

CREATE OR REPLACE FUNCTION lucy_guard_referral() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  user_kind "UserKind";
  target invoices%ROWTYPE;
  live timestamptz;
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
  IF (NEW.id, NEW.referred_user_id, NEW.bound_via, NEW.bound_by_user_id, NEW.bound_at)
    IS DISTINCT FROM (OLD.id, OLD.referred_user_id, OLD.bound_via, OLD.bound_by_user_id, OLD.bound_at) THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'A referral relationship is permanent';
  END IF;
  -- The referrer changes only before the award, only by the Owner, and only with a history row of this transaction.
  IF NEW.referrer_user_id IS DISTINCT FROM OLD.referrer_user_id THEN
    IF OLD.awarded_at IS NOT NULL THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'The referrer is locked once the reward has been granted';
    END IF;
    SELECT u.kind INTO user_kind FROM users u WHERE u.id = NEW.referrer_user_id;
    IF user_kind IS DISTINCT FROM 'CUSTOMER' OR NEW.referrer_user_id = NEW.referred_user_id THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'The new referrer is another customer account';
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM referral_changes c
      WHERE c.referral_id = NEW.id AND c.old_referrer_user_id = OLD.referrer_user_id
        AND c.new_referrer_user_id = NEW.referrer_user_id AND c.created_at >= transaction_timestamp()
    ) THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'A referrer change needs its history row';
    END IF;
  END IF;
  IF OLD.awarded_at IS NOT NULL THEN
    IF (NEW.awarded_at, NEW.awarded_invoice_id, NEW.awarded_paid_seq)
      IS DISTINCT FROM (OLD.awarded_at, OLD.awarded_invoice_id, OLD.awarded_paid_seq) THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'A referral is awarded at most once';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.awarded_at IS NOT NULL THEN
    -- The reward needs go-live ON and real money paid at or after it (Owner decisions OQ-4 and go-live, 2026-10-04).
    SELECT g.go_live_at INTO live FROM loyalty_go_live g;
    IF live IS NULL THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Loyalty is not live: the go-live switch is off';
    END IF;
    SELECT i.* INTO target FROM invoices i WHERE i.id = NEW.awarded_invoice_id FOR SHARE;
    IF target.status IS DISTINCT FROM 'PAID' OR target.paid_seq IS DISTINCT FROM NEW.awarded_paid_seq THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'A referral is awarded for a paid invoice at its current paid episode';
    END IF;
    IF target.total_vnd <= 0 OR target.paid_at < live THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'A referral is awarded for real money paid after go-live';
    END IF;
    NEW.awarded_at := clock_timestamp();
  END IF;
  RETURN NEW;
END;
$$;

-- Function hardening (the Phase 1 convention); CREATE OR REPLACE dropped the settings of the replaced functions.
DO $$
DECLARE
  migration_schema text := current_schema();
  function_name text;
BEGIN
  FOREACH function_name IN ARRAY ARRAY['lucy_refuse_owner_only_permission', 'lucy_guard_referral',
    'lucy_guard_referral_change'] LOOP
    EXECUTE format('ALTER FUNCTION %I.%I() SET search_path TO pg_catalog, %I, pg_temp',
      migration_schema, function_name, migration_schema);
    EXECUTE format('REVOKE ALL ON FUNCTION %I.%I() FROM PUBLIC', migration_schema, function_name);
  END LOOP;
  EXECUTE format('ALTER FUNCTION %I.lucy_phone_canonical(text) SET search_path TO pg_catalog, %I, pg_temp',
    migration_schema, migration_schema);
  EXECUTE format('REVOKE ALL ON FUNCTION %I.lucy_phone_canonical(text) FROM PUBLIC', migration_schema);
END;
$$;
