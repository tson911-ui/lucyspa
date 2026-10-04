# Phase 5 P5-3: points and tiers

Status: built and validated on a scratch database; **not deployed, loyalty stays OFF**. Contract: `PHASE5_LOYALTY_COMBOS_DESIGN.md` (sections 3-4, 11-14, 2.5).

## What changed

- **Earn:** the `loyalty` outbox consumer (worker, `packages/server/src/loyalty.ts`) handles `INVOICE_PAID`: only when go-live is ON, the episode was paid at/after go-live,
  the invoice is still PAID at that `paid_seq` (stale guard), the payer is a member. Points = `floor(total_vnd / 1000)` once per invoice (OQ-2: nothing excluded).
  Key `SPA_EARN:{invoice}:{paid_seq}`. Every skip is recorded as a consumption outcome (no backlog while OFF).
- **Reverse:** `INVOICE_REOPENED` / `INVOICE_CANCELLED(voidedPaidSeq)` write a linked `EARN_REVERSAL`. `PAYMENT_REVERSED` is not a key (it always comes with REOPENED; reacting to both would double-reverse).
- **Never below 0:** a deduction takes what the balance has; the rest is the entry's `shortfall_points`, flagged (audit `LOYALTY_SHORTFALL_FLAGGED` + outbox fact). Reversals: Owner-locked (P5-Q5). Manual deductions: the same clamp, **provisional until the Owner approves P5-T8**.
- **Manual adjustment:** `POST /api/v1/loyalty/customers/:id/adjustments` (wallet, signed points, reason, client UUID, optional `correctsEntryId`); `ADJUST_LOYALTY_POINTS` (GLOBAL) + fresh re-auth; new ledger entry, audited; replay-safe; one correction per entry.
- **Go-live:** new `ACTIVATE_LOYALTY` (GLOBAL_ONLY, held by the Owner only: SQL refuses it on any role or override; hidden from the role editor), `POST /api/v1/loyalty/go-live` needs fresh password re-auth, once, immutable. No 2FA exists in the repo, so password only.
- **Read API:** exact-phone/email member lookup, profile (both wallets, tier from the locked table v1), ledger (20/page), exceptions list (`VIEW_LOYALTY_EXCEPTIONS`, derived from `shortfall_points > 0`, read-only).
- **Admin UI** (`/workforce/loyalty`, sidebar "Điểm thưởng"): tabs Khách hàng (lookup) / Ngoại lệ / Kích hoạt; customer profile `/loyalty/:userId` with wallet cards, ledger table, adjustment dialog (also a linked correction from the row menu).

## Migrations

`20261028000000_phase5_activate_loyalty_code`, `…01_phase5_activate_loyalty_owner_only`, `…02_phase5_loyalty_consumer_outcomes`. Additive. Deploy (only when asked, after all of Phase 5): backup, `pnpm db:deploy`, `pnpm db:permissions:sync` (53 codes), restart API/Web/Worker.

## Decisions needed / notes

- Read access follows a branch, like the POS member lookup (`VIEW_LOYALTY` at the staff member's branch; the profile uses their first allowed branch). Confirm this is the wanted rule.
- Tier discount % is not shown yet (Member Discount arrives in P5-4). Customer-facing page: P5-10.

## Tests (scratch DB `lucy_spa_p5_3_validation_20261004`; the audit DB `lucy_spa_uxaudit_20261001` was migrated only for the DOM audit, go-live OFF)

| Check                                                                                                                                                                                               | Result   |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| New API suite `loyalty.integration.test` (OFF, go-live, pre-go-live, earn, reversal, out-of-order, cancel, adjustments, shortfall, profile/ledger, worker pass; fixture Owner when the DB has none) | 12 / 12  |
| New API races `loyalty.race.integration.test` (8 concurrent deductions, one key, one correction, two workers on one event; skips on a non-throwaway DB)                                             | 5 / 5    |
| API authorization 4/4, role-admin 4 (+1 skipped), invoice-notifications 12/12, payment 11/11                                                                                                        | pass     |
| Database foundation, Phase 4 foundation, database, notification foundation (incl. Owner-only SQL)                                                                                                   | 42 / 42  |
| Full `pnpm test` (server 39, worker 15 + 1 skipped, ui 440, web 469, api 218 + integration skips)                                                                                                   | all pass |
| `pnpm lint`, `pnpm format:check`, `pnpm typecheck`                                                                                                                                                  | clean    |

## UX gate

- Rendered the new screens at 360, 768 and 1440 light plus 1440 dark. Opened: lookup (1440 and 360 light), go-live (OFF 1440 and 360 light, confirmation dialog 1440 light, 360 light; ON 1440 dark), exceptions (1440 light and dark, 360 light), customer profile (OFF notice 1440 and 360 light; populated 1440, 768, 360 light; shortfall customer 1440 dark), adjustment dialog (1440 light and dark, 360 light). The other width/theme combinations were not opened one by one (the DOM audit ran on all of them).
- Fixed after the first look: the lookup form stretched full width (now one compact row); heading and button both said "Tìm khách" (button is now "Tra cứu"); the go-live heading repeated its button; cancelling the password prompt no longer shows a generic error.
- DOM audit of the new pages: the profile with a Notice shows FR3 `surface-style-mix` (info Notice beside cards) at 360/768; the ledger and exceptions tables show FR8 `row-height-uneven` at 360 (a free-text note wraps in the phone card list). Both are kit patterns already in the baseline. Everything else 0.
- Existing pages after the sidebar and role-editor change (audit DB, light): roles 4 to 0, dashboard 10 to 4, pos 2 to 0, discounts 1 to 0, teams 1 to 0, employees 3, skills 1, account 0. No count rose.
