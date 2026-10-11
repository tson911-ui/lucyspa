# Phase 7 P7-8: pay configuration (salary versions, tour rules, commission rules)

Wave B, Step 1. Design: `docs/PHASE7_PAYROLL_FUNDS.md` sections 4.1, 4.2, 8 (P7-T1, P7-T2, P7-T5, P7-T6). Not deployed.

## What changed

- **Migration 111** `20261202000000_phase7_pay_rules` (additive; rehearsal 0.045 s): `employee_salary_versions`, `tour_rules`, `commission_rules`, all **empty**
  and **append-only** (the database refuses an edit or a delete; a change is a new row with a later start date). No salary version is created from the old
  `baseSalaryVnd` (the Owner enters the first one; until then the payroll draft will show the profile salary as "not confirmed").
- **Rules**: a tour rule is a fixed amount per service from a date (0 = pays nothing); a commission rule is basis points of the line net (PERCENT, 0..10000) or dong per unit
  (FIXED_PER_UNIT), for the shop, a brand, a category or a product, optionally for one official employee. The most specific rule in force wins
  (`packages/server/src/pay-rules.ts`: employee+product, product, employee+category, category, employee+brand, brand, employee default, shop default; a 0 rule stops the search).
  Percent commission is half-up to 1 dong; a refund takes back its share cumulatively (`proportionalShare`).
- **API** `/api/v1/pay`: `GET tour-rules`, `GET tour-rules/:id/history`, `POST tour-rules`; `GET commission-rules`, `GET commission-rules/products?q`, `POST commission-rules`;
  `GET salaries`, `GET salaries/:id/history`, `POST salaries`. Reading rules: `MANAGE_PAY_RULES`, `MANAGE_PAYROLL` or `APPROVE_PAYROLL`; changing: `MANAGE_PAY_RULES` (all GLOBAL).
  Salaries: `VIEW/MANAGE_EMPLOYEE_PAY` at every branch of the employee, or the payroll permissions to read; a version is dated up to 62 days back and never ahead, needs OFFICIAL
  employment on the date for an amount (a null amount clears), is never your own, and the profile's single number follows the version in force. Rules may start up to 366 days ahead.
  Every change is audited (`EMPLOYEE_PAY`). New error `PAY_VERSION_EXISTS` (a version already starts that day).
- The employee screens' "set base salary" and "create with salary" now also append a salary version (dated today / the start date), so the two can never disagree; a second change on the same day is refused with `PAY_VERSION_EXISTS`.

## Tests

- `packages/server pay-rules.test` (7: order of preference, effective dates, zero rule, rounding, cumulative refund share, tour and salary pick); database isolation `phase7-pay-isolation` (4);
  API integration `pay/pay-config` (7) and HTTP `pay/pay.http`; the employee integration test now also checks the version. `pnpm test:integration` on a fresh database: 151 + 23 pass.

## Open questions

None. (Screens for these rules are P7-11.)
