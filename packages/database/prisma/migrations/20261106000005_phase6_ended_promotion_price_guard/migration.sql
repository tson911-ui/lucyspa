-- P6-3 Owner fix (2026-10-07): a promotion that was ended by hand, even before its planned start, must not block lowering the
-- list price. Ending by hand stamps ended_early_at at GREATEST(starts_at, now), so a promotion ended before it started carries a
-- future ended_early_at that equals its start: an empty window that never applies. The list price guard now counts only
-- promotions that were not ended by hand and whose planned end has not passed. Only the function body is replaced; no table,
-- column or trigger changes, and no price or promotion row is touched.
CREATE OR REPLACE FUNCTION lucy_guard_product_price_version() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  latest integer;
BEGIN
  IF TG_OP <> 'INSERT' THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'A price version is append-only';
  END IF;
  PERFORM 1 FROM product_variants v WHERE v.id = NEW.variant_id FOR KEY SHARE;
  SELECT COALESCE(max(p.version_no), 0) INTO latest FROM product_price_versions p WHERE p.variant_id = NEW.variant_id;
  IF NEW.version_no <> latest + 1 THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'A price version follows the previous one';
  END IF;
  NEW.created_at := clock_timestamp();
  IF EXISTS (
    SELECT 1 FROM product_promotions r
    WHERE r.variant_id = NEW.variant_id AND r.ended_early_at IS NULL AND r.ends_at > NEW.created_at
      AND r.promo_price_vnd >= NEW.list_price_vnd
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '23514',
      MESSAGE = 'The list price must stay above the price of a promotion that has not ended';
  END IF;
  RETURN NEW;
END;
$$;
