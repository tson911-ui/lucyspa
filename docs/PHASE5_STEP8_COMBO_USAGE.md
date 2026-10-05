# Phase 5 P5-8: Combo usage

Status: **APPROVED by the Owner, in the Owner's own words, 2026-10-05** (design 2.5); not deployed, loyalty stays OFF. Contract: `PHASE5_LOYALTY_COMBOS_DESIGN.md` sections 9.4, 9.5 and 9.7 (as built).

## What changed

- **Look up by the owner's phone** (draft visit invoice, `MANAGE_INVOICES` + `CONSUME_COMBO_SESSIONS` at the branch): shows only the combo name, sessions left and the owner's name **masked** ("N••• T••• L•••"); no phone, email or id. Not found and nothing usable look the same.
- **Choose a use** on a service line (row `⋮` "Dùng combo"): owner or relative (+ optional note). The line becomes a **0đ line, quantity 1**. Nothing is consumed yet; "Bỏ dùng combo" clears it.
- **Finalization** takes the lowest free session (PAID first), atomically; recipient and technician come from the line. Cancelling the invoice releases it (append-only). `session_kind` is exposed (`countsAsTour` false for BONUS; no tour logic, that is Phase 7). 0 points, no referral.
- **History** (tab "Lịch sử dùng combo", `RESTORE_COMBO_SESSIONS` or `MANAGE_COMBOS`, global): who, when, technician, owner/relative, status. DB triggers make it append-only. **Restore** = `RESTORE_COMBO_SESSIONS`, fresh password, reason, one offset entry; the use and the invoice stay.
- **Frozen combos** (Exceptions tab): sale reversed after use. Usable only while the sale invoice is PAID in its episode, so the freeze is immediate. Re-pay **reopens the same combo** (`combo_purchase_reopenings`); unused combos are still revoked (P5-7).
- The 0đ line is exempt from the price-range check **only through the immutable marker row**; every other line keeps the range rule.

## Owner decisions (own words, 2026-10-05, locked)

PAID sessions first, BONUS last; reversal after use allowed (used sessions keep history, unused frozen, Owner told through Exceptions); any branch; one session = one 0đ line, quantity 1, exempt from the price range; re-pay reopens the same frozen combo; restoring a session returns only the session (invoice and money untouched, no money-correction step); tour counting for PAID sessions is decided in Phase 7. OQ-9 is answered.

## Migration (additive)

`20261102000000_phase5_combo_usage`: `invoice_line_combo_usages`, `combo_purchase_reopenings`, `lucy_combo_purchase_usable`, guards (consumption tightened, revoke refused while usable), integrity check with the marker. No new permission code. Deploy later: `pnpm db:deploy`, restart API/Worker/Web.

## Tests

| Check                                                                                                                                                | Result          |
| ---------------------------------------------------------------------------------------------------------------------------------------------------- | --------------- |
| `combo-use.integration` (lookup, choose/clear, finalize, PAID-first, any branch, cancel, history, restore, freeze/reopen, 0 points, no benefit base) | 14 / 14         |
| `combo-use.race.integration` (last session x2, sale reversal vs use, restore vs cancel, replayed re-pay event)                                       | 4 / 4           |
| P5-2 foundation (consumption rewritten + new P5-8 DB test), P5-2 races, Phase 4 foundation                                                           | 21, 6, 21       |
| combo (+ voucher and promotion never stack), invoice, payment, discount, loyalty, referral, customer-invoice                                         | all pass        |
| Web unit tests, typecheck, lint, format, full `pnpm test`                                                                                            | see chat report |

## UX gate

Rendered 360/768/1440 light and 1440 dark (all widths in both themes): empty/plain invoice, row menu, use dialog (empty, found, relative), draft with a choice, finalized (mixed), all-free, restored, released, history list, restore dialog, frozen list, history empty. Opened: history 1440 light, invoice 1440 light, row menu 1440, dialog 1440 and 360, restore dialog 1440 dark, frozen list 1440, empty 768. Fixed after the first look: a combo badge made the lines table overflow and wrap (now a separate card), history table clipped at 1440 (fewer columns). Remaining DOM finding: the known FR3 "notice beside cards" on invoice pages. The audit ran on the review database, not `lucy_spa_uxaudit_20261001`: the baseline compare was **not** run.

## Open questions

None. Both earlier questions are closed by the Owner: restoring changes no money (no correction step), and tour for PAID sessions is a Phase 7 decision.
