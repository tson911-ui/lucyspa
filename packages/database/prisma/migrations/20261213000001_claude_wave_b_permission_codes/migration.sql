-- Claude integration Waves B to D, migration 1 of 2: enum values only.
-- The three remaining permission codes of the Owner-approved design (`docs/PHASE_CLAUDE_INTEGRATION.md` section 9.4, answers of 2026-10-12;
-- Waves B to D released by the Owner on 2026-10-13): MANAGE_CHAT_REQUESTS (the "gọi lại" inbox of the website chat), USE_AI_ASSISTANT (the
-- report question box) and VIEW_CUSTOMER_BRIEF (the KTV customer summary and the staff-only cosmetics suggestions). New enum values cannot
-- be used in the transaction that adds them, so they are committed on their own (as 20261212000000_claude_permission_codes did). The
-- catalog rows are inserted by the operator sync (`pnpm db:permissions:sync`) and nobody is granted anything by this migration.
ALTER TYPE "PermissionCode" ADD VALUE 'MANAGE_CHAT_REQUESTS';
ALTER TYPE "PermissionCode" ADD VALUE 'USE_AI_ASSISTANT';
ALTER TYPE "PermissionCode" ADD VALUE 'VIEW_CUSTOMER_BRIEF';
