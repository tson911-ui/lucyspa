-- Phase 6 P6-12 follow-up (Owner, 2026-10-08), migration 2 of 2: the Owner's exception to the return window.
-- Owner's words: "the Owner (only the Owner) may approve a return outside the time window as an exception, with a mandatory written
-- reason, recorded in the case history and audit log". This changes the rule of 20261111000000 that no one could open a case after its
-- window. Additive: three nullable columns, one CHECK, one event kind (added by 20261112000000), one unique index, one constraint
-- trigger and the replaced bodies of the case and event guards. No row is rewritten and no permission is added or granted.
--
-- Reading (pending the Owner): the Owner OPENS the case after the window with the reason (there is no "staff opens, Owner approves"
-- step). The database stays the backstop: the exception is recorded only when the opener is the Owner account, the window really
-- ended, and the case has its WINDOW_EXCEPTION history event by commit. A wrong or damaged case opened this way is accepted with any
-- photo that is still present (a photo cannot be dated inside a window that was over before the case existed).

ALTER TABLE "product_return_cases" ADD COLUMN "window_exception_by_user_id" UUID;
ALTER TABLE "product_return_cases" ADD COLUMN "window_exception_reason" TEXT;
ALTER TABLE "product_return_cases" ADD COLUMN "window_exception_at" TIMESTAMPTZ(3);
ALTER TABLE "product_return_cases" ADD CONSTRAINT "product_return_cases_window_exception_by_fkey"
  FOREIGN KEY ("window_exception_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "product_return_cases" ADD CONSTRAINT "product_return_cases_window_exception" CHECK (
  (("window_exception_by_user_id" IS NULL) = ("window_exception_at" IS NULL))
  AND (("window_exception_by_user_id" IS NULL) = ("window_exception_reason" IS NULL))
  AND ("window_exception_reason" IS NULL OR btrim("window_exception_reason") <> '')
  AND ("window_exception_by_user_id" IS NULL OR "window_exception_by_user_id" = "opened_by_user_id")
  AND ("window_exception_at" IS NULL OR "window_ends_at" IS NOT NULL));

-- The history can never contradict the case: at most one exception event, it carries the reason, and only an exception case has one.
ALTER TABLE "product_return_events" DROP CONSTRAINT "product_return_events_note_required";
ALTER TABLE "product_return_events" ADD CONSTRAINT "product_return_events_note_required" CHECK (
  "kind" NOT IN ('NOTE_ADDED', 'PHOTO_REMOVED', 'DECLINED', 'CANCELLED', 'WINDOW_EXCEPTION') OR "note" IS NOT NULL);
CREATE UNIQUE INDEX "product_return_events_exception_key" ON "product_return_events"("case_id") WHERE "kind" = 'WINDOW_EXCEPTION';

-- Cases. Replaces the 20261111000000 body. INSERT: as before, except that a case carrying an exception skips the "window is over"
-- refusal and instead needs the Owner account as the opener, a window that really ended, and (at commit) its history event.
-- UPDATE: the three exception columns are facts like the rest. ACCEPTED: a wrong or damaged case needs a present photo; inside the
-- window it must be dated within it, under an exception any present photo counts.
CREATE OR REPLACE FUNCTION lucy_guard_product_return_case() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  inv RECORD;
  sold integer;
  claimed integer;
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'A product return case is history and is never deleted';
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'OPEN' THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'A return case starts open';
    END IF;
    SELECT i.branch_id, i.status, i.channel, i.paid_at, i.paid_seq INTO inv FROM invoices i WHERE i.id = NEW.invoice_id FOR SHARE;
    IF NOT FOUND OR inv.status <> 'PAID' OR inv.paid_at IS NULL THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'A return case needs a paid invoice';
    END IF;
    IF inv.channel <> 'COUNTER' THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Only counter sales have a return case for now';
    END IF;
    IF NEW.branch_id <> inv.branch_id THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'A return case belongs to the branch of its invoice';
    END IF;
    IF NEW.handover_at <> inv.paid_at OR NEW.paid_seq <> inv.paid_seq THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'The return window starts when the goods were handed over';
    END IF;
    NEW.opened_at := clock_timestamp();
    NEW.created_at := NEW.opened_at;
    NEW.updated_at := NEW.opened_at;
    IF NEW.window_exception_by_user_id IS NOT NULL OR NEW.window_exception_reason IS NOT NULL
       OR NEW.window_exception_at IS NOT NULL THEN
      IF NOT EXISTS (SELECT 1 FROM users u WHERE u.id = NEW.window_exception_by_user_id AND u.kind = 'OWNER') THEN
        RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Only the Owner may approve a return outside its window';
      END IF;
      IF NEW.window_ends_at IS NULL OR NEW.opened_at <= NEW.window_ends_at THEN
        RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'An exception is only for a return after its window';
      END IF;
      NEW.window_exception_at := NEW.opened_at;
    ELSIF NEW.window_ends_at IS NOT NULL AND NEW.opened_at > NEW.window_ends_at THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'The return window is over';
    END IF;
    SELECT l.quantity INTO sold FROM invoice_lines l
      WHERE l.id = NEW.invoice_line_id AND l.invoice_id = NEW.invoice_id FOR NO KEY UPDATE;
    IF sold IS NULL OR NEW.quantity > sold THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'A return case cannot claim more units than were sold';
    END IF;
    SELECT COALESCE(SUM(c.quantity), 0) INTO claimed FROM product_return_cases c
      WHERE c.invoice_line_id = NEW.invoice_line_id AND c.status IN ('OPEN', 'ACCEPTED');
    IF claimed + NEW.quantity > sold THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'The units claimed on a line cannot exceed the units sold';
    END IF;
    RETURN NEW;
  END IF;
  -- UPDATE
  IF NEW.id IS DISTINCT FROM OLD.id OR NEW.code IS DISTINCT FROM OLD.code OR NEW.branch_id IS DISTINCT FROM OLD.branch_id
     OR NEW.invoice_id IS DISTINCT FROM OLD.invoice_id OR NEW.invoice_line_id IS DISTINCT FROM OLD.invoice_line_id
     OR NEW.reason IS DISTINCT FROM OLD.reason OR NEW.requested_outcome IS DISTINCT FROM OLD.requested_outcome
     OR NEW.quantity IS DISTINCT FROM OLD.quantity OR NEW.seal_intact IS DISTINCT FROM OLD.seal_intact
     OR NEW.notes IS DISTINCT FROM OLD.notes OR NEW.handover_at IS DISTINCT FROM OLD.handover_at
     OR NEW.paid_seq IS DISTINCT FROM OLD.paid_seq OR NEW.window_ends_at IS DISTINCT FROM OLD.window_ends_at
     OR NEW.window_exception_by_user_id IS DISTINCT FROM OLD.window_exception_by_user_id
     OR NEW.window_exception_reason IS DISTINCT FROM OLD.window_exception_reason
     OR NEW.window_exception_at IS DISTINCT FROM OLD.window_exception_at
     OR NEW.opened_by_user_id IS DISTINCT FROM OLD.opened_by_user_id OR NEW.opened_at IS DISTINCT FROM OLD.opened_at
     OR NEW.client_request_id IS DISTINCT FROM OLD.client_request_id OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'The facts of a return case never change';
  END IF;
  IF OLD.status <> 'OPEN' THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'A closed return case is immutable';
  END IF;
  IF NEW.status = 'OPEN' THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'An open return case changes only by being decided or cancelled';
  END IF;
  NEW.closed_at := clock_timestamp();
  IF NEW.status = 'ACCEPTED' THEN
    PERFORM 1 FROM invoices i WHERE i.id = OLD.invoice_id AND i.status = 'PAID' FOR SHARE;
    IF NOT FOUND THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'A return case is accepted only while its invoice is paid';
    END IF;
    IF OLD.reason = 'WRONG_OR_DAMAGED' AND NOT EXISTS (
         SELECT 1 FROM product_return_photos p
         WHERE p.case_id = OLD.id AND p.removed_at IS NULL
           AND (OLD.window_exception_at IS NOT NULL OR p.uploaded_at <= OLD.window_ends_at)) THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'A wrong or damaged product needs a photo taken within 48 hours';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

