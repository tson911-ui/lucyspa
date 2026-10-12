# Phase 8: Reports, Owner dashboard, export, audit-log screen, reviews — design contract (P8-1, design only)

Status: **DESIGN ONLY. No code, no migration. Everything below is a proposal pending the Owner's own words** (CLAUDE.md: only the Owner
approves). Written 2026-10-12 against production `d42ab4e` (118 migrations, 73 permissions; Phase 9 and Phase 7 deployed; the cash book
is **not started**, so `finance_go_live` has 0 rows and no tour, commission, tip or payroll row exists yet).

## 1. Scope, non-goals

PRD §56 Phase 8 lists: Owner dashboard, manager dashboards, revenue reports, employee reports, inventory reports, payroll reports,
Excel/PDF export, notification center, audit-log UI, reviews (§37, placed here by the Owner on 2026-10-07). Plus §36 (reports), and
items other phases explicitly left for Phase 8 (revenue by campaign, "đã thu, chưa giao" for online orders, loyalty reports, costing and
margin, a revenue aggregate that replaces the capped POS-board widget).

| PRD §56 item                                     | In this design                                                                                                   |
| ------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------- |
| Owner + manager dash                             | Yes: one dashboard, widgets by permission and branch scope (section 5)                                           |
| Revenue / employee / inventory / payroll reports | Yes (section 4)                                                                                                  |
| Excel / CSV export                               | Yes (section 6). **PDF: browser print first** (same as invoices and payslips); a server PDF engine only if asked |
| Notification center                              | **Nothing to build.** It is closed and in production (Notification Center track); listed here so it is not lost  |
| Audit-log UI                                     | Yes, a read-only screen on the existing `GET /api/v1/audit-events` (section 4.8)                                 |
| Reviews §37                                      | **Separate, last wave, only if the Owner says yes** (customer-visible; new table; section 4.9)                   |

**Non-goals:** any write to business data by a report; tax or e-invoice output; payroll arithmetic (reports read what Phase 7 stored);
AI; automatic "good/bad" labels on people (PRD §36.4); a public reviews page (PRD §61 leaves the publishing policy undecided);
changing any price, rule, stock or point.

## 2. What data exists (read in the repository)

Read for this document: PRD §36, §37, §39, §53, §56, §61; `schema.prisma` models listed below; `packages/server/src/invoice-notifications.ts`
(the 21:30 revenue summary); the Phase 4/6/7 design docs on revenue, refunds, exchanges, funds; the UX dashboard contract (section 14).

| Domain (report needs)           | Tables and the columns that matter                                                                                                                                                                                                                                                                                                                                                                                               | Day column to group by                                                                                                                                                                                          |
| ------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Bookings, lượt đến, no-show     | `bookings` (status, channel ONLINE/DESK, `checked_in_at`, `cancelled_late`, `no_show_at`), `visits` (origin BOOKING/WALK_IN, status, `arrived_at`, `completed_at`), `visit_participants` (kind MEMBER/GUEST/CHILD, `customer_user_id`, `phone_canonical`)                                                                                                                                                                        | `bookings.service_date`, `visits.service_date` (stored branch-local)                                                                                                                                            |
| Services performed, KTV time    | `visit_service_lines` (service, employee, status), `service_executions` (`started_at`, `ended_at`, end kind), `invoice_line_services` (employee, service, category)                                                                                                                                                                                                                                                              | `visits.service_date`; execution times are instants (see 3.3)                                                                                                                                                   |
| Invoices, payments, refunds     | `invoices` (kind VISIT/COMBO_SALE/PRODUCT_SALE, channel COUNTER/ONLINE, status, totals, `paid_seq`), `invoice_lines`, `invoice_line_allocations` (side SPA/BEAUTY, gross, discount share, **net** per line), `payments` (method CASH/PAYOS, status, `amount_vnd`), `payment_corrections`, `payment_side_allocations` (side, kind PAYMENT/REVERSAL), `product_refunds`, `product_exchanges`, `online_failed_delivery_settlements` | `invoices.business_date`, `payments.business_date` (set by a database trigger from the **branch-local** date of `collected_at`, so it is trustworthy); refunds, exchanges, settlements have **only an instant** |
| Discounts, vouchers, campaigns  | `invoice_discount_applications`, `discount_redemptions` (+ release), `invoice_voucher_entries`, `invoice_line_products` (`promotion_id`, `campaign_id`), `product_campaigns`                                                                                                                                                                                                                                                     | via the invoice                                                                                                                                                                                                 |
| Combos                          | `invoice_line_combos`, `combo_purchases` (sessions, price, void), `combo_session_consumptions`/`releases`/`restorations`                                                                                                                                                                                                                                                                                                         | `combo_purchases.issued_at` (instant); consumption via visit date                                                                                                                                               |
| Loyalty                         | `loyalty_ledger_entries` (wallet SPA/BEAUTY, kind EARN/EARN_REVERSAL/REFERRAL_AWARD/MANUAL_*/REFUND_REVERSAL, points), `referrals`, `reward_*`, `birthday_redemptions`                                                                                                                                                                                                                                                           | `created_at` (instant)                                                                                                                                                                                          |
| Cosmetics sales and stock       | `invoice_line_products` (variant, brand, category, seller), `stock_levels` (on hand, reserved), `inventory_lots` (expiry, `unit_cost_vnd`, nullable), `stock_movements` (kind OPENING/RECEIPT/ADJUSTMENT/SALE/SALE_REVERSAL/REFUND_RETURN/EXCHANGE_RETURN/GIFT_*; reason for adjustments), `inventory_low_stock_alerts`                                                                                                          | `stock_movements.created_at` (instant)                                                                                                                                                                          |
| Online orders                   | `product_orders` (channel), `product_order_lines` (status), `online_order_details`, `online_shipments`, `order_referrals` (staff code)                                                                                                                                                                                                                                                                                           | via the invoice                                                                                                                                                                                                 |
| Supplier imports (stock in)     | `stock_receipts` + lines (supplier, cost, lot), `suppliers`. (The Phase 9 website importer has its own history screen; not a Phase 8 report.)                                                                                                                                                                                                                                                                                    | `stock_receipts.receipt_date`                                                                                                                                                                                   |
| Cash book                       | `finance_go_live`, `cash_funds`, `fund_entries` (direction, category, amount, `business_date`), `cash_day_closings` (expected, counted, difference, reason)                                                                                                                                                                                                                                                                      | `business_date`                                                                                                                                                                                                 |
| Payroll, tour, commission, tips | `pay_earnings` (TOUR/PRODUCT_COMMISSION, reversals), `tips` (reversal rows), `pay_runs` (period month, status DRAFT/CLOSED/PAID), `pay_run_lines/items`, `payslips`, `salary_advances`, `employee_salary_versions`                                                                                                                                                                                                               | `business_date`; payroll by `period_month`                                                                                                                                                                      |
| Staff referral codes            | `employee_referral_codes`, `order_referrals`                                                                                                                                                                                                                                                                                                                                                                                     | via the invoice                                                                                                                                                                                                 |
| Attendance, leave               | `attendance_records` (check in/out), `leave_requests`, `collaborator_work_occurrences`                                                                                                                                                                                                                                                                                                                                           | `business_date`, `start_date`                                                                                                                                                                                   |
| Audit                           | `audit_events` (action, actor, entity, branch, before/after JSON, classification) with six indexes; API `GET /audit-events` exists, **no screen**                                                                                                                                                                                                                                                                                | `occurred_at`                                                                                                                                                                                                   |
| Reviews                         | **Nothing.** No table, no API                                                                                                                                                                                                                                                                                                                                                                                                    | —                                                                                                                                                                                                               |

