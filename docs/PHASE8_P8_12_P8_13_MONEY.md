# Phase 8 P8-12 and P8-13: cash, tips, payroll and provisional profit APIs (Wave C)

Design: `docs/PHASE8_REPORTS.md` 4.6, 4.7 (Owner answers section 13). Not deployed. API, exports and tests only: no migration, no new permission, no screen (P8-14).

## What changed

- **P8-12** (`money.core.ts`): `GET /reports/cash/daily` (K1: each day of each cash fund: opening float, in, out, expected, counted, difference, reason, withdrawal;
  a closed day shows what its closing stored, an open day the book so far; totals; by kind of entry), `/cash/funds` (K2: balance up to the end of the period,
  movement of the period, last closed day; the shared bank only for a person who holds VIEW_CASH at every branch), `/cash/differences` (K3: closed days that
  differ, shop alert threshold), `/tips` (T1: by person and method, reversals taken off, in a pay run vs still owed), `/payroll/monthly` (P1: pay run per month by kind
  of item, voided items left out, net and tips, status), `/payroll/labour-cost` (P2: net pay plus tips over the month's revenue in basis points, from one pass of
  the revenue facts), `/payroll/advances` (P3: paid and not recovered, and what waits).
  Before the Owner started the books (`finance_go_live`) the reports return `started: false` and no rows.
- **Shop-wide reports:** payroll, labour cost, advances and profit are about the whole shop (one pay run for everybody), so they open only to a person who holds their
  permissions at EVERY active branch. New registry flag `shopWide`; the registry says `available: false` otherwise and the API answers FORBIDDEN.
- **P8-13** (`profit.core.ts`): `GET /reports/profit` (VIEW_PROFIT, shop-wide, Owner only): revenue minus cost of goods (lot cost of the sale and return
  movements) minus tour and commission (pay earnings with reversals) minus salaries (base, collaborator work, bonus, adjustment, deduction of the pay months that lie
  FULLY inside the period; tips, advance recoveries and the cash entries of paying are never counted) minus manual expenses (corrected ones left out).
  Shows the share of units sold that had a cost, the products still missing one, and how many salary months were counted, partial, missing or still draft.
- **Exports:** `cash-daily` (+ sheet by kind), `cash-funds`, `cash-differences`, `tips`, `payroll-monthly`, `labour-cost`, `advances`, `profit` (+ sheet of products
  without a cost, the disclaimer "không phải báo cáo thuế"). Pay and profit files ask for the password (re-auth, as designed).
- **Fix found by the new tests:** a reversed tip is stored as a NEGATIVE amount; the staff report (P8-8) subtracted it a second time. Both now sum the signed amount.

## Tests and performance

- `money.integration.test.ts` (11) and `profit.integration.test.ts` (8): hand-computed days, funds, differences, tips, pay months, labour share, advances,
  profit lines, coverage, partial/missing salary months; not-started states; scope; registry; exports. In the 4th integration process.
- Fixture (3 branches, 365 days of cash, 12 pay runs of 20 people): every report under 60 ms except labour cost 1.4 s and profit 0.17 s (target 2 s).
- Benchmark lesson: stop the audit stack before benchmarking (leftover worker processes made the revenue report look 70% slower).

## Open

- Nothing needs the Owner. A person who has only MANAGE_CASH (not VIEW_CASH) does not get the cash reports; the cash book screen is theirs.
