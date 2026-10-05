# Phase 5 P5-10: Customer membership page + admin gap list

Status: built and validated on scratch databases; **not deployed, loyalty stays OFF**; **APPROVED by the Owner in own words, 2026-10-05** (design 2.5; OQ-11 answered). Contract: `PHASE5_LOYALTY_COMBOS_DESIGN.md` section 15 and 15.1. P5-9 was approved by the Owner in own words on 2026-10-05 (design 2.5; OQ-10 answered, Step 9 doc and handoff updated).

## What changed

- **Customer page** `/{locale}/account/loyalty` (tab "Điểm thưởng" in the member row, entry in the account menu): Spa and Beauty points with tier, points to the next tier and the Member Discount % (Spa card); points history; my combos (paid and bonus sessions left, status); combo usage including relatives; people I referred (masked, waiting or rewarded); my gifts (status, units left, expiry). Mobile cards at 360 px, tables from 768 px, 20 per page.
- **API** `GET /api/v1/me/loyalty` (+ `history`, `combos`, `combo-uses`, `referrals`, `gifts`): read only, session identity, no id accepted, no write verb. Combo usability uses the database's own `lucy_combo_purchase_usable`.
- Privacy: only masked names (relative too); no phone, staff name, staff reason, shortfall, relationship note or other people's invoice code. No notification (P5-Q9).
- No migration, no new permission. `reward.core` now exports its shared usage rule.

## Owner decisions (own words, 2026-10-05; design 2.5)

1. Go-live OFF: the page shows only the notice. 2. Manual adjustments read "Điều chỉnh bởi Lucy Spa". 3. Member discount % on the Spa card only. 4. Birthday gift status on the customer page: deferred. 5. Admin "view as customer" and per-customer birthday status: deferred.

## Tests

| Check                                                                                                                       | Result   |
| --------------------------------------------------------------------------------------------------------------------------- | -------- |
| `customer-loyalty.integration` (OFF, points, referrals, gifts, combos incl. relative and mistaken use, isolation, no leaks) | 6 / 6    |
| `customer-loyalty.http` (read only, no browser-chosen customer) and `.core` (pure rules)                                    | 4 / 4    |
| Web `loyalty.test.tsx`, site-nav and account-menu tests                                                                     | 19 / 19  |
| Typecheck, lint, format, full `pnpm test`, CI                                                                               | see chat |

## UX gate

Rendered 360/768/1440 light and 1440 dark (all widths in both themes) on the P5-8 review scratch database (go-live ON; An with 3 gift states, referrals, a combo used by a relative; Binh with a paused combo; Chi empty; English; go-live OFF). Opened: An 1440 light and dark, An 360 (top, middle, bottom), Binh 768, Chi 360 dark, OFF 360 and 1440. Fixed after the first look: phone cards had uneven heights (now one line per value) and an empty "Hóa đơn" row (column dropped). DOM audit script: 0 findings on every capture; the audit was not run on `lucy_spa_uxaudit_20261001` (it needs go-live ON and customer data), and the baseline holds no member loyalty page. To render the rewarded referral and the expired gift the seed wrote those two facts with `session_replication_role = replica` (scratch only).

## Admin gaps from earlier steps (listed, nothing built)

1. A customer's staff profile shows points, ledger and referral but not their combos (sessions left) or gifts; those are only in the POS combo lookup and the gift desk after a phone search.
2. No list of sold/issued combos with sessions left (only definitions, usage history and frozen combos); revoked combos are listed nowhere.
3. No staff view of "what this customer sees" and no cross-customer points list or report (Phase 8 scope).
4. The birthday gift has a setup tab but no per-customer "used this birthday" status for staff or customer.

The Owner then chose three of the gaps above for P5-10b (`PHASE5_STEP10B_ADMIN_COMBOS_GIFTS.md`).

## Follow-up after the deploy: tier table (Owner instruction, 2026-10-05)

Below the two point cards: a read-only table of the five tiers (tier, points needed, Member Discount) read from `LOYALTY_TIERS_V1` of the contracts package, the customer's own Spa tier marked "Hạng của bạn" (row highlight plus a badge), and one line of rules (1.000đ = 1 điểm, points never expire, a new tier applies from the next payment); VI and EN. No API change, no migration. Tests: `loyalty.test.tsx` 8 / 8 (the rows equal the contract table; both languages).

UX gate: rendered 360/768/1440 light and 1440 dark (all widths in both themes, VI and EN, three customers: Platinum, no tier, no tier). Opened: An 1440 light, An 360 light (twice), Binh 360 dark, An 768 dark, An EN 1440 dark. Fixed after the first look: the tier name touched its badge at 360 (now a `Cluster`). DOM audit script: 0 findings on every capture. Scratch review database only; no server.
