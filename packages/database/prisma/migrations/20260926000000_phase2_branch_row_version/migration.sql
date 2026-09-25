-- Phase 2 Step 3 only: optimistic-concurrency version for branch administration
-- (expectedVersion / 409 CONFLICT, the same convention as users, roles and services).
-- Additive; existing branch rows start at version 1. No data or seed changes.
ALTER TABLE "branches" ADD COLUMN "row_version" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "branches" ADD CONSTRAINT "branches_version_positive" CHECK ("row_version" > 0);
