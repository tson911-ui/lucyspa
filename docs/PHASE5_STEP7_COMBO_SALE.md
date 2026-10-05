# Phase 5 P5-7: Combo sale

Status: built and validated on scratch databases; **APPROVED by the Owner, 2026-10-05 (own words, design 2.5)**; not deployed, loyalty stays OFF. Contract: `PHASE5_LOYALTY_COMBOS_DESIGN.md` sections 9.1-9.3 and 9.6 (as built). P5-6 was approved by the Owner on 2026-10-05.

## What changed

- **Definitions** (`MANAGE_COMBOS`, global: Owner or a manager): new tab "Combo" in "Điểm thưởng". One service (never changes), paid sessions, bonus sessions, price, on/off; every save appends a version; no expiry field. Ships empty.
- **Sale at the counter**: POS header action "Bán combo" (`SELL_COMBOS` + `MANAGE_INVOICES` at the branch): choose a combo, find the member by exact phone/email, start. Creates a DRAFT invoice of kind `COMBO_SALE` (no Visit, OQ-1), one combo line, price fixed, buyer fixed. Then the normal flow: vouchers, finalize with the best offer (member discount and ordinary promotions/vouchers apply to the combo line like its service), cash/PayOS, cancel.
- **Issuance**: only when the invoice is PAID, by the `loyalty` worker (`COMBO_ISSUE` key = invoice line + paid episode): one `combo_purchases` row and one `combo_sessions` row per session (PAID then BONUS). Points are earned once on the amount paid (PRD 17.7: 1,000,000 at Diamond 7% = 930 points).
- **Reversal/cancel before any use**: the paid episode ends, the unused combo is revoked (`voided_at`, who, why; sessions stay as history); paying again issues a new combo. A combo with a session in use is never revoked automatically (audit `COMBO_REVOKE_BLOCKED_IN_USE`; use is P5-8).
- No usage in this step. Phase 4 guards for visit invoices are unchanged (every rule is split by `kind`).

## Owner answers of 2026-10-05 (first collected through the question tool, then APPROVED in the Owner's own words, design 2.5; items 5 and 6 added by the Owner)

1. Combos cannot be sold while go-live is OFF (API refuses, DB refuses). 2. Unused combo is revoked when the payment is reversed or the invoice cancelled. 3. Existing promotions and vouchers apply to a combo. 4. The birthday gift does not apply to a combo sale (engine skips it, DB refuses).

## Migrations (additive)

`20261101000000` (line kind `COMBO_PURCHASE`), `20261101000001` (invoice `kind`, nullable `visit_id` with CHECK, `invoice_line_combos`, guards for invoice/line/integrity by kind, issued combo copies the sold line, revoke rules, birthday refusal). Deploy later: backup, `pnpm db:deploy`, `pnpm db:permissions:sync` (no new codes), restart API/Web/Worker.

## Tests

| Check                                                                                                                                     | Result                           |
| ----------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------- |
| `combo.integration` (definitions, gate, sale, PAID issuance, reversal/revoke/re-pay, stale event, birthday, referral, snapshot, DB rules) | 19 / 19                          |
| `combo.race.integration` (same event on two workers, reversal vs issuance, edit vs finalize)                                              | 3 / 3                            |
| Updated for the new rule: P5-2 foundation and race tests (a combo is issued only from a combo sale), customer invoice keys                | pass                             |
| Database integration list (91 + 11), full API integration entry, web tests, format, lint, typecheck                                       | see final run in the chat report |

Also fixed (test only): `loyalty.race` needed an Owner row that a fresh CI database does not have.

## UX gate

- Rendered at 360, 768, 1440 light and 1440 dark: Combo tab (empty, list, new, edit, error form), POS board with "Bán combo", sale dialog (go-live off, open, member found), combo invoice in every state (draft, pending, paid and issued, paid and issuing, revoked, cancelled).
- Opened: combos-empty, list, edit and error form 1440 light, list 1440 dark, POS dialog (off) 1440 and 360, board 1440, sale dialog with member 360, issued 1440 light and 768 dark, revoked 768, draft 360. The other combinations were not opened one by one (the DOM audit ran on all).
- Fixed after the first look: the combo table was clipped at 768 (service and price columns now hide below lg/xl), a redundant "Không hết hạn." line.
- DOM audit: 0 findings on the board and list pages; only the known FR3 "notice beside cards" on invoice pages. Empty required fields use the browser's own validation (kit contract); custom messages cover the rest. The audit ran on the review database, not on `lucy_spa_uxaudit_20261001`, so the baseline compare was not run.

## Open questions

- Using a session after a payment reversal (a combo with sessions already used) is P5-8 / OQ-9. The consumption guard must also check that the purchase's paid episode is still current.
