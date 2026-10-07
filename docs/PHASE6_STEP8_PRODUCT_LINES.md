# Phase 6 P6-8: product lines on invoices (Wave 2 database and rules)

Status: committed locally, not pushed, not deployed. Owner request and approvals: design doc 2.13. My readings below are **pending the Owner's yes/no** (OQ-61..OQ-64 in `docs/PHASE6_OWNER_DECISIONS_VI.md`).

## What changed

- **Invoice shapes (T20):** `VISIT` may hold service and `PRODUCT` lines; new kind `PRODUCT_SALE` holds product lines only (no visit; member or guest payer; no loyalty go-live needed); `COMBO_SALE` unchanged.
- **Header (T33):** `channel` (`COUNTER` default, `ONLINE` unreachable from the API) and `shipping_fee_vnd` (default 0). `total = subtotal - discount + fee`. Old invoices read `COUNTER`/0.
- **Product line:** `invoice_line_products` copies product, variant, SKU, brand, category, names and label; **seller required** (active employee assigned to the invoice branch; default = caller, an Owner without assignment must name one). Price = effective price of the variant (T12), re-resolved at every draft edit, **frozen at finalization**; SQL re-derives it at commit and requires `priced_at = finalized_at`. Nobody types a price.
- **Stock (T15):** finalization reserves each line under the stock-level locks (sorted), all or nothing, `PRODUCT_OUT_OF_STOCK` names the lines; cancelling an unpaid invoice releases in the same transaction. `stock_levels.reserved` is written only by the reservation trigger; deferred checks keep `reserved = Σ RESERVED` and `reserved <= on_hand`. Adjustments and counts that would go below `reserved` get `INVENTORY_STOCK_RESERVED` (T13).
- **API:** `POST /pos/branches/:id/product-sales`, `/pos/invoices/:id/product-lines`, `.../product-lines/:lineId/update|remove` (`SELL_PRODUCTS`). Finalize/cancel/payment are the existing commands. Response adds `productLines`, `channel`, `shippingFeeVnd`, `actions.sellProducts`.
- **Interim money rule (until P6-9/P6-11):** the Spa engine sees service/combo lines only, so a product line gets **no discount and earns no points**; the Spa wallet earns on `total - product gross - fee` (identical to `total` without products); birthday gift skips non-VISIT invoices.
- **Customer view:** a product line shows name, quantity, price, total (combo-like shape, no seller/SKU); the proper T26 view is P6-10.

## Not in this Step (kept for P6-9..P6-11, nothing lost)

Consumption at PAID / `SALE` movements and T27 restore (P6-10); T19 per-side applications, snapshots, line-net and payment-side rows and the discount scope column (they have no writer before the v3 engine, P6-9/P6-11); POS screens (P6-10). A **paid** product invoice therefore keeps its reservation `RESERVED` and stock is not yet decremented.

## Migrations (2, additive)

`20261107000000_phase6_wave2_invoice_kinds` (two enum values); `20261107000001_phase6_wave2_product_sales` (columns, 2 tables, guards, replaces 4 functions). Permissions: none (`SELL_PRODUCTS` exists since P6-2). Draft `PRODUCT` lines may be deleted (the only deletable invoice lines).

## Tests (scratch DB `lucy_spa_p6_8_scratch_20261007`)

- **All API integration suites, unmodified existing ones included** (invoice, discount, payment, PayOS, customer invoice, loyalty, referral, birthday, combo, reward, inventory, import, 20 race suites): 708 tests, 707 pass, 0 fail, 1 skipped (pre-existing). This is the proof that service-only POS/payment/loyalty behavior is unchanged; no existing test file was edited.
- **New:** `phase6-wave2-foundation` (9, SQL guards), `product-sale.integration` (13: authority, draft, pricing/freeze, reserve, no oversell, cancel/pay/reverse, T13 refusals, mixed invoice equals a service-only twin, Spa earn on the Spa side only, customer view, service-only regression), `product-sale.race` (10 on separate connections: two cashiers on the last unit, double finalize, finalize vs cancel, cancel vs take-the-freed-unit, double payment, pay vs cancel, PayOS notification vs cash reversal on a mixed invoice, adjustment vs finalize, opposite lock order), `phase6-wave2-isolation` (5 static checks of what the migrations may touch). Reconciliation (lines = subtotal, total = subtotal - discount + fee, on hand = Σ movements = Σ lots, reserved = Σ open reservations <= on hand) runs after every test.
- `packages/database` integration: 116 + 18 race, 0 fail. `pnpm test` (all packages): 0 fail (api 287, web 614, worker 22, database 15). `pnpm lint`, `pnpm typecheck`, `pnpm format:check`: clean.
- Edits outside new files that tests depend on: `scripts/test-auth-integration.mjs` and `packages/database/package.json` list the new suites. A bug the new tests caught: a numeric `sum()` in the Spa-earn query (fixed, `::bigint`).

## UX gate

No screen changed (`apps/web` untouched; `pnpm --filter @lucy-spa/web typecheck` passes with the widened contracts), so there is nothing to render; the POS screens for product lines are P6-10. Not run: DOM audit (no page changed).
