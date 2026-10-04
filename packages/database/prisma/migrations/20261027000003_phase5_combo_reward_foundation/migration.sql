-- Phase 5 P5-2, migration 4 of 4: combo and reward-entitlement foundation (design sections 9 and 10).
-- Tables only, all empty: no combo, catalog item or entitlement exists after this migration (the reward
-- catalog ships empty, P5-Q7). Combo definitions and catalog items may be configured before go-live;
-- every table that records a customer fact (a purchase, a consumption, an entitlement, a redemption)
-- refuses an insert while the go-live switch is OFF (P5-T2). The invoice changes of OQ-1 (invoice kind,
-- visit-less combo sale, the COMBO_PURCHASE line kind) are P5-7 and are NOT part of this migration.

CREATE TYPE "EntitlementExpiryMode" AS ENUM ('NONE', 'DAYS_AFTER_ISSUE');
CREATE TYPE "ComboSessionKind" AS ENUM ('PAID', 'BONUS');
CREATE TYPE "ComboUsageKind" AS ENUM ('OWNER', 'RELATIVE');
CREATE TYPE "EntitlementReleaseCause" AS ENUM ('INVOICE_CANCELLED_UNPAID', 'ZERO_BALANCE_CORRECTION');
CREATE TYPE "RewardKind" AS ENUM ('FREE_SERVICE', 'VOUCHER', 'PRODUCT_GIFT', 'OTHER');
CREATE TYPE "RewardIssueSource" AS ENUM ('MANUAL', 'BIRTHDAY', 'CAMPAIGN');

-- ------------------------------------------------------------------------------------------ combos
CREATE TABLE "combos" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "code" TEXT NOT NULL,
    "service_id" UUID NOT NULL,
    "created_by_user_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT clock_timestamp(),

    CONSTRAINT "combos_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "combos_code" CHECK (btrim("code") <> '')
);

CREATE TABLE "combo_versions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "combo_id" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "name_vi" TEXT NOT NULL,
    "name_en" TEXT NOT NULL,
    "paid_sessions" INTEGER NOT NULL,
    "bonus_sessions" INTEGER NOT NULL DEFAULT 0,
    "price_vnd" BIGINT NOT NULL,
    "expiry_mode" "EntitlementExpiryMode" NOT NULL DEFAULT 'NONE',
    "expiry_days" INTEGER,
    "active" BOOLEAN NOT NULL,
    "created_by_user_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT clock_timestamp(),

    CONSTRAINT "combo_versions_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "combo_versions_values" CHECK (
      "version" >= 1 AND "paid_sessions" >= 1 AND "bonus_sessions" >= 0 AND "price_vnd" > 0
      AND btrim("name_vi") <> '' AND btrim("name_en") <> ''
    ),
    -- PRD 17.2: Lucy Spa combos do not expire; the mode stays configurable for a future package.
    CONSTRAINT "combo_versions_expiry" CHECK (
      ("expiry_mode" = 'NONE' AND "expiry_days" IS NULL)
      OR ("expiry_mode" = 'DAYS_AFTER_ISSUE' AND "expiry_days" IS NOT NULL AND "expiry_days" >= 1)
    )
);

CREATE TABLE "combo_purchases" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "combo_id" UUID NOT NULL,
    "version_id" UUID NOT NULL,
    "owner_user_id" UUID NOT NULL,
    "invoice_line_id" UUID NOT NULL,
    "paid_seq" INTEGER NOT NULL,
    "service_id" UUID NOT NULL,
    "name_vi" TEXT NOT NULL,
    "name_en" TEXT NOT NULL,
    "paid_sessions" INTEGER NOT NULL,
    "bonus_sessions" INTEGER NOT NULL,
    "price_vnd" BIGINT NOT NULL,
    "expiry_mode" "EntitlementExpiryMode" NOT NULL,
    "expires_at" TIMESTAMPTZ(3),
    "issued_at" TIMESTAMPTZ(3) NOT NULL DEFAULT clock_timestamp(),
    "voided_at" TIMESTAMPTZ(3),
    "voided_by_user_id" UUID,
    "void_reason" TEXT,

    CONSTRAINT "combo_purchases_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "combo_purchases_values" CHECK (
      "paid_seq" >= 1 AND "paid_sessions" >= 1 AND "bonus_sessions" >= 0 AND "price_vnd" > 0
      AND btrim("name_vi") <> '' AND btrim("name_en") <> ''
    ),
    CONSTRAINT "combo_purchases_expiry" CHECK (
      ("expiry_mode" = 'NONE' AND "expires_at" IS NULL)
      OR ("expiry_mode" = 'DAYS_AFTER_ISSUE' AND "expires_at" IS NOT NULL)
    ),
    CONSTRAINT "combo_purchases_void_facts" CHECK (
      ("voided_at" IS NULL AND "voided_by_user_id" IS NULL AND "void_reason" IS NULL)
      OR ("voided_at" IS NOT NULL AND "voided_by_user_id" IS NOT NULL AND "void_reason" IS NOT NULL
        AND btrim("void_reason") <> '')
    )
);

CREATE TABLE "combo_sessions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "purchase_id" UUID NOT NULL,
    "session_no" INTEGER NOT NULL,
    "kind" "ComboSessionKind" NOT NULL,

    CONSTRAINT "combo_sessions_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "combo_sessions_no" CHECK ("session_no" >= 1)
);

CREATE TABLE "combo_session_consumptions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "session_id" UUID NOT NULL,
    "invoice_line_id" UUID NOT NULL,
    "branch_id" UUID NOT NULL,
    "used_by" "ComboUsageKind" NOT NULL,
    "relationship_note" TEXT,
    "recipient_participant_id" UUID,
    "ktv_user_id" UUID,
    "performed_by_user_id" UUID NOT NULL,
    "consumed_at" TIMESTAMPTZ(3) NOT NULL DEFAULT clock_timestamp(),

    CONSTRAINT "combo_session_consumptions_pkey" PRIMARY KEY ("id"),
    -- PRD 17.4: the relationship marker exists for a relative's use only.
    CONSTRAINT "combo_session_consumptions_note" CHECK (
      "relationship_note" IS NULL OR ("used_by" = 'RELATIVE' AND btrim("relationship_note") <> '')
    )
);

