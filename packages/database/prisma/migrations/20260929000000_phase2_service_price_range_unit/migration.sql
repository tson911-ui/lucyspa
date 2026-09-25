-- Phase 2 service pricing: a price range and an explicit pricing unit.
-- price_vnd keeps its name and becomes the minimum price per pricing unit (the price itself
-- when the price is exact); price_max_vnd is the maximum. Exact prices use min = max.
--   0 <= price_vnd <= price_max_vnd   (price_vnd >= 0 is the existing services_price_nonnegative)
-- pricing_unit says what one price applies to: the whole service or one nail.
-- Existing services become exact, per-service prices (max = price_vnd, unit PER_SERVICE).
-- No other data is changed.
CREATE TYPE "ServicePricingUnit" AS ENUM ('PER_SERVICE', 'PER_NAIL');

ALTER TABLE "services"
  ADD COLUMN "price_max_vnd" BIGINT,
  ADD COLUMN "pricing_unit" "ServicePricingUnit" NOT NULL DEFAULT 'PER_SERVICE';

UPDATE "services" SET "price_max_vnd" = "price_vnd";

ALTER TABLE "services"
  ALTER COLUMN "price_max_vnd" SET NOT NULL,
  ADD CONSTRAINT "services_price_range" CHECK ("price_max_vnd" >= "price_vnd");
