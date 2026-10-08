-- Phase 6 P6-14 (P14-15, PRD 28.4): the replacement of an exchange is not a new sale to return. A return case can never be opened on a line of
-- the invoice of an exchange: the product-fault exception grants no new eligibility window, and the credit of the original line was already
-- claimed by the exchange. The API refuses first (RETURN_NOT_ELIGIBLE); this is the backstop. Additive: one guard function, one trigger;
-- nothing is rewritten and the earlier guards of the table are untouched.

CREATE FUNCTION lucy_refuse_return_of_exchange_invoice() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM product_exchanges x WHERE x.exchange_invoice_id = NEW.invoice_id) THEN
    RAISE EXCEPTION USING ERRCODE = '23514',
      MESSAGE = 'The replacement of an exchange cannot be returned: it is not a new sale and starts no new return window';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER lucy_product_return_cases_exchange_invoice BEFORE INSERT ON "product_return_cases"
  FOR EACH ROW EXECUTE FUNCTION lucy_refuse_return_of_exchange_invoice();

DO $$
DECLARE
  migration_schema text := current_schema();
BEGIN
  EXECUTE format('ALTER FUNCTION %I.lucy_refuse_return_of_exchange_invoice() SET search_path TO pg_catalog, %I, pg_temp',
    migration_schema, migration_schema);
  EXECUTE format('REVOKE ALL ON FUNCTION %I.lucy_refuse_return_of_exchange_invoice() FROM PUBLIC', migration_schema);
END;
$$;
