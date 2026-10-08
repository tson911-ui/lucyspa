-- Phase 6 P6-12 (Wave 3, design 8.1, T23, T35, OQ-22, OQ-40, OQ-79): product return cases.
-- Additive: three new tables, three enums, one sequence and two widened CHECKs of `notifications`. No existing table of POS, invoices,
-- payments, loyalty or stock changes, no permission is added or granted (MANAGE_PRODUCT_RETURNS and REFUND_PRODUCTS already exist).
-- A case moves no money and no stock; P6-13 (refunds) and P6-14 (exchanges) build on it.
--
--   product_return_cases   one claim about ONE product line of a PAID counter invoice. The facts never change; the case is OPEN until it
--                          is ACCEPTED, DECLINED or CANCELLED once (terminal, one way). Never deleted.
--   product_return_events  the append-only history (opened, notes, photos, decision). No update, no delete.
--   product_return_photos  private evidence. A removal (OQ-79: only on the customer's request, with the Owner) keeps the row as a
--                          tombstone; the API deletes the stored bytes.
--
-- The database is the backstop of the rules the API checks first: the facts come from the invoice (branch, paid time = hand-over for an
-- in-stock counter sale), the window is derived (7 days = 168 hours for PERSONAL_PREFERENCE with the seal intact, 48 hours for
-- WRONG_OR_DAMAGED, none for SKIN_IRRITATION), no case is opened after its window, the units claimed on a line never exceed the units
-- sold, and WRONG_OR_DAMAGED is accepted only with a photo taken inside the window.

CREATE TYPE "ProductReturnReason" AS ENUM ('PERSONAL_PREFERENCE', 'WRONG_OR_DAMAGED', 'SKIN_IRRITATION');
CREATE TYPE "ProductReturnOutcome" AS ENUM ('EXCHANGE', 'REFUND');
CREATE TYPE "ProductReturnStatus" AS ENUM ('OPEN', 'ACCEPTED', 'DECLINED', 'CANCELLED');
CREATE TYPE "ProductReturnEventKind" AS ENUM ('OPENED', 'NOTE_ADDED', 'PHOTO_ADDED', 'PHOTO_REMOVED', 'ACCEPTED', 'DECLINED', 'CANCELLED');

CREATE SEQUENCE "product_return_code_seq" AS BIGINT START 1;

-- ---------------------------------------------------------------------------------------------- cases
CREATE TABLE "product_return_cases" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "code" VARCHAR(40) NOT NULL,
    "branch_id" UUID NOT NULL,
    "invoice_id" UUID NOT NULL,
    "invoice_line_id" UUID NOT NULL,
    "reason" "ProductReturnReason" NOT NULL,
    "requested_outcome" "ProductReturnOutcome" NOT NULL,
    "quantity" INTEGER NOT NULL,
    "seal_intact" BOOLEAN,
    "notes" TEXT,
    "handover_at" TIMESTAMPTZ(3) NOT NULL,
    "paid_seq" INTEGER NOT NULL,
    "window_ends_at" TIMESTAMPTZ(3),
    "status" "ProductReturnStatus" NOT NULL DEFAULT 'OPEN',
    "decided_outcome" "ProductReturnOutcome",
    "closed_by_user_id" UUID,
    "closed_at" TIMESTAMPTZ(3),
    "closing_note" TEXT,
    "opened_by_user_id" UUID NOT NULL,
    "opened_at" TIMESTAMPTZ(3) NOT NULL DEFAULT clock_timestamp(),
    "client_request_id" UUID NOT NULL,
    "row_version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT clock_timestamp(),
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT clock_timestamp(),

    CONSTRAINT "product_return_cases_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "product_return_cases_code" CHECK (btrim("code") <> ''),
    CONSTRAINT "product_return_cases_quantity" CHECK ("quantity" > 0),
    CONSTRAINT "product_return_cases_notes" CHECK ("notes" IS NULL OR btrim("notes") <> ''),
    CONSTRAINT "product_return_cases_version" CHECK ("row_version" >= 1),
    -- Personal preference is accepted only for goods with the seal intact (PRD 28.1).
    CONSTRAINT "product_return_cases_seal" CHECK ("reason" <> 'PERSONAL_PREFERENCE' OR "seal_intact" IS TRUE),
    -- The window is derived from the hand-over, never typed: 7 days = 168 hours, 48 hours, or none (case by case, PRD 28.3).
    CONSTRAINT "product_return_cases_window" CHECK (
      ("reason" = 'PERSONAL_PREFERENCE' AND "window_ends_at" = "handover_at" + interval '168 hours')
      OR ("reason" = 'WRONG_OR_DAMAGED' AND "window_ends_at" = "handover_at" + interval '48 hours')
      OR ("reason" = 'SKIN_IRRITATION' AND "window_ends_at" IS NULL)),
    CONSTRAINT "product_return_cases_state" CHECK (
      (("status" = 'OPEN') = ("closed_at" IS NULL))
      AND (("closed_at" IS NULL) = ("closed_by_user_id" IS NULL))
      AND (("status" = 'ACCEPTED') = ("decided_outcome" IS NOT NULL))
      AND (("status" = 'OPEN') = ("closing_note" IS NULL) OR "status" = 'ACCEPTED')
      AND ("closing_note" IS NULL OR btrim("closing_note") <> '')
      AND ("status" NOT IN ('DECLINED', 'CANCELLED') OR "closing_note" IS NOT NULL))
);
CREATE UNIQUE INDEX "product_return_cases_code_key" ON "product_return_cases"("code");
CREATE UNIQUE INDEX "product_return_cases_request_key" ON "product_return_cases"("opened_by_user_id", "client_request_id");
CREATE INDEX "product_return_cases_branch_idx" ON "product_return_cases"("branch_id", "opened_at" DESC, "id");
CREATE INDEX "product_return_cases_line_idx" ON "product_return_cases"("invoice_line_id", "status");
ALTER TABLE "product_return_cases" ADD CONSTRAINT "product_return_cases_branch_id_fkey"
  FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "product_return_cases" ADD CONSTRAINT "product_return_cases_invoice_id_fkey"
  FOREIGN KEY ("invoice_id") REFERENCES "invoices"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "product_return_cases" ADD CONSTRAINT "product_return_cases_line_fkey"
  FOREIGN KEY ("invoice_id", "invoice_line_id") REFERENCES "invoice_lines"("invoice_id", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;
-- Only a PRODUCT line has a detail row: services and combos have no return case (PRD 29).
ALTER TABLE "product_return_cases" ADD CONSTRAINT "product_return_cases_product_line_fkey"
  FOREIGN KEY ("invoice_line_id") REFERENCES "invoice_line_products"("invoice_line_id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "product_return_cases" ADD CONSTRAINT "product_return_cases_opened_by_user_id_fkey"
  FOREIGN KEY ("opened_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "product_return_cases" ADD CONSTRAINT "product_return_cases_closed_by_user_id_fkey"
  FOREIGN KEY ("closed_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- --------------------------------------------------------------------------------------------- photos
CREATE TABLE "product_return_photos" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "case_id" UUID NOT NULL,
    "original_key" TEXT NOT NULL,
    "thumb_key" TEXT NOT NULL,
    "md_key" TEXT NOT NULL,
    "lg_key" TEXT NOT NULL,
    "mime" TEXT NOT NULL,
    "bytes" INTEGER NOT NULL,
    "width" INTEGER NOT NULL,
    "height" INTEGER NOT NULL,
    "sha256" TEXT NOT NULL,
    "uploaded_by_user_id" UUID NOT NULL,
    "uploaded_at" TIMESTAMPTZ(3) NOT NULL DEFAULT clock_timestamp(),
    "removed_at" TIMESTAMPTZ(3),
    "removed_by_user_id" UUID,
    "removal_note" TEXT,

    CONSTRAINT "product_return_photos_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "product_return_photos_size" CHECK ("bytes" > 0 AND "width" > 0 AND "height" > 0),
    CONSTRAINT "product_return_photos_removal" CHECK (
      ("removed_at" IS NULL) = ("removed_by_user_id" IS NULL)
      AND ("removed_at" IS NULL) = ("removal_note" IS NULL)
      AND ("removal_note" IS NULL OR btrim("removal_note") <> ''))
);
CREATE UNIQUE INDEX "product_return_photos_original_key" ON "product_return_photos"("original_key");
CREATE UNIQUE INDEX "product_return_photos_thumb_key" ON "product_return_photos"("thumb_key");
CREATE UNIQUE INDEX "product_return_photos_md_key" ON "product_return_photos"("md_key");
CREATE UNIQUE INDEX "product_return_photos_lg_key" ON "product_return_photos"("lg_key");
-- The same picture twice in one case is one photo; across cases nothing is compared (no global hash index: it would reveal that
-- the same file exists in another case).
CREATE UNIQUE INDEX "product_return_photos_case_sha_key" ON "product_return_photos"("case_id", "sha256") WHERE "removed_at" IS NULL;
CREATE INDEX "product_return_photos_case_idx" ON "product_return_photos"("case_id", "uploaded_at", "id");
ALTER TABLE "product_return_photos" ADD CONSTRAINT "product_return_photos_case_id_fkey"
  FOREIGN KEY ("case_id") REFERENCES "product_return_cases"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "product_return_photos" ADD CONSTRAINT "product_return_photos_uploaded_by_user_id_fkey"
  FOREIGN KEY ("uploaded_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "product_return_photos" ADD CONSTRAINT "product_return_photos_removed_by_user_id_fkey"
  FOREIGN KEY ("removed_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- --------------------------------------------------------------------------------------------- events
CREATE TABLE "product_return_events" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "case_id" UUID NOT NULL,
    "kind" "ProductReturnEventKind" NOT NULL,
    "actor_user_id" UUID NOT NULL,
    "note" TEXT,
    "photo_id" UUID,
    "occurred_at" TIMESTAMPTZ(3) NOT NULL DEFAULT clock_timestamp(),

    CONSTRAINT "product_return_events_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "product_return_events_note" CHECK ("note" IS NULL OR btrim("note") <> ''),
    CONSTRAINT "product_return_events_note_required" CHECK (
      "kind" NOT IN ('NOTE_ADDED', 'PHOTO_REMOVED', 'DECLINED', 'CANCELLED') OR "note" IS NOT NULL),
    CONSTRAINT "product_return_events_photo" CHECK (("kind" IN ('PHOTO_ADDED', 'PHOTO_REMOVED')) = ("photo_id" IS NOT NULL))
);
-- One opening and at most one closing per case: the history can never contradict the state.
CREATE UNIQUE INDEX "product_return_events_opened_key" ON "product_return_events"("case_id") WHERE "kind" = 'OPENED';
CREATE UNIQUE INDEX "product_return_events_closed_key" ON "product_return_events"("case_id")
  WHERE "kind" IN ('ACCEPTED', 'DECLINED', 'CANCELLED');
CREATE UNIQUE INDEX "product_return_events_photo_key" ON "product_return_events"("photo_id", "kind") WHERE "photo_id" IS NOT NULL;
CREATE INDEX "product_return_events_case_idx" ON "product_return_events"("case_id", "occurred_at", "id");
ALTER TABLE "product_return_events" ADD CONSTRAINT "product_return_events_case_id_fkey"
  FOREIGN KEY ("case_id") REFERENCES "product_return_cases"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "product_return_events" ADD CONSTRAINT "product_return_events_actor_user_id_fkey"
  FOREIGN KEY ("actor_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "product_return_events" ADD CONSTRAINT "product_return_events_photo_id_fkey"
  FOREIGN KEY ("photo_id") REFERENCES "product_return_photos"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- ---------------------------------------------------------------------------------------------- guards
-- Cases. INSERT: starts OPEN; the branch, the paid state and the hand-over time come from the invoice (a request cannot invent them);
-- the time is the database clock; no case opens after its window; the units claimed (OPEN or ACCEPTED) on the line never exceed
-- the units sold (the line row is locked so two concurrent claims serialize).
-- UPDATE: only OPEN -> ACCEPTED | DECLINED | CANCELLED, once; every fact stays as it was; ACCEPTED needs a still-PAID invoice and, for
-- WRONG_OR_DAMAGED, a photo taken inside the window that has not been removed. DELETE: never.
CREATE FUNCTION lucy_guard_product_return_case() RETURNS trigger
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
    IF NEW.window_ends_at IS NOT NULL AND NEW.opened_at > NEW.window_ends_at THEN
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
         WHERE p.case_id = OLD.id AND p.removed_at IS NULL AND p.uploaded_at <= OLD.window_ends_at) THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'A wrong or damaged product needs a photo taken within 48 hours';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER lucy_product_return_cases_guard BEFORE INSERT OR UPDATE OR DELETE ON "product_return_cases"
  FOR EACH ROW EXECUTE FUNCTION lucy_guard_product_return_case();
CREATE TRIGGER lucy_product_return_cases_version BEFORE UPDATE ON "product_return_cases"
  FOR EACH ROW EXECUTE FUNCTION lucy_guard_versioned_row();

-- Photos. INSERT only while the case is OPEN; the time is the database clock; a photo starts present. UPDATE: only the removal marks, once
-- (the time is the database clock); everything else about the photo is immutable. DELETE: never (a removal is a tombstone).
CREATE FUNCTION lucy_guard_product_return_photo() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  parent_status "ProductReturnStatus";
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Return evidence is history; a removal keeps a tombstone';
  END IF;
  IF TG_OP = 'INSERT' THEN
    SELECT c.status INTO parent_status FROM product_return_cases c WHERE c.id = NEW.case_id FOR SHARE;
    IF parent_status IS DISTINCT FROM 'OPEN' THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Evidence is added only while the return case is open';
    END IF;
    IF NEW.removed_at IS NOT NULL OR NEW.removed_by_user_id IS NOT NULL OR NEW.removal_note IS NOT NULL THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'A photo starts present';
    END IF;
    NEW.uploaded_at := clock_timestamp();
    RETURN NEW;
  END IF;
  IF NEW.id IS DISTINCT FROM OLD.id OR NEW.case_id IS DISTINCT FROM OLD.case_id OR NEW.original_key IS DISTINCT FROM OLD.original_key
     OR NEW.thumb_key IS DISTINCT FROM OLD.thumb_key OR NEW.md_key IS DISTINCT FROM OLD.md_key OR NEW.lg_key IS DISTINCT FROM OLD.lg_key
     OR NEW.mime IS DISTINCT FROM OLD.mime OR NEW.bytes IS DISTINCT FROM OLD.bytes OR NEW.width IS DISTINCT FROM OLD.width
     OR NEW.height IS DISTINCT FROM OLD.height OR NEW.sha256 IS DISTINCT FROM OLD.sha256
     OR NEW.uploaded_by_user_id IS DISTINCT FROM OLD.uploaded_by_user_id OR NEW.uploaded_at IS DISTINCT FROM OLD.uploaded_at THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'A return photo never changes';
  END IF;
  IF OLD.removed_at IS NOT NULL THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'A removed photo stays removed';
  END IF;
  IF NEW.removed_by_user_id IS NULL OR NEW.removal_note IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'A photo is only ever changed by removing it';
  END IF;
  NEW.removed_at := clock_timestamp();
  RETURN NEW;
END;
$$;
CREATE TRIGGER lucy_product_return_photos_guard BEFORE INSERT OR UPDATE OR DELETE ON "product_return_photos"
  FOR EACH ROW EXECUTE FUNCTION lucy_guard_product_return_photo();

-- Events. Append-only; the time is the database clock; an event matches the case it belongs to (notes while OPEN or ACCEPTED, photos
-- added while OPEN, a decision event only after the case holds that state).
CREATE FUNCTION lucy_guard_product_return_event() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  parent_status "ProductReturnStatus";
BEGIN
  IF TG_OP <> 'INSERT' THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Return history is append-only';
  END IF;
  SELECT c.status INTO parent_status FROM product_return_cases c WHERE c.id = NEW.case_id FOR SHARE;
  IF parent_status IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'An event belongs to a return case';
  END IF;
  IF (NEW.kind = 'OPENED' AND parent_status <> 'OPEN')
     OR (NEW.kind = 'PHOTO_ADDED' AND parent_status <> 'OPEN')
     OR (NEW.kind = 'NOTE_ADDED' AND parent_status NOT IN ('OPEN', 'ACCEPTED'))
     OR (NEW.kind = 'ACCEPTED' AND parent_status <> 'ACCEPTED')
     OR (NEW.kind = 'DECLINED' AND parent_status <> 'DECLINED')
     OR (NEW.kind = 'CANCELLED' AND parent_status <> 'CANCELLED') THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'The event does not match the state of the return case';
  END IF;
  NEW.occurred_at := clock_timestamp();
  RETURN NEW;
END;
$$;
CREATE TRIGGER lucy_product_return_events_guard BEFORE INSERT OR UPDATE OR DELETE ON "product_return_events"
  FOR EACH ROW EXECUTE FUNCTION lucy_guard_product_return_event();

-- ------------------------------------------------------------------------------------ notifications
-- The closed type/entity CHECKs of `notifications` learn one more notice (T35: a new case tells the holders of REFUND_PRODUCTS at the
-- branch). Same method as 20261110000000: two constraints are widened, never narrowed, so every existing row still satisfies them.
--   PRODUCT_RETURN_OPENED   about one return case at a branch -> entity 'ProductReturnCase' (the row also carries the branch)
-- `notifications_branch_scope` and `notifications_branch_entity` already fit (a branch is always present; the entity is not a Branch).
ALTER TABLE "notifications"
  DROP CONSTRAINT "notifications_type_check",
  ADD CONSTRAINT "notifications_type_check" CHECK ("type" IN (
    'BOOKING_CREATED', 'BOOKING_CANCELLED', 'LATE_CANCELLATION', 'BOOKING_NO_SHOW', 'CUSTOMER_ARRIVED',
    'BOOKING_KTV_CONFLICT', 'KTV_REASSIGNED', 'START_OVERDUE', 'PRE_END', 'END_OVERDUE',
    'LEAVE_REQUESTED', 'LEAVE_DECIDED',
    'INVOICE_PAID', 'INVOICE_CANCELLED', 'PAYOS_PAYMENT_SUCCEEDED', 'PAYOS_PAYMENT_ANOMALY', 'PAYMENT_REVERSED',
    'INVOICE_CANCELLED_ALERT', 'REVENUE_DAILY_SUMMARY',
    'LOW_STOCK_REACHED', 'EXPIRY_ALERT', 'EXPIRED_LOT_SOLD', 'PRODUCT_RETURN_OPENED')),
  DROP CONSTRAINT "notifications_entity_type_check",
  ADD CONSTRAINT "notifications_entity_type_check" CHECK ("entity_type" IN
    ('Booking', 'Visit', 'LeaveRequest', 'Invoice', 'Branch', 'ProductVariant', 'ProductReturnCase')),
  DROP CONSTRAINT "notifications_type_entity",
  ADD CONSTRAINT "notifications_type_entity" CHECK (
    (("type" LIKE 'LEAVE\_%') = ("entity_type" = 'LeaveRequest'))
    AND (("type" IN ('INVOICE_PAID', 'INVOICE_CANCELLED', 'PAYOS_PAYMENT_SUCCEEDED', 'PAYOS_PAYMENT_ANOMALY',
                     'PAYMENT_REVERSED', 'INVOICE_CANCELLED_ALERT')) = ("entity_type" = 'Invoice'))
    AND (("type" IN ('REVENUE_DAILY_SUMMARY', 'EXPIRY_ALERT')) = ("entity_type" = 'Branch'))
    AND (("type" IN ('LOW_STOCK_REACHED', 'EXPIRED_LOT_SOLD')) = ("entity_type" = 'ProductVariant'))
    AND (("type" = 'PRODUCT_RETURN_OPENED') = ("entity_type" = 'ProductReturnCase')));
