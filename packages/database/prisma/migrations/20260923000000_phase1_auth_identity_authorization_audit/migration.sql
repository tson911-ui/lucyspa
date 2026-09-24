-- Phase 1 Step 2 only: additive schema, no account/catalog seeds or Phase 0 data changes.
-- SQL-only constraints are intentional and must be retained in future migrations.

-- CreateEnum
CREATE TYPE "UserKind" AS ENUM ('CUSTOMER', 'EMPLOYEE', 'OWNER');

-- CreateEnum
CREATE TYPE "UserStatus" AS ENUM ('PENDING_SETUP', 'ACTIVE', 'INACTIVE');

-- CreateEnum
CREATE TYPE "PreferredLocale" AS ENUM ('vi', 'en');

-- CreateEnum
CREATE TYPE "AuthChallengePurpose" AS ENUM ('ACTIVATE_CUSTOMER', 'RESET_PASSWORD', 'VERIFY_RECOVERY_EMAIL', 'EMPLOYEE_SETUP');

-- CreateEnum
CREATE TYPE "AuthDeliveryState" AS ENUM ('PENDING', 'DELIVERED', 'FAILED', 'INVALIDATED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "SessionKind" AS ENUM ('ANONYMOUS', 'AUTHENTICATED');

-- CreateEnum
CREATE TYPE "ScopeKind" AS ENUM ('GLOBAL', 'BRANCH');

-- CreateEnum
CREATE TYPE "PermissionEffect" AS ENUM ('ALLOW', 'DENY');

-- CreateEnum
CREATE TYPE "ScopeCapability" AS ENUM ('GLOBAL_ONLY', 'BRANCH_CAPABLE');

-- CreateEnum
CREATE TYPE "DataClassification" AS ENUM ('STANDARD', 'EMPLOYEE_PAY');

-- CreateEnum
CREATE TYPE "AuditActorKind" AS ENUM ('USER', 'BOOTSTRAP', 'SYSTEM');

-- CreateEnum
CREATE TYPE "PermissionCode" AS ENUM ('VIEW_EMPLOYEES', 'CREATE_EMPLOYEES', 'UPDATE_EMPLOYEES', 'MANAGE_EMPLOYEE_STATUS', 'MANAGE_EMPLOYEE_ACCESS', 'MANAGE_EMPLOYEE_SCOPE', 'VIEW_EMPLOYEE_PAY', 'MANAGE_EMPLOYEE_PAY', 'MANAGE_PERMISSIONS', 'VIEW_AUDIT_LOG');

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "kind" "UserKind" NOT NULL,
    "status" "UserStatus" NOT NULL,
    "full_name" TEXT NOT NULL,
    "preferred_locale" "PreferredLocale" NOT NULL,
    "email_canonical" VARCHAR(254),
    "email_delivery" VARCHAR(254),
    "email_verified_at" TIMESTAMPTZ(3),
    "phone_canonical" VARCHAR(16),
    "normalization_version" INTEGER NOT NULL,
    "password_hash" TEXT,
    "credential_version" INTEGER NOT NULL DEFAULT 1,
    "authz_version" INTEGER NOT NULL DEFAULT 1,
    "row_version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "customer_profiles" (
    "user_id" UUID NOT NULL,
    "date_of_birth" DATE NOT NULL,
    "address" TEXT NOT NULL,

    CONSTRAINT "customer_profiles_pkey" PRIMARY KEY ("user_id")
);

-- CreateTable
CREATE TABLE "employee_profiles" (
    "user_id" UUID NOT NULL,
    "employee_code_canonical" VARCHAR(64) NOT NULL,
    "date_of_birth" DATE NOT NULL,
    "address" TEXT NOT NULL,
    "base_salary_vnd" BIGINT,

    CONSTRAINT "employee_profiles_pkey" PRIMARY KEY ("user_id")
);

-- CreateTable
CREATE TABLE "employee_branch_assignments" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "employee_user_id" UUID NOT NULL,
    "branch_id" UUID NOT NULL,
    "granted_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revoked_at" TIMESTAMPTZ(3),
    "granted_by_user_id" UUID NOT NULL,

    CONSTRAINT "employee_branch_assignments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "registration_intents" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "email_canonical" VARCHAR(254) NOT NULL,
    "email_delivery" VARCHAR(254) NOT NULL,
    "phone_canonical" VARCHAR(16) NOT NULL,
    "normalization_version" INTEGER NOT NULL,
    "password_hash" TEXT NOT NULL,
    "full_name" TEXT NOT NULL,
    "date_of_birth" DATE NOT NULL,
    "address" TEXT NOT NULL,
    "preferred_locale" "PreferredLocale" NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "completed_at" TIMESTAMPTZ(3),
    "invalidated_at" TIMESTAMPTZ(3),
    "completed_user_id" UUID,

    CONSTRAINT "registration_intents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "auth_challenges" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "purpose" "AuthChallengePurpose" NOT NULL,
    "flow_token_hash" BYTEA NOT NULL,
    "identity_key" BYTEA NOT NULL,
    "identity_key_version" INTEGER NOT NULL,
    "registration_intent_id" UUID,
    "user_id" UUID,
    "generation" INTEGER NOT NULL DEFAULT 1,
    "verifier_digest" BYTEA,
    "key_version" INTEGER,
    "credential_version" INTEGER,
    "authz_version" INTEGER,
    "delivery_email_snapshot" VARCHAR(254),
    "failed_attempts" INTEGER NOT NULL DEFAULT 0,
    "max_attempts" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "flow_expires_at" TIMESTAMPTZ(3) NOT NULL,
    "code_generated_at" TIMESTAMPTZ(3),
    "code_expires_at" TIMESTAMPTZ(3),
    "consumed_at" TIMESTAMPTZ(3),
    "invalidated_at" TIMESTAMPTZ(3),

    CONSTRAINT "auth_challenges_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "auth_deliveries" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "challenge_id" UUID NOT NULL,
    "generation" INTEGER NOT NULL,
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

    CONSTRAINT "auth_deliveries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sessions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "token_hash" BYTEA NOT NULL,
    "kind" "SessionKind" NOT NULL,
    "user_id" UUID,
    "credential_version" INTEGER,
    "authz_version" INTEGER,
    "csrf_key_version" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_activity_at" TIMESTAMPTZ(3) NOT NULL,
    "absolute_expires_at" TIMESTAMPTZ(3) NOT NULL,
    "revoked_at" TIMESTAMPTZ(3),
    "reauthenticated_at" TIMESTAMPTZ(3),

    CONSTRAINT "sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "auth_throttle_buckets" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "operation_bucket" TEXT NOT NULL,
    "pseudonymous_key" BYTEA NOT NULL,
    "key_version" INTEGER NOT NULL,
    "window_started_at" TIMESTAMPTZ(3) NOT NULL,
    "window_seconds" INTEGER NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 0,
    "next_allowed_at" TIMESTAMPTZ(3),
    "expires_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "auth_throttle_buckets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "roles" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "code" TEXT NOT NULL,
    "display_name_vi" TEXT NOT NULL,
    "display_name_en" TEXT NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "row_version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "roles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "permissions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "code" "PermissionCode" NOT NULL,
    "scope_capability" "ScopeCapability" NOT NULL,
    "data_classification" "DataClassification" NOT NULL,

    CONSTRAINT "permissions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "role_permissions" (
    "role_id" UUID NOT NULL,
    "permission_id" UUID NOT NULL,

    CONSTRAINT "role_permissions_pkey" PRIMARY KEY ("role_id","permission_id")
);

