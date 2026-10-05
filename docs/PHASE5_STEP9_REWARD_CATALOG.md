# Phase 5 P5-9: Gift / benefit catalog framework

Status: built and validated on scratch databases; **not deployed, loyalty stays OFF**; **APPROVED by the Owner in own words, 2026-10-05** (design 2.5; OQ-10 answered). Contract: `PHASE5_LOYALTY_COMBOS_DESIGN.md` sections 10 and 10.1. P5-8 was approved by the Owner in own words on 2026-10-05 (design 2.5).

## What changed

- **Catalog tab "Danh mục quà"** (`MANAGE_REWARD_CATALOG`, global): free service (needs a service), voucher quà tặng, quà hiện vật. Ships EMPTY. Names vi/en, active flag, optional expiry in days; edits under a row version and audited; never deleted.
- **Tab "Cấp quà tặng"** (`ISSUE_REWARDS` at a branch): exact-phone masked lookup, then the customer's rewards (20/page): grant (quantity + reason), mark one unit used (optional note), revoke (reason required), history dialog. A manager (`MANAGE_REWARD_CATALOG`) can restore a mistaken use (reason, one offset row).
- Everything needs go-live ON (API `LOYALTY_NOT_LIVE` and the database); catalog definitions may be saved before (like combos). No wallet or ledger row is ever written; there is no exchange of points for rewards.
- Not built (Owner questions below): POS redemption of a free service.

## Migration (additive)

`20261103000000_phase5_reward_catalog`: `reward_manual_uses`, `reward_manual_use_restorations` (append-only, no delete/truncate, go-live gated), `lucy_reward_units_in_use`, the P5-2 redemption guard now counts manual uses too. No new permission code. Deploy later: `pnpm db:deploy`, restart API/Web.

## Tests

| Check                                                                                                                    | Result   |
| ------------------------------------------------------------------------------------------------------------------------ | -------- |
| `reward.integration` (empty catalog, permissions, validation, go-live OFF, grant/use/revoke/restore, history, no points) | 7 / 7    |
| `reward.race.integration` (last unit x2, use vs revoke, use vs restore, restore x2; committed, 2 connections)            | 4 / 4    |
| P5-2 foundation (+ combined redemption and manual-use quantity) and P5-2 races                                           | 21, 6    |
| Web unit tests `reward.test.ts` (+ combo, birthday)                                                                      | 25 / 25  |
| Typecheck, lint, format, full `pnpm test`                                                                                | see chat |

## UX gate

Rendered 360/768/1440 light and 1440 dark (all widths in both themes): catalog empty (go-live OFF and ON), new/free-service/edit drawer, catalog list and row menu, desk (go-live OFF, start, customer without rewards, list, row menu), issue dialog (no items, chosen item), use, revoke, restore, history. Opened: catalog empty 1440, drawer 1440 light and dark, catalog list 1440 and 360, desk 1440, issue dialog (empty and chosen), revoke 1440 dark, restore 768, use 360, row menu 360, history 1440 light and dark and 360. Fixed after the first look: notices inside the issue dialog gave an uneven gap (now field hints); the history table clipped at 1440 and wrapped unevenly at 360 (restorations moved to the facts list, branch merged into the staff column). DOM audit ran on the review database (`lucy_spa_p5_9_review_scratch_20261005`, go-live ON) and compared with `docs/uxui-audit-baseline.json`: no type rises; the baseline holds no loyalty page, so these pages are new. Remaining findings are kit-level: drawer next to a card/notice (surface-style-mix), the kit's menu divider before the destructive item, and a dialog table overlapping the page table behind it. The audit did not run on `lucy_spa_uxaudit_20261001` (it would need go-live ON there).

## Owner decisions (own words, 2026-10-05; design 2.5)

1. A free service is marked used by hand; never a 0đ invoice line.
2. The Owner sets the expiry per catalog item (none or N days).
3. A mistaken "used" is restored by a manager with a reason (`MANAGE_REWARD_CATALOG`, no new permission).
4. `ISSUE_REWARDS` stays as built; after the deploy the Owner grants it to managers only.
5. No "OTHER" kind.
6. The catalog is editable while go-live is OFF; grant, use and revoke need go-live ON.
