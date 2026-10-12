-- Phase 8 (P8-T5): the synthetic load fixture for the report benchmarks. Run ONLY on a throw-away database that already has every
-- migration applied (see .local/p8/perf.sh in the repository notes; `scripts/perf/phase8-bench.mjs` measures it).
--
-- Shape (a deliberate over-estimate of a real spa): 3 branches x 3 years (1,096 days) x 50 invoices a day = 164,400 invoices, about 400k
-- lines, 164k payments, 20k online orders, 2.5k refunds, 700 exchanges. 70% of invoices are visits (a tenth of them also hold a product
-- line), 8% combo sales, 22% product sales (6% of those online). Service-only invoices have NO allocation rows, exactly as the real
-- system writes them. Everything is inserted with triggers off (session_replication_role = replica) because the rows are bulk fakes;
-- the report queries read only these tables. NEVER run this against a database with real data.
SET session_replication_role = replica;
SET synchronous_commit = off;
BEGIN;
SET work_mem = '256MB';

DO $guard$
BEGIN
  IF current_database() !~ '(scratch|test|perf)' THEN
    RAISE EXCEPTION 'refusing: % is not a scratch database', current_database();
  END IF;
  IF EXISTS (SELECT 1 FROM invoices LIMIT 1) THEN
    RAISE EXCEPTION 'refusing: the database already has invoices';
  END IF;
END
$guard$;

INSERT INTO branches (id, code, name) VALUES
  ('00000000-0000-4000-8000-0000000000b1', 'P8F1', 'Perf 1'),
  ('00000000-0000-4000-8000-0000000000b2', 'P8F2', 'Perf 2'),
  ('00000000-0000-4000-8000-0000000000b3', 'P8F3', 'Perf 3');

-- A 6-character invoice code in the real alphabet (no I, O, 0, 1), unique by construction from a counter.
CREATE FUNCTION pg_temp.p8_code(n bigint) RETURNS text LANGUAGE sql IMMUTABLE AS $body$
  SELECT string_agg(substr('ABCDEFGHJKLMNPQRSTUVWXYZ23456789', ((n >> (5 * k)) & 31)::int + 1, 1), '' ORDER BY k DESC)
  FROM generate_series(0, 5) k
$body$;

CREATE TEMP TABLE p8_inv AS
SELECT row_number() OVER () AS seq, gen_random_uuid() AS id,
       b.id AS branch_id,
       b.code AS branch_code,
       d::date AS day,
       n,
       random() AS r_kind,
       random() AS r_state,
       random() AS r_split,
       random() AS r_pay,
       random() AS r_disc,
       random() AS r_online,
       (1 + floor(random() * 3))::int AS nlines,
       (d::date + time '08:00' + random() * interval '12 hours') AT TIME ZONE 'Asia/Ho_Chi_Minh' AS at
FROM branches b
CROSS JOIN generate_series(date '2023-10-13', date '2026-10-12', interval '1 day') d
CROSS JOIN generate_series(1, 50) n
WHERE b.code LIKE 'P8F%';

ALTER TABLE p8_inv ADD COLUMN kind text, ADD COLUMN channel text, ADD COLUMN status text, ADD COLUMN visit_id uuid;
UPDATE p8_inv SET
  kind = CASE WHEN r_kind < 0.70 THEN 'VISIT' WHEN r_kind < 0.78 THEN 'COMBO_SALE' ELSE 'PRODUCT_SALE' END,
  status = CASE WHEN r_state < 0.96 THEN 'PAID' WHEN r_state < 0.98 THEN 'CANCELLED' ELSE 'PENDING_PAYMENT' END;
UPDATE p8_inv SET channel = CASE WHEN kind = 'PRODUCT_SALE' AND r_online < 0.06 THEN 'ONLINE' ELSE 'COUNTER' END;
UPDATE p8_inv SET visit_id = gen_random_uuid() WHERE kind = 'VISIT';

