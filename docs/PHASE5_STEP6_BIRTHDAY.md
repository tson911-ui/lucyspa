# Phase 5 P5-6: Birthday gift

Status: built and validated on scratch databases; **not deployed, loyalty stays OFF**. Contract: `PHASE5_LOYALTY_COMBOS_DESIGN.md` section 8.1 and the Owner decisions of 2026-10-04 in 2.5 (OQ-8 answered).

## What changed

- **Owner-only setup screen** ("Điểm thưởng" > tab "Quà sinh nhật"): ships EMPTY (empty state + "Thiết lập quà sinh nhật"), then a card with the current setup, a drawer form and the version history (DataTable, 20/page). Fields: on/off, type (percentage or fixed money), value, minimum spend, days before / after the birthday, three combine switches (member discount, automatic promotion, voucher), usage limit. Nothing is preset; the usage limit has no preselected option and saving is refused until one is chosen ("1 lần mỗi khách mỗi năm" is listed first as the default).
- **Engine layer** (`birthday.engine.ts`) after the single ordinary winner: base = amount left after the best offer; combinable = added; not combinable = compared, the larger discount wins (replaces the offer only when strictly larger); no offer = alone. Only go-live ON, payer = member with a birthday inside the window (29/2 = 28/2 in non-leap years), guest gets nothing, money gifts only. Drafts preview it; finalization freezes it in the loyalty snapshot; finalized invoices are never recalculated; points = floor(total after the gift / 1000), never multiplied.
- **Invoice display:** a separate "Quà sinh nhật" notice (added on top / chosen instead of the offer / applied alone, or why it was not used: minimum spend, usage limit, the offer is better) and its own row in "Các ưu đãi đã xét".
- **Permission:** `MANAGE_BIRTHDAY_REWARDS` is now Owner only (SQL refuses it on any role or override), like `ACTIVATE_LOYALTY`.

## Migration (additive)

`20261031000000_phase5_birthday_reward`: `birthday_reward_configs` (singleton), `birthday_reward_versions` (append-only, no defaults), `birthday_redemptions` + `birthday_redemption_releases`, snapshot columns `birthday_amount_vnd` / `birthday_base_vnd`, winner `BIRTHDAY`, `lucy_birthday_occurrence`, guards (current active version, window, min spend, amount, usage limit under the configuration row lock), `lucy_check_invoice_discount` = ordinary part + birthday amount, Owner-only trigger. Inserts nothing. Deploy (only when asked, after all of Phase 5): backup, `pnpm db:deploy`, `pnpm db:permissions:sync`, restart API/Web/Worker.

## Choices of mine, pending Owner confirmation (not Owner words)

1. A gift that may not combine is still computed on "the amount left after the best offer", also for the cap of a FIXED gift. Example: 100,000 with a 60% offer (60,000) and a fixed 80,000 gift that may not combine: base 40,000, gift capped at 40,000, the offer wins although 80,000 > 60,000. For a percentage: 500,000, 15% offer, 20% gift: 85,000 beats 75,000, customer pays 415,000, not 400,000. **Question for the Owner: which base when the gift is compared with the offer instead of added?** The code is unchanged until the Owner answers.
2. On an equal amount the offer stays and the yearly use is not consumed.
3. "Per year" = the birthday year of the occurrence (a window across New Year is one birthday, one use); counted across all versions.
4. **P5-T7** (the birthday as a separate layer after the best offer) was never approved as a proposal; the Owner's P5-6 instruction describes it, so please confirm it in your own words. For information: `MANAGE_BIRTHDAY_REWARDS` is Owner only now (instruction "Owner-only config screen"), which changes its P5-T13 entry.
5. Technical bound: days before + after at most 364. Lock order: invoice, discount rows, birthday configuration row, payer row, wallets.

## Tests (scratch DBs `lucy_spa_p5_6_scratch_20261004`, `..._noowner_...`)

| Check                                                                                                                                                                                             | Result        |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------- |
| Engine unit (29/2, New Year window, stacked / replaces / tie, min spend, limits, caps)                                                                                                            | 14 / 14       |
| `birthday.integration` (empty, Owner only, validation, versions, OFF, alone, window, min spend, limit + cancel release, member stacking, frozen invoice, DB guards, SQL = TS twin over 4k+ cases) | 14 / 14       |
| `birthday.race.integration` (two invoices of one payer: exactly one gift; finalize vs cancel; finalize vs Owner save), run twice                                                                  | 4 / 4, twice  |
| Regression: loyalty, referral, invoice, discount, payment, payos, customer-invoice, notifications, authorization, role-admin (Owner-less DB), all races, DB foundation                            | all pass      |
| Web (helpers, invoice layer, tabs) and full `pnpm test`, lint, format, typecheck                                                                                                                  | pass (0 fail) |

## UX gate

- Rendered at 360, 768, 1440 light + 1440 dark (all six runs per page): empty state, new form, validation errors, usage-limit error, configured screen + history, edit form (top and scrolled), and the invoice in every state (alone, stacked, replaces, usage limit, below minimum, draft preview). Theme cookie set per render.
- Images opened: config 1440 light, 768 dark, 360 light (first build); edit form 1440 light and 360 light; new form 768 light; usage error and error-scrolled 1440 light; empty 360 dark; draft 1440 light; below-minimum 768 light; replaces 1440 dark; stacked 1440 light and limit 1440 dark (first build). The other combinations were not opened one by one (the DOM audit ran on all).
- Fixed after the first look: the primary button wrapped under a long card description (intro moved out of the header); day fields at 160 px wrapped their labels (now 280); history columns were clipped (short window / limit texts, "Người lưu" hidden below 1024); table reasons clipped at 768 (short texts, the long ones stay in the notice).
- DOM audit on the baselined pages on `lucy_spa_uxaudit_20261001` (migrated): `pos`, `discounts`, `discount-detail` rose nowhere (all fell to 0). New states show only known findings: FR3 surface-style-mix (drawer over the page card, info notice beside cards) and FR8 row-height-uneven in the candidates table at 360 (218-224 px, as the P5-4 pos-invoice baseline).
- The shots come from the P5-5 derived capture script (it needs a login; `.local/p5-6/capture.mjs`), not from `scripts/uxui-screens.mjs`. The baseline compare used the plain audit capture (theme by the clock, dark at that hour); `pos` and `discount-detail` at 1440 were opened and are the real pages.
- Servers were local scratch ones only and are stopped.

## CI

CI runs `pnpm test:auth:integration`, which now lists `birthday.integration` and `birthday.race.integration`. The result of the pushed commits is in the final message.

## Open questions

The four choices above. Nothing else blocks P5-7.
