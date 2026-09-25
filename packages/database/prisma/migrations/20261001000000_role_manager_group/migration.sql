-- Employee directory grouping: a role can be marked as a manager role. Members with an
-- assignment of an active manager-group role are listed under "Quản lý / Managers".
-- Display metadata only: it grants no permission and changes no authorization.
-- Existing roles default to false (no one is re-grouped by this migration).
ALTER TABLE "roles" ADD COLUMN "is_manager_group" BOOLEAN NOT NULL DEFAULT false;
