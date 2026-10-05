# Phase 5 P5-10b: Admin gaps (combos sold, customer profile combos and gifts)

Status: built and validated on scratch databases; **not deployed, loyalty stays OFF**; awaits Owner review. Contract: `PHASE5_LOYALTY_COMBOS_DESIGN.md` section 15.2. P5-10 was approved by the Owner in own words on 2026-10-05 (design 2.5; OQ-11 answered, Step 10 report and handoff updated). The Owner chose exactly three of the gaps listed in the Step 10 report.

## What changed

- **"Combo đã bán"** (new tab in Điểm thưởng; `GET /api/v1/combos/sold`): buyer (name, masked phone), combo, sale date, branch, paid and bonus sessions left, status; status filter; 20 per page; totals of purchased and bonus sessions usable now at the top. Read only.
- **Revoked and frozen combos are listed** with their status and the date and cause (payment reversed or invoice cancelled). Used-up and expired ones are listed too; nothing is hidden.
- **Staff customer profile** now shows the customer's combos (same rows, every state) and gifts (status, units left, expiry), 20 per page each, read only.
- Permission: the tab and the endpoint use `RESTORE_COMBO_SESSIONS` or `MANAGE_COMBOS` (global), the rule of the combo usage history, so no new permission. The profile lists use `VIEW_LOYALTY` at the branch, like the rest of the profile (a branch staff member can see the customer's combos and gifts, never a grant reason or a staff name).
- No migration. No money value anywhere.

## Decisions I made (not Owner decisions)

1. Totals count only combos usable now (active); a frozen, revoked, expired or used-up combo adds nothing. 2. "Bị khóa" also covers a combo whose sale was reversed after every session was used. 3. Sale date and branch are shown under the combo name (one cell) so the table fits a tablet. 4. Who reversed or cancelled is not shown.

## Tests

| Check                                                                                                                 | Result   |
| --------------------------------------------------------------------------------------------------------------------- | -------- |
| `combo-sold.integration` (every state, event date and cause, totals, filter, 20 per page, permissions, profile lists) | 6 / 6    |
| `combo-sold.http` (read only, no extra parameters, stable codes)                                                      | 1 / 1    |
| Web `combo-sold.test.tsx`, loyalty tab tests                                                                          | pass     |
| Typecheck, lint, format, full `pnpm test`, CI                                                                         | see chat |

## UX gate

Rendered 360/768/1440 light and 1440 dark (all widths in both themes) on the P5-8 review scratch database: the list (all, frozen filter, revoked filter, English) and the staff profile of three customers. Opened: list 1440 light and dark, 768 light and dark (filtered), 360 (English cards), profiles 1440 light and dark, Chi 360. Fixed after the first look: the table was wider than the content (actions off-screen, clipped names, a card badge over its label); merged sale date and branch under the combo name, three-line status cell, one-line values with a title. DOM audit script: 0 findings on the list in every width, theme and language. The profile pages keep one 360 px finding in the points-history table (row heights, from P5-3, not part of this Step). The audit did not run on `lucy_spa_uxaudit_20261001`; this review database holds the combos. The frozen and revoked combos come from real flows (a payment reversal); only the expiry of the expired one was written with `session_replication_role = replica` (scratch only).

## Open questions for the Owner

1. Should the list show a money value, for example the unused prepaid amount of an active combo (sessions left x price per session)? Not added.
2. Totals count only usable combos. Should they also show the sessions locked in frozen combos?