Already in the product and reused, not rebuilt: the chart kit in `packages/ui` (`KpiCard`, line/bar/donut charts, `DateRangePicker`,
comparison toggle, "show as table" twin, loading/empty/error frame), `DataTable` + `Pagination`, the dashboard widget registry (one
registry entry + one component per widget), `lucy_branch_local_date()`, the re-authentication record (`reauth_uses`), the spreadsheet
**reader** (`packages/server/src/product-import/spreadsheet.ts`, uses `fflate`).

## 3. Gaps and traps the schema creates (each one is solved below)

1. **"Doanh thu" has no agreed definition.** The dashboard widget is deliberately named "Hóa đơn đã thanh toán", not "Doanh thu", "until Phase 8
   defines revenue" (UX decision Q-D5; PRD §61: do not invent). It is also capped at 200 invoices. → section 4.1, question OQ-P8-1.
2. **Refunds, exchanges and failed-delivery settlements have no business date**, only an instant. A hard-coded +07 offset would be wrong the
   day a branch changes timezone. → bucket through the branch timezone in SQL (3.3).
3. **Index gaps for date-range reports:** `payments` has only `payments_invoice_idx` (no branch/date index). `stock_movements` has
   `(branch, variant, created_at)` but a period best-seller scan across variants may not use it. Candidates only; **decided by EXPLAIN on
   a synthetic load fixture in P8-2**, never guessed (section 8, risk R2).
4. **Customers are not always accounts.** Walk-in guests have a name and `phone_canonical` only. "New vs returning" needs an identity rule (OQ-P8-4).
5. **Costs are nullable** (`inventory_lots.unit_cost_vnd`, `product_variants.cost_price_vnd`); Phase 6 deferred the costing method to Phase 8.
   A profit figure on partial cost data would be wrong. → coverage figure, never a guess (4.7).
6. **Before the cash book is started there are no rows** for cash, tips, tour, commission or payroll. A report must say "chưa bắt đầu",
   not show 0 (0 would look like a result). Revenue itself exists from the first invoice and does **not** depend on the book.
7. **No `.xlsx` writer exists** (only a reader). → section 6.
8. **Reviews do not exist** and the PRD leaves public/internal publishing undecided (§37, §61).
9. **Money held for goods not delivered** (online "đã thu, chưa giao") must be separate from revenue-like totals (Phase 6 design, customer liability note).
10. **A report is only as safe as its scope check.** Branch scope, `VIEW_REVENUE` vs `VIEW_EMPLOYEE_PAY` vs `VIEW_PRODUCT_COST` all differ per column; a
    shared "report" permission would leak pay and cost. → permission matrix (section 7).

### 3.3 Day boundaries (applies to every report)

- Filters are **branch business dates** `YYYY-MM-DD`, range closed on both ends, never UTC instants (UX contract 14.4).
- Tables with a stored branch-local date (`invoices`, `payments`, `visits`, `bookings`, `fund_entries`, `tips`, `pay_earnings`,
  `cash_day_closings`) are grouped by it directly (index friendly).
- Tables with only an instant (`product_refunds`, `product_exchanges`, `online_failed_delivery_settlements`, `stock_movements`,
  `loyalty_ledger_entries`, `audit_events`, `service_executions`, `combo_purchases`) are bucketed by `(instant AT TIME ZONE branches.timezone)::date`
  in set-based SQL joined to `branches` (the same rule `lucy_branch_local_date()` implements). No numeric offset anywhere in code. A test
  runs the edges 23:59 / 00:00 / 00:01 at +07 and a branch set to another timezone.
- Week = Monday to Sunday; quarter = calendar quarter; year = calendar year (OQ-P8-9).
- **The 21:30 revenue notification covers 00:00 to 21:30 only** (`REVENUE_SUMMARY_LOCAL_TIME`); a full-day report will legitimately show
  more if payments arrive after 21:30. The report screen says so in an info tooltip (no change to the notification unless the Owner asks, OQ-P8-2).

## 4. Reports

All reports: GET only, branch picker limited to the branches the account may read, date range + comparison to the previous period of
equal length, "show as table" twin for every chart, export button (needs `EXPORT_REPORTS`). Lists above 20 rows are `DataTable` + `Pagination`.

### 4.1 Revenue ("Doanh thu") — definition **proposed**, Owner decides (OQ-P8-1)

**Headline = money actually collected, net of money given back, by the day it happened (proposed default):**

