-- Phase 8 P8-3 (reports), migration 3: two partial indexes the revenue report reads by.
-- Chosen by EXPLAIN on the synthetic load fixture (scripts/perf/phase8-fixture.sql, ~164k invoices, ~189k payments), not guessed:
--  * payments had only `payments_invoice_idx`; the report asks for the effective payments of some branches in a range of business days.
--  * invoices had only (branch, business_date, status); "paid invoices of the period" is by the paid instant.
-- Both are partial (only the rows the reports count), additive, and hold no data of their own.
CREATE INDEX "payments_branch_date_idx" ON "payments" ("branch_id", "business_date") WHERE "status" = 'SUCCEEDED';
CREATE INDEX "invoices_paid_at_idx" ON "invoices" ("branch_id", "paid_at") WHERE "status" = 'PAID';
