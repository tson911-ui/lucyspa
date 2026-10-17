-- Session 10 A2 (Owner brief A2 and Owner answer 3, 2026-10-16): a customer deletes their own account from the account page.
-- The account is erased in place, never deleted: users are permanent (lucy_guard_user_identity) and invoices, payments, bookings and
-- the audit trail keep pointing at the same id. What this migration adds, and nothing else:
--   1. users.deleted_at and a third legal shape of a CUSTOMER row: INACTIVE, deleted, no email, no phone, no password, the neutral
--      placeholder name. A deleted account stays deleted (trigger).
--   2. customer_profiles: date of birth and address may be NULL, only for a deleted customer, and stay NULL once erased.
--   3. Online orders that were never paid (Owner answer 3): the recipient and contact name and phone may be cleared, exactly once, only
--      for a cancelled order whose invoice was never paid and whose customer is deleted. Paid orders keep them (legal record).
--   4. account_deletion_emails: the sealed confirmation email (the address exists only in the AES-GCM payload, erased when the row leaves
--      PENDING, like auth_deliveries). The outbox event carries the row id only.
-- No data is changed by this migration. Existing rows already satisfy every new or replaced check (deleted_at is NULL everywhere).

-- ---------------------------------------------------------------------------------------------------------------- 1. users
ALTER TABLE "users" ADD COLUMN "deleted_at" TIMESTAMPTZ(3);

ALTER TABLE "users"
  DROP CONSTRAINT "users_kind_credentials",
  ADD CONSTRAINT "users_kind_credentials" CHECK (
    ("kind" = 'CUSTOMER' AND "deleted_at" IS NULL AND "status" = 'ACTIVE' AND "email_canonical" IS NOT NULL
      AND "email_verified_at" IS NOT NULL AND "phone_canonical" IS NOT NULL AND "password_hash" IS NOT NULL)
    -- A deleted customer: no way to sign in and nothing that names the person (users_email_pair clears the other email columns).
    OR ("kind" = 'CUSTOMER' AND "deleted_at" IS NOT NULL AND "status" = 'INACTIVE' AND "email_canonical" IS NULL
      AND "phone_canonical" IS NULL AND "password_hash" IS NULL AND "full_name" = 'Tài khoản đã xóa')
    OR ("kind" = 'OWNER' AND "deleted_at" IS NULL AND "status" = 'ACTIVE' AND "email_canonical" IS NOT NULL
      AND "password_hash" IS NOT NULL)
    OR ("kind" = 'EMPLOYEE' AND "deleted_at" IS NULL AND "phone_canonical" IS NOT NULL AND (
      ("status" = 'ACTIVE' AND "password_hash" IS NOT NULL)
      OR ("status" = 'PENDING_SETUP' AND "password_hash" IS NULL)
      OR "status" = 'INACTIVE'
    ))
  ),
  ADD CONSTRAINT "users_deleted_at_finite" CHECK ("deleted_at" IS NULL OR isfinite("deleted_at"));

CREATE FUNCTION lucy_guard_user_deletion() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.deleted_at IS NOT NULL THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'An account is created live, never already deleted';
    END IF;
  ELSIF OLD.deleted_at IS NOT NULL THEN
    IF (NEW.deleted_at, NEW.status, NEW.full_name, NEW.email_canonical, NEW.email_delivery, NEW.email_verified_at,
        NEW.phone_canonical, NEW.password_hash)
      IS DISTINCT FROM (OLD.deleted_at, OLD.status, OLD.full_name, OLD.email_canonical, OLD.email_delivery, OLD.email_verified_at,
        OLD.phone_canonical, OLD.password_hash) THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'A deleted account stays deleted';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "users_deletion_guard" BEFORE INSERT OR UPDATE ON "users"
FOR EACH ROW EXECUTE FUNCTION lucy_guard_user_deletion();

-- ------------------------------------------------------------------------------------------------------ 2. customer_profiles
ALTER TABLE "customer_profiles"
  ALTER COLUMN "date_of_birth" DROP NOT NULL,
  ALTER COLUMN "address" DROP NOT NULL,
  ADD CONSTRAINT "customer_profiles_erased_together" CHECK (("date_of_birth" IS NULL) = ("address" IS NULL));

