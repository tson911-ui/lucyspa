-- UX/UI Step 11, migration 1 of 2: the website-content permission code (design 16.1, Owner Q-CM1).
-- A new enum value cannot be used in the transaction that adds it, so it is committed on its own here;
-- the catalog semantics that use it follow in the next migration. The catalog row is inserted by the
-- operator sync (`pnpm db:permissions:sync`) and no role or user is granted anything by this migration.
ALTER TYPE "PermissionCode" ADD VALUE 'MANAGE_WEBSITE_CONTENT';
