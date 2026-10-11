# Phase 7 P7-5: daily count, closing and reconciliation

Wave A, Step 4 of 6. Design: `docs/PHASE7_PAYROLL_FUNDS.md` sections 7.4, 7.5 (P7-T9). Not deployed. No migration (the tables and guards are P7-2).

## What changed

- API (`apps/api/src/finance/cash-closing.core.ts`, `cash-reconciliation.core.ts`):
  - `POST /api/v1/cash/funds/:id/closing-preview {date}`: first posts what the fund is still missing, then returns opening float, cash in, cash out, expected cash,
    unposted count, the last closed day, the default next-day float (setting `cash.default_next_float_vnd`, 1,000,000 VND unless changed) and why the day cannot be closed (already closed, future day, unposted).
  - `POST /api/v1/cash/funds/:id/close {date, countedVnd, withdrawalVnd, reason, clientRequestId}`: `MANAGE_CASH` at the branch + a fresh password (spent once).
    A count that differs from the book needs a reason; the difference is its own `COUNT_DIFFERENCE` entry of the day and is never a deduction from pay; the Owner's withdrawal is an
    `OWNER_WITHDRAWAL` entry; what stays is the next-day float and the book equals it exactly (database-checked). The fund row is locked for the whole transaction, so the
    background poster and every manual entry wait. A closed day is locked; late money goes to the first open day. Days close in order; a closed day is never reopened.
  - `GET /api/v1/cash/funds/:id/closings` (20 a page) and `GET /api/v1/cash/reconciliation?branchId&from&to` (sources since go-live against the entries made from them, exact amounts, unposted named; read-only).
  - The overview now carries `differenceAlerts` (closings of the last 30 days whose difference reached the alert threshold, setting `cash.difference_alert_vnd`, 50,000 VND unless changed).
- The poster can post one fund only (`fundId`), so a closing never waits for, or deadlocks with, another branch's closing.

## Deviation / follow-up (disclosed)

- The "Owner-visible alert" of design 7.4 is the alert count and flag on the cash screens (P7-6). A separate in-app notification type needs a database CHECK change and
  registry text; it is deferred (not decided by the Owner) and listed in the Wave A milestone.
- No concurrent-connection race suite for closing vs poster: the lock order (fund row FOR UPDATE by the closing, FOR SHARE by the poster and IN entries, FOR UPDATE by OUT entries and transfers, funds always in id order) and the database guards are the proof; the database refuses an entry on a closed day.

## Tests

- API integration `finance/cash-closing` (8): figures, strict input, passwords, ordering, short and over counts, alert, withdrawal, locked day (database refusal), late sale and manual entry on the next day, replay, history.
  `finance/cash-posting` now also covers the reconciliation (12). HTTP `finance/cash.http` covers every route. Rolled-back fixtures.

## Open questions

None.
