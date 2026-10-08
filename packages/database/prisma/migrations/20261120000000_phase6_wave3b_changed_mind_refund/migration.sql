-- Phase 6 Wave 3b follow-up (the Owner, 2026-10-09; OQ-32): when the customer changes their mind AFTER the supplier order, the Owner or a
-- manager decides case by case (the whole share, a part of it, or to decline). Until now the refund of a cancelled pre-order line was
-- always the whole net share, enforced by the refund guard below. Additive in effect: one function body is replaced, no table, column,
-- row or permission is touched, nothing already written can be affected (a refund already written stays the whole share, which is
-- still accepted).
--
--   lucy_guard_product_refund   the refund of a cancelled order line whose cause is CUSTOMER_CHANGED_MIND may be any whole amount from
--                               1 VND up to the net share of the line (the quantity is still all the units of the line, one refund per
--                               line, the running totals still match). Every other refund, and every refund of a return case, is still
--                               exactly the net share of the units refunded.
--
-- The commit-time check "a cancelled paid order line has its refund" (lucy_check_product_orders) is NOT changed: a cancelled paid line
-- still needs a refund, so nothing can be cancelled for a change of mind and refunded 0. Declining the request does not touch the
-- line at all (an audit record, no database change). The Beauty point reversal already works from the running refunded total of the
-- invoice, so a part refund takes back a proportional part of the points.

CREATE OR REPLACE FUNCTION lucy_guard_product_refund() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  inv RECORD;
  kase product_return_cases%ROWTYPE;
  oline product_order_lines%ROWTYPE;
  alloc RECORD;
  prior_units integer;
  prior_amount bigint;
  prior_case_units integer;
  prior_case_count integer;
  prior_invoice bigint;
  net bigint;
  total_units integer;
  before_share bigint;
  after_share bigint;
