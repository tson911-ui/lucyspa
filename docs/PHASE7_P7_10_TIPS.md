# Phase 7 P7-10: customers' tips

Wave B, Step 3. Design: `docs/PHASE7_PAYROLL_FUNDS.md` section 6 (P7-T7; Owner answer 5, 2026-10-11). Not deployed.

## What changed

- **Migration 113** `20261204000000_phase7_tips` (additive, one empty table + enum): `tips`. A tip is a record **separate** from the invoice and its payment (so it is not revenue,
  earns no loyalty points, is outside the commission base, and PayOS amounts still match the invoice). Immutable: the database refuses an edit and a delete; a mistake is a
  **negative row** that reverses one tip in full (same invoice, person, method; once). Only `run_id` (the payroll run that pays it with the payslip, P7-12..14) is set, once;
  a tip with a `run_id` can no longer be reversed. No new permission.
- **Record** `POST /api/v1/pay/tips`: `COLLECT_PAYMENTS` at the invoice's branch; the invoice must be PAID and not older than 7 days; the tip is for a KTV who performed a
  service on it; one live tip per person per invoice; amount positive integer VND; `clientRequestId` replay-safe (a different body with the same id is a conflict). In the **same
  transaction** it writes the book entry `TIP_IN` (cash: the branch cash fund, created with a 0 opening balance if the branch has none yet; transfer: the bank fund) dated on the
  open day. Audited `TIP_RECORDED` (FINANCIAL).
- **Reverse** `POST /api/v1/pay/tips/:id/reverse`: reason required; writes the negative tip and a `CORRECTION` book entry; refuses when the cash would go below 0
  (`CASH_INSUFFICIENT`) or a run has taken the tip (`TIP_CLAIMED`). Audited `TIP_REVERSED`.
- **Read** `GET /api/v1/pay/invoices/:id/tips`: the tips, the KTVs who served, `canRecord` and why not (`blockedBy`).
- Nothing is written before the Owner starts the cash book (`FINANCE_NOT_LIVE`). Nothing is paid out here: tips leave the cash book only with a payslip payment (P7-14).

## Deviations (disclosed)

- The counter screen to record a tip (dialog on the paid invoice) is built with the earnings and My Income screens in P7-11, so the UX gate runs once for all Wave B screens.
- A tip cannot be edited; the 7-day window is a technical decision of mine (design 6.2 gave no number): pending Owner approval.

## Tests

- Integration `pay/tips` (6 tests, 7 cases): go-live gate, record + book entry + invoice untouched, replay/conflict, one per person, bank transfer, permissions/validation/
  not paid/window, reversal + book correction + re-tip, claimed tip, database guards. HTTP `pay/pay.http`, database isolation `phase7-tips-isolation`.

## Open questions

- OQ-P7-10a: is 7 days the right window to record a tip after payment? (Default kept: 7.)