-- CreateTable
CREATE TABLE "user_role_assignments" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "role_id" UUID NOT NULL,
    "scope_kind" "ScopeKind" NOT NULL,
    "branch_id" UUID,
    "row_version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "user_role_assignments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_permission_overrides" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "permission_id" UUID NOT NULL,
    "effect" "PermissionEffect" NOT NULL,
    "scope_kind" "ScopeKind" NOT NULL,
    "branch_id" UUID,
    "row_version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "user_permission_overrides_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_events" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "schema_version" INTEGER NOT NULL DEFAULT 1,
    "action" TEXT NOT NULL,
    "occurred_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actor_kind" "AuditActorKind" NOT NULL,
    "actor_user_id" UUID,
    "subject_user_id" UUID,
    "entity_type" TEXT NOT NULL,
    "entity_id" TEXT NOT NULL,
    "branch_id" UUID,
    "request_id" TEXT,
    "correlation_id" TEXT,
    "reason" TEXT,
    "before" JSONB,
    "after" JSONB,
    "data_classification" "DataClassification" NOT NULL,

    CONSTRAINT "audit_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_canonical_key" ON "users"("email_canonical");

-- CreateIndex
CREATE UNIQUE INDEX "users_phone_canonical_key" ON "users"("phone_canonical");

-- CreateIndex
CREATE INDEX "users_kind_status_idx" ON "users"("kind", "status", "id");

-- CreateIndex
CREATE UNIQUE INDEX "employee_profiles_employee_code_canonical_key" ON "employee_profiles"("employee_code_canonical");

-- CreateIndex
CREATE INDEX "employee_branch_assignments_user_scope_idx" ON "employee_branch_assignments"("employee_user_id", "revoked_at", "branch_id");

-- CreateIndex
CREATE INDEX "employee_branch_assignments_branch_scope_idx" ON "employee_branch_assignments"("branch_id", "revoked_at", "employee_user_id");

-- CreateIndex
CREATE INDEX "employee_branch_assignments_grantor_idx" ON "employee_branch_assignments"("granted_by_user_id");

-- CreateIndex
CREATE INDEX "registration_intents_email_expiry_idx" ON "registration_intents"("email_canonical", "expires_at");

-- CreateIndex
CREATE INDEX "registration_intents_expiry_idx" ON "registration_intents"("expires_at", "id");

-- CreateIndex
CREATE INDEX "registration_intents_completed_user_idx" ON "registration_intents"("completed_user_id");

-- CreateIndex
CREATE UNIQUE INDEX "auth_challenges_flow_token_hash_key" ON "auth_challenges"("flow_token_hash");

-- CreateIndex
CREATE INDEX "auth_challenges_user_purpose_idx" ON "auth_challenges"("user_id", "purpose");

-- CreateIndex
CREATE INDEX "auth_challenges_intent_idx" ON "auth_challenges"("registration_intent_id");

-- CreateIndex
CREATE INDEX "auth_challenges_flow_expiry_idx" ON "auth_challenges"("flow_expires_at", "id");

-- CreateIndex
CREATE INDEX "auth_challenges_code_expiry_idx" ON "auth_challenges"("code_expires_at", "id");

-- CreateIndex
CREATE INDEX "auth_deliveries_claim_idx" ON "auth_deliveries"("state", "next_attempt_at", "lease_until", "id");

-- CreateIndex
CREATE INDEX "auth_deliveries_expiry_idx" ON "auth_deliveries"("expires_at", "id");

-- CreateIndex
CREATE UNIQUE INDEX "auth_deliveries_challenge_generation_key" ON "auth_deliveries"("challenge_id", "generation");

-- CreateIndex
CREATE UNIQUE INDEX "sessions_token_hash_key" ON "sessions"("token_hash");

-- CreateIndex
CREATE INDEX "sessions_user_revocation_expiry_idx" ON "sessions"("user_id", "revoked_at", "absolute_expires_at");

-- CreateIndex
CREATE INDEX "sessions_expiry_idx" ON "sessions"("absolute_expires_at", "id");

-- CreateIndex
CREATE INDEX "auth_throttle_buckets_expiry_idx" ON "auth_throttle_buckets"("expires_at", "id");

-- CreateIndex
CREATE UNIQUE INDEX "auth_throttle_buckets_operation_key_window_key" ON "auth_throttle_buckets"("operation_bucket", "pseudonymous_key", "key_version", "window_started_at", "window_seconds");

-- CreateIndex
CREATE UNIQUE INDEX "roles_code_key" ON "roles"("code");

-- CreateIndex
CREATE UNIQUE INDEX "permissions_code_key" ON "permissions"("code");

-- CreateIndex
CREATE INDEX "role_permissions_permission_idx" ON "role_permissions"("permission_id");

-- CreateIndex
CREATE INDEX "user_role_assignments_user_scope_idx" ON "user_role_assignments"("user_id", "scope_kind", "branch_id");

-- CreateIndex
CREATE INDEX "user_role_assignments_role_idx" ON "user_role_assignments"("role_id");

