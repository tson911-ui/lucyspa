-- Phase 5 P5-6 follow-up (Owner decisions of 2026-10-05 on OQ-8): the base of a birthday gift.
--  * A gift that is ADDED to the ordinary offer (the configuration allows that offer's source) is calculated on the eligible amount
--    LEFT AFTER the offer: base = eligible - ordinary part.
--  * A gift that may NOT combine is compared with the offer, both on the ORIGINAL eligible total: when it wins it is the only benefit
--    (winner BIRTHDAY) and its base is the whole eligible amount.
-- The redemption guard re-verifies exactly that, and that a stacked gift sits on an offer whose source the version allows to combine.
-- Additive: CREATE OR REPLACE of one guard function; no data is touched.

CREATE OR REPLACE FUNCTION lucy_guard_birthday_redemption() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  target invoices%ROWTYPE;
  snap invoice_loyalty_snapshots%ROWTYPE;
  applied invoice_discount_applications%ROWTYPE;
  ver birthday_reward_versions%ROWTYPE;
  latest integer;
  dob date;
  occurrence date;
  ordinary_part bigint;
  expected_base bigint;
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
  -- The base: the original eligible total when the gift stands alone or replaced the offer (winner BIRTHDAY); the amount left after
  -- the ordinary offer when the gift is added to it, which the version must allow for that offer's source.
  IF snap.winner_source = 'BIRTHDAY' THEN
    expected_base := snap.eligible_spa_vnd;
  ELSE
    IF snap.winner_source IS NULL THEN
      ordinary_part := 0;
    ELSIF snap.winner_source = 'MEMBER_TIER' THEN
      ordinary_part := snap.member_amount_vnd;
      IF NOT ver.combine_member THEN
        RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'The version does not let the birthday gift combine with the member discount';
      END IF;
    ELSE
      SELECT * INTO applied FROM invoice_discount_applications WHERE invoice_id = NEW.invoice_id;
      IF NOT FOUND THEN
        RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'A birthday gift added to a program benefit needs that benefit applied';
      END IF;
      ordinary_part := applied.computed_amount_vnd;
      IF (snap.winner_source = 'PROMOTION' AND NOT ver.combine_promotion)
        OR (snap.winner_source = 'VOUCHER' AND NOT ver.combine_voucher) THEN
        RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'The version does not let the birthday gift combine with this benefit';
      END IF;
    END IF;
    expected_base := snap.eligible_spa_vnd - ordinary_part;
  END IF;
  IF snap.birthday_base_vnd <> expected_base THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'The birthday gift base does not follow the combine rule';
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

-- CREATE OR REPLACE drops the function-level settings: restore the Phase 1 convention (fixed search_path, no PUBLIC execute).
DO $$
DECLARE
  migration_schema text := current_schema();
BEGIN
  EXECUTE format('ALTER FUNCTION %I.%I() SET search_path TO pg_catalog, %I, pg_temp',
    migration_schema, 'lucy_guard_birthday_redemption', migration_schema);
  EXECUTE format('REVOKE ALL ON FUNCTION %I.%I() FROM PUBLIC', migration_schema, 'lucy_guard_birthday_redemption');
END;
$$;
