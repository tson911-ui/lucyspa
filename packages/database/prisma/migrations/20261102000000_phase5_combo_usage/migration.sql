-- Phase 5 P5-8: combo usage (design 9.4-9.5). Additive; no existing row is touched.
--
-- The staff's choice "this service line is paid with a session of that combo" is kept as an editable SELECTION while the
-- invoice is a DRAFT (`invoice_line_combo_usages`); the append-only consumption (`combo_session_consumptions`, P5-2) is written
-- only when the invoice is finalized, so a staff mistake on a draft is simply cleared and never needs a manager restoration.
--
-- Rules added here (the Owner's answers of 2026-10-05 collected through the question tool are PROVISIONAL, design 2.5):
--   * a selected line is a 0 VND line, quantity 1, and is the ONLY kind of line exempt from the snapshotted price range
--     (the marker row is immutable once the invoice is finalized, so a later restoration never makes the range check fail);
--   * a combo is usable only while its sale invoice is PAID in the paid episode that issued it (or in an episode in which the
--     combo was reopened): reversing the sale freezes the unused sessions at once, with no wait for the worker;
--   * a finalized invoice has a consumption for every selected line; the consumption copies the selection;
--   * re-paying a sale whose reversal froze a combo that had sessions in use REOPENS that combo (one row per episode), it does
--     not issue a second one.

-- ------------------------------------------------------------------------------------------------- tables
CREATE TABLE "invoice_line_combo_usages" (
    "invoice_line_id" UUID NOT NULL,
    "invoice_id" UUID NOT NULL,
    "purchase_id" UUID NOT NULL,
    "used_by" "ComboUsageKind" NOT NULL,
    "relationship_note" TEXT,
    "selected_by_user_id" UUID NOT NULL,
    "selected_at" TIMESTAMPTZ(3) NOT NULL DEFAULT clock_timestamp(),

    CONSTRAINT "invoice_line_combo_usages_pkey" PRIMARY KEY ("invoice_line_id"),
    CONSTRAINT "invoice_line_combo_usages_note" CHECK (
      "relationship_note" IS NULL OR ("used_by" = 'RELATIVE' AND btrim("relationship_note") <> '')
    )
);

CREATE INDEX "invoice_line_combo_usages_invoice_idx" ON "invoice_line_combo_usages"("invoice_id");
CREATE INDEX "invoice_line_combo_usages_purchase_idx" ON "invoice_line_combo_usages"("purchase_id");

ALTER TABLE "invoice_line_combo_usages" ADD CONSTRAINT "invoice_line_combo_usages_line_fkey"
  FOREIGN KEY ("invoice_id", "invoice_line_id") REFERENCES "invoice_lines"("invoice_id", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "invoice_line_combo_usages" ADD CONSTRAINT "invoice_line_combo_usages_purchase_id_fkey"
  FOREIGN KEY ("purchase_id") REFERENCES "combo_purchases"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "invoice_line_combo_usages" ADD CONSTRAINT "invoice_line_combo_usages_selected_by_user_id_fkey"
  FOREIGN KEY ("selected_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- A combo whose paid episode ended while sessions were in use, and that came back with the re-payment of its sale invoice.
CREATE TABLE "combo_purchase_reopenings" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "purchase_id" UUID NOT NULL,
    "paid_seq" INTEGER NOT NULL,
    "reopened_at" TIMESTAMPTZ(3) NOT NULL DEFAULT clock_timestamp(),

    CONSTRAINT "combo_purchase_reopenings_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "combo_purchase_reopenings_seq" CHECK ("paid_seq" >= 2)
);

CREATE UNIQUE INDEX "combo_purchase_reopenings_episode_key" ON "combo_purchase_reopenings"("purchase_id", "paid_seq");

ALTER TABLE "combo_purchase_reopenings" ADD CONSTRAINT "combo_purchase_reopenings_purchase_id_fkey"
  FOREIGN KEY ("purchase_id") REFERENCES "combo_purchases"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- ------------------------------------------------------------------------------------------------- helper
-- Is the combo usable now? Its sale invoice is PAID, in the episode that issued it or an episode that reopened it, and the
-- purchase is not revoked. Takes the sale invoice SHARE lock (design 12.2: the invoice rows come before the combo rows), so a
-- concurrent reversal of the sale and a use are serialized.
CREATE FUNCTION lucy_combo_purchase_usable(purchase_ref uuid) RETURNS boolean
LANGUAGE plpgsql AS $$
DECLARE
  sale invoices%ROWTYPE;
  target combo_purchases%ROWTYPE;
BEGIN
  SELECT p.* INTO target FROM combo_purchases p WHERE p.id = purchase_ref;
  IF NOT FOUND OR target.voided_at IS NOT NULL THEN
    RETURN false;
  END IF;
  SELECT i.* INTO sale FROM invoices i JOIN invoice_lines l ON l.invoice_id = i.id
    WHERE l.id = target.invoice_line_id FOR SHARE OF i;
  RETURN sale.status = 'PAID' AND (
    sale.paid_seq = target.paid_seq
    OR EXISTS (SELECT 1 FROM combo_purchase_reopenings r WHERE r.purchase_id = target.id AND r.paid_seq = sale.paid_seq));
END;
$$;

-- ------------------------------------------------------------------------------------------------- guards
-- The selection: on a line of a DRAFT visit invoice, for a usable combo of the line's own service (PRD 17.3). Any branch may
-- use a combo (Owner answer, provisional). It can be removed only while the invoice is a draft and never edited.
CREATE FUNCTION lucy_guard_invoice_line_combo_usage() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  target invoices%ROWTYPE;
  performed_service uuid;
  purchase combo_purchases%ROWTYPE;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'A combo use is selected or cleared, never edited';
  END IF;
  SELECT * INTO target FROM invoices
    WHERE id = (CASE WHEN TG_OP = 'DELETE' THEN OLD.invoice_id ELSE NEW.invoice_id END) FOR SHARE;
  IF target.status IS DISTINCT FROM 'DRAFT' OR target.kind IS DISTINCT FROM 'VISIT' THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'A combo use is chosen only on the draft of a visit invoice';
  END IF;
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  SELECT d.service_id INTO performed_service FROM invoice_line_services d WHERE d.invoice_line_id = NEW.invoice_line_id;
  SELECT p.* INTO purchase FROM combo_purchases p WHERE p.id = NEW.purchase_id;
  IF performed_service IS NULL OR performed_service IS DISTINCT FROM purchase.service_id THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'A combo session is used only for the service of its combo';
  END IF;
  IF NOT lucy_combo_purchase_usable(NEW.purchase_id)
    OR (purchase.expires_at IS NOT NULL AND purchase.expires_at <= clock_timestamp()) THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'This combo cannot be used now';
  END IF;
  NEW.selected_at := clock_timestamp();
  RETURN NEW;
END;
$$;

CREATE TRIGGER "invoice_line_combo_usages_a_live" BEFORE INSERT ON "invoice_line_combo_usages"
FOR EACH ROW EXECUTE FUNCTION lucy_require_loyalty_go_live();
CREATE TRIGGER "invoice_line_combo_usages_guard" BEFORE INSERT OR UPDATE OR DELETE ON "invoice_line_combo_usages"
FOR EACH ROW EXECUTE FUNCTION lucy_guard_invoice_line_combo_usage();
CREATE TRIGGER "invoice_line_combo_usages_no_truncate" BEFORE TRUNCATE ON "invoice_line_combo_usages"
FOR EACH STATEMENT EXECUTE FUNCTION lucy_reject_permanent_history_mutation();

-- Reopening: the sale invoice is PAID in exactly this later episode, the purchase is not revoked, and no second combo was
-- issued for the same episode.
CREATE FUNCTION lucy_guard_combo_reopening() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  sale invoices%ROWTYPE;
  target combo_purchases%ROWTYPE;
BEGIN
  SELECT p.* INTO target FROM combo_purchases p WHERE p.id = NEW.purchase_id;
  SELECT i.* INTO sale FROM invoices i JOIN invoice_lines l ON l.invoice_id = i.id
    WHERE l.id = target.invoice_line_id FOR SHARE OF i;
  IF sale.status IS DISTINCT FROM 'PAID' OR sale.paid_seq IS DISTINCT FROM NEW.paid_seq OR NEW.paid_seq <= target.paid_seq THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'A combo is reopened in the current paid episode of its paid sale invoice';
  END IF;
  IF target.voided_at IS NOT NULL THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'A revoked combo is not reopened';
  END IF;
  IF EXISTS (SELECT 1 FROM combo_purchases q WHERE q.invoice_line_id = target.invoice_line_id AND q.paid_seq = NEW.paid_seq) THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'A combo is reopened or issued once per paid episode, not both';
  END IF;
  NEW.reopened_at := clock_timestamp();
  RETURN NEW;
END;
$$;

-- The other half: a purchase is not issued for an episode in which the line's combo was already reopened.
CREATE FUNCTION lucy_guard_combo_purchase_not_reopened() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM combo_purchase_reopenings r JOIN combo_purchases p ON p.id = r.purchase_id
      WHERE p.invoice_line_id = NEW.invoice_line_id AND r.paid_seq = NEW.paid_seq) THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'A combo is reopened or issued once per paid episode, not both';
  END IF;
  RETURN NEW;
END;
$$;

-- A combo that is usable now is never revoked (a late reversal event must not take away a combo reopened by a re-payment).
CREATE FUNCTION lucy_guard_combo_void_not_usable() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF lucy_combo_purchase_usable(OLD.id) THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'A combo that can be used now is not revoked';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "combo_purchases_void_not_usable" BEFORE UPDATE ON "combo_purchases"
FOR EACH ROW WHEN (OLD."voided_at" IS NULL AND NEW."voided_at" IS NOT NULL)
EXECUTE FUNCTION lucy_guard_combo_void_not_usable();

CREATE TRIGGER "combo_purchase_reopenings_a_live" BEFORE INSERT ON "combo_purchase_reopenings"
FOR EACH ROW EXECUTE FUNCTION lucy_require_loyalty_go_live();
CREATE TRIGGER "combo_purchase_reopenings_guard" BEFORE INSERT ON "combo_purchase_reopenings"
FOR EACH ROW EXECUTE FUNCTION lucy_guard_combo_reopening();
CREATE TRIGGER "combo_purchase_reopenings_append_only" BEFORE UPDATE OR DELETE ON "combo_purchase_reopenings"
FOR EACH ROW EXECUTE FUNCTION lucy_reject_permanent_history_mutation();
CREATE TRIGGER "combo_purchase_reopenings_no_truncate" BEFORE TRUNCATE ON "combo_purchase_reopenings"
FOR EACH STATEMENT EXECUTE FUNCTION lucy_reject_permanent_history_mutation();
CREATE TRIGGER "combo_purchases_not_reopened" BEFORE INSERT ON "combo_purchases"
FOR EACH ROW EXECUTE FUNCTION lucy_guard_combo_purchase_not_reopened();

-- Consumption (P5-2 function, tightened): the invoice is the DRAFT being finalized and the line carries the staff's selection of
-- exactly this combo, with the same owner/relative marker; the combo is usable NOW (sale invoice PAID in a usable episode); the
-- recipient and technician are those of the line. Lock order (design 12.2): the use invoice, then the sale invoice, then the
-- session row.
CREATE OR REPLACE FUNCTION lucy_guard_combo_consumption() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  target invoices%ROWTYPE;
  purchase combo_purchases%ROWTYPE;
  chosen invoice_line_combo_usages%ROWTYPE;
  detail invoice_line_services%ROWTYPE;
  staff_kind "UserKind";
BEGIN
  SELECT i.* INTO target FROM invoices i JOIN invoice_lines l ON l.invoice_id = i.id
    WHERE l.id = NEW.invoice_line_id FOR SHARE OF i;
  SELECT p.* INTO purchase FROM combo_purchases p JOIN combo_sessions s ON s.purchase_id = p.id WHERE s.id = NEW.session_id;
  IF NOT lucy_combo_purchase_usable(purchase.id) THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'A voided, frozen or expired combo cannot be consumed';
  END IF;
  PERFORM 1 FROM combo_sessions s WHERE s.id = NEW.session_id FOR UPDATE;
  IF purchase.expires_at IS NOT NULL AND purchase.expires_at <= clock_timestamp() THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'A voided or expired combo cannot be consumed';
  END IF;
  IF target.status IS DISTINCT FROM 'DRAFT' OR target.kind IS DISTINCT FROM 'VISIT' THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'A session is consumed on the visit invoice being finalized, never another one';
  END IF;
  IF target.branch_id IS DISTINCT FROM NEW.branch_id THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'A consumption records the branch of its invoice';
  END IF;
  SELECT u.* INTO chosen FROM invoice_line_combo_usages u WHERE u.invoice_line_id = NEW.invoice_line_id;
  IF NOT FOUND OR chosen.purchase_id IS DISTINCT FROM purchase.id
    OR (chosen.used_by, chosen.relationship_note) IS DISTINCT FROM (NEW.used_by, NEW.relationship_note) THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'A consumption follows the combo use chosen on its line';
  END IF;
  SELECT d.* INTO detail FROM invoice_line_services d WHERE d.invoice_line_id = NEW.invoice_line_id;
  IF detail.service_id IS DISTINCT FROM purchase.service_id THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'A combo session is consumed only for the service of its combo';
  END IF;
  IF NEW.recipient_participant_id IS DISTINCT FROM detail.participant_id OR NEW.ktv_user_id IS DISTINCT FROM detail.employee_user_id THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'The recipient and technician of a consumption are those of its line';
  END IF;
  IF NEW.recipient_participant_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM visit_participants vp WHERE vp.id = NEW.recipient_participant_id AND vp.visit_id = target.visit_id) THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'The service recipient belongs to the visit of the invoice';
  END IF;
  IF NEW.ktv_user_id IS NOT NULL THEN
    SELECT u.kind INTO staff_kind FROM users u WHERE u.id = NEW.ktv_user_id;
    IF staff_kind IS DISTINCT FROM 'EMPLOYEE' THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'The KTV of a consumption is an employee';
    END IF;
  END IF;
  IF EXISTS (
    SELECT 1 FROM combo_session_consumptions c
      WHERE c.session_id = NEW.session_id
        AND NOT EXISTS (SELECT 1 FROM combo_session_releases r WHERE r.consumption_id = c.id)
        AND NOT EXISTS (SELECT 1 FROM combo_session_restorations o WHERE o.consumption_id = c.id)) THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'The combo session is already consumed';
  END IF;
  NEW.consumed_at := clock_timestamp();
  RETURN NEW;