-- CreateIndex
CREATE INDEX "user_role_assignments_branch_idx" ON "user_role_assignments"("branch_id");

-- CreateIndex
CREATE INDEX "user_permission_overrides_user_scope_idx" ON "user_permission_overrides"("user_id", "scope_kind", "branch_id");

-- CreateIndex
CREATE INDEX "user_permission_overrides_permission_idx" ON "user_permission_overrides"("permission_id");

-- CreateIndex
CREATE INDEX "user_permission_overrides_branch_idx" ON "user_permission_overrides"("branch_id");

-- CreateIndex
CREATE INDEX "audit_events_time_idx" ON "audit_events"("occurred_at", "id");

-- CreateIndex
CREATE INDEX "audit_events_actor_idx" ON "audit_events"("actor_user_id", "occurred_at", "id");

-- CreateIndex
CREATE INDEX "audit_events_subject_idx" ON "audit_events"("subject_user_id", "occurred_at", "id");

-- CreateIndex
CREATE INDEX "audit_events_entity_idx" ON "audit_events"("entity_type", "entity_id", "occurred_at", "id");

-- CreateIndex
CREATE INDEX "audit_events_branch_action_idx" ON "audit_events"("branch_id", "action", "occurred_at", "id");

-- CreateIndex
CREATE INDEX "audit_events_action_idx" ON "audit_events"("action", "occurred_at", "id");