CREATE TEMP TABLE p8_line AS
SELECT gen_random_uuid() AS id, i.id AS invoice_id, l AS seq,
       CASE WHEN i.kind = 'VISIT' THEN (CASE WHEN l = 3 AND i.r_split < 0.10 THEN 'PRODUCT' ELSE 'SERVICE' END)
            WHEN i.kind = 'COMBO_SALE' THEN 'COMBO_PURCHASE' ELSE 'PRODUCT' END AS kind,
       (50000 + floor(random() * 40) * 10000)::bigint AS gross,
       CASE WHEN i.r_disc < 0.20 THEN 0.10 ELSE 0 END AS disc_rate
FROM p8_inv i
CROSS JOIN LATERAL generate_series(1, CASE WHEN i.kind = 'COMBO_SALE' THEN 1 ELSE i.nlines END) l;
ALTER TABLE p8_line ADD COLUMN share bigint, ADD COLUMN has_alloc boolean;
UPDATE p8_line SET share = floor(gross * disc_rate)::bigint;
-- Allocations exist only for invoices with a product line (the real system writes none for service-only invoices).
UPDATE p8_line l SET has_alloc = EXISTS (SELECT 1 FROM p8_line p WHERE p.invoice_id = l.invoice_id AND p.kind = 'PRODUCT');

CREATE TEMP TABLE p8_tot AS
SELECT invoice_id, sum(gross) AS subtotal, sum(share) AS discount, sum(gross - share) AS total
FROM p8_line GROUP BY invoice_id;

INSERT INTO visits (id, code, branch_id, origin, status, service_date, arrived_at, completed_at, created_by_user_id)
SELECT i.visit_id, 'VS-' || to_char(i.day, 'YYMMDD') || '-' || i.branch_code || lpad(i.n::text, 3, '0'), i.branch_id,
       'WALK_IN', 'COMPLETED', i.day, i.at, i.at + interval '1 hour',
       '00000000-0000-4000-8000-0000000000a1'
FROM p8_inv i WHERE i.visit_id IS NOT NULL;

INSERT INTO invoices (id, code, branch_id, visit_id, payer_user_id, status, business_date, calculation_version, subtotal_vnd, discount_total_vnd,
                      total_vnd, finalized_at, finalized_by_user_id, cancelled_at, cancelled_by_user_id, cancelled_from_status, cancel_reason,
                      paid_at, paid_seq, created_by_user_id, created_at, updated_at, kind, channel, shipping_fee_vnd)
SELECT i.id, 'INV-' || to_char(i.day, 'YYMMDD') || '-' || pg_temp.p8_code(i.seq), i.branch_id, i.visit_id,
       CASE WHEN i.kind = 'COMBO_SALE' OR i.channel = 'ONLINE' THEN '00000000-0000-4000-8000-0000000000c1'::uuid END,
       i.status::"InvoiceStatus", i.day, 3, t.subtotal, t.discount, t.total,
       i.at, '00000000-0000-4000-8000-0000000000a1',
       CASE WHEN i.status = 'CANCELLED' THEN i.at END,
       CASE WHEN i.status = 'CANCELLED' THEN '00000000-0000-4000-8000-0000000000a1'::uuid END,
       CASE WHEN i.status = 'CANCELLED' THEN 'PENDING_PAYMENT'::"InvoiceStatus" END,
       CASE WHEN i.status = 'CANCELLED' THEN 'Dữ liệu thử' END,
       CASE WHEN i.status = 'PAID' THEN i.at END,
       CASE WHEN i.status = 'PAID' THEN 1 ELSE 0 END,
       '00000000-0000-4000-8000-0000000000a1', i.at, i.at, i.kind::"InvoiceKind", i.channel::"InvoiceChannel", 0
FROM p8_inv i JOIN p8_tot t ON t.invoice_id = i.id;

INSERT INTO invoice_lines (id, invoice_id, sequence, kind, item_code, name_vi, name_en, quantity, unit_price_vnd, gross_vnd)
SELECT l.id, l.invoice_id, l.seq, l.kind::"InvoiceLineKind", 'P8-' || l.kind, 'Dòng thử', 'Test line', 1, l.gross, l.gross
FROM p8_line l;