CREATE TABLE "combo_session_releases" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "consumption_id" UUID NOT NULL,
    "released_at" TIMESTAMPTZ(3) NOT NULL DEFAULT clock_timestamp(),
    "released_by_user_id" UUID NOT NULL,
    "cause" "EntitlementReleaseCause" NOT NULL,
    "reason" TEXT NOT NULL,

    CONSTRAINT "combo_session_releases_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "combo_session_releases_reason" CHECK (btrim("reason") <> '')
);

CREATE TABLE "combo_session_restorations" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "consumption_id" UUID NOT NULL,
    "restored_at" TIMESTAMPTZ(3) NOT NULL DEFAULT clock_timestamp(),
    "restored_by_user_id" UUID NOT NULL,
    "reason" TEXT NOT NULL,

    CONSTRAINT "combo_session_restorations_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "combo_session_restorations_reason" CHECK (btrim("reason") <> '')
);

-- ---------------------------------------------------------------------------------------- rewards
CREATE TABLE "reward_catalog_items" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "code" TEXT NOT NULL,
    "kind" "RewardKind" NOT NULL,
    "service_id" UUID,
    "name_vi" TEXT NOT NULL,
    "name_en" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "expiry_mode" "EntitlementExpiryMode" NOT NULL DEFAULT 'NONE',
    "expiry_days" INTEGER,
    "created_by_user_id" UUID NOT NULL,
    "row_version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT clock_timestamp(),
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT clock_timestamp(),

    CONSTRAINT "reward_catalog_items_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "reward_catalog_items_values" CHECK (
      btrim("code") <> '' AND btrim("name_vi") <> '' AND btrim("name_en") <> '' AND "row_version" >= 1
    ),
    CONSTRAINT "reward_catalog_items_service" CHECK ("kind" = 'FREE_SERVICE' OR "service_id" IS NULL),
    CONSTRAINT "reward_catalog_items_expiry" CHECK (
      ("expiry_mode" = 'NONE' AND "expiry_days" IS NULL)
      OR ("expiry_mode" = 'DAYS_AFTER_ISSUE' AND "expiry_days" IS NOT NULL AND "expiry_days" >= 1)
    )
);

-- Remaining quantity and status are derived (issued minus active redemptions, expiry, void), never stored.
CREATE TABLE "reward_entitlements" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "owner_user_id" UUID NOT NULL,
    "catalog_item_id" UUID NOT NULL,
    "source_kind" "RewardIssueSource" NOT NULL,
    "source_reference" TEXT,
    "quantity_issued" INTEGER NOT NULL,
    "issued_at" TIMESTAMPTZ(3) NOT NULL DEFAULT clock_timestamp(),
    "expires_at" TIMESTAMPTZ(3),
    "issued_by_user_id" UUID,
    "reason" TEXT,
    "voided_at" TIMESTAMPTZ(3),
    "voided_by_user_id" UUID,
    "void_reason" TEXT,

    CONSTRAINT "reward_entitlements_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "reward_entitlements_values" CHECK (
      "quantity_issued" >= 1
      AND ("source_reference" IS NULL OR btrim("source_reference") <> '')
      AND ("reason" IS NULL OR btrim("reason") <> '')
    ),
    -- A manual issue always names the staff member and a reason (audit trail).
    CONSTRAINT "reward_entitlements_manual" CHECK (
      "source_kind" <> 'MANUAL' OR ("issued_by_user_id" IS NOT NULL AND "reason" IS NOT NULL)
    ),
    CONSTRAINT "reward_entitlements_void_facts" CHECK (
      ("voided_at" IS NULL AND "voided_by_user_id" IS NULL AND "void_reason" IS NULL)
      OR ("voided_at" IS NOT NULL AND "voided_by_user_id" IS NOT NULL AND "void_reason" IS NOT NULL
        AND btrim("void_reason") <> '')
    )
);

CREATE TABLE "reward_redemptions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "entitlement_id" UUID NOT NULL,
    "invoice_line_id" UUID NOT NULL,
    "branch_id" UUID NOT NULL,
    "redeemed_by_user_id" UUID NOT NULL,
    "redeemed_at" TIMESTAMPTZ(3) NOT NULL DEFAULT clock_timestamp(),

    CONSTRAINT "reward_redemptions_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "reward_redemption_releases" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "redemption_id" UUID NOT NULL,
    "released_at" TIMESTAMPTZ(3) NOT NULL DEFAULT clock_timestamp(),
    "released_by_user_id" UUID NOT NULL,
    "cause" "EntitlementReleaseCause" NOT NULL,
    "reason" TEXT NOT NULL,

    CONSTRAINT "reward_redemption_releases_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "reward_redemption_releases_reason" CHECK (btrim("reason") <> '')
);