-- Events. Replaces the 20261111000000 body; the only addition is the WINDOW_EXCEPTION rule: it is written while the case is open and
-- only for a case that carries an exception.
CREATE OR REPLACE FUNCTION lucy_guard_product_return_event() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  parent_status "ProductReturnStatus";
  parent_exception timestamptz;
BEGIN
  IF TG_OP <> 'INSERT' THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Return history is append-only';
  END IF;
  SELECT c.status, c.window_exception_at INTO parent_status, parent_exception
    FROM product_return_cases c WHERE c.id = NEW.case_id FOR SHARE;
  IF parent_status IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'An event belongs to a return case';
  END IF;
  IF (NEW.kind = 'OPENED' AND parent_status <> 'OPEN')
     OR (NEW.kind = 'PHOTO_ADDED' AND parent_status <> 'OPEN')
     OR (NEW.kind = 'NOTE_ADDED' AND parent_status NOT IN ('OPEN', 'ACCEPTED'))
     OR (NEW.kind = 'ACCEPTED' AND parent_status <> 'ACCEPTED')
     OR (NEW.kind = 'DECLINED' AND parent_status <> 'DECLINED')
     OR (NEW.kind = 'CANCELLED' AND parent_status <> 'CANCELLED')
     OR (NEW.kind = 'WINDOW_EXCEPTION' AND (parent_status <> 'OPEN' OR parent_exception IS NULL)) THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'The event does not match the state of the return case';
  END IF;
  NEW.occurred_at := clock_timestamp();
  RETURN NEW;
END;
$$;

-- A case that carries an exception has its WINDOW_EXCEPTION history event by commit (the history cannot omit it).
CREATE FUNCTION lucy_check_return_exception_event() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM product_return_events e
    WHERE e.case_id = NEW.id AND e.kind = 'WINDOW_EXCEPTION' AND e.note = NEW.window_exception_reason
      AND e.actor_user_id = NEW.window_exception_by_user_id) THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'A return window exception is recorded in the case history';
  END IF;
  RETURN NULL;
END;
$$;
CREATE CONSTRAINT TRIGGER "product_return_cases_exception_event" AFTER INSERT ON "product_return_cases"
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW WHEN (NEW.window_exception_at IS NOT NULL)
EXECUTE FUNCTION lucy_check_return_exception_event();

-- CREATE OR REPLACE drops function-level settings and CREATE FUNCTION starts without them: apply the Phase 1 convention
-- (fixed search_path, no PUBLIC execute) to every function this migration touches.
DO $$
DECLARE
  migration_schema text := current_schema();
  function_name text;
BEGIN
  FOREACH function_name IN ARRAY ARRAY[
    'lucy_guard_product_return_case', 'lucy_guard_product_return_event', 'lucy_check_return_exception_event'
  ] LOOP
    EXECUTE format('ALTER FUNCTION %I.%I() SET search_path TO pg_catalog, %I, pg_temp',
      migration_schema, function_name, migration_schema);
    EXECUTE format('REVOKE ALL ON FUNCTION %I.%I() FROM PUBLIC', migration_schema, function_name);
  END LOOP;
END;
$$;