```
net revenue (branch B, day D) =
    Σ payments.amount_vnd   where status = SUCCEEDED, no payment_correction, payments.business_date = D
  − Σ product_refunds.amount_vnd                       (local date of occurred_at)
  − Σ product_exchanges.refund_vnd                     (money paid back when the replacement is cheaper)
  − Σ online_failed_delivery_settlements.refund_vnd    (the carrier fees are a cost, never revenue)
```

This is the same basis as the existing 21:30 summary and the cash book will post (so the two reconcile), and it counts a split payment
(cash + PayOS) correctly. Rules written into the contract so no one has to guess:

- **Tips are never revenue** (Phase 7 decision). `shipping_fee_vnd` is shown as its own line, not inside product revenue.
- **A combo counts when it is sold.** Using a session later is **never** revenue again (shown in a combo usage report); a gift/bonus session is 0.
- **Zero-balance invoices** (voucher or points covering all) count as a lượt đến and an invoice, with 0 VND.
- **An exchange invoice counts only the difference** (Phase 6 P14-11); the credit was revenue of the original sale.
- **Online orders:** money collected is revenue-like only after the order is handed over; before that it is reported as **"đã thu, chưa giao"**
  (a customer liability), never inside the headline (OQ-P8-1 lets the Owner choose otherwise).
- **Split by side (Spa / Cosmetics)** comes from `payment_side_allocations` (kind PAYMENT plus REVERSAL) so the two sides always add up to
  the headline. **Split by kind** (service / combo / product) spreads each effective payment over the invoice's `invoice_line_allocations.net`
  with a largest-remainder rounding so the parts add up to the payment to the dong; a refund reduces the kind of the refunded line.
- **Money out of discounts** is a separate report (4.2), not a deduction (lines are already net of the discount share).
- **Self-check:** for every request the server asserts `Σ parts = headline` and fails loudly (error code, never a wrong silent number).
  After the cash book starts, a reconciliation view compares revenue by day with `SALE_CASH + SALE_BANK − refunds` in `fund_entries`.

The accrual alternative ("when the invoice becomes PAID") is kept as a secondary KPI, **"Hóa đơn đã thanh toán"** (count and invoice total), so what
staff already know on the dashboard does not disappear.

### 4.2 Revenue breakdowns (Wave A first, rest Wave B)

| Id  | Report                         | Content                                                                                                                                    |
| --- | ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------ |
| R1  | Overview                       | Net revenue by day/week/month/quarter/year/custom; previous period; invoice count; average invoice; refunds; "đã thu, chưa giao"; lượt đến |
| R2  | By branch                      | Table + bars for the branches the account may read (Owner: all)                                                                            |
| R3  | By side and kind               | Spa vs Cosmetics; service / combo sale / product; channel counter vs online                                                                |
| R4  | By payment method              | Cash vs PayOS; refunds by cash vs manual transfer                                                                                          |
| R5  | By service                     | Quantity, net, share; by category; top N                                                                                                   |
| R6  | By product                     | Quantity, net, by brand and category; top N                                                                                                |
| R7  | Combos                         | Sold (count, VND), sessions used / remaining / expired, voided                                                                             |
| R8  | Discounts, vouchers, campaigns | Discount given by type (voucher, member discount, birthday, campaign, promotion); **revenue by campaign** (Owner request, Wave 4)          |
| R9  | Online orders                  | Orders by status, collected not delivered, cancelled, failed-delivery settlements, shipping fees, staff-code orders                        |
| R10 | Refunds and corrections        | Product refunds, exchanges, payment reversals, payment anomalies, with reasons                                                             |

### 4.3 Customers and bookings (Wave B)

- **C1 Customers:** new vs returning, lượt đến by day, by origin (booking / walk-in), by channel (online / desk); groups counted as defined in OQ-P8-4.
- **C2 Booking funnel:** bookings, checked in, cancelled, late cancellations, no-shows, by channel and by day.
- **C3 Loyalty:** points issued, reversed, redeemed per wallet; members per tier; referrals bound and rewarded; reward and birthday use; points outstanding.
- **C4 Top customers** (optional, off by default in the menu): by spend and by lượt đến; name + **full phone** (Owner, OQ-P8-6); needs `VIEW_REVENUE` and `VIEW_LOYALTY`.

### 4.4 Staff (Wave B; factual, no ranking, no good/bad label)

Per person and period: lượt làm dịch vụ (service executions ended), customers served, actual minutes (`ended_at − started_at`) next to the
planned minutes, service sales (net of the lines assigned to the person), product sales (as seller), tips, tour, commission, attendance
days/hours, leave days, and (new) orders placed with the person's referral code. Default sort: name. Columns about pay need `VIEW_EMPLOYEE_PAY`;
the rest need `VIEW_STAFF_REPORTS`. A person sees their own figures in the existing My Income screens; no new staff-facing page unless OQ-P8-3 says so.

### 4.5 Cosmetics and stock (Wave B)

Best sellers (quantity and net, by period and branch), low stock (below `low_stock_threshold`, same rule as the existing alert), **slow movers**
(on hand > 0 and no SALE for N days, default 60), expiring lots (default within 60 days), stock on hand and **value at cost with a coverage
figure**, stock movements by kind and reason (internal use, tester, damaged, expired, loss, count correction), stock receipts by supplier
(units, cost where known). Cost columns need `VIEW_PRODUCT_COST`.

### 4.6 Cash, tips, payroll (Wave C; need the books to be started)

- **K1 Daily cash:** opening float, cash in/out by category, expected, counted, difference, reason, closing status; **K2 fund balances**; **K3 differences list**.
- **T1 Tips:** by person/day/method; owed vs paid out (not yet in a run).
- **P1 Payroll by month:** per run: base, tour, commission, bonus, adjustment, deduction, advance recovery, tips, net, status; **P2 labour cost vs revenue**
  (percent in basis points); **P3 advances outstanding**.
- Before the book/payroll start these show an empty state "Chưa bắt đầu sổ quỹ / chưa có kỳ lương", never zeros.

### 4.7 Basic profit view (Wave C, Owner only) — "Lãi tạm tính" (OQ-P8-5)

