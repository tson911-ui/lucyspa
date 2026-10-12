-- Phase 8 P8-16 (customer reviews; design `PHASE8_REPORTS.md` 4.9; Owner answer OQ-P8-7 of 2026-10-12: YES, built last. A customer with an account gives
-- 1 to 5 stars and an optional note for a paid invoice, and may rate each person who served, or skip it. PRIVATE: used inside only, never published; the staff
-- report shows averages and distributions, and a person with fewer than 5 ratings is "chưa đủ đánh giá").
--
-- Additive: two new tables, both empty. Nothing is created by this migration; a review exists only after the customer's own action.
--  * `customer_reviews`: one review per paid invoice (the payer is the only customer who can open it), written once, never changed, never deleted.
--  * `customer_review_staff_ratings`: one rating per person who served on that invoice, written with the review, never changed, never deleted.
-- The rules live in the database (triggers), not only in the application: a review needs a PAID invoice of the customer who paid it, a rating is for
-- someone who performed a service on that invoice, and history is never rewritten.

CREATE TABLE "customer_reviews" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "invoice_id" UUID NOT NULL,
    "customer_user_id" UUID NOT NULL,
    "branch_id" UUID NOT NULL,
    "rating" SMALLINT NOT NULL,
    "comment" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT "customer_reviews_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "customer_reviews_rating" CHECK ("rating" BETWEEN 1 AND 5),
    CONSTRAINT "customer_reviews_comment" CHECK (
      "comment" IS NULL OR (length(btrim("comment")) > 0 AND char_length("comment") <= 1000))
);
CREATE UNIQUE INDEX "customer_reviews_invoice_key" ON "customer_reviews"("invoice_id");
CREATE INDEX "customer_reviews_branch_idx" ON "customer_reviews"("branch_id", "created_at");
CREATE INDEX "customer_reviews_customer_idx" ON "customer_reviews"("customer_user_id", "created_at");
ALTER TABLE "customer_reviews" ADD CONSTRAINT "customer_reviews_invoice_fkey" FOREIGN KEY ("invoice_id")
  REFERENCES "invoices"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "customer_reviews" ADD CONSTRAINT "customer_reviews_customer_fkey" FOREIGN KEY ("customer_user_id")
  REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "customer_reviews" ADD CONSTRAINT "customer_reviews_branch_fkey" FOREIGN KEY ("branch_id")
  REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

CREATE TABLE "customer_review_staff_ratings" (
    "review_id" UUID NOT NULL,
    "employee_user_id" UUID NOT NULL,
    "rating" SMALLINT NOT NULL,
    CONSTRAINT "customer_review_staff_ratings_pkey" PRIMARY KEY ("review_id", "employee_user_id"),
    CONSTRAINT "customer_review_staff_ratings_rating" CHECK ("rating" BETWEEN 1 AND 5)
);
CREATE INDEX "customer_review_staff_ratings_employee_idx" ON "customer_review_staff_ratings"("employee_user_id");
ALTER TABLE "customer_review_staff_ratings" ADD CONSTRAINT "customer_review_staff_ratings_review_fkey" FOREIGN KEY ("review_id")
  REFERENCES "customer_reviews"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "customer_review_staff_ratings" ADD CONSTRAINT "customer_review_staff_ratings_employee_fkey" FOREIGN KEY ("employee_user_id")
  REFERENCES "employee_profiles"("user_id") ON DELETE RESTRICT ON UPDATE RESTRICT;

CREATE FUNCTION lucy_guard_customer_review() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  target RECORD;
BEGIN
  IF TG_OP <> 'INSERT' THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'A review is history: it is never changed or deleted';
  END IF;
  SELECT status, payer_user_id, branch_id INTO target FROM invoices WHERE id = NEW.invoice_id;
  IF target.status IS DISTINCT FROM 'PAID'
     OR target.payer_user_id IS DISTINCT FROM NEW.customer_user_id
     OR target.branch_id IS DISTINCT FROM NEW.branch_id THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'A review belongs to a paid invoice of the customer who paid it';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER lucy_customer_reviews_guard BEFORE INSERT OR UPDATE OR DELETE ON "customer_reviews"
  FOR EACH ROW EXECUTE FUNCTION lucy_guard_customer_review();

CREATE FUNCTION lucy_guard_customer_review_rating() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP <> 'INSERT' THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'A review is history: it is never changed or deleted';
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM customer_reviews r
    JOIN invoice_lines l ON l.invoice_id = r.invoice_id
    JOIN invoice_line_services s ON s.invoice_line_id = l.id
    WHERE r.id = NEW.review_id AND s.employee_user_id = NEW.employee_user_id
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'A person can be rated only for a service they performed on that invoice';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER lucy_customer_review_ratings_guard BEFORE INSERT OR UPDATE OR DELETE ON "customer_review_staff_ratings"
  FOR EACH ROW EXECUTE FUNCTION lucy_guard_customer_review_rating();