END;
$$;

-- Commit-time integrity of one invoice: the P5-7 function with the combo use added. A selected line is a 0 VND line of
-- quantity 1 and is the only line exempt from the snapshotted price range (every other line keeps the original rule); a
-- finalized invoice has a consumption for every selected line.
CREATE OR REPLACE FUNCTION lucy_check_invoice_integrity() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  invoice_id_value uuid;
  target invoices%ROWTYPE;
  line_count integer;
  detail_count integer;
  done_count integer;
  unpriced integer;
  line_total bigint;
  effective bigint;
BEGIN
  IF TG_TABLE_NAME = 'invoices' THEN
    invoice_id_value := NEW.id;
  ELSIF TG_TABLE_NAME = 'payment_corrections' THEN
    SELECT invoice_id INTO invoice_id_value FROM payments WHERE id = NEW.payment_id;
  ELSE
    invoice_id_value := NEW.invoice_id;
  END IF;
  SELECT * INTO target FROM invoices WHERE id = invoice_id_value;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;
  SELECT count(*) INTO line_count FROM invoice_lines WHERE invoice_id = target.id;
  IF target.kind = 'VISIT' THEN
    SELECT count(*) INTO detail_count FROM invoice_line_services WHERE invoice_id = target.id;
    SELECT count(*) INTO done_count FROM visit_service_lines WHERE visit_id = target.visit_id AND status = 'DONE';
    IF line_count = 0 OR line_count <> detail_count OR line_count <> done_count THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'An invoice carries every performed service of its visit exactly once';
    END IF;
    IF EXISTS (
      SELECT 1 FROM invoice_lines l JOIN invoice_line_services s ON s.invoice_line_id = l.id
      WHERE l.invoice_id = target.id
        AND NOT EXISTS (SELECT 1 FROM invoice_line_combo_usages u WHERE u.invoice_line_id = l.id)
        AND ((l.unit_price_vnd IS NOT NULL
            AND (l.unit_price_vnd < s.catalog_price_min_vnd OR l.unit_price_vnd > s.catalog_price_max_vnd))
          OR (l.quantity IS NOT NULL AND l.quantity > s.quantity_limit))) THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'A line price must lie in the snapshotted range and its quantity within the snapshotted limit';
    END IF;
    IF EXISTS (
      SELECT 1 FROM invoice_lines l JOIN invoice_line_combo_usages u ON u.invoice_line_id = l.id
      WHERE l.invoice_id = target.id
        AND ((l.unit_price_vnd IS NOT NULL AND l.unit_price_vnd <> 0)
          OR (l.quantity IS NOT NULL AND l.quantity <> 1)
          OR (l.gross_vnd IS NOT NULL AND l.gross_vnd <> 0))) THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'A line paid with a combo session is a 0 VND line of quantity 1';
    END IF;
    IF target.finalized_at IS NOT NULL AND EXISTS (
      SELECT 1 FROM invoice_line_combo_usages u
        WHERE u.invoice_id = target.id
          AND NOT EXISTS (SELECT 1 FROM combo_session_consumptions c WHERE c.invoice_line_id = u.invoice_line_id)) THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'A finalized invoice consumes a combo session for every line paid with one';
    END IF;
  ELSE
    SELECT count(*) INTO detail_count FROM invoice_line_combos WHERE invoice_id = target.id;
    IF line_count <> 1 OR detail_count <> 1 THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'A combo sale carries exactly one combo purchase line';
    END IF;
    IF EXISTS (
      SELECT 1 FROM invoice_lines l JOIN invoice_line_combos d ON d.invoice_line_id = l.id
      WHERE l.invoice_id = target.id
        AND (l.kind <> 'COMBO_PURCHASE' OR l.quantity IS DISTINCT FROM 1
          OR l.unit_price_vnd IS DISTINCT FROM d.price_vnd OR l.gross_vnd IS DISTINCT FROM d.price_vnd)) THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'A combo purchase line is priced exactly at its combo price, quantity 1';
    END IF;
  END IF;
  IF target.finalized_at IS NOT NULL THEN
    SELECT count(*) FILTER (WHERE quantity IS NULL OR unit_price_vnd IS NULL), COALESCE(sum(gross_vnd), 0)
      INTO unpriced, line_total FROM invoice_lines WHERE invoice_id = target.id;
    IF unpriced > 0 OR target.subtotal_vnd <> line_total THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'A finalized invoice has every line priced and its subtotal is the sum of its lines';
    END IF;
  END IF;
  effective := lucy_invoice_effective_paid(target.id);
  IF effective > target.total_vnd
    OR (target.status = 'DRAFT' AND EXISTS (SELECT 1 FROM payments WHERE invoice_id = target.id))
    OR (target.status = 'PAID' AND effective <> target.total_vnd)
    OR (target.status = 'PENDING_PAYMENT' AND effective >= target.total_vnd)
    OR (target.status = 'CANCELLED' AND effective <> 0) THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Payments must reconcile with the invoice status and receivable';
  END IF;
  RETURN NULL;
