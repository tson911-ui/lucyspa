-- Phase 5 P5-7, migration 2 of 2: the combo sale (design 9.2-9.3, OQ-1 approved by the Owner 2026-10-04).
--
-- A combo is sold at the counter on its OWN invoice, not tied to a Visit (invoice kind COMBO_SALE, visit_id NULL, exactly one
-- COMBO_PURCHASE line). Everything the Phase 4 guards enforce for a normal invoice (kind VISIT) is unchanged: the visit
-- rules, one active invoice per visit, the snapshot of the performed services, the price range, payments, finalization,
-- cancellation, the redemption rules. Additive; no existing row is touched (every existing invoice is a VISIT).
--
-- Rules added here:
--   * a combo sale is created only while loyalty is live (P5-T2, Owner answer of 2026-10-05) and always names a member payer
--     (P5-Q8: members only), who becomes the owner of the combo when the invoice is PAID;
--   * the combo line is a snapshot of the CURRENT active combo version (name, service, category, sessions, price, expiry) and
--     is priced exactly at the combo price, quantity 1, never edited; one combo per invoice;
--   * a combo purchase (the issued combo) snapshots that line, not the live definition, so a later edit or deactivation never
--     takes away what a customer already paid for;
--   * an issued combo is revoked only after the paid episode that issued it has ended (reopened or cancelled) and only while
--     none of its sessions is in use; the purchase stays as history (voided_at, never deleted);
--   * the birthday gift never applies to a combo sale (Owner answer of 2026-10-05).

CREATE TYPE "InvoiceKind" AS ENUM ('VISIT', 'COMBO_SALE');

ALTER TABLE "invoices" ADD COLUMN "kind" "InvoiceKind" NOT NULL DEFAULT 'VISIT';
ALTER TABLE "invoices" ALTER COLUMN "visit_id" DROP NOT NULL;
ALTER TABLE "invoices"
  ADD CONSTRAINT "invoices_kind_visit" CHECK (("kind" = 'VISIT') = ("visit_id" IS NOT NULL)),
  ADD CONSTRAINT "invoices_combo_sale_member" CHECK ("kind" <> 'COMBO_SALE' OR "payer_user_id" IS NOT NULL);

-- ------------------------------------------------------------------------------------ the combo line detail
CREATE TABLE "invoice_line_combos" (
    "invoice_line_id" UUID NOT NULL,
    "invoice_id" UUID NOT NULL,
    "combo_id" UUID NOT NULL,
    "version_id" UUID NOT NULL,
    "service_id" UUID NOT NULL,
    "service_category_id" UUID NOT NULL,
    "name_vi" TEXT NOT NULL,
    "name_en" TEXT NOT NULL,
    "paid_sessions" INTEGER NOT NULL,
    "bonus_sessions" INTEGER NOT NULL,
    "price_vnd" BIGINT NOT NULL,
    "expiry_mode" "EntitlementExpiryMode" NOT NULL,
    "expiry_days" INTEGER,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT clock_timestamp(),

    CONSTRAINT "invoice_line_combos_pkey" PRIMARY KEY ("invoice_line_id"),
    CONSTRAINT "invoice_line_combos_values" CHECK (
      "paid_sessions" >= 1 AND "bonus_sessions" >= 0 AND "price_vnd" > 0
      AND btrim("name_vi") <> '' AND btrim("name_en") <> ''
    ),
    CONSTRAINT "invoice_line_combos_expiry" CHECK (
      ("expiry_mode" = 'NONE' AND "expiry_days" IS NULL)
      OR ("expiry_mode" = 'DAYS_AFTER_ISSUE' AND "expiry_days" IS NOT NULL AND "expiry_days" >= 1)
    )
);

-- One combo per sale invoice; a second combo is a second invoice.
CREATE UNIQUE INDEX "invoice_line_combos_invoice_key" ON "invoice_line_combos"("invoice_id");
CREATE INDEX "invoice_line_combos_combo_idx" ON "invoice_line_combos"("combo_id");

