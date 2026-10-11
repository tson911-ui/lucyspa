# Phase 7 P7-14: closing a payroll run, payslips, marking paid, reversal

Wave B, Step 8. Design: `docs/PHASE7_PAYROLL_FUNDS.md` 4.3 (P7-T3, P7-T10, P7-T12). API only (screens come with P7-15). Not deployed.

## What changed

- **Migration 117** `20261208000000_phase7_payroll_close` (additive): table `payslips` (empty); foreign keys from `pay_earnings.run_id` and `tips.run_id` to `pay_runs` (both always NULL until a run
  is closed); nullable `pay_run_id` on collaborator work. Guards: a payslip is made only for a closed run, keeps its printed totals, moves `PENDING -> PAID -> REVERSED`, never deleted;
  work a closed run paid cannot change its pay, date, mode or status (a correction is an adjustment in the next run).
- **Close** `POST /api/v1/pay/runs/:id/close` (`APPROVE_PAYROLL` + **fresh password**, the version the person saw). Refused while: the draft is behind its sources (`PAY_RUN_STALE`), there is no
  payment day, a person's base salary is unconfirmed or missing, a net is negative, or there are no people (`PAY_RUN_BLOCKED` names which). It freezes the run, takes the unclaimed
  earnings and tips up to the end of the month and the **agreed** collaborator work (unagreed work stays open so it can still be agreed), proves in the same transaction that what it took is
  exactly what the preview showed, makes one payslip per person (net pay and tips are separate totals, net never negative), and settles advances that are fully recovered. **Nobody is paid.**
- **Pay** `POST /api/v1/pay/runs/:id/pay` (`APPROVE_PAYROLL` + fresh password; not before the payment day): pays all pending payslips or a chosen few from one fund (a cash fund must hold
  the whole amount); net pay is a `SALARY_PAYOUT` entry and tips a separate `TIP_OUT` entry per person; a retry changes nothing; when no payslip is pending the run becomes `PAID`.
- **Reverse** `POST /api/v1/pay/payslips/:id/reverse` (same authority and password, reason): the book gets correcting entries and the payslip says `REVERSED`; the run is never reopened and the
  person is owed again (corrected by an adjustment in the next run).
- **Read**: `GET /pay/runs/:id/payslips`, `GET /pay/payslips/:id` (payroll permissions) and **`GET /api/v1/me/payslips[/:id]`** for an employee's own payslips with no permission (somebody else's
  payslip is "not found").
- The draft now counts collaborator work not yet in a closed run up to the end of the month (earlier work agreed late appears as a late item); the count is of agreed occurrences.
- `pay_earnings.run_id` and `tips.run_id` now have foreign keys: the P7-9 and P7-10 integration tests use a real run row.

## Deviations (disclosed)

- Closing is blocked (not just warned) by an unconfirmed or missing base salary and by a negative net: the safer option under the Owner's "nothing pays or changes an amount without his click".
- A payslip whose net and tips are both 0 is marked paid with no book entry when it is included in a payment.
- Paying is allowed from the payment day onwards, never before it.

## Tests

- Integration `pay/pay-close` (6): refusals (permission, version, payment day, base, stale, negative net, nothing left behind), close takes the sources and makes payslips, database freezes, payslips read by
  managers and by their owner only, paying (payment day, password, funds, two entries, retry, spent password, run becomes paid), reversal. Isolation `phase7-payroll-close-isolation`, HTTP `pay/pay.http`.

## Open questions

None.
