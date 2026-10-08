# Phase 6 P6-11 (part): scope and product targets on the discount screens

Status: committed locally, not pushed, not deployed. Web only (no API, database, server or worker change). The discount API has taken
`scope`, `brandIds`, `productCategoryIds` and `productIds` since P6-9; this adds the screens it was waiting for.

## What changed

- **Form** (create page and new-version page, `discount-form.tsx`): "Phạm vi" (Dịch vụ / Sản phẩm / Cả hai) and "Áp dụng cho" (all of the
  scope / only chosen items). Service targets show when the scope has services; product targets (brands and product categories as checkbox
  groups, the category hint says a parent also covers its subcategories; products as a search picker with removable chips, no `fieldset`,
  no `details`) show when it has products. Targets that do not fit the scope are dropped from the payload, so changing the scope never
  leaves a stale choice. A services-only program sends exactly the payload it always did; any other scope is stated with its targets.
  "Selected" with nothing selected of a kind the scope reaches is refused on the client as the server does.
- **Detail** (`discount-detail.tsx`): scope, "Áp dụng cho" and each target kind by name (comma list); if a list cannot be read it shows the
  number of items, never an id. **List**: a "Phạm vi" column, shown from 1536 px only (at 1440 px it cut the validity column).
- New `discount-targets.tsx` (catalog lists, picker, chips). Texts VI/EN in `i18n/workforce.ts`; short labels so a select fits at 130%.
- The product search lists the first 30 matches (the review catalog has 4,063 products; rendering all would freeze the page).

## Tests (web, `pnpm test` whole package: 638 pass, 0 fail; typecheck, lint, format:check clean)

New `discounts-scope.test.ts` (payload per scope, stale targets dropped, validation, prefill, old program without scope fields) and 6 render
tests in `discounts.test.tsx` (scope controls, "all" label per scope, brands/categories/chips, no catalog permission, both languages, no "khám").
No existing assertion changed. UI ratchet untouched (no counter moved).

## UX gate (review stack on `lucy_spa_p6_10_review_scratch`, migrated to 20261110000000; screenshots `.local/uxui-screens/p611-*`)

Rendered at 360, 768, 1440 light + 1440 dark, and 130% text (360 and 1440): new program for each scope (products with brands, categories and 6
chosen products incl. a 169-character name; both; all products; services), nothing chosen + submit, catalog forbidden (403), detail of four
programs (22 products selected; both; services; all products), new-version page prefilled, list. Every image was opened and read.
Fixed from what I saw: the list lost its validity column at 1440 (scope column moved to 2xl); chips showed the long product code and a
7-line pill (name only, cut at 60 characters); "Áp dụng cho" clipped at 130% (shorter option texts). Not fixed: at 360 px with 130% text the
admin top bar overflows 32 px (known, `docs/UI_BACKLOG.md`); the native checkbox inputs report 20 px (the label is the target, as on every form).
Not rendered: the detail page when the catalog lists are forbidden (the fallback to a count is in code, not covered by a test).

## DOM audit (audit database `lucy_spa_uxaudit_20261001`, migrated; name checked)

`discounts` 56 -> 0, `discount-detail` 78 -> 0, new page 0 (not in the baseline); no count of any type rises.

## Gaps for the Owner / next Step

- Brand, category and product lists need `MANAGE_PRODUCTS` or `MANAGE_PRODUCT_PRICES`; a holder of `MANAGE_DISCOUNTS` alone gets a notice and
  cannot pick product targets (an Owner can). Options: grant both, or a read-only catalog list for discount managers. Not decided here.
- `GET /products` has no search or paging (every product); the picker filters in the browser. Fine for hundreds, heavy for thousands.

## UX gate: Beauty card and expired-lot notice

Review stack on `lucy_spa_p6_10_review_scratch`; the member `khach@review` got go-live ON and Beauty points by manual ledger rows; one `EXPIRED_LOT_SOLD` notification was inserted for the Owner. Every image was opened and read.

- **Loyalty page** (`/vi/account/loyalty`, Beauty 1,000 points, Spa 0): 360, 768, 1440 light, 1440 dark, 130% at 360 and 1440. The Beauty card shows "Gold" and "4%" (the Spa card "Chưa có hạng" / "Chưa có"); both cards are equal in size and aligned, 2 columns from 768, no overlap, no horizontal scroll, the Beauty history row (+1.000, "Điểm Lucy Beauty") is listed. "No tier yet" state (Beauty 40 points, 360 and 1440): "Chưa có hạng", "Còn 460 điểm để lên hạng Silver", "Chưa có".
- **Staff inbox** with the expired-lot notice, 360 and 1440 light (and 1440 dark): the row opens the stock item. **Defect found and fixed:** the message (~100 characters) was cut by the 2-line clamp, losing "hết hạn". Shortened to "Lô {lot} hết hạn đã giao {quantity} {sku} (hóa đơn {invoice})." (EN likewise); the meaning now always shows, a very long invoice code can still be cut at 360 (the full text is the link tooltip). `i18n/notifications.ts` and the notice test changed; 12 notification tests pass.
- **Not covered:** the loyalty page is a customer page, not in `uxui-audit-pages.json`, so no DOM audit. The tier table marks only the Spa tier as "current" (a member whose Beauty tier differs sees no mark for it): left as is, a design choice for the Owner. At 360 px with 130% text the customer top bar clips its last icon (shell, not this change).
