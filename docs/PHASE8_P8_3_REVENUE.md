# Phase 8 P8-3: revenue core, refunds list, load fixture (Wave A)

Design: `docs/PHASE8_REPORTS.md` 4.1-4.2 (Owner answers section 13). Not deployed.

## What changed

- **`revenue.sql.ts`: the one definition of revenue as SQL.** Facts at the grain (day, branch, flow, channel, method, side, kind, line):
  effective payments (SUCCEEDED, no correction) on their branch `business_date`, split over Spa/Beauty by `payment_side_allocations` and over
  lines by recorded net (largest remainder, to the dong); minus `product_refunds` (failed-delivery refunds are among them: the settlement
  row is **not** subtracted again) and exchange differences, by the branch-local day of the instant. Online orders are recognised on the
  delivery day; until then "đã thu, chưa giao". Tips never revenue.
- **`revenue.core.ts` + `GET /api/v1/reports/revenue`** (R1-R4: totals, series with gap-filled buckets, previous period, by branch / side /
  kind / channel / method, paid invoices, lượt đến, online held, unclassified). Every breakdown regroups the same facts and the server
  checks `Σ parts = headline` and the headline against a control total computed without the splitting (`REPORT_TOTALS_DIFFER` otherwise).
- **`refunds.core.ts` + `GET /api/v1/reports/refunds`** (R10: refunds, exchange differences, reversed payments, paged 20, totals, anomalies).
- **Frame:** `SET LOCAL jit = off` and `work_mem = 64MB` (measured below).
- **Migration 121** `20261210000002`: partial indexes `payments(branch_id, business_date) WHERE SUCCEEDED`, `invoices(branch_id, paid_at) WHERE PAID`.
- **Load fixture** `scripts/perf/phase8-fixture.sql` (164,400 invoices, 315k lines, 189k payments, 2k online orders, 1k refunds, 282
  exchanges, 3 branches x 3 years; service-only invoices have no allocation rows, like the real system) and `scripts/perf/phase8-bench.mjs`
  (p50/p95 per case, `explain` option).

## Findings

- **A service-only invoice has no `payment_side_allocations` and no `invoice_line_allocations`** (only invoices with a product line do).
  Production's first invoices are of that kind, so revenue falls back to: no allocation + no product line → Spa, weighted by line gross; a
  product line without allocation → UNCLASSIFIED (never guessed). Covered by the golden test.
- Correction to the design text: a failed-delivery refund is already a `product_refunds` row; the settlement is not a second deduction.
- Performance (p95, over-sized fixture on this machine, JIT off): 1 day 0.26 s (p50 71 ms), 7 days 0.13 s, 30 days + previous 0.49 s, 90 days
  0.58 s, **366 days 1.85 s**, 366 days + previous 3.6 s, refunds list 0.03 s. Targets (800 ms widget, 2 s report, 4 s with comparison) met.
  Before the fixes: 366 days 7.4 s (a correlated NOT EXISTS over a CTE became a 113-million-row nested loop; JIT compiled for 2 s). A
  single-line shortcut was tried and made it no faster, so it was removed.

## Tests (green)

- `revenue.integration.test.ts` (10 tests, the golden dataset): cash sale, split payment, service invoice, Spa+Beauty invoice (side and kind
  hand-computed), refund, exchange difference, reversed payment (excluded, listed), PayOS online order (held, then recognised on delivery),
  parts = total for side/kind/channel/method/branch/series, previous period and bucket totals, scope by branch and permission, validation, the
  list, midnight edges at +07 and in another zone, no-split payment kept visible, **no row changes after running every report**.
- `fresh scratch DB: pnpm test:integration` (database package, 151 + 23): two assertions of Phase 4 updated (financial code list, invoice index list).
  P8-2's CI run failed on exactly the first of these; fixed here.

## Open questions

None for the Owner. (Shipping fee: the setting is off, so the fee line is informational inside product revenue.)
