# Phase 6 P6-2: database and permissions foundation (Wave 1)

Status: built and validated on a scratch database (`lucy_spa_p6_2_scratch_20261007`); **committed locally, not pushed, not deployed**.
Contract: `PHASE6_PRODUCTS_INVENTORY_DESIGN.md` (sections 2.5, 3, 4, 9, 11.2, 13). Owner request of 2026-10-07: DB foundation plus the permission codes, granted to no one, no change to POS, invoices or payments.

## What changed

- **5 additive migrations** (63 → 68): `20261106000000_phase6_permission_codes` (11 enum values), `…01_phase6_permission_semantics` (catalog constraint rewritten with the new codes), `…02_phase6_catalog_foundation`, `…03_phase6_import_foundation`, `…04_phase6_inventory_foundation`.
- **11 permission codes** (54 → 65), granted to nobody, none Owner-only: GLOBAL_ONLY `MANAGE_PRODUCTS`, `MANAGE_PRODUCT_PRICES`, `VIEW_PRODUCT_COST`, `IMPORT_PRODUCT_DATA`, `MANAGE_PRODUCT_CAMPAIGNS`; branch capable `VIEW_INVENTORY`, `MANAGE_STOCK_RECEIPTS`, `ADJUST_STOCK`, `SELL_PRODUCTS`, `MANAGE_PRODUCT_RETURNS`, `REFUND_PRODUCTS`. FINANCIAL: prices, cost, receipts, import, refunds, campaigns. Role screen: new group "Sản phẩm và kho" with VI/EN labels.
- **18 new tables, 17 of them empty** (nothing seeded): brands, categories, products, variants, price versions, promotions, images, import jobs and rows, suppliers, receipts and lines, lots, stock levels, count sessions and lines, movements. The 18th is `product_settings`, one row with the Owner-approved defaults (expiry warning 90 days, "Mới" 30 days).
- **Database guards:** product lifecycle (draft, publish needs an active priced variant, first publication stamped, never back to draft), append-only price versions, non-overlapping promotions (exclusion constraint) with one manual early end, `lucy_variant_price_at` (the effective price), receipts DRAFT to CONFIRMED then immutable, append-only movements, lot quantity and stock level written only by the movement trigger (`on_hand >= 0`, `reserved <= on_hand`), deferred checks that stock equals the sum of movements, a confirmed receipt has a movement per line, an approved count carries out its differences, import jobs one-way with preview rows.
- **Not in this Step (Wave 2 and 3):** any change to invoices, discounts, loyalty, payments, reservations, sale/return movement kinds, returns tables. No API route, no screen, no worker.

## Permissions and data

The 54 existing codes are unchanged; `pnpm db:permissions:sync` after the migrations inserts the 11 new rows (65 total). Cost price exists as a column only; the API will gate it by `VIEW_PRODUCT_COST` in P6-3.

## Tests run (scratch database)

Scratch database `lucy_spa_p6_2_scratch_20261007` (68 migrations): whole-repo `pnpm test` 1,305 pass, 0 fail (database 9, server 39, worker 16 + 1 skipped, ui 463, api 255, web 523); `pnpm lint`, `pnpm typecheck`, `pnpm format:check` clean; `pnpm test:integration` (database) 101 + 18 race tests pass, 0 fail (includes every Phase 4 and 5 POS, invoice, payment and loyalty race suite, unchanged); `pnpm test:auth:integration` (api) 627 tests, 626 pass, 1 skipped, 0 fail. New: `phase6-foundation.integration.test.ts` (8 tests), `phase6-inventory-races.integration.test.ts` (6 races: last unit, 8 buyers of 3 units, two receipts at once, one draft confirmed twice, two price versions, two overlapping promotions), `phase6-wave1-isolation.test.ts` (4 static guards: Wave 1 migrations touch no POS, invoice, discount, payment, loyalty or booking table; mutation-checked). Updated catalog expectations in 4 older tests (API authorization, role administration, Phase 4 permission foundation: counts and the FINANCIAL list). No POS, invoice or payment test needed any change.

## Risks and open items

- Production deploy of Wave 1 needs `pnpm db:deploy` then `pnpm db:permissions:sync`; the 5 migrations only create new objects and rewrite the permission catalog constraint.
- `btree_gist` (used by the promotion exclusion constraint) is already installed since Phase 3.
- Cost price is stored unencrypted like other business data; its protection is the API permission (P6-3).