CREATE FUNCTION lucy_guard_customer_profile_erasure() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.date_of_birth IS NULL OR NEW.address IS NULL THEN
    IF TG_OP = 'INSERT' OR NOT EXISTS (SELECT 1 FROM users u WHERE u.id = NEW.user_id AND u.deleted_at IS NOT NULL) THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Only the profile of a deleted account is erased';
    END IF;
  ELSIF TG_OP = 'UPDATE' AND OLD.date_of_birth IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'An erased profile is never written again';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "customer_profiles_erasure_guard" BEFORE INSERT OR UPDATE ON "customer_profiles"
FOR EACH ROW EXECUTE FUNCTION lucy_guard_customer_profile_erasure();

-- ---------------------------------------------------------------------------------------- 3. never-paid online orders
ALTER TABLE "product_orders"
  ALTER COLUMN "contact_phone" DROP NOT NULL,
  DROP CONSTRAINT "product_orders_phone",
  ADD CONSTRAINT "product_orders_phone" CHECK (
    "contact_phone" IS NULL OR ("contact_phone" = lucy_phone_canonical("contact_phone")) IS TRUE);

-- Same body as wave 3b (20261116000001), plus the one erasure: a cancelled online order whose invoice was never paid, of a deleted
-- customer, loses its contact name and phone; an erased contact is never written again; a new order always has a phone.
CREATE OR REPLACE FUNCTION lucy_guard_product_order() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  target invoices%ROWTYPE;
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'A product order is history and is never deleted';
  END IF;
  IF TG_OP = 'INSERT' THEN
    SELECT * INTO target FROM invoices WHERE id = NEW.invoice_id FOR SHARE;
    IF NOT FOUND OR target.status <> 'DRAFT' OR target.kind NOT IN ('VISIT', 'PRODUCT_SALE') THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'A product order is created by the finalization of a draft invoice with product lines';
    END IF;
    IF NEW.branch_id <> target.branch_id OR NEW.channel <> target.channel
       OR NEW.customer_user_id IS DISTINCT FROM target.payer_user_id THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'A product order has the branch, channel and customer of its invoice';
    END IF;
    IF NEW.contact_phone IS NULL THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'A product order has a contact phone';
    END IF;
    NEW.created_at := clock_timestamp();
    NEW.updated_at := NEW.created_at;
    RETURN NEW;
  END IF;
  -- Only the contact (a mistyped phone or name is corrected, with an audit event written by the API) may change.
  IF (NEW.id, NEW.code, NEW.invoice_id, NEW.branch_id, NEW.channel, NEW.customer_user_id, NEW.created_by_user_id, NEW.created_at)
    IS DISTINCT FROM (OLD.id, OLD.code, OLD.invoice_id, OLD.branch_id, OLD.channel, OLD.customer_user_id, OLD.created_by_user_id,
      OLD.created_at) THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Only the contact of a product order can change';
  END IF;
  IF OLD.contact_phone IS NULL THEN
    IF NEW.contact_phone IS NOT NULL OR NEW.contact_name IS NOT NULL THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'An erased contact is never written again';
    END IF;
  ELSIF NEW.contact_phone IS NULL THEN
    SELECT * INTO target FROM invoices WHERE id = OLD.invoice_id;
    IF OLD.channel <> 'ONLINE' OR NEW.contact_name IS NOT NULL OR target.paid_seq <> 0 OR target.status <> 'CANCELLED'
       OR NOT EXISTS (SELECT 1 FROM users u WHERE u.id = OLD.customer_user_id AND u.deleted_at IS NOT NULL) THEN
      RAISE EXCEPTION USING ERRCODE = '23514',
        MESSAGE = 'Only a never-paid, cancelled online order of a deleted account loses its contact';
    END IF;
  END IF;
  NEW.updated_at := clock_timestamp();
  RETURN NEW;
END;
$$;