ALTER TABLE "invoice_line_combos" ADD CONSTRAINT "invoice_line_combos_line_fkey"
  FOREIGN KEY ("invoice_id", "invoice_line_id") REFERENCES "invoice_lines"("invoice_id", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "invoice_line_combos" ADD CONSTRAINT "invoice_line_combos_version_fkey"
  FOREIGN KEY ("combo_id", "version_id") REFERENCES "combo_versions"("combo_id", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "invoice_line_combos" ADD CONSTRAINT "invoice_line_combos_service_id_fkey"
  FOREIGN KEY ("service_id") REFERENCES "services"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "invoice_line_combos" ADD CONSTRAINT "invoice_line_combos_service_category_id_fkey"
  FOREIGN KEY ("service_category_id") REFERENCES "service_categories"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- ------------------------------------------------------------------------------------------------ guards
-- The combo detail is recorded once, on the combo line of a DRAFT combo sale, as an exact copy of the CURRENT active version
-- of the combo (taken under the combo row share lock, so a concurrent new version is serialized) and of the service category
-- at this instant (the discount scope reads this snapshot, never the live catalog, like a service line).
CREATE FUNCTION lucy_guard_invoice_line_combo() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  target invoices%ROWTYPE;
  line invoice_lines%ROWTYPE;
  defined combos%ROWTYPE;
  chosen combo_versions%ROWTYPE;
  latest integer;
  category uuid;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Combo details are recorded once';
  END IF;
  SELECT * INTO target FROM invoices WHERE id = NEW.invoice_id FOR SHARE;
  IF target.status IS DISTINCT FROM 'DRAFT' OR target.kind IS DISTINCT FROM 'COMBO_SALE' THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'A combo detail belongs to the draft of a combo sale';
  END IF;
  SELECT * INTO line FROM invoice_lines WHERE id = NEW.invoice_line_id;
  IF line.kind IS DISTINCT FROM 'COMBO_PURCHASE' THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'A combo detail belongs to a COMBO_PURCHASE line';
  END IF;
  PERFORM 1 FROM combos WHERE id = NEW.combo_id FOR SHARE;
  SELECT * INTO defined FROM combos WHERE id = NEW.combo_id;
  SELECT * INTO chosen FROM combo_versions WHERE id = NEW.version_id AND combo_id = NEW.combo_id;
  SELECT max(v.version) INTO latest FROM combo_versions v WHERE v.combo_id = NEW.combo_id;
  IF defined.id IS NULL OR chosen.id IS NULL OR chosen.version IS DISTINCT FROM latest OR NOT chosen.active THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'A combo is sold from its current active version';
  END IF;
  SELECT s.category_id INTO category FROM services s WHERE s.id = defined.service_id;
  IF (NEW.service_id, NEW.service_category_id, NEW.name_vi, NEW.name_en, NEW.paid_sessions, NEW.bonus_sessions,
      NEW.price_vnd, NEW.expiry_mode, NEW.expiry_days)
    IS DISTINCT FROM (defined.service_id, category, chosen.name_vi, chosen.name_en, chosen.paid_sessions,
      chosen.bonus_sessions, chosen.price_vnd, chosen.expiry_mode, chosen.expiry_days)
    OR (line.item_code, line.name_vi, line.name_en) IS DISTINCT FROM (defined.code, chosen.name_vi, chosen.name_en) THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'The combo line must copy the current combo definition';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "invoice_line_combos_guard" BEFORE INSERT OR UPDATE ON "invoice_line_combos"
FOR EACH ROW EXECUTE FUNCTION lucy_guard_invoice_line_combo();
CREATE TRIGGER "invoice_line_combos_no_delete" BEFORE DELETE ON "invoice_line_combos"
FOR EACH ROW EXECUTE FUNCTION lucy_reject_financial_delete();
CREATE TRIGGER "invoice_line_combos_no_truncate" BEFORE TRUNCATE ON "invoice_line_combos"
FOR EACH STATEMENT EXECUTE FUNCTION lucy_reject_permanent_history_mutation();

-- Invoice lifecycle guard: the Phase 4 function, with the creation rules split by kind. A VISIT invoice keeps every original rule.
CREATE OR REPLACE FUNCTION lucy_guard_invoice() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  visit_status "VisitStatus";
  visit_branch uuid;
  payer_kind "UserKind";
  line_count integer;
  unpriced integer;
  line_total bigint;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'DRAFT' OR NEW.row_version <> 1 OR NEW.paid_seq <> 0 THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'An invoice starts as a DRAFT at version 1';
    END IF;
    IF NEW.kind = 'VISIT' THEN
      -- FOR SHARE serializes with any change of the visit (a completed visit is immutable).
      SELECT status, branch_id INTO visit_status, visit_branch FROM visits WHERE id = NEW.visit_id FOR SHARE;
      IF visit_status IS DISTINCT FROM 'COMPLETED' THEN
        RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'An invoice is created only for a completed visit';
      END IF;
      IF visit_branch IS DISTINCT FROM NEW.branch_id THEN
        RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'An invoice belongs to the branch of its visit';
      END IF;
    ELSIF NOT EXISTS (SELECT 1 FROM loyalty_go_live) THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'A combo is sold only once loyalty is live';
    END IF;
    IF NEW.business_date IS DISTINCT FROM lucy_branch_local_date(NEW.branch_id, NEW.created_at) THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Invoice business date must be the branch-local date of its creation';
    END IF;
  ELSE
    IF (NEW.id, NEW.code, NEW.kind, NEW.branch_id, NEW.visit_id, NEW.business_date, NEW.created_by_user_id, NEW.created_at)
      IS DISTINCT FROM (OLD.id, OLD.code, OLD.kind, OLD.branch_id, OLD.visit_id, OLD.business_date,
        OLD.created_by_user_id, OLD.created_at) THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Invoice identity cannot be rewritten';
    END IF;
    IF OLD.status = 'CANCELLED' AND NEW IS DISTINCT FROM OLD THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'A cancelled invoice is final';
    END IF;
    IF NEW IS DISTINCT FROM OLD AND NEW.row_version <> OLD.row_version + 1 THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Invoice changes bump the version by one';
    END IF;
    IF NEW.status <> OLD.status AND NOT (
      (OLD.status = 'DRAFT' AND NEW.status IN ('PENDING_PAYMENT', 'PAID', 'CANCELLED'))
      OR (OLD.status = 'PENDING_PAYMENT' AND NEW.status IN ('PAID', 'CANCELLED'))
      OR (OLD.status = 'PAID' AND NEW.status IN ('PENDING_PAYMENT', 'CANCELLED'))) THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Illegal invoice status transition';
    END IF;
    -- Once finalized, the payer, the calculation result and the finalization facts are frozen.
    IF OLD.status <> 'DRAFT'
      AND (NEW.payer_user_id, NEW.calculation_version, NEW.subtotal_vnd, NEW.discount_total_vnd,
           NEW.total_vnd, NEW.finalized_at, NEW.finalized_by_user_id)
        IS DISTINCT FROM (OLD.payer_user_id, OLD.calculation_version, OLD.subtotal_vnd,
           OLD.discount_total_vnd, OLD.total_vnd, OLD.finalized_at, OLD.finalized_by_user_id) THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'A finalized invoice keeps its payer, amounts and finalization facts';
    END IF;
    -- paid_seq counts paid episodes: +1 exactly when the invoice becomes PAID, otherwise unchanged.
    IF NEW.paid_seq IS DISTINCT FROM OLD.paid_seq
        + (CASE WHEN NEW.status = 'PAID' AND OLD.status <> 'PAID' THEN 1 ELSE 0 END) THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'The paid episode counter increments only when the invoice becomes paid';
    END IF;
    IF (OLD.status = 'PAID' AND NEW.status IN ('PAID', 'CANCELLED'))
      AND NEW.paid_at IS DISTINCT FROM OLD.paid_at THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'The paid time is a historical fact and is kept';
    END IF;
    IF NEW.status = 'CANCELLED' THEN
      IF NEW.cancelled_from_status IS DISTINCT FROM OLD.status THEN
        RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'A cancellation records the status it left';
      END IF;
      -- OP-7: a PAID invoice is cancellable only when it is a zero-balance transaction and no
      -- Payment row exists at all. Any payment (cash, provider, split; effective or reversed)
      -- follows the Q6 correction rules instead: reverse first, then cancel while PENDING_PAYMENT.
      IF OLD.status = 'PAID' AND (NEW.total_vnd <> 0
        OR EXISTS (SELECT 1 FROM payments WHERE invoice_id = OLD.id)) THEN
        RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'A paid invoice can be cancelled only as a zero-balance correction with no payment';
      END IF;
    END IF;
    -- Finalization: every line is priced with a quantity and the subtotal is the sum of the lines.
    IF OLD.status = 'DRAFT' AND NEW.status IN ('PENDING_PAYMENT', 'PAID') THEN
      SELECT count(*), count(*) FILTER (WHERE quantity IS NULL OR unit_price_vnd IS NULL),
        COALESCE(sum(gross_vnd), 0)
        INTO line_count, unpriced, line_total FROM invoice_lines WHERE invoice_id = OLD.id;
      IF line_count = 0 OR unpriced > 0 THEN
        RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Finalization needs every line priced with a quantity';
      END IF;
      IF NEW.subtotal_vnd <> line_total THEN
        RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'The finalized subtotal must be the sum of its lines';
      END IF;
      -- OP-2: only a receivable of exactly 0 is settled directly (paid_at = finalized_at); anything
      -- else waits for payments.
      IF NEW.status = 'PAID' AND (NEW.total_vnd <> 0 OR NEW.paid_at IS DISTINCT FROM NEW.finalized_at) THEN
        RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Only a zero-balance invoice is settled directly at finalization';
      END IF;
    END IF;
  END IF;
  IF NEW.payer_user_id IS NOT NULL
    AND (TG_OP = 'INSERT' OR NEW.payer_user_id IS DISTINCT FROM OLD.payer_user_id) THEN
    SELECT kind INTO payer_kind FROM users WHERE id = NEW.payer_user_id;
    IF payer_kind IS DISTINCT FROM 'CUSTOMER' THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'An invoice payer is a customer account';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

-- Invoice line guard: a line's kind follows its invoice's kind, and a combo purchase line is priced by its combo and never edited.
CREATE OR REPLACE FUNCTION lucy_guard_invoice_line() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  invoice_status "InvoiceStatus";
  invoice_kind "InvoiceKind";
BEGIN
  -- FOR SHARE serializes with the invoice's finalization or cancellation.
  SELECT status, kind INTO invoice_status, invoice_kind FROM invoices WHERE id = NEW.invoice_id FOR SHARE;
  IF invoice_status IS DISTINCT FROM 'DRAFT' THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Invoice lines are created and priced only while the invoice is a draft';
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.row_version <> 1 THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'An invoice line starts at version 1';
    END IF;
    IF (invoice_kind = 'VISIT') <> (NEW.kind = 'SERVICE') THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'The line kind must match the invoice kind';
    END IF;
  ELSE
    IF (NEW.id, NEW.invoice_id, NEW.sequence, NEW.kind, NEW.item_code, NEW.name_vi, NEW.name_en, NEW.created_at)
      IS DISTINCT FROM (OLD.id, OLD.invoice_id, OLD.sequence, OLD.kind, OLD.item_code, OLD.name_vi,
        OLD.name_en, OLD.created_at) THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Invoice line identity and snapshot cannot be rewritten';
    END IF;
    IF NEW IS DISTINCT FROM OLD AND NEW.row_version <> OLD.row_version + 1 THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Invoice line changes bump the version by one';
    END IF;
    IF NEW.kind = 'COMBO_PURCHASE' AND NEW IS DISTINCT FROM OLD THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'A combo purchase line is priced by its combo and never edited';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

-- Commit-time integrity of one invoice: the Phase 4 function with the content rule split by kind. A VISIT invoice keeps the
-- original "every performed service exactly once" and price-range rules; a COMBO_SALE carries exactly one combo purchase line
-- priced exactly at its snapshotted combo price, quantity 1. The finalization and payment reconciliation rules are the same.
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
    -- Every performed (DONE) service of the visit is on the invoice exactly once, each with its detail
    -- (the unique keys make "at most once"; the counts make "at least once").
    SELECT count(*) INTO detail_count FROM invoice_line_services WHERE invoice_id = target.id;
    SELECT count(*) INTO done_count FROM visit_service_lines WHERE visit_id = target.visit_id AND status = 'DONE';
    IF line_count = 0 OR line_count <> detail_count OR line_count <> done_count THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'An invoice carries every performed service of its visit exactly once';
    END IF;
    -- A price lies inside the snapshotted range and a quantity within the snapshotted limit.
    IF EXISTS (
      SELECT 1 FROM invoice_lines l JOIN invoice_line_services s ON s.invoice_line_id = l.id
      WHERE l.invoice_id = target.id
        AND ((l.unit_price_vnd IS NOT NULL
            AND (l.unit_price_vnd < s.catalog_price_min_vnd OR l.unit_price_vnd > s.catalog_price_max_vnd))
          OR (l.quantity IS NOT NULL AND l.quantity > s.quantity_limit))) THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'A line price must lie in the snapshotted range and its quantity within the snapshotted limit';
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
  -- Reconciliation (design 9): 0 <= effective <= receivable; PAID <=> effective = receivable
  -- (also for a receivable of 0 with no payment, OP-2); PENDING_PAYMENT <=> effective < receivable;
  -- a draft has no payment; a cancelled invoice has no effective payment.
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

CREATE CONSTRAINT TRIGGER "invoice_line_combos_integrity" AFTER INSERT ON "invoice_line_combos"
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION lucy_check_invoice_integrity();

-- The issued combo (combo_purchases): it is issued for the current paid episode of a PAID combo sale whose payer owns it, and
-- it snapshots the COMBO LINE that was sold (not the live definition, so a combo edited or deactivated between the sale and
-- the payment is still issued exactly as sold). Revoking it (voided_at, once) is allowed only after the paid episode that
-- issued it has ended and while none of its sessions is in use; it is never deleted.
CREATE OR REPLACE FUNCTION lucy_guard_combo_purchase() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  target invoices%ROWTYPE;
  detail invoice_line_combos%ROWTYPE;
BEGIN
  IF TG_OP = 'INSERT' THEN
    SELECT i.* INTO target FROM invoices i JOIN invoice_lines l ON l.invoice_id = i.id
      WHERE l.id = NEW.invoice_line_id FOR SHARE OF i;
    IF target.kind IS DISTINCT FROM 'COMBO_SALE' THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'A combo is issued only for a combo sale';
    END IF;
    IF target.status IS DISTINCT FROM 'PAID' OR target.paid_seq IS DISTINCT FROM NEW.paid_seq THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'A combo is issued for the current paid episode of a paid invoice';
    END IF;
    IF target.payer_user_id IS NULL OR target.payer_user_id IS DISTINCT FROM NEW.owner_user_id THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'A combo belongs to the member who paid for it';
    END IF;
    SELECT d.* INTO detail FROM invoice_line_combos d WHERE d.invoice_line_id = NEW.invoice_line_id;
    IF NOT FOUND
      OR (NEW.combo_id, NEW.version_id, NEW.service_id, NEW.name_vi, NEW.name_en, NEW.paid_sessions, NEW.bonus_sessions,
          NEW.price_vnd, NEW.expiry_mode)
        IS DISTINCT FROM (detail.combo_id, detail.version_id, detail.service_id, detail.name_vi, detail.name_en,
          detail.paid_sessions, detail.bonus_sessions, detail.price_vnd, detail.expiry_mode) THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'A combo purchase snapshots the combo line that was sold exactly';
    END IF;
    NEW.issued_at := clock_timestamp();
    NEW.expires_at := CASE WHEN detail.expiry_mode = 'DAYS_AFTER_ISSUE'
      THEN NEW.issued_at + make_interval(days => detail.expiry_days) ELSE NULL END;
    IF NEW.voided_at IS NOT NULL THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'A combo purchase is issued unvoided';
    END IF;
    RETURN NEW;
  END IF;
  IF (NEW.id, NEW.combo_id, NEW.version_id, NEW.owner_user_id, NEW.invoice_line_id, NEW.paid_seq, NEW.service_id,
      NEW.name_vi, NEW.name_en, NEW.paid_sessions, NEW.bonus_sessions, NEW.price_vnd, NEW.expiry_mode, NEW.expires_at,
      NEW.issued_at)
    IS DISTINCT FROM (OLD.id, OLD.combo_id, OLD.version_id, OLD.owner_user_id, OLD.invoice_line_id, OLD.paid_seq,
      OLD.service_id, OLD.name_vi, OLD.name_en, OLD.paid_sessions, OLD.bonus_sessions, OLD.price_vnd, OLD.expiry_mode,
      OLD.expires_at, OLD.issued_at) THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'A combo purchase is immutable apart from being voided once';
  END IF;
  IF OLD.voided_at IS NOT NULL THEN
    IF (NEW.voided_at, NEW.voided_by_user_id, NEW.void_reason)
      IS DISTINCT FROM (OLD.voided_at, OLD.voided_by_user_id, OLD.void_reason) THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'A voided combo purchase cannot change';
    END IF;
  ELSIF NEW.voided_at IS NOT NULL THEN
    -- Lock order (design 12.2): the invoice first, then the combo rows (its sessions sorted by id).
    SELECT i.* INTO target FROM invoices i JOIN invoice_lines l ON l.invoice_id = i.id
      WHERE l.id = OLD.invoice_line_id FOR SHARE OF i;
    IF target.status = 'PAID' AND target.paid_seq = OLD.paid_seq THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'A combo is revoked only after the paid episode that issued it has ended';
    END IF;
    PERFORM 1 FROM combo_sessions s WHERE s.purchase_id = OLD.id ORDER BY s.id FOR UPDATE;
    IF EXISTS (
      SELECT 1 FROM combo_session_consumptions c JOIN combo_sessions s ON s.id = c.session_id
        WHERE s.purchase_id = OLD.id
          AND NOT EXISTS (SELECT 1 FROM combo_session_releases r WHERE r.consumption_id = c.id)
          AND NOT EXISTS (SELECT 1 FROM combo_session_restorations o WHERE o.consumption_id = c.id)) THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'A combo with a session in use is not revoked automatically';
    END IF;
    NEW.voided_at := clock_timestamp();
  END IF;
  RETURN NEW;
END;
$$;

-- The birthday gift never applies to a combo sale (Owner answer of 2026-10-05): the engine skips it and the database refuses it.
CREATE FUNCTION lucy_guard_birthday_not_combo_sale() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  invoice_kind "InvoiceKind";
BEGIN
  SELECT kind INTO invoice_kind FROM invoices WHERE id = NEW.invoice_id;
  IF invoice_kind IS DISTINCT FROM 'VISIT' THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'The birthday gift does not apply to a combo sale';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "birthday_redemptions_not_combo_sale" BEFORE INSERT ON "birthday_redemptions"
FOR EACH ROW EXECUTE FUNCTION lucy_guard_birthday_not_combo_sale();

-- CREATE OR REPLACE drops function-level settings and CREATE FUNCTION starts without them: apply the Phase 1 convention
-- (fixed search_path, no PUBLIC execute) to every function this migration touches.
DO $$
DECLARE
  migration_schema text := current_schema();
  function_name text;
BEGIN
  FOREACH function_name IN ARRAY ARRAY[
    'lucy_guard_invoice_line_combo', 'lucy_guard_invoice', 'lucy_guard_invoice_line', 'lucy_check_invoice_integrity',
    'lucy_guard_combo_purchase', 'lucy_guard_birthday_not_combo_sale'
  ] LOOP
    EXECUTE format('ALTER FUNCTION %I.%I() SET search_path TO pg_catalog, %I, pg_temp',
      migration_schema, function_name, migration_schema);
    EXECUTE format('REVOKE ALL ON FUNCTION %I.%I() FROM PUBLIC', migration_schema, function_name);
  END LOOP;
END;
$$;