INSERT INTO invoice_line_allocations (invoice_id, invoice_line_id, side, gross_vnd, discount_share_vnd, net_vnd)
SELECT l.invoice_id, l.id, (CASE WHEN l.kind = 'PRODUCT' THEN 'BEAUTY' ELSE 'SPA' END)::"PricingSide", l.gross, l.share, l.gross - l.share
FROM p8_line l WHERE l.has_alloc;

-- Payments of paid invoices: one (80%) or two cash parts (20%); online invoices are PayOS.
CREATE TEMP TABLE p8_pay AS
SELECT gen_random_uuid() AS id, i.id AS invoice_id, i.branch_id, i.day, i.at, part,
       CASE WHEN i.channel = 'ONLINE' THEN 'PAYOS' WHEN i.r_pay < 0.55 THEN 'CASH' WHEN i.r_pay < 0.80 THEN 'PAYOS' ELSE 'CASH' END AS method,
       CASE WHEN i.r_pay >= 0.80 AND i.channel = 'COUNTER' THEN 2 ELSE 1 END AS parts,
       t.total
FROM p8_inv i JOIN p8_tot t ON t.invoice_id = i.id
CROSS JOIN LATERAL generate_series(1, CASE WHEN i.r_pay >= 0.80 AND i.channel = 'COUNTER' THEN 2 ELSE 1 END) part
WHERE i.status = 'PAID' AND t.total > 0;
ALTER TABLE p8_pay ADD COLUMN amount bigint;
UPDATE p8_pay SET amount = CASE WHEN parts = 1 THEN total WHEN part = 1 THEN (total / 2 / 1000) * 1000 ELSE total - (total / 2 / 1000) * 1000 END;
DELETE FROM p8_pay WHERE amount <= 0;

INSERT INTO payments (id, invoice_id, branch_id, method, status, amount_due_vnd, amount_vnd, tendered_vnd, change_vnd, collected_by_user_id,
                      collected_at, business_date, idempotency_key, provider_order_code, provider_payment_link_id, checkout_url, qr_code,
                      expires_at, provider_reference)
SELECT p.id, p.invoice_id, p.branch_id, p.method::"PaymentMethod", 'SUCCEEDED', p.amount, p.amount, p.amount, 0,
       '00000000-0000-4000-8000-0000000000a1', p.at + part * interval '1 minute', p.day, gen_random_uuid(),
       CASE WHEN p.method = 'PAYOS' THEN 1000000000 + row_number() OVER () END,
       CASE WHEN p.method = 'PAYOS' THEN 'link-' || p.id END, CASE WHEN p.method = 'PAYOS' THEN 'https://pay.example/' || p.id END,
       CASE WHEN p.method = 'PAYOS' THEN 'qr' END, CASE WHEN p.method = 'PAYOS' THEN p.at + interval '15 minutes' END,
       CASE WHEN p.method = 'PAYOS' THEN 'ref-' || p.id END
FROM p8_pay p;

-- The Spa/Beauty split of each payment of an invoice that has allocations: pro rata to the side nets, remainder to the first side.
INSERT INTO payment_side_allocations (invoice_id, payment_id, side, kind, amount_vnd)
SELECT s.invoice_id, s.payment_id, s.side::"PricingSide", 'PAYMENT',
       CASE WHEN s.rn = 1 THEN s.amount - COALESCE(sum(s.part_amount) FILTER (WHERE s.rn > 1) OVER (PARTITION BY s.payment_id), 0) ELSE s.part_amount END
FROM (
  SELECT p.invoice_id, p.id AS payment_id, p.amount, a.side::text AS side,
         floor(p.amount::numeric * a.net / t.net)::bigint AS part_amount,
         row_number() OVER (PARTITION BY p.id ORDER BY a.side) AS rn
  FROM p8_pay p
  JOIN (SELECT invoice_id, side, sum(net_vnd) AS net FROM invoice_line_allocations GROUP BY invoice_id, side) a ON a.invoice_id = p.invoice_id
  JOIN (SELECT invoice_id, sum(net_vnd) AS net FROM invoice_line_allocations GROUP BY invoice_id) t ON t.invoice_id = p.invoice_id
  WHERE t.net > 0
) s;

