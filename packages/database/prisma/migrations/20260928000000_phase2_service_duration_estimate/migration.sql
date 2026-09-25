-- Phase 2 service model: a customer-facing estimated duration range next to the one
-- internal scheduling duration. duration_minutes keeps its meaning (the deterministic
-- duration future booking reserves). The estimate never exceeds it, so a booking slot
-- is never shorter than the longest duration promised to the customer:
--   1 <= estimated_min_minutes <= estimated_max_minutes <= duration_minutes (<= 1440).
-- Existing services become exact-duration estimates (min = max = duration_minutes).
-- No other data is changed.
ALTER TABLE "services"
  ADD COLUMN "estimated_min_minutes" INTEGER,
  ADD COLUMN "estimated_max_minutes" INTEGER;

UPDATE "services"
SET "estimated_min_minutes" = "duration_minutes",
    "estimated_max_minutes" = "duration_minutes";

ALTER TABLE "services"
  ALTER COLUMN "estimated_min_minutes" SET NOT NULL,
  ALTER COLUMN "estimated_max_minutes" SET NOT NULL,
  ADD CONSTRAINT "services_estimated_duration_range" CHECK (
    "estimated_min_minutes" >= 1
    AND "estimated_min_minutes" <= "estimated_max_minutes"
    AND "estimated_max_minutes" <= "duration_minutes"
  );