ALTER TABLE "online_order_details"
  ALTER COLUMN "recipient_name" DROP NOT NULL,
  ALTER COLUMN "recipient_phone" DROP NOT NULL,
  DROP CONSTRAINT "online_order_details_phone",
  DROP CONSTRAINT "online_order_details_text",
  ADD CONSTRAINT "online_order_details_phone" CHECK (
    "recipient_phone" IS NULL OR ("recipient_phone" = lucy_phone_canonical("recipient_phone")) IS TRUE),
  ADD CONSTRAINT "online_order_details_text" CHECK (
    ("recipient_name" IS NULL OR btrim("recipient_name") <> '')
    AND btrim("province_name") <> '' AND btrim("ward") <> '' AND btrim("street") <> ''),
  ADD CONSTRAINT "online_order_details_recipient_erased_together" CHECK (("recipient_name" IS NULL) = ("recipient_phone" IS NULL));

-- Same INSERT rule as wave 4 (20261121000001). The details stay frozen, except the one erasure of the recipient's name and phone
-- (Owner answer 3): a cancelled online order whose invoice was never paid, of a deleted customer. The address stays.
CREATE OR REPLACE FUNCTION lucy_guard_online_order_details() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  ord product_orders%ROWTYPE;
  target invoices%ROWTYPE;
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'The delivery details of an online order are frozen at checkout';
  END IF;
  IF TG_OP = 'UPDATE' THEN
    IF (NEW.order_id, NEW.province_code, NEW.province_name, NEW.ward, NEW.street, NEW.deadline_at, NEW.policy_version,
        NEW.policy_accepted_at, NEW.client_request_id, NEW.created_at)
      IS DISTINCT FROM (OLD.order_id, OLD.province_code, OLD.province_name, OLD.ward, OLD.street, OLD.deadline_at, OLD.policy_version,
        OLD.policy_accepted_at, OLD.client_request_id, OLD.created_at)
      OR NEW.recipient_name IS NOT NULL OR NEW.recipient_phone IS NOT NULL OR OLD.recipient_phone IS NULL THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'The delivery details of an online order are frozen at checkout';
    END IF;
    SELECT * INTO ord FROM product_orders WHERE id = OLD.order_id;
    SELECT * INTO target FROM invoices WHERE id = ord.invoice_id;
    IF target.paid_seq <> 0 OR target.status <> 'CANCELLED'
       OR NOT EXISTS (SELECT 1 FROM users u WHERE u.id = ord.customer_user_id AND u.deleted_at IS NOT NULL) THEN
      RAISE EXCEPTION USING ERRCODE = '23514',
        MESSAGE = 'Only a never-paid, cancelled online order of a deleted account loses its recipient';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.recipient_name IS NULL OR NEW.recipient_phone IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Delivery details name the recipient';
  END IF;
  SELECT * INTO ord FROM product_orders WHERE id = NEW.order_id;
  SELECT * INTO target FROM invoices WHERE id = ord.invoice_id FOR SHARE;
  IF ord.id IS NULL OR ord.channel <> 'ONLINE' OR target.status <> 'DRAFT' THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Delivery details are written by the checkout of an online order';
  END IF;
  IF NEW.deadline_at <= clock_timestamp() THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'The deadline of an unpaid online order lies in the future';
  END IF;
  NEW.created_at := clock_timestamp();
  RETURN NEW;
END;
$$;