-- A payment reversed by mistake (0.3% of cash payments).
INSERT INTO payment_corrections (payment_id, kind, reason, actor_user_id, occurred_at)
SELECT p.id, 'REVERSAL', 'Nhập nhầm (dữ liệu thử)', '00000000-0000-4000-8000-0000000000a1', p.at + interval '2 hours'
FROM p8_pay p WHERE p.method = 'CASH' AND random() < 0.003;

-- Online orders of the online invoices.
CREATE TEMP TABLE p8_order AS
SELECT gen_random_uuid() AS id, i.id AS invoice_id, i.branch_id, i.branch_code, i.day, i.n, i.at, random() AS r
FROM p8_inv i WHERE i.channel = 'ONLINE' AND i.status = 'PAID';
INSERT INTO product_orders (id, code, invoice_id, branch_id, channel, customer_user_id, contact_phone, created_by_user_id)
SELECT o.id, 'DH-' || to_char(o.day, 'YYMMDD') || '-' || o.branch_code || lpad(o.n::text, 3, '0'), o.invoice_id, o.branch_id, 'ONLINE',
       '00000000-0000-4000-8000-0000000000c1', '+84900000000', '00000000-0000-4000-8000-0000000000a1'
FROM p8_order o;
-- 85% delivered (COMPLETED via shipping), 5% shipped, 5% paid and waiting, 5% cancelled (the facts check of the table wants the matching columns).
INSERT INTO product_order_lines (order_id, invoice_id, invoice_line_id, branch_id, variant_id, quantity, status, paid_at, expected_from, expected_to,
                                 completed_at, shipped_at, shipped_by_user_id, delivered_at, delivered_by_user_id, delivered_by_kind,
                                 cancelled_at, cancelled_by_user_id, cancel_cause, cancel_note)
SELECT o.id, o.invoice_id, l.id, o.branch_id, gen_random_uuid(), 1,
       (CASE WHEN o.r < 0.85 THEN 'COMPLETED' WHEN o.r < 0.90 THEN 'SHIPPED' WHEN o.r < 0.95 THEN 'PAID' ELSE 'CANCELLED' END)::"ProductOrderLineStatus",
       o.at,
       CASE WHEN o.r < 0.95 THEN o.day + 7 END,
       CASE WHEN o.r < 0.95 THEN o.day + 9 END,
       CASE WHEN o.r < 0.85 THEN o.at + interval '3 days' END,
       CASE WHEN o.r < 0.90 THEN o.at + interval '1 day' END,
       CASE WHEN o.r < 0.90 THEN '00000000-0000-4000-8000-0000000000a1'::uuid END,
       CASE WHEN o.r < 0.85 THEN o.at + interval '3 days' END,
       CASE WHEN o.r < 0.85 THEN '00000000-0000-4000-8000-0000000000a1'::uuid END,
       CASE WHEN o.r < 0.85 THEN 'STAFF' END,
       CASE WHEN o.r >= 0.95 THEN o.at + interval '1 day' END,
       CASE WHEN o.r >= 0.95 THEN '00000000-0000-4000-8000-0000000000a1'::uuid END,
       CASE WHEN o.r >= 0.95 THEN 'CUSTOMER_CHANGED_MIND'::"ProductOrderCancelCause" END,
       CASE WHEN o.r >= 0.95 THEN 'Dữ liệu thử' END
FROM p8_order o JOIN p8_line l ON l.invoice_id = o.invoice_id;

-- Refunds: 1.5% of counter product lines; exchanges: 0.4%.
INSERT INTO product_refunds (code, branch_id, invoice_id, invoice_line_id, return_case_id, case_ordinal, paid_seq, quantity, amount_vnd,
                             line_units_after, line_amount_after_vnd, invoice_refunded_after_vnd, method, bank_reference, reason, restock,
                             actor_user_id, reauthenticated_at, client_request_id, occurred_at)
