-- Follow-up Step 5: the challenge guard learns CHANGE_EMAIL. Identical to the Phase 1
-- function for every existing purpose; a CHANGE_EMAIL flow must belong to the Owner or an
-- employee and target an address different from the stored one (the proposed new email).
CREATE OR REPLACE FUNCTION lucy_guard_auth_challenge() RETURNS trigger
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
        -- A verified email change is workforce-only and is sent to the PROPOSED address,
        -- which must differ from the stored one; every other flow targets the stored address.
        OR (NEW.purpose = 'CHANGE_EMAIL' AND (principal.kind = 'CUSTOMER'
          OR NEW.delivery_email_snapshot IS NOT DISTINCT FROM principal.email_delivery))
        OR (NEW.purpose NOT IN ('EMPLOYEE_SETUP', 'CHANGE_EMAIL')
          AND NEW.delivery_email_snapshot IS DISTINCT FROM principal.email_delivery)
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
