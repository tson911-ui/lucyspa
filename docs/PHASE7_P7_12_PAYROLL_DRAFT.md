# Phase 7 P7-12: monthly payroll run, draft and preview

Wave B, Step 6. Design: `docs/PHASE7_PAYROLL_FUNDS.md` 4.3 (P7-T3, P7-T11, P7-T14), Owner answers 5 and 10. API only (screens come with P7-15). Not deployed.

## What changed

- **Migration 115** `20261206000000_phase7_payroll_runs` (additive, 3 empty tables): `pay_runs` (one per calendar month, `DRAFT -> CLOSED -> PAID`, never backwards,
  `row_version`, payment day, columns for closing/paying fixed now), `pay_run_lines` (a person in a run), `pay_run_items`. Database guards: a run is never deleted, its month never
  moves, every change bumps the version by one; under a run that is not a draft **nothing** can be inserted, changed or deleted; a manual item is never edited or deleted, only
  voided once with a reason.
- **API** `/api/v1/pay/runs` (read: `MANAGE_PAYROLL` or `APPROVE_PAYROLL`; change: `MANAGE_PAYROLL`; all GLOBAL):
  list, detail (= the preview), create a month, refresh, choose the payment day, add a manual item, void a manual item. Audited (`PAY_RUN_*`, EMPLOYEE_PAY).
- **The draft is built from the sources** (`pay-runs.core.ts`), writing nothing until the button is pressed:
  - base salary of whoever is an OFFICIAL employee on the **last day** of the month, from the salary version in force that day; no version yet = the profile figure flagged
    `UNCONFIRMED_BASE`, no figure at all = 0 flagged `NO_BASE`; "no salary from then" = no item;
  - tour and commission earned and not yet in a run, reversals already taken off, **late items** from earlier months included and shown (`lateVnd`);
  - collaborator work scheduled in the month (agreed amounts summed, unagreed work counted and flagged, never added as 0);
  - tips owed, on their own line, **not in the net**;
  - manual bonus / adjustment / deduction with a reason (a deduction is stored negative; a bonus is positive; an adjustment is signed, never 0), replay-safe by request id.
- **Preview extras**: per-person net and tips, warnings (unconfirmed or missing base, unagreed collaborator work, negative net, no payment day, cash-count differences in the
  month as context only), attendance days and approved leave days as read-only context (nothing is deducted automatically), `stale` when the sources moved since the draft was built.
- **Refresh** (needs the version the person saw) rebuilds only the generated items; manual items and the people they sit on stay.
- Go-live gate: no run before the Owner starts the cash book and payroll, and none for a month before it. Nothing is paid and no fund entry is written.

## Deviations (disclosed)

- Branch cost lines (design 4.3 "cost lines carry the branch") are not stored; the run is shop-wide and a person's items are not split by branch. Raise it if the Owner wants a branch view.
- Suggested advance recoveries arrive with P7-13 (the item kind exists already).
- Claiming the sources (earnings, tips, collaborator work get the run id) and the collaborator-work guard are done at closing, P7-14.

## Tests

- Integration `pay/pay-runs` (7): go-live gate and permissions, create + validation + once per month, every kind of generated item and the warnings, manual items (signs, reasons, replay,
  void), stale/refresh/version, payment day window, closed-run freeze and database guards. HTTP `pay/pay.http`, database isolation `phase7-payroll-runs-isolation`.

## Open questions

None.