```
provisional profit = net revenue
                   − product cost of goods sold   (lot cost of the actual SALE movements, returns taken back)
                   − tour − product commission    (pay_earnings, reversals included)
                   − salaries                     (pay run lines of the period month; NOT the SALARY_PAYOUT cash entries, to avoid counting twice)
                   − manual expenses              (cash book MANUAL_EXPENSE, after go-live)
```

Shown line by line, labelled "tạm tính, không phải báo cáo thuế", with **"x% số lượng bán có giá vốn"** and a list of products still without cost;
rent, electricity, tax and other costs are not in the system and are not guessed. Needs the new `VIEW_PROFIT` (GLOBAL_ONLY).

### 4.8 Audit-log screen (Wave C)

Read-only screen over the existing endpoint: filters by date, actor, action, entity, branch; row shows before/after for allowed classifications. The
existing rules stay (EMPLOYEE_PAY events need `VIEW_EMPLOYEE_PAY`, FINANCIAL need `VIEW_REVENUE`). No new data, no new rule. Permission: `VIEW_AUDIT_LOG`.

### 4.9 Reviews (Wave D, **only if the Owner approves; customer-visible**) (OQ-P8-7)

New table `customer_reviews` (additive): one per paid invoice per customer, rating 1-5, optional comment, optional per-KTV rating for the people who served;
created from the customer's own paid-invoice page. **Private by default, never published on the site** (PRD §61). Staff report: average and distribution
per branch and per KTV with the number of ratings (a rating with fewer than 5 ratings is shown as "chưa đủ đánh giá"). Needs the new `VIEW_REVIEWS`.

## 5. Owner dashboard (and manager dashboards: the same screen, narrower scope)

One dashboard page; widgets are registry entries (existing mechanism: order is persisted, unknown ids skipped, each widget is an error boundary).
A branch selector (Owner: "Tất cả chi nhánh" + each; manager: only their branches). KPI cards with delta vs previous period, built from the **same**
SQL module as the reports, so a number is identical everywhere (T4).

| Widget                                      | Permission                                    | Notes                                                                                         |
| ------------------------------------------- | --------------------------------------------- | --------------------------------------------------------------------------------------------- |
| Doanh thu hôm nay / tuần / tháng            | `VIEW_REVENUE`                                | **Replaces** "Hóa đơn đã thanh toán" as the money widget (OQ-P8-2); old KPI kept as secondary |
| Cash vs PayOS today                         | `VIEW_REVENUE`                                | Share of the headline                                                                         |
| Spa vs Cosmetics; services vs products      | `VIEW_REVENUE`                                |                                                                                               |
| Khách hôm nay, đặt lịch, đang làm, hàng chờ | existing booking widgets                      | Already built; only grouped on the new page                                                   |
| Tips, tour, commission today                | `VIEW_EMPLOYEE_PAY`                           | "Chưa bắt đầu" before the book starts                                                         |
| Cảnh báo tồn kho                            | `VIEW_INVENTORY`                              | Low stock + expiring (uses existing alerts)                                                   |
| Đơn nghỉ phép chờ duyệt                     | existing                                      | Already built                                                                                 |
| Hoàn trả / đổi hàng                         | `REFUND_PRODUCTS` or `MANAGE_PRODUCT_RETURNS` | Counts and open cases                                                                         |
| Lệch quỹ, thanh toán bất thường             | `VIEW_CASH` / `VIEW_INVOICES`                 | Differences ≥ threshold (existing setting); payment anomalies                                 |
| Cảnh báo lương                              | `VIEW_EMPLOYEE_PAY`                           | Runs in DRAFT after month end, advances outstanding                                           |
| Online: đã thu chưa giao                    | `VIEW_REVENUE`                                | Customer liability                                                                            |

## 6. Export (Excel / CSV; PDF by printing)

- **Formats:** `.xlsx` and `.csv` from every report with an export button. **PDF = the browser print view** of the report (print stylesheet, same as invoices and payslips);
  a server PDF engine is a separate Owner decision (OQ-P8-6).
- **xlsx writer without a new dependency:** a small streaming SpreadsheetML writer over `fflate` (already used by the reader). A library (`exceljs`) would need the Owner's approval as a new dependency; not proposed.
- **Correctness:** money as numeric cells (integer VND, no formatted strings); dates as real dates (xlsx) or ISO (csv); text always written as strings, never formulas.
  **CSV**: UTF-8 with BOM (Vietnamese opens correctly), comma delimiter, a cell starting with `=`, `+`, `-`, `@`, tab or CR is prefixed with an apostrophe (formula injection).
- **Content:** exactly what the screen shows for the same filters and permission; the server re-checks permission and branch scope at generation. Customer phone numbers are shown and exported in full (Owner decision on OQ-P8-6; no masking).
- **Limits:** streamed, never built in memory (the server has 7.8 GB and no swap); hard cap 100,000 rows per file (above that the screen asks to narrow the range); at most 2 exports at a time per user.
- **The only write a report area makes:** an audit row `REPORT_EXPORTED` (who, report, filters, row count, branch), written after the read-only transaction. Exports containing **pay or profit** also need the
  fresh-password re-entry already used for money actions (`reauth_uses`). Whether _screens_ that show other people's pay write an audit row follows the Phase 7 rule and is confirmed against `pay.service.ts` in P8-2.

## 7. Permissions (proposed; none seeded in P8-1; granted to nobody; no role names)

Count: **73 today + 4 new = 77** at the end; each wave adds only the code it needs (74 after Wave A, 75 after B, 76 after C, 77 after D).

