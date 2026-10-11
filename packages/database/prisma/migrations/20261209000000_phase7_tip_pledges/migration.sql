-- Phase 7 P7-17 (Owner decision on tips, 2026-10-12, replaces OQ-P7-10a): cash tips are not recorded at all; a tip exists only when the CUSTOMER
-- adds it to a PayOS payment ("Thêm tip") and chooses which of the KTVs who served get how much.
--
-- Additive. One new table, empty, and one nullable column on `tips`.
--
-- `payment_tip_pledges` is what the customer chose, frozen when the PayOS request is created: the provider is asked for the invoice part
-- (`payments.amount_vnd`, the only money credited to the invoice, revenue, points and the commission base) PLUS the sum of the pledges.
-- A pledge names a KTV who performed a service on that invoice (the database checks it), is created only together with a pending PayOS request
-- that has no link yet, and never changes. The tip itself (`tips`, with its TIP_IN book entry) is written by the settlement transaction
-- when the provider confirms exactly that total, so `tips.payment_id` names the payment that carried it (one tip per payment and KTV).

CREATE TABLE "payment_tip_pledges" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "payment_id" UUID NOT NULL,
    "employee_user_id" UUID NOT NULL,
    "amount_vnd" BIGINT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT "payment_tip_pledges_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "payment_tip_pledges_amount" CHECK ("amount_vnd" >= 1000 AND "amount_vnd" <= 10000000 AND "amount_vnd" % 1000 = 0)
);
CREATE UNIQUE INDEX "payment_tip_pledges_person_key" ON "payment_tip_pledges"("payment_id", "employee_user_id");
CREATE INDEX "payment_tip_pledges_employee_idx" ON "payment_tip_pledges"("employee_user_id");
ALTER TABLE "payment_tip_pledges" ADD CONSTRAINT "payment_tip_pledges_payment_fkey" FOREIGN KEY ("payment_id")
  REFERENCES "payments"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "payment_tip_pledges" ADD CONSTRAINT "payment_tip_pledges_employee_fkey" FOREIGN KEY ("employee_user_id")
  REFERENCES "employee_profiles"("user_id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- A pledge is written once, for a KTV of the invoice, while the PayOS request is still pending and has no link; the whole pledge of one payment
-- never exceeds the tip limit (10,000,000 each is the same ceiling as a tip). It is never changed or deleted.
CREATE FUNCTION lucy_guard_tip_pledge() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  target RECORD;
BEGIN
  IF TG_OP <> 'INSERT' THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'A tip pledge is history: it is never changed or deleted';
  END IF;
  SELECT id, invoice_id, method, status, checkout_url, provider_payment_link_id INTO target FROM payments WHERE id = NEW.payment_id;
  IF NOT FOUND OR target.method <> 'PAYOS' OR target.status <> 'PENDING'
     OR target.checkout_url IS NOT NULL OR target.provider_payment_link_id IS NOT NULL THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'A tip is pledged only with a new PayOS request that has no link yet';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM invoice_line_services s JOIN invoice_lines l ON l.id = s.invoice_line_id AND l.invoice_id = s.invoice_id
    WHERE s.invoice_id = target.invoice_id AND s.employee_user_id = NEW.employee_user_id AND l.kind = 'SERVICE'
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'A tip can only be for a KTV who performed a service on the invoice';
  END IF;
  IF (SELECT COALESCE(SUM(amount_vnd), 0) FROM payment_tip_pledges WHERE payment_id = NEW.payment_id) + NEW.amount_vnd > 10000000 THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'The tips of one payment add up to at most 10,000,000';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER lucy_payment_tip_pledges_guard BEFORE INSERT OR UPDATE OR DELETE ON "payment_tip_pledges"
  FOR EACH ROW EXECUTE FUNCTION lucy_guard_tip_pledge();

-- The payment that carried a tip (NULL for a tip of the first design, and for a reversal). One tip per payment and KTV.
ALTER TABLE "tips" ADD COLUMN "payment_id" UUID;
ALTER TABLE "tips" ADD CONSTRAINT "tips_payment_fkey" FOREIGN KEY ("payment_id")
  REFERENCES "payments"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
CREATE UNIQUE INDEX "tips_payment_person_key" ON "tips"("payment_id", "employee_user_id")
  WHERE "payment_id" IS NOT NULL AND "reverses_id" IS NULL;
CREATE INDEX "tips_payment_idx" ON "tips"("payment_id");
