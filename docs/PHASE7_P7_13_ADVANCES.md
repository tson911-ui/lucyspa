# Phase 7 P7-13: salary advances

Wave B, Step 7. Design: `docs/PHASE7_PAYROLL_FUNDS.md` 4.4, OQ-110, P7-T12. API only (screens come with P7-15). Not deployed.

## What changed

- **Migration 116** `20261207000000_phase7_salary_advances` (additive): table `salary_advances` (empty) and one nullable column `advance_id` on the (empty) payroll item table.
  Statuses `REQUESTED -> APPROVED -> PAID -> RECOVERED | WRITTEN_OFF` (or `CANCELLED` before paying); the database refuses a delete, a change of person/amount/reason, a move backwards,
  a change to a finished stage, and a second open advance for the same person.
- **Rules (OQ-110 as proposed)**: only an official employee with a **confirmed** monthly salary (a salary version, never the profile figure), at most **half** of it, one open advance
  each. Request: `MANAGE_PAYROLL`. Approve and pay: `APPROVE_PAYROLL` (GLOBAL). Cancel (reason): either permission, only before paying.
- **Paying** (`APPROVE_PAYROLL` + **fresh password**, spent once): chooses a fund, refuses when a cash fund does not hold the money, and writes the `ADVANCE` outflow in the same transaction
  (`CASH_INSUFFICIENT`, closed days and the book follow the cash rules). A retry with the same request id changes nothing. Approving pays nothing.
- **Recovery**: the payroll draft (P7-12) suggests an `ADVANCE_RECOVERY` item for every paid advance: what is owed, **never more than the net pay available** (the rest stays owed for the
  next run), so a recovery can never make a payslip negative. Only items of **closed** runs count as taken back; `settleRecoveries` (called at closing in P7-14) turns a fully taken-back
  advance into `RECOVERED`.
- **Write-off** (`APPROVE_PAYROLL` + fresh password + reason): only a paid advance that still owes something; records the amount written off; moves no money.
- API `/api/v1/pay/advances` (list with who is eligible and the limit, request, approve, cancel, pay, write-off); every command audited (`ADVANCE_*`; money ones FINANCIAL).
  `PayService` now takes the environment (for the fresh-password window).

## Deviations (disclosed)

- "Recovery suggested, editable": the amount is not edited in place; to take less, add a manual adjustment with a reason (what is not recovered stays owed). A recovery-override
  field can be added if the Owner prefers.
- Advances paid from the bank fund are booked at a branch the employee works at; the person must have one.

## Tests

- Integration `pay/pay-advances` (7): go-live gate and permissions, eligibility and limit, one open advance, replay, approve/cancel versions, paying (fresh password, empty drawer,
  outflow once, replay, spent confirmation), recovery in the draft (whole debt, shrinking to the net pay, closed run settles it), write-off, database guards. HTTP `pay/pay.http`,
  database isolation `phase7-salary-advances-isolation`.

## Open questions

None.
