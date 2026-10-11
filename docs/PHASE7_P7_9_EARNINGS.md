# Phase 7 P7-9: earnings (tour and product commission)

Wave B, Step 2. Design: `docs/PHASE7_PAYROLL_FUNDS.md` section 5 (P7-T3, P7-T4, P7-T6; OQ-104..OQ-107 approved). Not deployed.

## What changed

- **Migration 112** `20261203000000_phase7_earnings` (additive, both tables empty): `pay_earnings` and `pay_seller_overrides`. An earning is immutable (the database refuses
  an edit, a delete, and a reversal that does not match or exceeds it); only `run_id` (the payroll run that claims it, P7-12) is set once. Each row stores the rule, base and
  result it was calculated with, and a unique `source_key`.
- **Engine** `packages/server/src/compensation.ts` (`reconcileInvoiceEarnings`): state-based and idempotent (reads one invoice, writes only what is missing). Nothing is
  earned before go-live or for an invoice paid before it.
  - **Tour:** a PAID service line earns the tour of its service in force that day for the KTV on the line when they are an OFFICIAL employee that day. A bonus combo session and a
    reward are free and earn nothing; a PAID combo session earns (OQ-104). No rule or a 0 rule: no earning.
  - **Commission:** a PAID product line earns the most specific rule in force on its **net after discounts** (OQ-105) for its seller, or for the person the Owner named after the
    fact; official employees only (OQ-107). Online lines have no seller until P7-10b (referral code).
  - **Reversals:** a payment reversal, cancellation or a new paid episode reverses the earnings of the old episode; a refund or exchange takes back its share of the commission,
    cumulatively and never above the earning; a changed seller reverses the old earning and earns for the new one. Nothing is edited; reversals are negative rows, unclaimed, so a
    closed payroll period is untouched and the change reaches the next draft.
- **Worker** `compensation-jobs.ts`: every 5 s over invoices changed in the last 3 days (an unchanged invoice is not read twice), every 6 h over everything since go-live.
- **API**: `GET /api/v1/pay/invoices/:id/earnings` (`MANAGE_PAYROLL` or `APPROVE_PAYROLL`) and `POST /api/v1/pay/product-lines/:id/seller` (`MANAGE_PAYROLL`, reason, audited
  `PRODUCT_SELLER_CORRECTED`): closes OQ-P6-25 (the invoice line is never rewritten; the override is its own record).

## Deviation (disclosed)

- Design 5.3 allowed a seller correction only while the earning is not in a closed run; instead a correction is always allowed and its rows are simply unclaimed, so they land in the
  next draft. The money outcome is the same and nothing closed is rewritten.
- The bonus-combo and reward exclusions are implemented from the data model (`ComboSessionConsumption.session.kind`, `RewardRedemption`) but are not covered by an integration test
  (building a combo and a reward in the fixture is large); covered by review only.

## Tests

- Integration `pay/pay-earnings` (11): go-live gate, no rule, tour and commission values, idempotency, later rules, non-official, 0 rule, employee rule and fixed per unit, payment
  reversal and re-payment (episodes), cumulative refunds, seller correction both ways, claimed rows, database guards. HTTP `pay/pay.http`, database isolation `phase7-earnings-isolation`.

## Open questions

None.
