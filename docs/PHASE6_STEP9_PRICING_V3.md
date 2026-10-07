# Phase 6 P6-9: pricing engine v3 (Wave 2 rules)

Status: committed locally, not pushed, not deployed. Owner approvals and the question-tool answer: design doc 2.15; my readings, **pending the Owner's yes/no**: 2.16 (OQ-66..71, plus `docs/PHASE6_OWNER_DECISIONS_VI.md`).

## What changed

- **Engine v3** (`pricing.v3.ts`, pure): Spa side (service and combo lines) and Beauty side (product lines) are priced separately; each side picks ONE winner (member discount of the payer's tier **in that wallet**, code-less promotions, supplied vouchers; largest amount, a tie goes to the member discount, then program code); nothing stacks inside a side. A `BOTH` program is evaluated once on both sides' eligible subtotal, its amount is split by the cumulative primitive, it is redeemed once even when it wins one side only. Birthday gift: Spa side only. Each side's discount is allocated to its lines (net per line).
- **Split primitive** (`split.ts`, T18) with a SQL twin `lucy_split_pro_rata` (parity-tested). **Scope** SERVICES / PRODUCTS / BOTH on every program version (existing = SERVICES) and product targets by brand, exact category or product; accepted by the discount API (`scope`, `brandIds`, `productCategoryIds`, `productIds`). **No screen** (discount screens = P6-11, POS = P6-10).
- **OQ-59 safety net:** an invoice with no product line is priced by v2 (the source of truth, `calculation_version` stays 2); v3 runs on the same loaded inputs (no extra lock, no Beauty-wallet read) and a difference or a v3 failure is compared field by field, logged (`PRICING_V3_MISMATCH` error line), recorded (audit + outbox event) and never changes the amount or fails the finalization.
- **Persistence (T19, OQ-65):** Spa side = the Phase 4/5 rows; Beauty side = `invoice_beauty_applications`, `invoice_beauty_snapshots`; `invoice_line_allocations` (net per line); `payment_side_allocations` (written by triggers, v3 invoices only, a reversal mirrors its payment); a shared program records the split figures; `discount_redemptions` is unique per (invoice, program). Cancelling releases every redemption. The Spa wallet earns on the Spa side net.
- Existing code touched: `discount.engine.ts` (scope check, two exports), `discount.eval.ts` (loader), `invoice.core.ts`, `discount.core.ts`/controller, `customer-invoice.core.ts`, `packages/server/src/loyalty.ts`, contracts. Dead `productGrossOf` removed.

## Migrations (2, additive; verified from zero and on a database that already held P6-8 test data)

`20261108000000_phase6_wave2_discount_scope` (scope column default SERVICES, 3 target tables, scope check); `20261108000001_phase6_wave2_pricing_v3` (enums, SQL split, widened redemption key, shared-amount columns and CHECK, Beauty rows, allocations, guards, v3 integrity check, payment triggers). Replaced: one index and one constraint (same migration), five functions. Permissions: none. A static guard (`phase6-wave2-pricing-isolation.test`) pins what the migrations may touch.

## Tests (scratch DBs `lucy_spa_p6_9_scratch_final`, `lucy_spa_p6_9_dbtests_scratch_final`)

- New: split (6, one of them 5,000 random splits), engine (18, worked examples A-D of 6.8), **differential v2 vs v3 on 6,000 random service-only invoices** (identical), shadow runner; DB (7: scope, SQL twin parity on 2,000 random splits, Beauty-only v3 invoices, 9 refused inconsistent invoices, row guards, hardening); API integration (11: examples A-D through the real POS flow, scope/targets by API, two redemptions + release on cancel, birthday on the Spa side, payments A, B, reverse A, C, draft/v2 transition, forced mismatch and forced failure of v3, service-only unchanged); **7 real-PostgreSQL race tests** (single-use shared voucher, mixed vs service-only of one payer, finalize vs Beauty-wallet adjustment, double payment, payment vs reversal, finalize vs cancel, cancel vs taking the freed voucher). Reconciliation after every test.
- Whole repo `pnpm test`: 0 fail (database 21, server 53, worker 22, ui 467, web 614, api 407 with 94 integration tests skipped by design). `pnpm lint`, `pnpm typecheck`, `pnpm format:check`: clean. Full integration on databases built from zero by the final migrations: **API 728 tests, 727 pass, 0 fail, 1 skipped** (the referral race that needs an Owner, skipped the same way in P6-8); **database 123 + 18 race tests, 0 fail**.
- **Existing test files touched: 2 files, 5 lookup lines** (`findUnique*({ where: { invoiceId } })` on `discountRedemption` became `findFirst*`; the key is now per (invoice, program)). No assertion changed. Every other existing suite ran unmodified (P6-8 product-sale suites included) and passes. An existing test caught one regression of mine on the way (the error text of the scope check); I restored the original wording instead of editing the test. The Phase 5 integrity check is now statement-for-statement the old one (pinned by a static test) plus one dispatch line for version 3.

## UX gate

No screen changed (`apps/web` untouched; web typecheck and 614 tests pass with the widened contracts). Nothing to render; the screens that show sides, scope and targets are P6-10 and P6-11.

## Open questions and risks

- OQ-66..71 (design 2.16); the redemption-key answer is provisional until the Owner confirms it in own words.
- Not rehearsed: rollback of these two migrations (Wave 2 rollback evidence is due at P6-11; restoring the one-per-invoice key is only possible while no invoice holds two redemptions). `CREATE UNIQUE INDEX` on `discount_redemptions` briefly blocks writes to that small table at deploy.
- Version 3 reads one extra (empty) relation per finalization of a service-only invoice (product detail of the lines); no extra lock.