BEGIN
  IF TG_OP <> 'INSERT' THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'A product refund is history and is never changed or deleted';
  END IF;
  SELECT i.branch_id, i.status, i.channel, i.paid_seq INTO inv FROM invoices i WHERE i.id = NEW.invoice_id FOR SHARE;
  IF NOT FOUND OR inv.status <> 'PAID' THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'A refund needs a paid invoice';
  END IF;
  IF inv.channel <> 'COUNTER' THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Only counter sales have a refund for now';
  END IF;
  IF NEW.branch_id <> inv.branch_id THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'A refund belongs to the branch of its invoice';
  END IF;
  IF NEW.paid_seq <> inv.paid_seq THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'A refund belongs to the current paid episode of its invoice';
  END IF;
  IF NEW.order_line_id IS NULL THEN
    SELECT c.* INTO kase FROM product_return_cases c WHERE c.id = NEW.return_case_id FOR SHARE;
    IF NOT FOUND OR kase.status <> 'ACCEPTED' OR kase.decided_outcome IS DISTINCT FROM 'REFUND'
       OR kase.invoice_id <> NEW.invoice_id OR kase.invoice_line_id <> NEW.invoice_line_id OR kase.branch_id <> NEW.branch_id THEN
      RAISE EXCEPTION USING ERRCODE = '23514',
        MESSAGE = 'A refund follows an accepted return case that was decided as a refund, for its own line';
    END IF;
  ELSE
    -- Phase 6 P6-17 (OQ-32): the refund of a cancelled pre-order line, in full. The goods never left the shop, so nothing is returned.
    SELECT o.* INTO oline FROM product_order_lines o WHERE o.id = NEW.order_line_id FOR SHARE;
    IF NOT FOUND OR oline.status <> 'CANCELLED' OR oline.cancel_cause = 'INVOICE_CANCELLED'
       OR oline.invoice_id <> NEW.invoice_id OR oline.invoice_line_id <> NEW.invoice_line_id OR oline.branch_id <> NEW.branch_id THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'A refund of an order line follows its cancellation by a person, for its own line';
    END IF;
    IF NEW.quantity <> oline.quantity THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'A cancelled order line is refunded for all its units';
    END IF;
  END IF;
  SELECT l.quantity, a.net_vnd, a.side INTO alloc
    FROM invoice_lines l JOIN invoice_line_allocations a ON a.invoice_line_id = l.id
    WHERE l.id = NEW.invoice_line_id AND l.invoice_id = NEW.invoice_id AND l.kind = 'PRODUCT'
    FOR NO KEY UPDATE OF l;
  IF NOT FOUND OR alloc.side <> 'BEAUTY' OR alloc.quantity IS NULL OR alloc.quantity < 1 THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Only a product line with a recorded net amount can be refunded';
  END IF;
  total_units := alloc.quantity;
  net := alloc.net_vnd;
  SELECT c.claimed_units, c.claimed_vnd INTO prior_units, prior_amount FROM lucy_line_claims(NEW.invoice_line_id) c;
  IF lucy_open_exchange_on_line(NEW.invoice_line_id) THEN
    RAISE EXCEPTION USING ERRCODE = '23514',
      MESSAGE = 'A line with an open exchange takes no other claim until that exchange is completed or cancelled';
  END IF;
  IF prior_units + NEW.quantity > total_units THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'A line cannot be refunded more units than were sold';
  END IF;
  IF NEW.order_line_id IS NULL THEN
    SELECT COALESCE(sum(r.quantity), 0), count(*) INTO prior_case_units, prior_case_count
      FROM product_refunds r WHERE r.return_case_id = NEW.return_case_id;
    IF prior_case_units + NEW.quantity > kase.quantity THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'A case cannot be refunded more units than it accepted';
    END IF;
    IF NEW.case_ordinal <> prior_case_count + 1 THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'The refunds of a case are numbered in order';
    END IF;
  ELSIF prior_units <> 0 THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'A cancelled order line is refunded in full and has no other claim';
  END IF;
  before_share := (2 * net * prior_units + total_units) / (2 * total_units);
  after_share := (2 * net * (prior_units + NEW.quantity) + total_units) / (2 * total_units);
  -- The Owner (2026-10-09, OQ-32): when the customer changed their mind after the supplier order the Owner or a manager decides case by
  -- case, so that refund may be a part of the share (1 VND up to the whole share). Every other refund is exactly the net share.
  IF NEW.order_line_id IS NOT NULL AND oline.cancel_cause = 'CUSTOMER_CHANGED_MIND' THEN
    IF NEW.amount_vnd < 1 OR NEW.amount_vnd > after_share - before_share THEN
      RAISE EXCEPTION USING ERRCODE = '23514',
        MESSAGE = 'The refund of a change of mind is from 1 VND up to the net share of the line';
    END IF;
  ELSIF NEW.amount_vnd <> after_share - before_share THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'A refund is the net share of the units refunded, not another amount';
  END IF;
  IF NEW.line_units_after <> prior_units + NEW.quantity OR NEW.line_amount_after_vnd <> prior_amount + NEW.amount_vnd THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'The running totals of a refund match the refunds before it';
  END IF;
  SELECT COALESCE(sum(r.amount_vnd), 0) INTO prior_invoice FROM product_refunds r WHERE r.invoice_id = NEW.invoice_id;
  IF NEW.invoice_refunded_after_vnd <> prior_invoice + NEW.amount_vnd THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'The running total of an invoice matches the refunds before it';
  END IF;
  NEW.occurred_at := clock_timestamp();
  RETURN NEW;
END;
$$;

-- The Phase 1 convention (fixed search_path, no PUBLIC execute) for the function this migration replaces.
DO $$
DECLARE
  migration_schema text := current_schema();
BEGIN
  EXECUTE format('ALTER FUNCTION %I.lucy_guard_product_refund() SET search_path TO pg_catalog, %I, pg_temp', migration_schema, migration_schema);
  EXECUTE format('REVOKE ALL ON FUNCTION %I.lucy_guard_product_refund() FROM PUBLIC', migration_schema);
END;
$$;