| Code                 | New?             | Scope          | Allows                                                                                                 |
| -------------------- | ---------------- | -------------- | ------------------------------------------------------------------------------------------------------ |
| `VIEW_REVENUE`       | no               | branch         | Revenue reports (R1-R10), dashboard money widgets; "all branches" needs it at GLOBAL scope             |
| `VIEW_BOOKINGS`      | no               | branch         | Booking funnel and lượt đến counts                                                                     |
| `VIEW_LOYALTY`       | no               | branch         | Loyalty reports (C3) and top customers (with `VIEW_REVENUE`)                                           |
| `VIEW_INVENTORY`     | no               | branch         | Stock reports (4.5)                                                                                    |
| `VIEW_PRODUCT_COST`  | no               | branch         | Cost and stock-value columns                                                                           |
| `VIEW_CASH`          | no               | branch         | Cash reports (K1-K3)                                                                                   |
| `VIEW_EMPLOYEE_PAY`  | no               | branch         | Tips, tour, commission, payroll reports and the pay columns of staff reports                           |
| `VIEW_AUDIT_LOG`     | no               | existing       | Audit-log screen                                                                                       |
| `EXPORT_REPORTS`     | **yes (Wave A)** | BRANCH_CAPABLE | Download a file; a report can be seen on screen without it. Never widens what the report may contain   |
| `VIEW_STAFF_REPORTS` | **yes (Wave B)** | BRANCH_CAPABLE | Per-employee factual metrics (counts, minutes, attendance); pay columns still need `VIEW_EMPLOYEE_PAY` |
| `VIEW_PROFIT`        | **yes (Wave C)** | GLOBAL_ONLY    | Provisional profit view and its export                                                                 |
| `VIEW_REVIEWS`       | **yes (Wave D)** | BRANCH_CAPABLE | Review report                                                                                          |

Rule: a report row or column is returned only if the account holds **every** permission that column needs at that branch; otherwise the column is omitted
(never zero-filled). Authorization is permission + branch scope server-side; the web only hides menu items (a 403 shows the same state).

## 8. Technical decisions (all pending Owner approval; bundled with the questionnaire answer)