SELECT 'RF' || row_number() OVER (), i.branch_id, i.id, l.id, gen_random_uuid(), 1, 1, 1, l.gross - l.share, 1, l.gross - l.share,
       l.gross - l.share, s.method::"ProductRefundMethod", CASE WHEN s.method = 'BANK_TRANSFER_MANUAL' THEN 'TF123456' END,
       'Dữ liệu thử', 'SELLABLE', '00000000-0000-4000-8000-0000000000a1', i.at, gen_random_uuid(), i.at + interval '2 days'
FROM p8_inv i
JOIN p8_line l ON l.invoice_id = i.id
CROSS JOIN LATERAL (SELECT CASE WHEN random() < 0.7 THEN 'CASH' ELSE 'BANK_TRANSFER_MANUAL' END AS method) s
WHERE i.status = 'PAID' AND i.channel = 'COUNTER' AND l.kind = 'PRODUCT' AND random() < 0.015;

INSERT INTO product_exchanges (code, branch_id, invoice_id, invoice_line_id, return_case_id, paid_seq, quantity, line_units_after,
                               line_amount_after_vnd, credit_vnd, rule, replacement_variant_id, replacement_unit_price_vnd,
                               replacement_gross_vnd, applied_credit_vnd, payable_vnd, refund_vnd, refund_method, exchange_invoice_id,
                               reason, actor_user_id, reauthenticated_at, client_request_id, occurred_at)
SELECT 'DH' || row_number() OVER (), i.branch_id, i.id, l.id, gen_random_uuid(), 1, 1, 1, l.gross - l.share, l.gross - l.share,
       'PRICE_DIFFERENCE', gen_random_uuid(), 40000, 40000, 40000, 0, (l.gross - l.share) - 40000, 'CASH', gen_random_uuid(), 'Dữ liệu thử',
       '00000000-0000-4000-8000-0000000000a1', i.at, gen_random_uuid(), i.at + interval '1 day'
FROM p8_inv i JOIN p8_line l ON l.invoice_id = i.id
WHERE i.status = 'PAID' AND i.channel = 'COUNTER' AND l.kind = 'PRODUCT' AND l.gross - l.share > 40000 AND random() < 0.004;

-- What each line was: 40 services and 350 product variants (so the by-service and by-product reports have something to group).
INSERT INTO invoice_line_services (invoice_line_id, invoice_id, visit_service_line_id, service_id, participant_id, employee_user_id,
                                   pricing_unit, catalog_price_min_vnd, catalog_price_max_vnd, quantity_limit, added_on_behalf)
SELECT l.id, l.invoice_id, gen_random_uuid(), md5('svc' || (abs(hashtext(l.id::text)) % 40)::text)::uuid, gen_random_uuid(),
       '00000000-0000-4000-8000-0000000000a1', 'PER_SERVICE', l.gross, l.gross, 1, false
FROM p8_line l WHERE l.kind = 'SERVICE';

INSERT INTO invoice_line_products (invoice_line_id, invoice_id, product_id, variant_id, sku, product_name_vi, product_name_en,
                                   list_price_vnd, priced_at, fulfilment_mode)
SELECT l.id, l.invoice_id, md5('prd' || (abs(hashtext(l.id::text)) % 350)::text)::uuid, md5('var' || (abs(hashtext(l.id::text)) % 350)::text)::uuid,
       'SKU-' || (abs(hashtext(l.id::text)) % 350), 'Sản phẩm thử', 'Test product', l.gross, now(), 'IN_STOCK'
FROM p8_line l WHERE l.kind = 'PRODUCT';

COMMIT;
ANALYZE;
SELECT (SELECT count(*) FROM invoices) AS invoices, (SELECT count(*) FROM invoice_lines) AS lines,
       (SELECT count(*) FROM payments) AS payments, (SELECT count(*) FROM product_refunds) AS refunds,
       (SELECT count(*) FROM product_exchanges) AS exchanges, (SELECT count(*) FROM product_orders) AS orders,
       (SELECT count(*) FROM visits) AS visits;
