# Phase 5 P5-11: Final check (no deploy)

Status: **Phase 5 is complete and was deployed by the Owner on 2026-10-05 (commit `42841d6`); go-live was switched on by the Owner afterwards (see the handoff).** Contract: `PHASE5_LOYALTY_COMBOS_DESIGN.md` (2.5, 15.2). P5-10b was approved by the Owner in own words on 2026-10-05, with the money value and the frozen-sessions card added to it. Deploy guide for the Owner (plain Vietnamese): `PHASE5_DEPLOY_CHECKLIST.md`.

## What changed

- **"Combo đã bán", Owner only** (`ACTIVATE_LOYALTY` check): per combo, unused prepaid money = invoice total after discount ÷ purchased sessions × purchased sessions left (bonus 0đ). Three cards: unused money of usable combos, and apart the money of frozen and of revoked combos. Everyone who sees the list also gets a "frozen sessions" card. The API sends `valueVnd: null` and `totals.value: null` to everyone else and on the staff profile. No migration.
- **360 px fix** of the P5-3 "Lịch sử điểm" table: the free-text note wrapped, so rows had two heights. The table now uses the kit's `ls-cards-one-line` (one line, ellipsis).
- **CI gap closed:** six Phase 5 integration suites (combo-use, combo-use race, reward, reward race, combo-sold, customer-loyalty) were never in `scripts/test-auth-integration.mjs`, so CI never ran them. Added.
- **Flake fixed (test only):** `discount.integration` `span(24, 24)` read the clock twice; one millisecond apart it was a valid window. One reading now.
- **Docs:** design 2.5 and 15.2, P5-10b report, handoff, `PHASE5_DEPLOY_CHECKLIST.md`.

## Tests (brand-new scratch databases, 61 migrations from zero; never the dev DB)

| Check                                                                                                                | Result                                                                  |
| -------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| `pnpm check` (format, lint, boundaries, typecheck, unit tests, build), twice                                         | pass both times                                                         |
| Unit: database 4, server 39, worker 15 (+1 skip), ui 440, web 516, api 246 (integration skipped w/o flag)            | all pass                                                                |
| `pnpm test:integration` (database suites)                                                                            | 92 / 92 and 11 / 11                                                     |
| `pnpm test:auth:integration` (API entry, now with the six added suites)                                              | 617 pass, 1 skipped (existing), 0 fail                                  |
| Opt-in suites (leave consumer race, invoice notifications race, worker booking jobs)                                 | 1 / 1, 1 / 1, 10 / 10                                                   |
| `pnpm smoke` (web, API, DB, Redis, OpenAPI, BullMQ)                                                                  | passed                                                                  |
| `combo-sold.integration` (new value cases: discount, rounding, bonus 0, apart totals, Owner only)                    | 7 / 7                                                                   |
| End-to-end run on an empty database (`.local/p5-11/e2e.mjs`, real API over HTTP, loyalty worker consumer)            | 69 / 69                                                                 |
| Empty database after migrations: go-live OFF                                                                         | no `loyalty_go_live` row; SQL refuses a wallet; API says OFF            |
| Migrations on a COPY of `lucy_spa_uxaudit_20261001` (20 Phase 4 invoices, 5 migrations pending, incl. P5-7 and P5-8) | applied; 20 invoices, 34 lines, 19 payments, same total, all kind VISIT |
| Old code `58bfabc` on the new schema (rollback test), all its 489 integration tests                                  | 489 / 489 only after deleting the 13 new permission rows (below)        |

End-to-end order: OFF checks (combo sale refused, no points, customer page empty) → go-live ON → paid invoice earns 650 points → Silver 3% member discount → referral (a customer with a paid visit cannot be bound; a brand-new one rewards +10 Spa +10 Beauty once) → birthday gift 10% stacked on the member discount, once per birthday → combo sale (member 4%, no birthday gift, issued only when PAID) → combo use by the owner and a relative → restore → reward grant and use → customer page and privacy → Owner list with money → wallet = ledger sum. My first two runs failed on my own script (visits without an owner had no payer; wrong expected tier); no product defect was found.

CI headroom: the last green runs took 6 to 9 minutes against a 20 minute limit; the six added suites cost about one minute, so the limit stays.

## Finding for the Owner (rollback)

Software-only rollback to `58bfabc` after `db:permissions:sync` breaks: the old Prisma client cannot read the 13 new permission rows (53 failures). Deleting those rows first (nobody holds them; the foreign keys refuse otherwise) makes all 489 old tests pass. Step A2 of the guide does this.

## UX gate (changed screens only: "Combo đã bán", staff profile ledger)

Final build, rendered 360/768/1440 light and 1440 dark (all widths in both themes, VI and EN, all, frozen and revoked filters) on the review scratch database. Opened from that build: list 1440 light, 768 light, 768 dark, 768 EN, 360 light. Fixed along the way: a 4 + 2 card grid at 1440 and a 2 + 1 money row at 768 (frozen and revoked money now share one card: 3 session cards and 2 money cards, no orphan at any width; **my own choice, pending Owner approval**), an EN label wrapping at 768, a profile note that wrapped at 360 (the kit's one-line class; a first hand-made ellipsis overflowed the card and was replaced). DOM audit script: 0 findings on every final capture. The audit did not run on `lucy_spa_uxaudit_20261001` (loyalty pages are not in its baseline).

## Open questions for the Owner

1. (Answered 2026-10-05, design 2.5: approved. Still to confirm: "rounded up" vs the built half up.) The money layout and my money-value readings (design 2.5, "P5-11 built-in choices") need your approval: invoice total as "amount paid", one half-up rounding per combo, expired combos shown on the row but in no total, no money on the staff profile even for you, frozen and revoked money in one shared card.
2. When to deploy; the guide waits for your word. Go-live stays OFF until you switch it on.
