-- Claude integration Wave A (CI-X1), migration 1 of 3: enum values only.
-- Two permission codes of the Owner-approved design (`docs/PHASE_CLAUDE_INTEGRATION.md` section 9.4, answers of 2026-10-12):
-- MANAGE_AI_SETTINGS (turn the AI features on, caps, model, forbidden phrases, key check) and USE_AI_CONTENT (start rewrite runs,
-- review, edit, reject, apply drafts). Both GLOBAL_ONLY. New enum values cannot be used in the transaction that adds them, so they are
-- committed on their own here (as 20261210000000_phase8_permission_codes did). The catalog rows are inserted by the operator sync
-- (`pnpm db:permissions:sync`) and nobody is granted anything by this migration. No existing behavior changes.
ALTER TYPE "PermissionCode" ADD VALUE 'MANAGE_AI_SETTINGS';
ALTER TYPE "PermissionCode" ADD VALUE 'USE_AI_CONTENT';
