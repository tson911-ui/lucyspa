# Phase 7 P7-10b: staff referral codes for online orders

Wave B, Step 4. Design: `docs/PHASE7_PAYROLL_FUNDS.md` section 14 (P7-T16; Owner answer 3, OQ-106). Not deployed.

## What changed

- **Migration 114** `20261205000000_phase7_referral_codes` (additive, two empty tables, no code written):
  - `employee_referral_codes`: six characters from an alphabet without look-alikes (no 0, 1, I, O), stored upper-case (so case-insensitive), **unique for ever** (a switched-off
    code is never given again), **one active code per person**. A row never changes except that an active code is switched off once (who, when, why). Never deleted.
  - `order_referrals`: the code an online order was placed with (code text, person, code row). Written once while the order is still a draft; **never updated or deleted**, so it is
    frozen long before payment. The existing rule "an online line has no seller" is untouched.
- **Owner API** (`MANAGE_PAY_RULES` to change; read also for the payroll permissions): `GET /api/v1/pay/referral-codes` (official employees and their code, history, order count; people
  with an active code who are no longer official are listed separately and their code no longer works), `POST /pay/referral-codes` (give one person a code), `POST
/pay/referral-codes/:employeeId/reset` (reason; the old code is kept as inactive history). **No code is ever created automatically**; only OFFICIAL employees get one. Audited
  `STAFF_CODE_CREATED` / `STAFF_CODE_RESET` (EMPLOYEE_PAY).
- **Checkout**: `referralCode` (optional) on the quote and on the order request. A code that does not exist, was switched off, belongs to someone no longer official or is malformed
  is refused with ONE answer, `REFERRAL_CODE_INVALID` (no hint which). The quote saves nothing. The checkout page has a "Mã nhân viên giới thiệu (nếu có)" field next to the voucher
  field; a refused code is shown in words and the order goes on without it.
- **Commission**: the earnings engine now takes the person named by the order's code as the seller of an online line (a seller correction still wins). Same base (net after discounts),
  same refund rules, official employees only. An online order without a code earns nothing; nobody is invented.

## Deviations (disclosed)

- The UX gate for the new checkout field (screenshots, DOM audit) is run together with the Wave B staff screens (P7-15), because both need the audit stack. The field reuses the voucher
  field's components and CSS classes unchanged. The staff screen for viewing, giving and resetting codes comes with the rule screens (P7-11).
- Codes are shown to the Owner in full (they are not secrets from the Owner); nothing prints a code in a log or an audit "before/after" other than the audit rows of this feature.

## Tests

- Integration `pay/staff-codes` (6): nothing until the Owner clicks, official only, permissions, reset history, database guards, wrong/switched-off/ex-official code refused, a valid
  code (any case) stored on the order and frozen, the person earns 5% of the online line's net, no code means no earning. Checkout `online.checkout` re-run. HTTP `pay/pay.http`,
  database isolation `phase7-referral-codes-isolation`, web `shop/online`.

## Open questions

None.
