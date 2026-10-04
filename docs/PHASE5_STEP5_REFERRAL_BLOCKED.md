# Phase 5 P5-5: Referral (blocked, questions for the Owner)

Status: **nothing built.** Contract: `PHASE5_LOYALTY_COMBOS_DESIGN.md` section 7 and 2.3. The Owner's P5-5 instruction is recorded in 2.5; it does not answer the items below.
Every "proposed default" is **pending Owner approval**; nothing here is approved until the Owner says so in their own words.

## Done before stopping

- P5-T6 (equal amount: the Member Discount wins, the customer keeps the voucher) and OQ-2 (member discount on all priced services) recorded as Owner-approved; engine, tests, staff-facing reason (`MEMBER_TIE_OVER_PROGRAM`) fixed. Commit `eeea0dd`, pushed.
- Tests: engine 16/16; `loyalty.integration` 13/13; `member-discount.race` 4/4; `discount.integration` 13/13 + `discount.race` 7/7 (scratch DB `lucy_spa_p5_3_validation_20261004`); full `pnpm test` exit 0; lint, typecheck, format clean.

## Questions that block P5-5

| #      | Question                                                                                                                                                                                                                                                       | Proposed default (pending approval)                                                                                   |
| ------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| OQ-4   | A first visit whose invoice is 0đ (promotion, voucher or member discount makes it free) goes to `PAID` with no payment. Does "it is paid" count? If not, that customer is no longer new, so the referral can never be awarded.                                 | No: the award needs a real payment (`settlement = PAYMENT`).                                                          |
| OQ-5   | Which role makes the qualifying visit: the new customer as **service recipient**, as **payer**, or either? If a guest pays for the new customer's first visit, does it count? If the first invoice is cancelled and never paid, the referral is lost for good. | Service recipient (member participant); the payer can be anyone, a guest included; never paid means never awarded.    |
| OQ-6   | A refers B and B refers A before either has a visit (loop); and the referrer's account is deactivated when the award is due.                                                                                                                                   | Only the structural rules (existing member, no self-referral); a deactivated referrer is still credited.              |
| OQ-7   | Because signup must not reveal members, a customer who mistypes the referrer phone as **another real member's** number is bound to that member silently and forever, and nobody can undo it. Accept?                                                           | Accept; staff bind at the counter with a masked confirmation; signup shows nothing either way.                        |
| P5-T10 | Binding window: staff may bind at the counter after the new customer's first visit is completed but until its invoice is first `PAID`. Also a normalized phone column on `visit_participants` (free-text today) and the identical signup response.             | As in design 7.2-7.4.                                                                                                 |
| Scope  | A referrer typed at signup while go-live is OFF: stored and awarded later (if the first paid visit is after go-live), or ignored? Visits before go-live still count against "brand-new" (design 7.4).                                                          | Stored; awarded only if the qualifying paid episode is at or after go-live; earlier visits count against "brand-new". |

## Not touched

No migration, no permission change, no UI. No deploy. P5-6 waits for P5-5 approval.