END;
$$;

CREATE CONSTRAINT TRIGGER "invoice_line_combo_usages_integrity" AFTER INSERT ON "invoice_line_combo_usages"
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION lucy_check_invoice_integrity();

-- Restoration (PRD 17.5) needs no change: the P5-2 guard, the unique key per consumption and the append-only trigger already
-- make it a single offset entry that keeps the consumption as history. Restoring does not change the invoice: the 0 VND line
-- stays as it was.

-- CREATE OR REPLACE drops function-level settings and CREATE FUNCTION starts without them: apply the Phase 1 convention
-- (fixed search_path, no PUBLIC execute) to every function this migration touches.
DO $$
DECLARE
  migration_schema text := current_schema();
  function_name text;
BEGIN
  FOREACH function_name IN ARRAY ARRAY[
    'lucy_guard_invoice_line_combo_usage', 'lucy_guard_combo_reopening',
    'lucy_guard_combo_purchase_not_reopened', 'lucy_guard_combo_void_not_usable', 'lucy_guard_combo_consumption',
    'lucy_check_invoice_integrity'
  ] LOOP
    EXECUTE format('ALTER FUNCTION %I.%I() SET search_path TO pg_catalog, %I, pg_temp',
      migration_schema, function_name, migration_schema);
    EXECUTE format('REVOKE ALL ON FUNCTION %I.%I() FROM PUBLIC', migration_schema, function_name);
  END LOOP;
END;
$$;

DO $$
DECLARE
  migration_schema text := current_schema();
BEGIN
  EXECUTE format('ALTER FUNCTION %I.lucy_combo_purchase_usable(uuid) SET search_path TO pg_catalog, %I, pg_temp',
    migration_schema, migration_schema);
  EXECUTE format('REVOKE ALL ON FUNCTION %I.lucy_combo_purchase_usable(uuid) FROM PUBLIC', migration_schema);
END;
$$;