-- AddForeignKey
ALTER TABLE "customer_profiles" ADD CONSTRAINT "customer_profiles_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "employee_profiles" ADD CONSTRAINT "employee_profiles_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "employee_branch_assignments" ADD CONSTRAINT "employee_branch_assignments_employee_user_id_fkey" FOREIGN KEY ("employee_user_id") REFERENCES "employee_profiles"("user_id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "employee_branch_assignments" ADD CONSTRAINT "employee_branch_assignments_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "employee_branch_assignments" ADD CONSTRAINT "employee_branch_assignments_granted_by_user_id_fkey" FOREIGN KEY ("granted_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "registration_intents" ADD CONSTRAINT "registration_intents_completed_user_id_fkey" FOREIGN KEY ("completed_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "auth_challenges" ADD CONSTRAINT "auth_challenges_registration_intent_id_fkey" FOREIGN KEY ("registration_intent_id") REFERENCES "registration_intents"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "auth_challenges" ADD CONSTRAINT "auth_challenges_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "auth_deliveries" ADD CONSTRAINT "auth_deliveries_challenge_id_fkey" FOREIGN KEY ("challenge_id") REFERENCES "auth_challenges"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_role_id_fkey" FOREIGN KEY ("role_id") REFERENCES "roles"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_permission_id_fkey" FOREIGN KEY ("permission_id") REFERENCES "permissions"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "user_role_assignments" ADD CONSTRAINT "user_role_assignments_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "user_role_assignments" ADD CONSTRAINT "user_role_assignments_role_id_fkey" FOREIGN KEY ("role_id") REFERENCES "roles"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "user_role_assignments" ADD CONSTRAINT "user_role_assignments_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "user_permission_overrides" ADD CONSTRAINT "user_permission_overrides_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "user_permission_overrides" ADD CONSTRAINT "user_permission_overrides_permission_id_fkey" FOREIGN KEY ("permission_id") REFERENCES "permissions"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "user_permission_overrides" ADD CONSTRAINT "user_permission_overrides_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_actor_user_id_fkey" FOREIGN KEY ("actor_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_subject_user_id_fkey" FOREIGN KEY ("subject_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- Identity, authorization structure and permanent audit guards.
-- Canonical mailbox syntax is only a storage boundary. Runtime normalization and
-- maintained mailbox/phone validators remain authoritative before persistence.
ALTER TABLE "users"
  ADD CONSTRAINT "users_name_nonblank" CHECK ("full_name" !~ '^[[:space:]]*$'),
  ADD CONSTRAINT "users_versions_positive" CHECK (
    "normalization_version" > 0 AND "credential_version" > 0 AND "authz_version" > 0 AND "row_version" > 0
  ),
  ADD CONSTRAINT "users_email_pair" CHECK (
    ("email_canonical" IS NULL AND "email_delivery" IS NULL AND "email_verified_at" IS NULL)
    OR (
      "email_canonical" IS NOT NULL AND "email_delivery" IS NOT NULL
      AND "email_canonical" = lower("email_delivery" COLLATE "C")
      AND "email_canonical" ~ '^[a-z0-9.!#$%&''*+/=?^_`{|}~-]+@[a-z0-9.-]+$'
      AND char_length(split_part("email_canonical", '@', 1)) <= 64
      AND split_part("email_delivery", '@', 2) = split_part("email_canonical", '@', 2)
    )
  ),
  ADD CONSTRAINT "users_phone_e164_shape" CHECK (
    "phone_canonical" IS NULL OR "phone_canonical" ~ '^\+[1-9][0-9]{1,14}$'
  ),
  ADD CONSTRAINT "users_password_hash_shape" CHECK (
    "password_hash" IS NULL OR "password_hash" LIKE '$argon2id$%'
  ),
  ADD CONSTRAINT "users_kind_credentials" CHECK (
    ("kind" = 'CUSTOMER' AND "status" = 'ACTIVE' AND "email_canonical" IS NOT NULL
      AND "email_verified_at" IS NOT NULL AND "phone_canonical" IS NOT NULL AND "password_hash" IS NOT NULL)
    OR ("kind" = 'OWNER' AND "status" = 'ACTIVE' AND "email_canonical" IS NOT NULL AND "password_hash" IS NOT NULL)
    OR ("kind" = 'EMPLOYEE' AND "phone_canonical" IS NOT NULL AND (
      ("status" = 'ACTIVE' AND "password_hash" IS NOT NULL)
      OR ("status" = 'PENDING_SETUP' AND "password_hash" IS NULL)
      OR "status" = 'INACTIVE'
    ))
  );

CREATE UNIQUE INDEX "users_sole_owner_key" ON "users" ("kind") WHERE "kind" = 'OWNER';

-- Grant EXECUTE on this otherwise inert capability only to a separately managed
-- bootstrap principal. No roles, memberships, accounts or passwords are created.
CREATE FUNCTION lucy_owner_bootstrap_capability() RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  RETURN;
END;
$$;
REVOKE ALL ON FUNCTION lucy_owner_bootstrap_capability() FROM PUBLIC;

CREATE FUNCTION lucy_guard_user_identity() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'User identities are permanent; use an authorized status transition';
  END IF;
  IF TG_OP = 'UPDATE' AND (NEW.id IS DISTINCT FROM OLD.id OR NEW.kind IS DISTINCT FROM OLD.kind) THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'User identity and principal kind are immutable';
  END IF;
  IF TG_OP = 'INSERT' AND NEW.kind = 'OWNER' AND NOT has_function_privilege(
    current_user,
    format('%I.lucy_owner_bootstrap_capability()', TG_TABLE_SCHEMA)::regprocedure,
    'EXECUTE'
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Owner creation requires the dedicated bootstrap database privilege';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "users_identity_guard" BEFORE INSERT OR UPDATE OR DELETE ON "users"
FOR EACH ROW EXECUTE FUNCTION lucy_guard_user_identity();

CREATE FUNCTION lucy_reject_permanent_history_mutation() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Permanent identity and audit history cannot be removed or rewritten';
END;
$$;
CREATE TRIGGER "users_no_truncate" BEFORE TRUNCATE ON "users"
FOR EACH STATEMENT EXECUTE FUNCTION lucy_reject_permanent_history_mutation();

ALTER TABLE "customer_profiles"
  ADD CONSTRAINT "customer_profiles_address_nonblank" CHECK ("address" !~ '^[[:space:]]*$'),
  ADD CONSTRAINT "customer_profiles_calendar_date" CHECK (isfinite("date_of_birth"));
ALTER TABLE "employee_profiles"
  ADD CONSTRAINT "employee_profiles_address_nonblank" CHECK ("address" !~ '^[[:space:]]*$'),
  ADD CONSTRAINT "employee_profiles_calendar_date" CHECK (isfinite("date_of_birth")),
  ADD CONSTRAINT "employee_profiles_code_canonical" CHECK ("employee_code_canonical" ~ '^[A-Z0-9_-]{1,64}$'),
  ADD CONSTRAINT "employee_profiles_salary_nonnegative" CHECK ("base_salary_vnd" IS NULL OR "base_salary_vnd" >= 0);

CREATE FUNCTION lucy_guard_profile_identity() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.user_id IS DISTINCT FROM OLD.user_id THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'A profile cannot be moved to another User';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "customer_profiles_identity_guard" BEFORE UPDATE ON "customer_profiles"
FOR EACH ROW EXECUTE FUNCTION lucy_guard_profile_identity();
CREATE TRIGGER "employee_profiles_identity_guard" BEFORE UPDATE ON "employee_profiles"
FOR EACH ROW EXECUTE FUNCTION lucy_guard_profile_identity();
CREATE TRIGGER "customer_profiles_no_truncate" BEFORE TRUNCATE ON "customer_profiles"
FOR EACH STATEMENT EXECUTE FUNCTION lucy_reject_permanent_history_mutation();
CREATE TRIGGER "employee_profiles_no_truncate" BEFORE TRUNCATE ON "employee_profiles"
FOR EACH STATEMENT EXECUTE FUNCTION lucy_reject_permanent_history_mutation();

-- Check the final transaction state, allowing User and matching profile creation
-- with User inserted first (the FK is immediate), without a partial identity.
-- The User row lock serializes concurrent profile changes for that identity.
CREATE FUNCTION lucy_check_user_profile() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  checked_user_id uuid;
  checked_kind text;
  has_customer_profile boolean;
  has_employee_profile boolean;
BEGIN
  IF TG_TABLE_NAME = 'users' THEN
    checked_user_id := NEW.id;
  ELSIF TG_OP = 'DELETE' THEN
    checked_user_id := OLD.user_id;
  ELSE
    checked_user_id := NEW.user_id;
  END IF;
  SELECT kind::text INTO checked_kind FROM users WHERE id = checked_user_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;
  SELECT EXISTS (SELECT 1 FROM customer_profiles WHERE user_id = checked_user_id),
         EXISTS (SELECT 1 FROM employee_profiles WHERE user_id = checked_user_id)
    INTO has_customer_profile, has_employee_profile;
  IF (checked_kind = 'CUSTOMER' AND (NOT has_customer_profile OR has_employee_profile))
    OR (checked_kind = 'EMPLOYEE' AND (NOT has_employee_profile OR has_customer_profile))
    OR (checked_kind = 'OWNER' AND (has_customer_profile OR has_employee_profile)) THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'User kind requires exactly its matching profile and no other profile';
  END IF;
  RETURN NULL;
END;
$$;
CREATE CONSTRAINT TRIGGER "users_profile_consistency" AFTER INSERT OR UPDATE ON "users"
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION lucy_check_user_profile();
CREATE CONSTRAINT TRIGGER "customer_profiles_kind_consistency" AFTER INSERT OR UPDATE OR DELETE ON "customer_profiles"
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION lucy_check_user_profile();
CREATE CONSTRAINT TRIGGER "employee_profiles_kind_consistency" AFTER INSERT OR UPDATE OR DELETE ON "employee_profiles"
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION lucy_check_user_profile();

ALTER TABLE "employee_branch_assignments"
  ADD CONSTRAINT "employee_branch_assignments_revocation_order" CHECK ("revoked_at" IS NULL OR "revoked_at" >= "granted_at");
CREATE UNIQUE INDEX "employee_branch_assignments_active_key"
  ON "employee_branch_assignments" ("employee_user_id", "branch_id") WHERE "revoked_at" IS NULL;
CREATE FUNCTION lucy_guard_branch_membership_history() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Employee branch membership history cannot be deleted';
  END IF;
  IF (NEW.id, NEW.employee_user_id, NEW.branch_id, NEW.granted_at, NEW.granted_by_user_id)
    IS DISTINCT FROM (OLD.id, OLD.employee_user_id, OLD.branch_id, OLD.granted_at, OLD.granted_by_user_id)
    OR (OLD.revoked_at IS NOT NULL AND NEW.revoked_at IS DISTINCT FROM OLD.revoked_at) THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Membership grant history and completed revocation are immutable';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "employee_branch_assignments_history_guard" BEFORE UPDATE OR DELETE ON "employee_branch_assignments"
FOR EACH ROW EXECUTE FUNCTION lucy_guard_branch_membership_history();
CREATE TRIGGER "employee_branch_assignments_no_truncate" BEFORE TRUNCATE ON "employee_branch_assignments"
FOR EACH STATEMENT EXECUTE FUNCTION lucy_reject_permanent_history_mutation();

ALTER TABLE "roles"
  ADD CONSTRAINT "roles_code_canonical_and_not_owner" CHECK ("code" ~ '^[A-Z][A-Z0-9_]*$' AND "code" <> 'OWNER'),
  ADD CONSTRAINT "roles_names_nonblank" CHECK ("display_name_vi" !~ '^[[:space:]]*$' AND "display_name_en" !~ '^[[:space:]]*$'),
  ADD CONSTRAINT "roles_version_positive" CHECK ("row_version" > 0);

-- All reviewed Phase 1 permissions are branch-capable. Shared role editing is a
-- GLOBAL action under MANAGE_PERMISSIONS; that runtime distinction is not a new
-- permission code or an authorization evaluator in this schema migration.
ALTER TABLE "permissions"
  ADD CONSTRAINT "permissions_phase1_catalog_semantics" CHECK (
    "scope_capability" = 'BRANCH_CAPABLE'
    AND (("code" IN ('VIEW_EMPLOYEE_PAY', 'MANAGE_EMPLOYEE_PAY') AND "data_classification" = 'EMPLOYEE_PAY')
      OR ("code" NOT IN ('VIEW_EMPLOYEE_PAY', 'MANAGE_EMPLOYEE_PAY') AND "data_classification" = 'STANDARD'))
  );
CREATE FUNCTION lucy_guard_permission_catalog() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW IS DISTINCT FROM OLD THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Permission catalog identity and semantics are code-owned and immutable';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "permissions_catalog_guard" BEFORE UPDATE ON "permissions"
FOR EACH ROW EXECUTE FUNCTION lucy_guard_permission_catalog();

ALTER TABLE "user_role_assignments"
  ADD CONSTRAINT "user_role_assignments_scope_consistency" CHECK (
    ("scope_kind" = 'GLOBAL' AND "branch_id" IS NULL) OR ("scope_kind" = 'BRANCH' AND "branch_id" IS NOT NULL)
  ),
  ADD CONSTRAINT "user_role_assignments_version_positive" CHECK ("row_version" > 0);
CREATE UNIQUE INDEX "user_role_assignments_global_key" ON "user_role_assignments" ("user_id", "role_id")
  WHERE "scope_kind" = 'GLOBAL';
CREATE UNIQUE INDEX "user_role_assignments_branch_key" ON "user_role_assignments" ("user_id", "role_id", "branch_id")
  WHERE "scope_kind" = 'BRANCH';
ALTER TABLE "user_permission_overrides"
  ADD CONSTRAINT "user_permission_overrides_scope_consistency" CHECK (
    ("scope_kind" = 'GLOBAL' AND "branch_id" IS NULL) OR ("scope_kind" = 'BRANCH' AND "branch_id" IS NOT NULL)
  ),
  ADD CONSTRAINT "user_permission_overrides_version_positive" CHECK ("row_version" > 0);
CREATE UNIQUE INDEX "user_permission_overrides_global_key" ON "user_permission_overrides" ("user_id", "permission_id")
  WHERE "scope_kind" = 'GLOBAL';
CREATE UNIQUE INDEX "user_permission_overrides_branch_key" ON "user_permission_overrides" ("user_id", "permission_id", "branch_id")
  WHERE "scope_kind" = 'BRANCH';

CREATE FUNCTION lucy_check_employee_grant_target() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  target_kind text;
BEGIN
  SELECT kind::text INTO target_kind FROM users WHERE id = NEW.user_id;
  IF target_kind IS DISTINCT FROM 'EMPLOYEE' THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Only employee principals may receive roles or permission overrides';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "user_role_assignments_employee_target" BEFORE INSERT OR UPDATE ON "user_role_assignments"
FOR EACH ROW EXECUTE FUNCTION lucy_check_employee_grant_target();
CREATE TRIGGER "user_permission_overrides_employee_target" BEFORE INSERT OR UPDATE ON "user_permission_overrides"
FOR EACH ROW EXECUTE FUNCTION lucy_check_employee_grant_target();

ALTER TABLE "audit_events"
  ADD CONSTRAINT "audit_events_schema_version_positive" CHECK ("schema_version" > 0),
  ADD CONSTRAINT "audit_events_actor_consistency" CHECK (("actor_kind" = 'USER') = ("actor_user_id" IS NOT NULL)),
  ADD CONSTRAINT "audit_events_identifiers_nonblank" CHECK (
    "action" ~ '^[A-Z][A-Z0-9_]*$' AND "entity_type" !~ '^[[:space:]]*$' AND "entity_id" !~ '^[[:space:]]*$'
    AND ("request_id" IS NULL OR "request_id" !~ '^[[:space:]]*$')
    AND ("correlation_id" IS NULL OR "correlation_id" !~ '^[[:space:]]*$')
    AND ("reason" IS NULL OR "reason" !~ '^[[:space:]]*$')
  ),
  ADD CONSTRAINT "audit_events_snapshots_are_objects" CHECK (
    ("before" IS NULL OR jsonb_typeof("before") = 'object') AND ("after" IS NULL OR jsonb_typeof("after") = 'object')
  ),
  ADD CONSTRAINT "audit_events_salary_classification" CHECK ("action" <> 'BASE_SALARY_CHANGED' OR "data_classification" = 'EMPLOYEE_PAY');
CREATE TRIGGER "audit_events_append_only" BEFORE UPDATE OR DELETE ON "audit_events"
FOR EACH ROW EXECUTE FUNCTION lucy_reject_permanent_history_mutation();
CREATE TRIGGER "audit_events_no_truncate" BEFORE TRUNCATE ON "audit_events"
FOR EACH STATEMENT EXECUTE FUNCTION lucy_reject_permanent_history_mutation();

-- Defense in depth only: separately provisioned runtime credentials also need
-- INSERT/appropriate SELECT, without ownership or DDL/trigger bypass privileges.
REVOKE UPDATE, DELETE, TRUNCATE ON "audit_events" FROM PUBLIC;

-- Authentication storage constraints. Numeric lifetimes/budgets remain runtime
-- configuration; these checks enforce structure and irreversible transitions.
ALTER TABLE "registration_intents"
  ADD CONSTRAINT "registration_intents_candidate_valid" CHECK (
    "normalization_version" > 0 AND "full_name" !~ '^[[:space:]]*$'
    AND "address" !~ '^[[:space:]]*$' AND isfinite("date_of_birth")
    AND "password_hash" LIKE '$argon2id$%'
    AND "email_canonical" = lower("email_delivery" COLLATE "C")
    AND "email_canonical" ~ '^[a-z0-9.!#$%&''*+/=?^_`{|}~-]+@[a-z0-9.-]+$'
    AND char_length(split_part("email_canonical", '@', 1)) <= 64
    AND split_part("email_delivery", '@', 2) = split_part("email_canonical", '@', 2)
    AND "phone_canonical" ~ '^\+[1-9][0-9]{1,14}$'
  ),
  ADD CONSTRAINT "registration_intents_lifecycle" CHECK (
    isfinite("created_at") AND isfinite("expires_at") AND "expires_at" > "created_at"
    AND (("completed_at" IS NULL) = ("completed_user_id" IS NULL))
    AND NOT ("completed_at" IS NOT NULL AND "invalidated_at" IS NOT NULL)
    AND ("completed_at" IS NULL OR ("completed_at" >= "created_at" AND "completed_at" < "expires_at"))
    AND ("invalidated_at" IS NULL OR (isfinite("invalidated_at") AND "invalidated_at" >= "created_at"))
  );

CREATE FUNCTION lucy_guard_registration_intent() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF (to_jsonb(NEW) - ARRAY['completed_at', 'invalidated_at', 'completed_user_id'])
        IS DISTINCT FROM (to_jsonb(OLD) - ARRAY['completed_at', 'invalidated_at', 'completed_user_id'])
      OR ((OLD.completed_at IS NOT NULL OR OLD.invalidated_at IS NOT NULL) AND NEW IS DISTINCT FROM OLD) THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Registration candidate and terminal state are immutable';
    END IF;
  END IF;
  IF NEW.completed_user_id IS NOT NULL AND (TG_OP = 'INSERT' OR OLD.completed_at IS NULL) THEN
    IF NEW.expires_at <= statement_timestamp() OR NOT EXISTS (
      SELECT 1 FROM users WHERE id = NEW.completed_user_id AND kind = 'CUSTOMER'
        AND email_canonical = NEW.email_canonical AND phone_canonical = NEW.phone_canonical
    ) THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Registration completion requires a live intent and its matching customer';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "registration_intents_lifecycle_guard" BEFORE INSERT OR UPDATE ON "registration_intents"
FOR EACH ROW EXECUTE FUNCTION lucy_guard_registration_intent();

ALTER TABLE "auth_challenges"
  ADD CONSTRAINT "auth_challenges_digest_shape" CHECK (
    octet_length("flow_token_hash") = 32 AND octet_length("identity_key") = 32 AND "identity_key_version" > 0
  ),
  ADD CONSTRAINT "auth_challenges_subject" CHECK (
    ("purpose" = 'ACTIVATE_CUSTOMER' AND "registration_intent_id" IS NOT NULL AND "user_id" IS NULL
      AND "credential_version" IS NULL AND "authz_version" IS NULL)
    OR ("purpose" <> 'ACTIVATE_CUSTOMER' AND "registration_intent_id" IS NULL AND "user_id" IS NOT NULL
      AND "credential_version" IS NOT NULL AND "credential_version" > 0
      AND ("authz_version" IS NULL OR "authz_version" > 0))
  ),
  ADD CONSTRAINT "auth_challenges_material" CHECK (
    ("purpose" = 'EMPLOYEE_SETUP' AND "verifier_digest" IS NULL AND "key_version" IS NULL
      AND "delivery_email_snapshot" IS NULL AND "code_generated_at" IS NULL AND "code_expires_at" IS NULL
      AND "authz_version" IS NOT NULL AND "authz_version" > 0)
    OR ("purpose" <> 'EMPLOYEE_SETUP' AND "verifier_digest" IS NOT NULL AND octet_length("verifier_digest") = 32
      AND "key_version" IS NOT NULL AND "key_version" > 0 AND "delivery_email_snapshot" IS NOT NULL
      AND "delivery_email_snapshot" !~ '[[:space:]]' AND position('@' in "delivery_email_snapshot") > 1
      AND "code_generated_at" IS NOT NULL AND "code_expires_at" IS NOT NULL
      AND "code_generated_at" >= "created_at" AND "code_expires_at" > "code_generated_at"
      AND "code_expires_at" <= "flow_expires_at")
  ),
  ADD CONSTRAINT "auth_challenges_bounded_attempts" CHECK (
    "generation" > 0 AND "max_attempts" > 0 AND "failed_attempts" >= 0 AND "failed_attempts" <= "max_attempts"
    AND ("failed_attempts" < "max_attempts" OR "invalidated_at" IS NOT NULL)
  ),
  ADD CONSTRAINT "auth_challenges_lifecycle" CHECK (
    isfinite("created_at") AND isfinite("flow_expires_at") AND "flow_expires_at" > "created_at"
    AND NOT ("consumed_at" IS NOT NULL AND "invalidated_at" IS NOT NULL)
    AND ("consumed_at" IS NULL OR ("consumed_at" >= "created_at" AND "consumed_at" < "flow_expires_at"
      AND ("code_expires_at" IS NULL OR "consumed_at" < "code_expires_at")))
    AND ("invalidated_at" IS NULL OR (isfinite("invalidated_at") AND "invalidated_at" >= "created_at"))
  );
-- Expired rows remain covered until explicitly invalidated under the identity
-- lock. Never use volatile now() in a partial-index predicate.
CREATE UNIQUE INDEX "auth_challenges_actionable_identity_purpose_key"
  ON "auth_challenges" ("identity_key", "purpose") WHERE "consumed_at" IS NULL AND "invalidated_at" IS NULL;

CREATE FUNCTION lucy_guard_auth_challenge() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  candidate registration_intents%ROWTYPE;
  principal users%ROWTYPE;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.purpose = 'ACTIVATE_CUSTOMER' AND NEW.registration_intent_id IS NOT NULL THEN
      SELECT * INTO candidate FROM registration_intents WHERE id = NEW.registration_intent_id;
      IF FOUND AND (NEW.delivery_email_snapshot IS DISTINCT FROM candidate.email_delivery
        OR NEW.flow_expires_at > candidate.expires_at OR NEW.created_at < candidate.created_at
        OR candidate.completed_at IS NOT NULL OR candidate.invalidated_at IS NOT NULL) THEN
        RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Activation must bind to its unchanged registration candidate and deadline';
      END IF;
    ELSIF NEW.user_id IS NOT NULL THEN
      SELECT * INTO principal FROM users WHERE id = NEW.user_id;
      IF FOUND AND (
        (NEW.purpose = 'EMPLOYEE_SETUP' AND principal.kind <> 'EMPLOYEE')
        OR (NEW.purpose = 'VERIFY_RECOVERY_EMAIL' AND principal.kind = 'CUSTOMER')
        OR (NEW.purpose <> 'EMPLOYEE_SETUP' AND NEW.delivery_email_snapshot IS DISTINCT FROM principal.email_delivery)
      ) THEN
        RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Challenge purpose and delivery target must match the principal';
      END IF;
    END IF;
  ELSE
    IF (NEW.id, NEW.purpose, NEW.flow_token_hash, NEW.identity_key, NEW.identity_key_version,
        NEW.registration_intent_id, NEW.user_id, NEW.credential_version, NEW.authz_version,
        NEW.delivery_email_snapshot, NEW.max_attempts, NEW.created_at, NEW.flow_expires_at)
      IS DISTINCT FROM (OLD.id, OLD.purpose, OLD.flow_token_hash, OLD.identity_key, OLD.identity_key_version,
        OLD.registration_intent_id, OLD.user_id, OLD.credential_version, OLD.authz_version,
        OLD.delivery_email_snapshot, OLD.max_attempts, OLD.created_at, OLD.flow_expires_at)
      OR ((OLD.consumed_at IS NOT NULL OR OLD.invalidated_at IS NOT NULL) AND NEW IS DISTINCT FROM OLD)
      OR NEW.failed_attempts < OLD.failed_attempts
      OR NEW.generation < OLD.generation OR NEW.generation > OLD.generation + 1 THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Challenge binding, failure budget and terminal state cannot be rewritten';
    END IF;
    IF NEW.generation = OLD.generation THEN
      IF (NEW.verifier_digest, NEW.key_version, NEW.code_generated_at, NEW.code_expires_at)
        IS DISTINCT FROM (OLD.verifier_digest, OLD.key_version, OLD.code_generated_at, OLD.code_expires_at) THEN
        RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Replacing an email code requires a new generation';
      END IF;
    ELSIF NEW.purpose = 'EMPLOYEE_SETUP' OR OLD.flow_expires_at <= statement_timestamp()
      OR OLD.failed_attempts >= OLD.max_attempts OR NEW.verifier_digest IS NOT DISTINCT FROM OLD.verifier_digest
      OR NEW.code_generated_at < OLD.code_generated_at THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Only a live email flow may rotate its code';
    END IF;
  END IF;
  IF NEW.consumed_at IS NOT NULL AND (TG_OP = 'INSERT' OR OLD.consumed_at IS NULL)
    AND (NEW.flow_expires_at <= statement_timestamp()
    OR (NEW.code_expires_at IS NOT NULL AND NEW.code_expires_at <= statement_timestamp())) THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'An expired challenge cannot be consumed';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "auth_challenges_lifecycle_guard" BEFORE INSERT OR UPDATE ON "auth_challenges"
FOR EACH ROW EXECUTE FUNCTION lucy_guard_auth_challenge();

ALTER TABLE "auth_deliveries"
  ADD CONSTRAINT "auth_deliveries_counters" CHECK ("generation" > 0 AND "attempts" >= 0),
  ADD CONSTRAINT "auth_deliveries_lifecycle" CHECK (
    isfinite("created_at") AND isfinite("expires_at") AND "expires_at" > "created_at" AND isfinite("next_attempt_at")
    AND (("state" = 'DELIVERED') = ("delivered_at" IS NOT NULL))
    AND ("delivered_at" IS NULL OR (isfinite("delivered_at") AND "delivered_at" >= "created_at"))
  ),
  ADD CONSTRAINT "auth_deliveries_payload_lifecycle" CHECK (
    ("state" = 'PENDING' AND "encrypted_payload" IS NOT NULL AND octet_length("encrypted_payload") > 0
      AND "nonce" IS NOT NULL AND octet_length("nonce") = 12 AND "tag" IS NOT NULL AND octet_length("tag") = 16
      AND "key_version" IS NOT NULL AND "key_version" > 0)
    OR ("state" <> 'PENDING' AND "encrypted_payload" IS NULL AND "nonce" IS NULL AND "tag" IS NULL AND "key_version" IS NULL
      AND "lease_token" IS NULL AND "lease_until" IS NULL)
  ),
  ADD CONSTRAINT "auth_deliveries_lease" CHECK (
    ("lease_token" IS NULL AND "lease_until" IS NULL)
    OR ("lease_token" IS NOT NULL AND octet_length("lease_token") = 32 AND "lease_until" IS NOT NULL
      AND "lease_until" > "created_at" AND "lease_until" <= "expires_at")
  ),
  ADD CONSTRAINT "auth_deliveries_safe_error_code" CHECK ("safe_error_code" IS NULL OR "safe_error_code" ~ '^[A-Z][A-Z0-9_]{0,63}$');

CREATE FUNCTION lucy_guard_auth_delivery() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  flow auth_challenges%ROWTYPE;
BEGIN
  IF TG_OP = 'INSERT' THEN
    SELECT * INTO flow FROM auth_challenges WHERE id = NEW.challenge_id;
    IF FOUND AND (flow.purpose = 'EMPLOYEE_SETUP' OR NEW.generation <> flow.generation
      OR NEW.expires_at > flow.code_expires_at OR NEW.created_at < flow.code_generated_at) THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Delivery must bind to the current email code and its deadline';
    END IF;
  ELSE
    IF (NEW.id, NEW.challenge_id, NEW.generation, NEW.created_at, NEW.expires_at)
        IS DISTINCT FROM (OLD.id, OLD.challenge_id, OLD.generation, OLD.created_at, OLD.expires_at)
      OR NEW.attempts < OLD.attempts OR (OLD.state <> 'PENDING' AND NEW IS DISTINCT FROM OLD)
      OR (NEW.state = 'PENDING' AND (NEW.encrypted_payload, NEW.nonce, NEW.tag, NEW.key_version)
        IS DISTINCT FROM (OLD.encrypted_payload, OLD.nonce, OLD.tag, OLD.key_version)) THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Delivery binding, payload and terminal state cannot be rewritten';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "auth_deliveries_lifecycle_guard" BEFORE INSERT OR UPDATE ON "auth_deliveries"
FOR EACH ROW EXECUTE FUNCTION lucy_guard_auth_delivery();

ALTER TABLE "sessions"
  ADD CONSTRAINT "sessions_digest_versions" CHECK (octet_length("token_hash") = 32 AND "csrf_key_version" > 0),
  ADD CONSTRAINT "sessions_subject" CHECK (
    ("kind" = 'ANONYMOUS' AND "user_id" IS NULL AND "credential_version" IS NULL
      AND "authz_version" IS NULL AND "reauthenticated_at" IS NULL)
    OR ("kind" = 'AUTHENTICATED' AND "user_id" IS NOT NULL
      AND "credential_version" IS NOT NULL AND "credential_version" > 0
      AND "authz_version" IS NOT NULL AND "authz_version" > 0)
  ),
  ADD CONSTRAINT "sessions_lifecycle" CHECK (
    isfinite("created_at") AND isfinite("absolute_expires_at") AND "absolute_expires_at" > "created_at"
    AND "last_activity_at" >= "created_at" AND "last_activity_at" < "absolute_expires_at"
    AND ("revoked_at" IS NULL OR (isfinite("revoked_at") AND "revoked_at" >= "created_at"))
    AND ("reauthenticated_at" IS NULL OR ("reauthenticated_at" >= "created_at" AND "reauthenticated_at" < "absolute_expires_at"))
  );
CREATE FUNCTION lucy_guard_session() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF (NEW.id, NEW.token_hash, NEW.kind, NEW.user_id, NEW.credential_version, NEW.authz_version,
      NEW.csrf_key_version, NEW.created_at, NEW.absolute_expires_at, NEW.reauthenticated_at)
    IS DISTINCT FROM (OLD.id, OLD.token_hash, OLD.kind, OLD.user_id, OLD.credential_version, OLD.authz_version,
      OLD.csrf_key_version, OLD.created_at, OLD.absolute_expires_at, OLD.reauthenticated_at)
    OR NEW.last_activity_at < OLD.last_activity_at
    OR (OLD.revoked_at IS NOT NULL AND NEW.revoked_at IS DISTINCT FROM OLD.revoked_at) THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Session rotation requires a new row; session authority and revocation are immutable';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "sessions_lifecycle_guard" BEFORE UPDATE ON "sessions"
FOR EACH ROW EXECUTE FUNCTION lucy_guard_session();

ALTER TABLE "auth_throttle_buckets"
  ADD CONSTRAINT "auth_throttle_buckets_key_counter" CHECK (
    "operation_bucket" ~ '^[A-Z][A-Z0-9_]*$' AND octet_length("pseudonymous_key") = 32
    AND "key_version" > 0 AND "count" >= 0 AND "window_seconds" >= 0
    AND isfinite("window_started_at") AND isfinite("expires_at")
  ),
  ADD CONSTRAINT "auth_throttle_buckets_window_or_cooldown" CHECK (
    ("window_seconds" > 0 AND "next_allowed_at" IS NULL
      AND "expires_at" >= "window_started_at" + "window_seconds" * INTERVAL '1 second')
    OR ("window_seconds" = 0 AND "window_started_at" = TIMESTAMPTZ '1970-01-01 00:00:00+00'
      AND "count" = 0 AND "next_allowed_at" IS NOT NULL AND isfinite("next_allowed_at") AND "expires_at" >= "next_allowed_at")
  );
CREATE FUNCTION lucy_guard_throttle_bucket() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF (NEW.id, NEW.operation_bucket, NEW.pseudonymous_key, NEW.key_version, NEW.window_started_at, NEW.window_seconds)
    IS DISTINCT FROM (OLD.id, OLD.operation_bucket, OLD.pseudonymous_key, OLD.key_version, OLD.window_started_at, OLD.window_seconds)
    OR NEW.count < OLD.count OR NEW.next_allowed_at < OLD.next_allowed_at OR NEW.expires_at < OLD.expires_at THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'A throttle bucket cannot reset its key, counter or cooldown';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "auth_throttle_buckets_monotonic_guard" BEFORE UPDATE ON "auth_throttle_buckets"
FOR EACH ROW EXECUTE FUNCTION lucy_guard_throttle_bucket();

-- Pin every newly created function to the actual migration schema, with catalog
-- names first and temporary schemas last. This also makes isolated-schema tests
-- exercise exactly the deployment SQL. Functions remain SECURITY INVOKER so the
-- bootstrap gate checks the caller, never the migration owner's authority.
DO $$
DECLARE
  migration_schema text := current_schema();
  function_name text;
BEGIN
  FOREACH function_name IN ARRAY ARRAY[
    'lucy_owner_bootstrap_capability', 'lucy_guard_user_identity',
    'lucy_reject_permanent_history_mutation', 'lucy_guard_profile_identity',
    'lucy_check_user_profile', 'lucy_guard_branch_membership_history',
    'lucy_guard_permission_catalog', 'lucy_check_employee_grant_target',
    'lucy_guard_registration_intent', 'lucy_guard_auth_challenge',
    'lucy_guard_auth_delivery', 'lucy_guard_session', 'lucy_guard_throttle_bucket'
  ] LOOP
    EXECUTE format('ALTER FUNCTION %I.%I() SET search_path TO pg_catalog, %I, pg_temp',
      migration_schema, function_name, migration_schema);
    EXECUTE format('REVOKE ALL ON FUNCTION %I.%I() FROM PUBLIC', migration_schema, function_name);
  END LOOP;
END;
$$;