-- --------------------------------------------------------------------------------------- indexes
CREATE UNIQUE INDEX "combos_code_key" ON "combos"("code");
CREATE UNIQUE INDEX "combo_versions_combo_version_key" ON "combo_versions"("combo_id", "version");
CREATE UNIQUE INDEX "combo_versions_combo_id_id_key" ON "combo_versions"("combo_id", "id");
CREATE UNIQUE INDEX "combo_purchases_line_episode_key" ON "combo_purchases"("invoice_line_id", "paid_seq");
CREATE INDEX "combo_purchases_owner_idx" ON "combo_purchases"("owner_user_id", "issued_at");
CREATE UNIQUE INDEX "combo_sessions_purchase_no_key" ON "combo_sessions"("purchase_id", "session_no");
CREATE UNIQUE INDEX "combo_session_consumptions_line_key" ON "combo_session_consumptions"("invoice_line_id");
CREATE INDEX "combo_session_consumptions_session_idx" ON "combo_session_consumptions"("session_id");
CREATE UNIQUE INDEX "combo_session_releases_consumption_key" ON "combo_session_releases"("consumption_id");
CREATE UNIQUE INDEX "combo_session_restorations_consumption_key" ON "combo_session_restorations"("consumption_id");
CREATE UNIQUE INDEX "reward_catalog_items_code_key" ON "reward_catalog_items"("code");
CREATE INDEX "reward_entitlements_owner_idx" ON "reward_entitlements"("owner_user_id", "issued_at");
CREATE UNIQUE INDEX "reward_redemptions_line_key" ON "reward_redemptions"("invoice_line_id");
CREATE INDEX "reward_redemptions_entitlement_idx" ON "reward_redemptions"("entitlement_id");
CREATE UNIQUE INDEX "reward_redemption_releases_redemption_key" ON "reward_redemption_releases"("redemption_id");

