-- Follow-up Step 5: verified self-service email change. Additive enum value only; it is
-- committed on its own before any statement uses it (PostgreSQL enum rule).
ALTER TYPE "AuthChallengePurpose" ADD VALUE 'CHANGE_EMAIL';