-- ------------------------------------------------------------------------------------------ 4. account_deletion_emails
CREATE TABLE "account_deletion_emails" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "state" "AuthDeliveryState" NOT NULL DEFAULT 'PENDING',
    "encrypted_payload" BYTEA,
    "nonce" BYTEA,
    "tag" BYTEA,
    "key_version" INTEGER,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "next_attempt_at" TIMESTAMPTZ(3) NOT NULL,
    "lease_token" BYTEA,
    "lease_until" TIMESTAMPTZ(3),
    "delivered_at" TIMESTAMPTZ(3),
    "provider_message_id" TEXT,
    "safe_error_code" TEXT,

    CONSTRAINT "account_deletion_emails_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "account_deletion_emails_counters" CHECK ("attempts" >= 0),
    CONSTRAINT "account_deletion_emails_lifecycle" CHECK (
      isfinite("created_at") AND isfinite("expires_at") AND "expires_at" > "created_at" AND isfinite("next_attempt_at")
      AND (("state" = 'DELIVERED') = ("delivered_at" IS NOT NULL))
      AND ("delivered_at" IS NULL OR (isfinite("delivered_at") AND "delivered_at" >= "created_at"))),
    CONSTRAINT "account_deletion_emails_payload_lifecycle" CHECK (
      ("state" = 'PENDING' AND "encrypted_payload" IS NOT NULL AND octet_length("encrypted_payload") > 0
        AND "nonce" IS NOT NULL AND octet_length("nonce") = 12 AND "tag" IS NOT NULL AND octet_length("tag") = 16
        AND "key_version" IS NOT NULL AND "key_version" > 0)
      OR ("state" <> 'PENDING' AND "encrypted_payload" IS NULL AND "nonce" IS NULL AND "tag" IS NULL AND "key_version" IS NULL
        AND "lease_token" IS NULL AND "lease_until" IS NULL)),
    CONSTRAINT "account_deletion_emails_lease" CHECK (
      ("lease_token" IS NULL AND "lease_until" IS NULL)
      OR ("lease_token" IS NOT NULL AND octet_length("lease_token") = 32 AND "lease_until" IS NOT NULL
        AND "lease_until" > "created_at" AND "lease_until" <= "expires_at")),
    CONSTRAINT "account_deletion_emails_safe_error_code" CHECK (
      "safe_error_code" IS NULL OR "safe_error_code" ~ '^[A-Z][A-Z0-9_]{0,63}$')
);
CREATE UNIQUE INDEX "account_deletion_emails_user_key" ON "account_deletion_emails"("user_id");
CREATE INDEX "account_deletion_emails_claim_idx" ON "account_deletion_emails"("state", "next_attempt_at", "lease_until", "id");
ALTER TABLE "account_deletion_emails" ADD CONSTRAINT "account_deletion_emails_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

CREATE FUNCTION lucy_guard_account_deletion_email() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'A deletion email record is history and is never deleted';
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NOT EXISTS (SELECT 1 FROM users u WHERE u.id = NEW.user_id AND u.deleted_at IS NOT NULL) OR NEW.state <> 'PENDING' THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'A deletion email is queued for a deleted account only';
    END IF;
    RETURN NEW;
  END IF;
  IF (NEW.id, NEW.user_id, NEW.created_at, NEW.expires_at) IS DISTINCT FROM (OLD.id, OLD.user_id, OLD.created_at, OLD.expires_at)
    OR NEW.attempts < OLD.attempts OR (OLD.state <> 'PENDING' AND NEW IS DISTINCT FROM OLD)
    OR (NEW.state = 'PENDING' AND (NEW.encrypted_payload, NEW.nonce, NEW.tag, NEW.key_version)
      IS DISTINCT FROM (OLD.encrypted_payload, OLD.nonce, OLD.tag, OLD.key_version)) THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Delivery binding, payload and terminal state cannot be rewritten';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "account_deletion_emails_guard" BEFORE INSERT OR UPDATE OR DELETE ON "account_deletion_emails"
FOR EACH ROW EXECUTE FUNCTION lucy_guard_account_deletion_email();
CREATE TRIGGER "account_deletion_emails_no_truncate" BEFORE TRUNCATE ON "account_deletion_emails"
FOR EACH STATEMENT EXECUTE FUNCTION lucy_reject_permanent_history_mutation();

-- The Phase 1 convention (fixed search_path, no PUBLIC execute) for every function this migration creates or replaces.
DO $$
DECLARE
  migration_schema text := current_schema();
  function_name text;
BEGIN
  FOREACH function_name IN ARRAY ARRAY[
    'lucy_guard_user_deletion', 'lucy_guard_customer_profile_erasure', 'lucy_guard_product_order',
    'lucy_guard_online_order_details', 'lucy_guard_account_deletion_email'
  ] LOOP
    EXECUTE format('ALTER FUNCTION %I.%I() SET search_path TO pg_catalog, %I, pg_temp',
      migration_schema, function_name, migration_schema);
    EXECUTE format('REVOKE ALL ON FUNCTION %I.%I() FROM PUBLIC', migration_schema, function_name);
  END LOOP;
END;
$$;