-- ------------------------------------------------------------------------------------ foreign keys
ALTER TABLE "combos" ADD CONSTRAINT "combos_service_id_fkey"
  FOREIGN KEY ("service_id") REFERENCES "services"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "combos" ADD CONSTRAINT "combos_created_by_user_id_fkey"
  FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "combo_versions" ADD CONSTRAINT "combo_versions_combo_id_fkey"
  FOREIGN KEY ("combo_id") REFERENCES "combos"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "combo_versions" ADD CONSTRAINT "combo_versions_created_by_user_id_fkey"
  FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "combo_purchases" ADD CONSTRAINT "combo_purchases_combo_id_fkey"
  FOREIGN KEY ("combo_id") REFERENCES "combos"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "combo_purchases" ADD CONSTRAINT "combo_purchases_version_fkey"
  FOREIGN KEY ("combo_id", "version_id") REFERENCES "combo_versions"("combo_id", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "combo_purchases" ADD CONSTRAINT "combo_purchases_owner_user_id_fkey"
  FOREIGN KEY ("owner_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "combo_purchases" ADD CONSTRAINT "combo_purchases_invoice_line_id_fkey"
  FOREIGN KEY ("invoice_line_id") REFERENCES "invoice_lines"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "combo_purchases" ADD CONSTRAINT "combo_purchases_service_id_fkey"
  FOREIGN KEY ("service_id") REFERENCES "services"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "combo_purchases" ADD CONSTRAINT "combo_purchases_voided_by_user_id_fkey"
  FOREIGN KEY ("voided_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "combo_sessions" ADD CONSTRAINT "combo_sessions_purchase_id_fkey"
  FOREIGN KEY ("purchase_id") REFERENCES "combo_purchases"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "combo_session_consumptions" ADD CONSTRAINT "combo_session_consumptions_session_id_fkey"
  FOREIGN KEY ("session_id") REFERENCES "combo_sessions"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "combo_session_consumptions" ADD CONSTRAINT "combo_session_consumptions_invoice_line_id_fkey"
  FOREIGN KEY ("invoice_line_id") REFERENCES "invoice_lines"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "combo_session_consumptions" ADD CONSTRAINT "combo_session_consumptions_branch_id_fkey"
  FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "combo_session_consumptions" ADD CONSTRAINT "combo_session_consumptions_recipient_participant_id_fkey"
  FOREIGN KEY ("recipient_participant_id") REFERENCES "visit_participants"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "combo_session_consumptions" ADD CONSTRAINT "combo_session_consumptions_ktv_user_id_fkey"
  FOREIGN KEY ("ktv_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "combo_session_consumptions" ADD CONSTRAINT "combo_session_consumptions_performed_by_user_id_fkey"
  FOREIGN KEY ("performed_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "combo_session_releases" ADD CONSTRAINT "combo_session_releases_consumption_id_fkey"
  FOREIGN KEY ("consumption_id") REFERENCES "combo_session_consumptions"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "combo_session_releases" ADD CONSTRAINT "combo_session_releases_released_by_user_id_fkey"
  FOREIGN KEY ("released_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "combo_session_restorations" ADD CONSTRAINT "combo_session_restorations_consumption_id_fkey"
  FOREIGN KEY ("consumption_id") REFERENCES "combo_session_consumptions"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "combo_session_restorations" ADD CONSTRAINT "combo_session_restorations_restored_by_user_id_fkey"
  FOREIGN KEY ("restored_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "reward_catalog_items" ADD CONSTRAINT "reward_catalog_items_service_id_fkey"
  FOREIGN KEY ("service_id") REFERENCES "services"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "reward_catalog_items" ADD CONSTRAINT "reward_catalog_items_created_by_user_id_fkey"
  FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "reward_entitlements" ADD CONSTRAINT "reward_entitlements_owner_user_id_fkey"
  FOREIGN KEY ("owner_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "reward_entitlements" ADD CONSTRAINT "reward_entitlements_catalog_item_id_fkey"
  FOREIGN KEY ("catalog_item_id") REFERENCES "reward_catalog_items"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "reward_entitlements" ADD CONSTRAINT "reward_entitlements_issued_by_user_id_fkey"
  FOREIGN KEY ("issued_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "reward_entitlements" ADD CONSTRAINT "reward_entitlements_voided_by_user_id_fkey"
  FOREIGN KEY ("voided_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "reward_redemptions" ADD CONSTRAINT "reward_redemptions_entitlement_id_fkey"
  FOREIGN KEY ("entitlement_id") REFERENCES "reward_entitlements"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "reward_redemptions" ADD CONSTRAINT "reward_redemptions_invoice_line_id_fkey"
  FOREIGN KEY ("invoice_line_id") REFERENCES "invoice_lines"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "reward_redemptions" ADD CONSTRAINT "reward_redemptions_branch_id_fkey"
  FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "reward_redemptions" ADD CONSTRAINT "reward_redemptions_redeemed_by_user_id_fkey"
  FOREIGN KEY ("redeemed_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "reward_redemption_releases" ADD CONSTRAINT "reward_redemption_releases_redemption_id_fkey"
  FOREIGN KEY ("redemption_id") REFERENCES "reward_redemptions"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "reward_redemption_releases" ADD CONSTRAINT "reward_redemption_releases_released_by_user_id_fkey"
  FOREIGN KEY ("released_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- ------------------------------------------------------------------------------------------ guards
-- A combo version is the next number of its combo, taken under the combo row lock.
CREATE FUNCTION lucy_guard_combo_version() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  expected integer;
BEGIN
  PERFORM 1 FROM combos c WHERE c.id = NEW.combo_id FOR UPDATE;
  SELECT COALESCE(max(v.version), 0) + 1 INTO expected FROM combo_versions v WHERE v.combo_id = NEW.combo_id;
  IF NEW.version IS DISTINCT FROM expected THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'A combo version is the next number of its combo';
  END IF;
  NEW.created_at := clock_timestamp();
  RETURN NEW;
END;
$$;

-- A combo purchase is issued for the current paid episode of a PAID invoice whose payer is the member who
-- owns it (P5-Q8: members only), and it snapshots its definition exactly. It may later be voided once.
CREATE FUNCTION lucy_guard_combo_purchase() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  target invoices%ROWTYPE;
  version combo_versions%ROWTYPE;
  defined combos%ROWTYPE;
BEGIN
  IF TG_OP = 'INSERT' THEN
    SELECT i.* INTO target FROM invoices i JOIN invoice_lines l ON l.invoice_id = i.id
      WHERE l.id = NEW.invoice_line_id FOR SHARE OF i;
    IF target.status IS DISTINCT FROM 'PAID' OR target.paid_seq IS DISTINCT FROM NEW.paid_seq THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'A combo is issued for the current paid episode of a paid invoice';
    END IF;
    IF target.payer_user_id IS NULL OR target.payer_user_id IS DISTINCT FROM NEW.owner_user_id THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'A combo belongs to the member who paid for it';
    END IF;
    SELECT v.* INTO version FROM combo_versions v WHERE v.id = NEW.version_id AND v.combo_id = NEW.combo_id;
    SELECT c.* INTO defined FROM combos c WHERE c.id = NEW.combo_id;
    IF NOT FOUND OR version.id IS NULL OR NOT version.active
      OR (NEW.service_id, NEW.name_vi, NEW.name_en, NEW.paid_sessions, NEW.bonus_sessions, NEW.price_vnd, NEW.expiry_mode)
        IS DISTINCT FROM (defined.service_id, version.name_vi, version.name_en, version.paid_sessions,
          version.bonus_sessions, version.price_vnd, version.expiry_mode) THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'A combo purchase snapshots an active version exactly';
    END IF;
    NEW.issued_at := clock_timestamp();
    NEW.expires_at := CASE WHEN version.expiry_mode = 'DAYS_AFTER_ISSUE'
      THEN NEW.issued_at + make_interval(days => version.expiry_days) ELSE NULL END;
    IF NEW.voided_at IS NOT NULL THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'A combo purchase is issued unvoided';
    END IF;
    RETURN NEW;
  END IF;
  IF (NEW.id, NEW.combo_id, NEW.version_id, NEW.owner_user_id, NEW.invoice_line_id, NEW.paid_seq, NEW.service_id,
      NEW.name_vi, NEW.name_en, NEW.paid_sessions, NEW.bonus_sessions, NEW.price_vnd, NEW.expiry_mode, NEW.expires_at,
      NEW.issued_at)
    IS DISTINCT FROM (OLD.id, OLD.combo_id, OLD.version_id, OLD.owner_user_id, OLD.invoice_line_id, OLD.paid_seq,
      OLD.service_id, OLD.name_vi, OLD.name_en, OLD.paid_sessions, OLD.bonus_sessions, OLD.price_vnd, OLD.expiry_mode,
      OLD.expires_at, OLD.issued_at) THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'A combo purchase is immutable apart from being voided once';
  END IF;
  IF OLD.voided_at IS NOT NULL THEN
    IF (NEW.voided_at, NEW.voided_by_user_id, NEW.void_reason)
      IS DISTINCT FROM (OLD.voided_at, OLD.voided_by_user_id, OLD.void_reason) THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'A voided combo purchase cannot change';
    END IF;
  ELSIF NEW.voided_at IS NOT NULL THEN
    NEW.voided_at := clock_timestamp();
  END IF;
  RETURN NEW;
END;
$$;

-- Commit-time invariant: a purchase has exactly its paid and bonus session rows, numbered 1..n (deferred).
CREATE FUNCTION lucy_check_combo_sessions() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  purchase_ref uuid;
  target combo_purchases%ROWTYPE;
  paid integer;
  bonus integer;
  highest integer;
BEGIN
  IF TG_TABLE_NAME = 'combo_purchases' THEN purchase_ref := NEW.id; ELSE purchase_ref := NEW.purchase_id; END IF;
  SELECT p.* INTO target FROM combo_purchases p WHERE p.id = purchase_ref;
  SELECT count(*) FILTER (WHERE s.kind = 'PAID'), count(*) FILTER (WHERE s.kind = 'BONUS'), COALESCE(max(s.session_no), 0)
    INTO paid, bonus, highest FROM combo_sessions s WHERE s.purchase_id = purchase_ref;
  IF paid <> target.paid_sessions OR bonus <> target.bonus_sessions OR highest <> paid + bonus THEN
    RAISE EXCEPTION USING ERRCODE = '23514',
      MESSAGE = 'A combo purchase has exactly its paid and bonus sessions, numbered from 1';
  END IF;
  RETURN NULL;
END;
$$;

-- Consumption of one session on one invoice line. Under the session row lock: the purchase is not voided or
-- expired, the session has no active consumption, the invoice is not cancelled and belongs to the line's branch,
-- the line performs the combo's own service (PRD 17.3), and a recipient belongs to the same visit.
CREATE FUNCTION lucy_guard_combo_consumption() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  target invoices%ROWTYPE;
  purchase combo_purchases%ROWTYPE;
  performed_service uuid;
  staff_kind "UserKind";
BEGIN
  -- Lock order (design 12.2, P5-T12): the invoice first, then the combo rows.
  SELECT i.* INTO target FROM invoices i JOIN invoice_lines l ON l.invoice_id = i.id
    WHERE l.id = NEW.invoice_line_id FOR SHARE OF i;
  PERFORM 1 FROM combo_sessions s WHERE s.id = NEW.session_id FOR UPDATE;
  SELECT p.* INTO purchase FROM combo_purchases p JOIN combo_sessions s ON s.purchase_id = p.id WHERE s.id = NEW.session_id;
  IF purchase.voided_at IS NOT NULL OR (purchase.expires_at IS NOT NULL AND purchase.expires_at <= clock_timestamp()) THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'A voided or expired combo cannot be consumed';
  END IF;
  IF target.status IS NULL OR target.status = 'CANCELLED' THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'A session is consumed on an invoice being finalized, never a cancelled one';
  END IF;
  IF target.branch_id IS DISTINCT FROM NEW.branch_id THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'A consumption records the branch of its invoice';
  END IF;
  SELECT d.service_id INTO performed_service FROM invoice_line_services d WHERE d.invoice_line_id = NEW.invoice_line_id;
  IF performed_service IS DISTINCT FROM purchase.service_id THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'A combo session is consumed only for the service of its combo';
  END IF;
  IF NEW.recipient_participant_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM visit_participants vp WHERE vp.id = NEW.recipient_participant_id AND vp.visit_id = target.visit_id) THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'The service recipient belongs to the visit of the invoice';
  END IF;
  IF NEW.ktv_user_id IS NOT NULL THEN
    SELECT u.kind INTO staff_kind FROM users u WHERE u.id = NEW.ktv_user_id;
    IF staff_kind IS DISTINCT FROM 'EMPLOYEE' THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'The KTV of a consumption is an employee';
    END IF;
  END IF;
  IF EXISTS (
    SELECT 1 FROM combo_session_consumptions c
      WHERE c.session_id = NEW.session_id
        AND NOT EXISTS (SELECT 1 FROM combo_session_releases r WHERE r.consumption_id = c.id)
        AND NOT EXISTS (SELECT 1 FROM combo_session_restorations o WHERE o.consumption_id = c.id)) THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'The combo session is already consumed';
  END IF;
  NEW.consumed_at := clock_timestamp();
  RETURN NEW;
END;
$$;

-- Release: only for a consumption of a CANCELLED invoice, with a cause that matches how it was cancelled,
-- never for a restored consumption, at most once (unique key), under the same session lock.
CREATE FUNCTION lucy_guard_combo_release() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  consumed combo_session_consumptions%ROWTYPE;
  target invoices%ROWTYPE;
BEGIN
  SELECT c.* INTO consumed FROM combo_session_consumptions c WHERE c.id = NEW.consumption_id;
  -- Lock order (design 12.2, P5-T12): the invoice first, then the combo rows.
  SELECT i.* INTO target FROM invoices i JOIN invoice_lines l ON l.invoice_id = i.id
    WHERE l.id = consumed.invoice_line_id FOR SHARE OF i;
  PERFORM 1 FROM combo_sessions s WHERE s.id = consumed.session_id FOR UPDATE;
  IF target.status IS DISTINCT FROM 'CANCELLED' THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'A consumption is released only when its invoice is cancelled';
  END IF;
  IF (NEW.cause = 'INVOICE_CANCELLED_UNPAID' AND target.cancelled_from_status IS DISTINCT FROM 'PENDING_PAYMENT')
    OR (NEW.cause = 'ZERO_BALANCE_CORRECTION' AND target.cancelled_from_status IS DISTINCT FROM 'PAID') THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'The release cause must match how the invoice was cancelled';
  END IF;
  IF EXISTS (SELECT 1 FROM combo_session_restorations o WHERE o.consumption_id = NEW.consumption_id) THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'A restored consumption is not released again';
  END IF;
  NEW.released_at := clock_timestamp();
  RETURN NEW;
END;
$$;

-- Restoration (PRD 17.5): an authorized correction of an active consumption; the consumption stays as history.
CREATE FUNCTION lucy_guard_combo_restoration() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  consumed combo_session_consumptions%ROWTYPE;
BEGIN
  SELECT c.* INTO consumed FROM combo_session_consumptions c WHERE c.id = NEW.consumption_id;
  PERFORM 1 FROM combo_sessions s WHERE s.id = consumed.session_id FOR UPDATE;
  IF EXISTS (SELECT 1 FROM combo_session_releases r WHERE r.consumption_id = NEW.consumption_id) THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'A released consumption cannot also be restored';
  END IF;
  NEW.restored_at := clock_timestamp();
  RETURN NEW;
END;
$$;

-- Commit-time invariant: every consumption of a cancelled invoice is released (or was restored) (deferred).
CREATE FUNCTION lucy_check_combo_consumption_release() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  invoice_ref uuid;
BEGIN
  IF TG_TABLE_NAME = 'invoices' THEN
    invoice_ref := NEW.id;
  ELSE
    SELECT l.invoice_id INTO invoice_ref FROM invoice_lines l WHERE l.id = NEW.invoice_line_id;
  END IF;
  IF EXISTS (
    SELECT 1 FROM combo_session_consumptions c
      JOIN invoice_lines l ON l.id = c.invoice_line_id
      JOIN invoices i ON i.id = l.invoice_id
      WHERE i.id = invoice_ref AND i.status = 'CANCELLED'
        AND NOT EXISTS (SELECT 1 FROM combo_session_releases r WHERE r.consumption_id = c.id)
        AND NOT EXISTS (SELECT 1 FROM combo_session_restorations o WHERE o.consumption_id = c.id)) THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'A cancelled invoice releases every combo session it consumed';
  END IF;
  RETURN NULL;
END;
$$;

-- Reward catalog item: identity is immutable; name, active flag and expiry rule may be edited (versioned).
CREATE FUNCTION lucy_guard_reward_catalog_item() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.row_version <> 1 THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'A catalog item starts at version 1';
    END IF;
    NEW.created_at := clock_timestamp();
    NEW.updated_at := NEW.created_at;
    RETURN NEW;
  END IF;
  IF (NEW.id, NEW.code, NEW.kind, NEW.service_id, NEW.created_by_user_id, NEW.created_at)
    IS DISTINCT FROM (OLD.id, OLD.code, OLD.kind, OLD.service_id, OLD.created_by_user_id, OLD.created_at) THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'A catalog item identity is immutable';
  END IF;
  IF NEW.row_version IS DISTINCT FROM OLD.row_version + 1 THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'A catalog item update must advance its version by one';
  END IF;
  NEW.updated_at := clock_timestamp();
  RETURN NEW;
END;
$$;

-- Reward entitlement: for a customer account and an active catalog item; a manual issue is audited by its
-- columns; a configured expiry is computed from the issue instant; it may be voided once.
CREATE FUNCTION lucy_guard_reward_entitlement() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  item reward_catalog_items%ROWTYPE;
  owner_kind "UserKind";
BEGIN
  IF TG_OP = 'INSERT' THEN
    SELECT u.kind INTO owner_kind FROM users u WHERE u.id = NEW.owner_user_id;
    IF owner_kind IS DISTINCT FROM 'CUSTOMER' THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'An entitlement belongs to a customer account';
    END IF;
    SELECT c.* INTO item FROM reward_catalog_items c WHERE c.id = NEW.catalog_item_id;
    IF NOT FOUND OR NOT item.active THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'An entitlement is issued from an active catalog item';
    END IF;
    IF NEW.voided_at IS NOT NULL THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'An entitlement is issued unvoided';
    END IF;
    NEW.issued_at := clock_timestamp();
    NEW.expires_at := CASE WHEN item.expiry_mode = 'DAYS_AFTER_ISSUE'
      THEN NEW.issued_at + make_interval(days => item.expiry_days) ELSE NULL END;
    RETURN NEW;
  END IF;
  IF (NEW.id, NEW.owner_user_id, NEW.catalog_item_id, NEW.source_kind, NEW.source_reference, NEW.quantity_issued,
      NEW.issued_at, NEW.expires_at, NEW.issued_by_user_id, NEW.reason)
    IS DISTINCT FROM (OLD.id, OLD.owner_user_id, OLD.catalog_item_id, OLD.source_kind, OLD.source_reference,
      OLD.quantity_issued, OLD.issued_at, OLD.expires_at, OLD.issued_by_user_id, OLD.reason) THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'An entitlement is immutable apart from being voided once';
  END IF;
  IF OLD.voided_at IS NOT NULL THEN
    IF (NEW.voided_at, NEW.voided_by_user_id, NEW.void_reason)
      IS DISTINCT FROM (OLD.voided_at, OLD.voided_by_user_id, OLD.void_reason) THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'A voided entitlement cannot change';
    END IF;
  ELSIF NEW.voided_at IS NOT NULL THEN
    NEW.voided_at := clock_timestamp();
  END IF;
  RETURN NEW;
END;
$$;

-- Redemption of an entitlement on an invoice line, under the entitlement row lock: not voided or expired,
-- active redemptions below the issued quantity, the invoice is not cancelled and is of the stated branch, and
-- a catalog item tied to a service is redeemed only on a line for that service.
CREATE FUNCTION lucy_guard_reward_redemption() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  entitlement reward_entitlements%ROWTYPE;
  item reward_catalog_items%ROWTYPE;
  target invoices%ROWTYPE;
  performed_service uuid;
  active_count integer;
BEGIN
  -- Lock order (design 12.2, P5-T12): the invoice first, then the reward rows.
  SELECT i.* INTO target FROM invoices i JOIN invoice_lines l ON l.invoice_id = i.id
    WHERE l.id = NEW.invoice_line_id FOR SHARE OF i;
  SELECT e.* INTO entitlement FROM reward_entitlements e WHERE e.id = NEW.entitlement_id FOR UPDATE;
  SELECT c.* INTO item FROM reward_catalog_items c WHERE c.id = entitlement.catalog_item_id;
  IF entitlement.voided_at IS NOT NULL OR (entitlement.expires_at IS NOT NULL AND entitlement.expires_at <= clock_timestamp()) THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'A voided or expired entitlement cannot be redeemed';
  END IF;
  IF target.status IS NULL OR target.status = 'CANCELLED' THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'An entitlement is redeemed on an invoice being finalized, never a cancelled one';
  END IF;
  IF target.branch_id IS DISTINCT FROM NEW.branch_id THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'A redemption records the branch of its invoice';
  END IF;
  IF item.service_id IS NOT NULL THEN
    SELECT d.service_id INTO performed_service FROM invoice_line_services d WHERE d.invoice_line_id = NEW.invoice_line_id;
    IF performed_service IS DISTINCT FROM item.service_id THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'The entitlement is redeemed only for its own service';
    END IF;
  END IF;
  SELECT count(*) INTO active_count FROM reward_redemptions r
    WHERE r.entitlement_id = NEW.entitlement_id
      AND NOT EXISTS (SELECT 1 FROM reward_redemption_releases l WHERE l.redemption_id = r.id);
  IF active_count >= entitlement.quantity_issued THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'The entitlement has no quantity left';
  END IF;
  NEW.redeemed_at := clock_timestamp();
  RETURN NEW;
END;
$$;

CREATE FUNCTION lucy_guard_reward_release() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  redeemed reward_redemptions%ROWTYPE;
  target invoices%ROWTYPE;
BEGIN
  SELECT r.* INTO redeemed FROM reward_redemptions r WHERE r.id = NEW.redemption_id;
  -- Lock order (design 12.2, P5-T12): the invoice first, then the reward rows.
  SELECT i.* INTO target FROM invoices i JOIN invoice_lines l ON l.invoice_id = i.id
    WHERE l.id = redeemed.invoice_line_id FOR SHARE OF i;
  PERFORM 1 FROM reward_entitlements e WHERE e.id = redeemed.entitlement_id FOR UPDATE;
  IF target.status IS DISTINCT FROM 'CANCELLED' THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'A redemption is released only when its invoice is cancelled';
  END IF;
  IF (NEW.cause = 'INVOICE_CANCELLED_UNPAID' AND target.cancelled_from_status IS DISTINCT FROM 'PENDING_PAYMENT')
    OR (NEW.cause = 'ZERO_BALANCE_CORRECTION' AND target.cancelled_from_status IS DISTINCT FROM 'PAID') THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'The release cause must match how the invoice was cancelled';
  END IF;
  NEW.released_at := clock_timestamp();
  RETURN NEW;
END;
$$;

CREATE FUNCTION lucy_check_reward_redemption_release() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  invoice_ref uuid;
BEGIN
  IF TG_TABLE_NAME = 'invoices' THEN
    invoice_ref := NEW.id;
  ELSE
    SELECT l.invoice_id INTO invoice_ref FROM invoice_lines l WHERE l.id = NEW.invoice_line_id;
  END IF;
  IF EXISTS (
    SELECT 1 FROM reward_redemptions r
      JOIN invoice_lines l ON l.id = r.invoice_line_id
      JOIN invoices i ON i.id = l.invoice_id
      WHERE i.id = invoice_ref AND i.status = 'CANCELLED'
        AND NOT EXISTS (SELECT 1 FROM reward_redemption_releases x WHERE x.redemption_id = r.id)) THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'A cancelled invoice releases every reward it redeemed';
  END IF;
  RETURN NULL;
END;
$$;

-- ---------------------------------------------------------------------------------------- triggers
CREATE TRIGGER "combos_immutable" BEFORE UPDATE OR DELETE ON "combos"
FOR EACH ROW EXECUTE FUNCTION lucy_reject_permanent_history_mutation();
CREATE TRIGGER "combos_no_truncate" BEFORE TRUNCATE ON "combos"
FOR EACH STATEMENT EXECUTE FUNCTION lucy_reject_permanent_history_mutation();
CREATE TRIGGER "combo_versions_guard" BEFORE INSERT ON "combo_versions"
FOR EACH ROW EXECUTE FUNCTION lucy_guard_combo_version();
CREATE TRIGGER "combo_versions_append_only" BEFORE UPDATE OR DELETE ON "combo_versions"
FOR EACH ROW EXECUTE FUNCTION lucy_reject_permanent_history_mutation();
CREATE TRIGGER "combo_versions_no_truncate" BEFORE TRUNCATE ON "combo_versions"
FOR EACH STATEMENT EXECUTE FUNCTION lucy_reject_permanent_history_mutation();

CREATE TRIGGER "combo_purchases_a_live" BEFORE INSERT ON "combo_purchases"
FOR EACH ROW EXECUTE FUNCTION lucy_require_loyalty_go_live();
CREATE TRIGGER "combo_purchases_guard" BEFORE INSERT OR UPDATE ON "combo_purchases"
FOR EACH ROW EXECUTE FUNCTION lucy_guard_combo_purchase();
CREATE TRIGGER "combo_purchases_no_delete" BEFORE DELETE ON "combo_purchases"
FOR EACH ROW EXECUTE FUNCTION lucy_reject_financial_delete();
CREATE TRIGGER "combo_purchases_no_truncate" BEFORE TRUNCATE ON "combo_purchases"
FOR EACH STATEMENT EXECUTE FUNCTION lucy_reject_permanent_history_mutation();
CREATE CONSTRAINT TRIGGER "combo_purchases_sessions_integrity" AFTER INSERT ON "combo_purchases"
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION lucy_check_combo_sessions();
CREATE TRIGGER "combo_sessions_append_only" BEFORE UPDATE OR DELETE ON "combo_sessions"
FOR EACH ROW EXECUTE FUNCTION lucy_reject_permanent_history_mutation();
CREATE TRIGGER "combo_sessions_no_truncate" BEFORE TRUNCATE ON "combo_sessions"
FOR EACH STATEMENT EXECUTE FUNCTION lucy_reject_permanent_history_mutation();
CREATE CONSTRAINT TRIGGER "combo_sessions_integrity" AFTER INSERT ON "combo_sessions"
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION lucy_check_combo_sessions();

CREATE TRIGGER "combo_session_consumptions_a_live" BEFORE INSERT ON "combo_session_consumptions"
FOR EACH ROW EXECUTE FUNCTION lucy_require_loyalty_go_live();
CREATE TRIGGER "combo_session_consumptions_guard" BEFORE INSERT ON "combo_session_consumptions"
FOR EACH ROW EXECUTE FUNCTION lucy_guard_combo_consumption();
CREATE TRIGGER "combo_session_consumptions_append_only" BEFORE UPDATE OR DELETE ON "combo_session_consumptions"
FOR EACH ROW EXECUTE FUNCTION lucy_reject_permanent_history_mutation();
CREATE TRIGGER "combo_session_consumptions_no_truncate" BEFORE TRUNCATE ON "combo_session_consumptions"
FOR EACH STATEMENT EXECUTE FUNCTION lucy_reject_permanent_history_mutation();
CREATE TRIGGER "combo_session_releases_guard" BEFORE INSERT ON "combo_session_releases"
FOR EACH ROW EXECUTE FUNCTION lucy_guard_combo_release();
CREATE TRIGGER "combo_session_releases_append_only" BEFORE UPDATE OR DELETE ON "combo_session_releases"
FOR EACH ROW EXECUTE FUNCTION lucy_reject_permanent_history_mutation();
CREATE TRIGGER "combo_session_releases_no_truncate" BEFORE TRUNCATE ON "combo_session_releases"
FOR EACH STATEMENT EXECUTE FUNCTION lucy_reject_permanent_history_mutation();
CREATE TRIGGER "combo_session_restorations_guard" BEFORE INSERT ON "combo_session_restorations"
FOR EACH ROW EXECUTE FUNCTION lucy_guard_combo_restoration();
CREATE TRIGGER "combo_session_restorations_append_only" BEFORE UPDATE OR DELETE ON "combo_session_restorations"
FOR EACH ROW EXECUTE FUNCTION lucy_reject_permanent_history_mutation();
CREATE TRIGGER "combo_session_restorations_no_truncate" BEFORE TRUNCATE ON "combo_session_restorations"
FOR EACH STATEMENT EXECUTE FUNCTION lucy_reject_permanent_history_mutation();
CREATE CONSTRAINT TRIGGER "invoices_combo_release_integrity" AFTER UPDATE ON "invoices"
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW WHEN (NEW."status" = 'CANCELLED')
EXECUTE FUNCTION lucy_check_combo_consumption_release();
CREATE CONSTRAINT TRIGGER "combo_session_consumptions_release_integrity" AFTER INSERT ON "combo_session_consumptions"
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION lucy_check_combo_consumption_release();

CREATE TRIGGER "reward_catalog_items_guard" BEFORE INSERT OR UPDATE ON "reward_catalog_items"
FOR EACH ROW EXECUTE FUNCTION lucy_guard_reward_catalog_item();
CREATE TRIGGER "reward_catalog_items_no_delete" BEFORE DELETE ON "reward_catalog_items"
FOR EACH ROW EXECUTE FUNCTION lucy_reject_permanent_history_mutation();
CREATE TRIGGER "reward_catalog_items_no_truncate" BEFORE TRUNCATE ON "reward_catalog_items"
FOR EACH STATEMENT EXECUTE FUNCTION lucy_reject_permanent_history_mutation();
CREATE TRIGGER "reward_entitlements_a_live" BEFORE INSERT ON "reward_entitlements"
FOR EACH ROW EXECUTE FUNCTION lucy_require_loyalty_go_live();
CREATE TRIGGER "reward_entitlements_guard" BEFORE INSERT OR UPDATE ON "reward_entitlements"
FOR EACH ROW EXECUTE FUNCTION lucy_guard_reward_entitlement();
CREATE TRIGGER "reward_entitlements_no_delete" BEFORE DELETE ON "reward_entitlements"
FOR EACH ROW EXECUTE FUNCTION lucy_reject_permanent_history_mutation();
CREATE TRIGGER "reward_entitlements_no_truncate" BEFORE TRUNCATE ON "reward_entitlements"
FOR EACH STATEMENT EXECUTE FUNCTION lucy_reject_permanent_history_mutation();
CREATE TRIGGER "reward_redemptions_a_live" BEFORE INSERT ON "reward_redemptions"
FOR EACH ROW EXECUTE FUNCTION lucy_require_loyalty_go_live();
CREATE TRIGGER "reward_redemptions_guard" BEFORE INSERT ON "reward_redemptions"
FOR EACH ROW EXECUTE FUNCTION lucy_guard_reward_redemption();
CREATE TRIGGER "reward_redemptions_append_only" BEFORE UPDATE OR DELETE ON "reward_redemptions"
FOR EACH ROW EXECUTE FUNCTION lucy_reject_permanent_history_mutation();
CREATE TRIGGER "reward_redemptions_no_truncate" BEFORE TRUNCATE ON "reward_redemptions"
FOR EACH STATEMENT EXECUTE FUNCTION lucy_reject_permanent_history_mutation();
CREATE TRIGGER "reward_redemption_releases_guard" BEFORE INSERT ON "reward_redemption_releases"
FOR EACH ROW EXECUTE FUNCTION lucy_guard_reward_release();
CREATE TRIGGER "reward_redemption_releases_append_only" BEFORE UPDATE OR DELETE ON "reward_redemption_releases"
FOR EACH ROW EXECUTE FUNCTION lucy_reject_permanent_history_mutation();
CREATE TRIGGER "reward_redemption_releases_no_truncate" BEFORE TRUNCATE ON "reward_redemption_releases"
FOR EACH STATEMENT EXECUTE FUNCTION lucy_reject_permanent_history_mutation();
CREATE CONSTRAINT TRIGGER "invoices_reward_release_integrity" AFTER UPDATE ON "invoices"
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW WHEN (NEW."status" = 'CANCELLED')
EXECUTE FUNCTION lucy_check_reward_redemption_release();
CREATE CONSTRAINT TRIGGER "reward_redemptions_release_integrity" AFTER INSERT ON "reward_redemptions"
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION lucy_check_reward_redemption_release();

-- Function hardening (the Phase 1 convention): a fixed search_path and no PUBLIC execute.
DO $$
DECLARE
  migration_schema text := current_schema();
  function_name text;
BEGIN
  FOREACH function_name IN ARRAY ARRAY[
    'lucy_guard_combo_version', 'lucy_guard_combo_purchase', 'lucy_check_combo_sessions',
    'lucy_guard_combo_consumption', 'lucy_guard_combo_release', 'lucy_guard_combo_restoration',
    'lucy_check_combo_consumption_release', 'lucy_guard_reward_catalog_item', 'lucy_guard_reward_entitlement',
    'lucy_guard_reward_redemption', 'lucy_guard_reward_release', 'lucy_check_reward_redemption_release'
  ] LOOP
    EXECUTE format('ALTER FUNCTION %I.%I() SET search_path TO pg_catalog, %I, pg_temp',
      migration_schema, function_name, migration_schema);
    EXECUTE format('REVOKE ALL ON FUNCTION %I.%I() FROM PUBLIC', migration_schema, function_name);
  END LOOP;
END;
$$;
