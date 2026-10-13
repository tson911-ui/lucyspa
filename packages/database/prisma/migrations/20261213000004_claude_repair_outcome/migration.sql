-- Claude integration CI-F1 (Owner decision of 2026-10-13, design section 15): the targeted repair call of a product rewrite draft is
-- recorded in the usage ledger with its own outcome, so what repairs cost can be added up apart from what the rewrites cost.
-- Additive: the old values stay valid, no row changes, the append-only trigger is not involved.
ALTER TABLE "ai_usage_ledger" DROP CONSTRAINT "ai_usage_ledger_outcome";
ALTER TABLE "ai_usage_ledger" ADD CONSTRAINT "ai_usage_ledger_outcome"
  CHECK ("outcome" IN ('SUCCEEDED', 'REFUSED', 'FAILED', 'REPAIRED', 'REPAIR_FAILED'));
