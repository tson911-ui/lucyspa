# Phase 8 P8-7, P8-8, P8-9: sales, people and stock report APIs (Wave B)

Design: `docs/PHASE8_REPORTS.md` 4.2-4.5 (Owner answers section 13; OQ-P8-6 changed: customer phone numbers are shown and exported in full). Not deployed.
API, exports and tests only: no migration, no permission, no screen (screens are P8-10).

## What changed

- **P8-7 sales** (`sales.core.ts`): `GET /reports/revenue/{services,products,combos,discounts}` and `GET /reports/online-orders` (20 a page).
  Products group by variant, brand or category; discounts show an "OTHER" row for any discount no program explains, plus campaigns.
- **P8-8 people** (`people.core.ts`): `GET /reports/customers/visits` (lượt đến, people, new vs returning; first visit counted across all branches),
  `/bookings/funnel` (came, cancelled, late, no-show; rates over bookings not cancelled), `/loyalty` (points by kind, members per tier, referrals,
  rewards, birthdays; branch-less points only for a person who reads every branch), `/customers/top` (50 payers, full phone), `/staff`
  (facts only, name order, no ranking; sales columns need `VIEW_REVENUE` and pay columns `VIEW_EMPLOYEE_PAY` at every covered branch, else null).
- **P8-9 stock** (`stock.core.ts`): `GET /reports/stock/{best-sellers,low,slow,expiry,value,movements,receipts}`. Slow = stock and no sale for N days
  (default 60); expiry window default 60; `days` 1..730. Value and cost columns need `VIEW_PRODUCT_COST` (value report forbidden without it; slow
  and receipts hide the cost column). Value shows coverage: units with a cost / units on hand.
- **Exports:** 17 new report ids in `POST /reports/export` (new `days` field); staff report is re-auth (pay data); locale labels VI/EN.
- Contracts: `reports-sales.ts`, `reports-people.ts`, `reports-stock.ts`.

## Tests

- `sales.integration.test.ts` (8), `people.integration.test.ts` (8), `stock.integration.test.ts` (9): hand-computed figures, scope, permission
  matrix, column hiding, exports, fixtures roll back. Run in the 4th integration process (`scripts/test-phase8-integration.mjs`).
- Performance on the 164,400-invoice fixture, 366 days (target 2 s): services 1.87 s, products 1.55 s, combos 1.27 s, staff 1.46 s,
  best sellers 1.31 s, all others under 100 ms. The fixture holds no stock rows, so the stock timings only prove the queries are not wasteful
  (they read the small level/lot tables); the movement-based ones filter on branch + time.

## Open

- Nothing needs the Owner. P8-10 (screens and dashboard widgets) is next and changes what staff see: nav entries are added behind the new permissions only.
