-- Claude integration Wave A (CI-B1): which discount programs the chat bot may mention. The Owner ticks "bot may mention" on a program; the
-- default is false, so nothing is mentioned until he chooses (design `PHASE_CLAUDE_INTEGRATION.md` section 6.2, OQ-CI-7: never a code-based,
-- member-, employee- or manager-targeted or customer-specific program). Additive: one defaulted column on `discounts`; the existing guard
-- already accepts any other column when the row version advances by one.
ALTER TABLE "discounts" ADD COLUMN "bot_visible" BOOLEAN NOT NULL DEFAULT false;