| Id     | Decision                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P8-T1  | **Read-only is enforced, not promised.** Every report query runs in `SET TRANSACTION READ ONLY` with `statement_timeout` (dashboard 5 s, report 15 s, export 60 s); all routes are GET; a test proves a write inside the report connection fails and a scan test refuses write SQL in the reports module. The only write is the export audit row (section 6).                                                                               |
| P8-T2  | Dates and time zones as in 3.3. One shared date/range helper; no numeric offsets.                                                                                                                                                                                                                                                                                                                                                           |
| P8-T3  | Money stays `BigInt` end to end; JSON carries money as decimal strings; percentages are integer basis points; averages round half up and say so.                                                                                                                                                                                                                                                                                            |
| P8-T4  | **One revenue module** (`revenue.core`) feeds the dashboard, the reports and the exports. Each response carries the headline and its parts; the server asserts they match.                                                                                                                                                                                                                                                                  |
| P8-T5  | **Live SQL aggregation first.** No rollup tables in Wave A. A synthetic fixture on a scratch database (the P6-7 pattern) of about 3 branches x 3 years (~150k invoices, ~450k lines, ~200k visits, ~1M stock movements) with targets: dashboard p95 ≤ 800 ms, any report over 366 days p95 ≤ 2 s, export streams. If missed: an additive index first, then a rebuildable daily rollup maintained by the worker (never the source of truth). |
| P8-T6  | Index migration (additive, in P8-2, only what EXPLAIN on the fixture proves): candidates `payments(branch_id, business_date) WHERE status='SUCCEEDED'`, `service_executions(ended_at)`, a period index on `stock_movements`, `loyalty_ledger_entries(created_at)`.                                                                                                                                                                          |
| P8-T7  | Permissions per section 7; the report registry (code, permissions, parameters) lives in `packages/contracts` so API and web share it; a test fails if a report has no permission or no scope test.                                                                                                                                                                                                                                          |
| P8-T8  | Branch scope is resolved server-side from the account; a `branchId` parameter is only a filter inside that set. "All my branches" = the permitted set.                                                                                                                                                                                                                                                                                      |
| P8-T9  | Export engine as section 6 (streaming xlsx over `fflate`, CSV with BOM and escaping, cap, audit row, re-auth for pay/profit).                                                                                                                                                                                                                                                                                                               |
| P8-T10 | PDF = print stylesheet; no PDF engine.                                                                                                                                                                                                                                                                                                                                                                                                      |
| P8-T11 | Freshness: live data. The page may show the data as of the last load and refresh on demand; no server cache that could show an old number after a correction.                                                                                                                                                                                                                                                                               |
| P8-T12 | Privacy (**changed by the Owner's answer to OQ-P8-6**): customer lists and exports show the name and the **full phone number**, no masking; they are reachable only with the report's permissions (`VIEW_REVENUE` + `VIEW_LOYALTY` for customer lists) and `EXPORT_REPORTS` for files.                                                                                                                                                      |
| P8-T13 | UI: routes under `/workforce/reports/*` and a dashboard page; staff direction C, `Page` + `PageHeader` (one primary action: Xuất file), `DataTable`, existing chart kit, URL-state filters, all states (loading, empty, error, partial, long text, many rows), 360/768/1440 light + 130% text + dark.                                                                                                                                       |
| P8-T14 | Tests: a **golden dataset** built through the real services (cash, PayOS, split payment, voucher, member discount, combo sale and use, exchange, product refund, payment reversal, online order, tip) with hand-computed expected figures; invariants (parts = total); time zone edges; permission matrix; export content (BOM, escaping, full phone); the performance fixture runs as a separate command, not inside `pnpm test`.          |
| P8-T15 | Audit-log screen adds no endpoint rule; reviews (if approved) are append-only and never edited by staff.                                                                                                                                                                                                                                                                                                                                    |

## 9. Build steps and deployable waves

Each Step: Owner review, targeted tests, report ≤ 40 lines; each UI Step carries the UX gate and the DOM audit. Each wave is deployed only on the Owner's word, with
the database backup first, a rollback proof and an Owner test script (as for Phases 6 and 7). Migrations are additive (permission rows + indexes; Wave D adds one table).

**Wave A: revenue and the Owner dashboard (useful alone)**

| Step | Content                                                                                                                                                                         |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P8-2 | Foundation: read-only runner, scope resolver, date helper, report registry in contracts, `EXPORT_REPORTS` (73 → 74), performance fixture and the EXPLAIN-proven index migration |
| P8-3 | Revenue core and R1-R4, R10 API; golden dataset tests; parts = total; time zone edges                                                                                           |
| P8-4 | Export engine (xlsx + CSV, escaping, audit row, re-auth hook, caps) wired to R1-R4, R10                                                                                         |
| P8-5 | Revenue screens and the Owner/manager dashboard widgets; "Doanh thu" replaces the capped paid-invoices money widget; UX gate                                                    |
| P8-6 | **Wave A milestone:** regression, p95 measurement on the fixture, deploy guide, rollback proof, Owner test script                                                               |

**Wave B: sales detail, customers, staff, stock**

| Step  | Content                                                                                                                          |
| ----- | -------------------------------------------------------------------------------------------------------------------------------- |
| P8-7  | R5-R9 API (service, product, combo, discount/campaign, online) + exports                                                         |
| P8-8  | Customers, booking funnel, loyalty (C1-C4) and staff reports API, `VIEW_STAFF_REPORTS` (74 → 75) + exports                       |
| P8-9  | Stock reports API (best sellers, low stock, slow movers, expiry, value with coverage, movements, receipts by supplier) + exports |
| P8-10 | Wave B screens and dashboard widgets (stock, refunds, online); UX gate                                                           |
| P8-11 | **Wave B milestone**                                                                                                             |

**Wave C: money screens, profit, audit log**

| Step  | Content                                                                                            |
| ----- | -------------------------------------------------------------------------------------------------- |
| P8-12 | Cash, tips, payroll summaries (K1-K3, T1, P1-P3) API + exports with re-auth; "chưa bắt đầu" states |
| P8-13 | Provisional profit API + `VIEW_PROFIT` (75 → 76) + export                                          |
| P8-14 | Cash/payroll/profit screens, dashboard money-alert widgets, audit-log screen; UX gate              |
| P8-15 | **Wave C milestone**                                                                               |

**Wave D: reviews (only after the Owner's yes on OQ-P8-7)**

| Step  | Content                                                                                                                                              |
| ----- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| P8-16 | `customer_reviews` migration, `VIEW_REVIEWS` (76 → 77), customer API, report API                                                                     |
| P8-17 | Customer prompt on the paid-invoice page (customer-visible: before/after screenshots for the Owner) and the staff review report; UX gate             |
| P8-18 | **Phase 8 milestone:** full regression (`pnpm check`, integration, smoke), performance run, deploy guide, rollback proof, Owner test script, handoff |

## 10. Risks

| Id  | Risk                                                                          | Mitigation                                                                                                                                                                                                                                                 |
| --- | ----------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| R1  | The Owner and the screen disagree about what "doanh thu" means                | OQ-P8-1 first; the definition is printed in the report's info tooltip and in every export header; the old KPI stays as a secondary figure                                                                                                                  |
| R2  | Slow reports once real volume arrives (production has about 2 invoices today) | Fixture with measured p95 targets before Wave A is deployed; EXPLAIN-proven indexes; statement timeouts; rollups only if measured necessary                                                                                                                |
| R3  | A number differs between dashboard, report and export                         | One revenue module; parts = total assertion; a test compares the three                                                                                                                                                                                     |
| R4  | A report leaks pay, cost or customer data                                     | Column-level permissions (section 7); phones are shown in full by the Owner's decision, so the permission gate and the export audit row carry the protection; `EXPORT_REPORTS` separate; re-auth for pay/profit exports; audit row; permission matrix test |
| R5  | A report quietly writes or locks data                                         | Read-only transaction, GET only, scan test, statement timeout, no advisory locks                                                                                                                                                                           |
| R6  | Exports exhaust memory or are used to scrape                                  | Streaming, 100,000-row cap, 2 at a time per user, audit row                                                                                                                                                                                                |
| R7  | Excel misreads the file (encoding, formulas, locale separator)                | `.xlsx` is the main route; CSV has BOM and escaping; money numeric; opened in Excel and LibreOffice during the Owner test script                                                                                                                           |
| R8  | Profit view misleads (missing costs, missing rent/tax)                        | Coverage figure, "tạm tính" label, Owner-only, lines shown separately, no guessing                                                                                                                                                                         |
| R9  | Staff feel ranked or watched                                                  | Factual metrics only, no ranking, no good/bad label (PRD §36.4); staff see only their own figures unless the Owner decides otherwise (OQ-P8-3)                                                                                                             |
| R10 | Reports before the books start show misleading zeros                          | Explicit "chưa bắt đầu" states; revenue does not depend on the book                                                                                                                                                                                        |
| R11 | Reviews: pressure on staff, fake or abusive reviews, accidental publication   | Wave D is optional and last; private only; one per paid invoice per own customer; no public output in Phase 8                                                                                                                                              |
| R12 | Scope creep (tax, e-invoice, AI summaries, server PDF)                        | Non-goals in section 1; PRD §61                                                                                                                                                                                                                            |

## 11. Owner questionnaire (Vietnamese, plain language; each has a recommended default; answer "ok" to accept all)

Trả lời **"ok"** để đồng ý với mọi mục "Tôi khuyên", hoặc ghi "khác: …" cho mục nào muốn đổi. Đây chỉ là cách hiểu của tôi, **chưa được duyệt**; chỉ lời của Chủ mới là
duyệt, và không dòng code nào được viết trước đó. Mục có dấu **[ĐỔI VIỆC HÀNG NGÀY]** là mục làm thay đổi những gì nhân viên hoặc khách nhìn thấy hay phải làm, nên Chủ cần quyết trước khi xây.

| #        | Câu hỏi                                                                                                                                                   | Tôi khuyên (mặc định)                                                                                                                                                                                                                                                                                                                                                                                                                                 | Chặn bước |
| -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------- |
| OQ-P8-1  | **"Doanh thu" là gì?** (Chưa từng được định nghĩa; hiện màn hình chỉ ghi "Hóa đơn đã thanh toán".) **[ĐỔI VIỆC HÀNG NGÀY: con số quản lý nhìn mỗi sáng]** | Doanh thu = **tiền đã thu thực tế (tiền mặt + PayOS) trừ tiền đã hoàn lại cho khách**, tính theo ngày tiền về. **Không** tính tip. Phí giao hàng hiển thị riêng. Gói combo tính **lúc bán**, dùng buổi sau đó **không** tính lại. Đơn online đã thu nhưng **chưa giao** hiện ở dòng riêng "đã thu, chưa giao", chưa gộp vào doanh thu.                                                                                                                | P8-3      |
| OQ-P8-2  | **Màn hình tổng quan** thay đổi thế nào? **[ĐỔI VIỆC HÀNG NGÀY: quản lý/Chủ thấy màn hình khác]**                                                         | Ô tiền "Hóa đơn đã thanh toán" được **thay bằng "Doanh thu"** (số theo OQ-P8-1), vẫn giữ số hóa đơn đã thanh toán làm số phụ. Bỏ giới hạn 200 hóa đơn. Tin nhắn tổng kết **21:30 giữ nguyên** (chỉ tính đến 21:30); báo cáo cả ngày có thể lớn hơn và có ghi chú giải thích. Nhân viên quầy/KTV **không** thấy tổng quan này.                                                                                                                         | P8-5      |
| OQ-P8-3  | **Ai được xem gì?** (chi nhánh, số liệu nhân viên) **[ĐỔI VIỆC HÀNG NGÀY: nhân viên biết số liệu của mình có người xem]**                                 | Chủ xem **mọi chi nhánh**; quản lý chỉ chi nhánh được giao. Số liệu từng người (số lượt làm dịch vụ, phút làm thực tế, doanh số, tip, tour, hoa hồng, chấm công) chỉ người có quyền mới xem; **không có bảng xếp hạng, không gắn nhãn tốt/xấu**. Mỗi nhân viên chỉ xem số của **chính mình** (đã có ở "Thu nhập của tôi"); **không thêm màn hình mới cho nhân viên**.                                                                                 | P8-8      |
| OQ-P8-4  | **Khách mới / khách quay lại** và **lượt đến** đếm thế nào?                                                                                               | **Khách quay lại** = người đã có ít nhất một lượt đến hoàn thành **trước** kỳ đang xem (nhận diện theo tài khoản; khách vãng lai theo số điện thoại). **Lượt đến** = mỗi lần khách (hoặc cả nhóm đi cùng) đến và hoàn thành; số **khách** đếm riêng theo đầu người. Khách vãng lai không có số điện thoại chỉ tính vào "khách không xác định".                                                                                                        | P8-8      |
| OQ-P8-5  | Có muốn xem **lãi tạm tính**? Tính thế nào?                                                                                                               | **Có, chỉ Chủ xem** (quyền riêng). Lãi tạm tính = doanh thu − giá vốn hàng bán (theo giá nhập của đúng lô đã bán) − tour − hoa hồng − lương (theo kỳ lương) − chi phí nhập tay trong sổ quỹ. Ghi rõ **"tạm tính, không phải báo cáo thuế"**, không có tiền thuê/điện/thuế. Sản phẩm **chưa có giá vốn** được liệt kê và báo "x% có giá vốn", không đoán. **[ĐỔI VIỆC HÀNG NGÀY: nên nhập giá nhập khi nhập kho (hiện là tùy chọn) để lãi chính xác]** | P8-13     |
| OQ-P8-6  | **Xuất file**: định dạng và cách bảo mật? **[ĐỔI VIỆC HÀNG NGÀY: quản lý phải nhập lại mật khẩu khi xuất lương/lãi]**                                     | **Excel (.xlsx) và CSV** cho mọi báo cáo; **PDF = nút In của trình duyệt** (như hóa đơn, phiếu lương), chưa làm công cụ PDF riêng. Quyền **"Xuất báo cáo"** tách khỏi quyền xem. Số điện thoại khách **che bớt** trong file. Xuất lương/lãi **phải nhập lại mật khẩu**. Mỗi lần xuất ghi vào nhật ký. Mỗi file tối đa 100.000 dòng.                                                                                                                   | P8-4      |
| OQ-P8-7  | **Đánh giá của khách** sau khi thanh toán (PRD §37): có làm không? **[ĐỔI VIỆC HÀNG NGÀY: KHÁCH sẽ thấy ô đánh giá trên trang hóa đơn của họ]**           | **Làm ở cuối cùng, và chỉ khi Chủ đồng ý.** Khách có tài khoản chấm **1–5 sao** + ghi chú (tùy chọn) cho mỗi hóa đơn đã thanh toán, có thể chấm riêng từng KTV; **bỏ qua được**. **Đánh giá chỉ để nội bộ, không đăng công khai** (chưa quyết chính sách đăng). Quản lý xem trung bình và phân bố; KTV **chưa** xem được của mình cho đến khi Chủ quyết.                                                                                              | P8-16     |
| OQ-P8-8  | **Màn hình nhật ký hoạt động** (ai đã làm gì, khi nào)?                                                                                                   | Làm màn **chỉ xem** trên dữ liệu đã có, cho người có quyền "Xem nhật ký". Giữ nguyên quy tắc hiện tại: nhật ký về **lương** chỉ người có quyền xem lương, về **tiền** chỉ người có quyền xem doanh thu. Không thêm hay xóa dữ liệu.                                                                                                                                                                                                                   | P8-14     |
| OQ-P8-9  | Các **ngưỡng và quy ước nhỏ**?                                                                                                                            | Tuần từ **Thứ Hai đến Chủ Nhật**; quý theo lịch; so sánh với kỳ trước cùng độ dài; **hàng bán chậm** = còn tồn nhưng 60 ngày không bán được; **sắp hết hạn** = trong 60 ngày; hàng bán chạy xếp theo số lượng và theo doanh thu; khoảng thời gian tối đa 366 ngày mỗi lần xem.                                                                                                                                                                        | P8-7..9   |
| OQ-P8-10 | **Thứ tự làm và đưa lên máy chủ thật**?                                                                                                                   | Làm theo 4 đợt: **A** doanh thu + tổng quan, **B** chi tiết bán hàng/khách/nhân viên/kho, **C** quỹ/lương/lãi/nhật ký, **D** đánh giá (nếu đồng ý). Mỗi đợt chỉ lên máy chủ thật khi **Chủ nói**, sao lưu trước, có bản thử cho Chủ. Báo cáo quỹ/lương hiện **"Chưa bắt đầu"** cho đến khi Chủ bấm bắt đầu sổ quỹ. Báo cáo **chỉ đọc**, không thay đổi dữ liệu nào.                                                                                   | P8-2      |

**Tóm tắt những gì thay đổi việc hàng ngày (để Chủ quyết trước khi viết code):**

1. Quản lý/Chủ: ô tiền trên màn hình tổng quan đổi tên và đổi cách tính (OQ-P8-1, OQ-P8-2). Thu ngân và KTV: **không đổi gì**.
2. Nhân viên: số liệu của họ được người có quyền xem, nhưng không xếp hạng (OQ-P8-3). Không thêm màn hình mới cho nhân viên.
3. Thu ngân/quản lý kho: nên nhập **giá nhập** khi nhập kho nếu muốn xem lãi (OQ-P8-5). Hiện là tùy chọn; hệ thống không bắt buộc.
4. Quản lý: xuất file lương/lãi phải nhập lại mật khẩu; mọi lần xuất đều ghi nhật ký (OQ-P8-6).
5. **Khách hàng:** chỉ khi Chủ đồng ý OQ-P8-7 mới có ô đánh giá sau thanh toán. Nếu không đồng ý, khách không thấy thay đổi nào ở Phase 8.

Các quyết định kỹ thuật `P8-T1…T15` và 4 quyền mới (73 → 77, cấp cho **không ai** lúc đầu) được gộp vào cùng một lần duyệt, không hỏi riêng; việc cấp quyền cho vai trò do Chủ làm trong màn hình vai trò.

## 12. Verification of this document

Read in the repository for this design: `CLAUDE.md`; `LUCYSPA_HANDOFF.md` (phase status, production line `d42ab4e`, Phase 7 lines, the final roadmap); PRD §36, §37, §39, §53, §56, §61;
`schema.prisma` models `Invoice`, `InvoiceLine`, `InvoiceLineAllocation`, `InvoiceLineService`, `InvoiceLineProduct`, `InvoiceLineCombo`, `Payment`, `PaymentSideAllocation`,
`PaymentCorrection`, `ProductRefund`, `ProductExchange`, `OnlineFailedDeliverySettlement`, `ProductOrder`, `Visit`, `VisitParticipant`, `VisitServiceLine`, `ServiceExecution`, `Booking`, `StockMovement`,
`StockLevel`, `InventoryLot`, `StockReceipt`, `FundEntry`, `CashDayClosing`, `PayEarning`, `Tip`, `PayRun`, `PayRunItem`, `Payslip`, `LoyaltyLedgerEntry`, `Referral`, `EmployeeReferralCode`,
`OrderReferral`, `AttendanceRecord`, `LeaveRequest`, `AuditEvent`; the `PermissionCodeName` list (73); the migrations that set `business_date` from the branch-local date
(`lucy_branch_local_date`); `packages/server/src/invoice-notifications.ts` (`revenueFigures`); `apps/api/src/authorization/audit-read.service.ts` and the existing `GET audit-events`;
`packages/server/src/product-import/spreadsheet.ts` (reader only); the UX dashboard contract (sections 14.3-14.4) and decision Q-D5; Phase 4/6/7 design notes that defer reports to Phase 8.

**Not verified and therefore decided in P8-2, not assumed here:** whether `product_exchanges.refund_vnd` and `product_refunds` can ever describe the same money (a test in P8-3 must show revenue
equals net money movement); which indexes the fixture proves necessary; whether Phase 7 audits staff reads of other people's pay; the exact refund/exchange event names. Nothing in this file has been run
against production data (production holds about 2 invoices, 9 users and 348 products, so volume cannot be measured there).

## 13. Owner answers (2026-10-12) and what they change

Recorded as given (the Owner's message, Vietnamese questionnaire answered in English). **Approved.**

> OQ-P8-1, 2, 3, 4, 5, 7, 8, 9: OK as proposed (OQ-P8-7 = YES, build reviews in Wave D).
> OQ-P8-6: OK, EXCEPT customer phone numbers are NOT masked — show and export the full phone number. Everything else stays: xlsx + CSV, PDF via print, separate EXPORT_REPORTS permission, re-auth for pay/profit exports, audit row per export, 100,000-row cap.
> OQ-P8-10: OK on the four waves, but build A → B → C → D in one unattended run and produce ONE combined deploy at the end (like Phase 7), not four separate deploys.
> Technical decisions P8-T1..T15 and the 4 new permissions (73 → 77, granted to nobody): approved as written, with P8-T12 changed to match OQ-P8-6 (no phone masking).

Tiếng Việt (bản ghi): OQ-P8-1, 2, 3, 4, 5, 7, 8, 9 đồng ý như đề xuất (OQ-P8-7 = CÓ, làm đánh giá ở Đợt D). OQ-P8-6 đồng ý, **trừ** việc che số điện thoại: **hiển thị và xuất đầy đủ số điện thoại khách**;
giữ nguyên xlsx + CSV, PDF bằng nút In, quyền "Xuất báo cáo" riêng, nhập lại mật khẩu khi xuất lương/lãi, ghi nhật ký mỗi lần xuất, tối đa 100.000 dòng. OQ-P8-10 đồng ý 4 đợt, nhưng làm liền A → B → C → D
rồi **gộp thành MỘT lần đưa lên máy chủ** ở cuối (như Phase 7). Các quyết định kỹ thuật P8-T1…T15 và 4 quyền mới (73 → 77, không cấp cho ai) đã duyệt, P8-T12 sửa theo OQ-P8-6 (không che số điện thoại).

Consequences written into this contract: (1) phones in customer lists and exports are full (sections 4.3, 6, P8-T9, P8-T12, R4 edited above); (2) section 9 "each wave is deployed only on the Owner's word" is
**replaced**: one combined deploy of Waves A-D at the end, one guide, one rollback proof, one Owner test script; (3) Wave D (reviews) is approved and is part of that deploy; (4) the Owner's standing rule stays:
anything that changes what staff or customers see or do day to day is raised to him **before** it is built (this includes the review prompt layout, P8-17, with before/after screenshots).
