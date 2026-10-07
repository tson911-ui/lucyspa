-- Phase 6 P6-3b (Owner decisions of 2026-10-07, design 2.8): a variant may be sold "on order" (the shop orders it from the supplier
-- after payment) and may carry its own waiting time; the default waiting time is one settings value (OQ-P6-31: 3 to 5 days).
-- Additive and Wave 1 only: three nullable-or-defaulted columns on `product_variants` and two on `product_settings`; no existing
-- row changes meaning, no table of POS, invoices, discounts, loyalty or payments is touched. NO weight column (the Owner removed it).
--
-- `sell_on_order` is ON by default (OQ-P6-30: "mặc định bật đặt theo đơn"); the Owner switches it off for items the shop keeps in
-- stock. The waiting time is a range of calendar days (the Owner's "ngày thường", not excluding Sundays or holidays).
-- Database rules chosen by me, pending the Owner's yes/no (same as P6-2): both variant bounds are set or both are empty; every
-- bound is 1 to 90 days with min <= max; the same range for the settings default.

ALTER TABLE "product_variants"
  ADD COLUMN "sell_on_order" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "lead_time_days_min" SMALLINT,
  ADD COLUMN "lead_time_days_max" SMALLINT;

ALTER TABLE "product_variants" ADD CONSTRAINT "product_variants_lead_time" CHECK (
  ("lead_time_days_min" IS NULL AND "lead_time_days_max" IS NULL)
  OR ("lead_time_days_min" IS NOT NULL AND "lead_time_days_max" IS NOT NULL
      AND "lead_time_days_min" >= 1 AND "lead_time_days_max" <= 90 AND "lead_time_days_min" <= "lead_time_days_max"));

ALTER TABLE "product_settings"
  ADD COLUMN "lead_time_days_min" SMALLINT NOT NULL DEFAULT 3,
  ADD COLUMN "lead_time_days_max" SMALLINT NOT NULL DEFAULT 5;

ALTER TABLE "product_settings" ADD CONSTRAINT "product_settings_lead_time" CHECK (
  "lead_time_days_min" >= 1 AND "lead_time_days_max" <= 90 AND "lead_time_days_min" <= "lead_time_days_max");
