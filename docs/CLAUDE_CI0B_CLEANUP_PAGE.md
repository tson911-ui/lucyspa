# CI-0b: one-click cleanup of the supplier's customer comments (2026-10-12)

Design: `docs/PHASE_CLAUDE_INTEGRATION.md` section 3.3. Owner answer OQ-CI-1: OK. No AI, no key, **no migration, no new permission** (`MANAGE_PRODUCTS`, GLOBAL).

## What changed

- API `api/v1/product-text-cleanup` (`apps/api/src/products/product-text-cleanup.*`): `GET preview` (read only; the products whose `description_vi` the rule from CI-0a would change, with row version, text hash, comment count and characters), `GET preview/:id` (current text, cleaned text, removed lines),
  `POST apply` (1 to 100 entries). Apply locks each product (id order), refuses one whose row version or text hash changed since the preview (`CHANGED`), writes only `description_vi` with `row_version + 1`, and appends one audit event per product, `PRODUCT_SUPPLIER_REVIEW_TEXT_REMOVED`, with the **full before and after text** and the removed lines,
  plus one summary event per call. A clean product is reported as `NOTHING_TO_REMOVE`, a missing one as `NOT_FOUND`; a second click changes nothing. Contracts in `packages/contracts/src/product-text-cleanup.ts`.
- Screen "Dọn lời đánh giá của nhà cung cấp" (menu: catalog group, after "Sản phẩm nhập"): `Page` + `PageHeader` with one primary action ("Dọn N sản phẩm"), a `DataTable` (20 per page) with the comment count, characters removed and status, a row `⋮` menu (see the text that will go, skip this product), a Drawer with the current text beside the cleaned one (removed lines struck through), a `ConfirmDialog`
  before anything is sent, a success notice and toast, and the empty state "Không còn lời đánh giá nào…". Calls of at most 100 products.
- Candidates not yet approved are not listed: approval cleans them (CI-0a), so they cannot reach a product.

## Tests run

- API integration on `lucy_spa_p8_scratch` (`product-text-cleanup.integration.test.ts`, 4 tests): authority on every endpoint, preview lists only products with comments and writes nothing, validation, apply (cleaned text, version bump, nothing else touched, audit before/after, a product edited after the preview is skipped untouched, second click finds nothing, missing product reported).
- Web: screen test (access, one h1, primary action with count, empty state, no clinic word), helper tests (entries, batches, sums), nav tests. Root `pnpm lint`, `pnpm typecheck`, `pnpm format:check` clean.

## UX gate (frontend-design loaded; the kit and brand are fixed by CLAUDE.md, so this is a compact work screen from `packages/ui` only)

- Rendered on the audit stack (scratch DB, the 71 real supplier descriptions seeded as DRAFT products) at 360, 768 and 1440 light, 1440 dark, 130 % text at 360 and 1440. Opened and checked: list 360/768/1440 light, drawer 1440, confirm dialog (360 with the "Đang lưu…" state, 1440), row menu in dark, 130 % list at 360,
  the done state at 360 and the empty state at 1440 dark. Checked: one h1, one primary action at the trailing edge, sentence-case Vietnamese, 20 per page with "Hiển thị 1-20 trong 71", one row height, numeric columns right aligned, no horizontal scroll, 44 px targets, nothing bordered inside a card.
- Fixed from the first render: the long menu label wrapped to two lines (now "Dọn lời đánh giá"); the drawer showed the removed block far below a long description (now "Phần sẽ bị bỏ" first, struck through, then "Mô tả sau khi dọn"); the DOM audit found one FR3 surface mix (an info notice beside the table), so the explanation moved into the page intro. DOM audit after the fixes: **0 findings** at 360/768/1440.
- Real end to end: one click on the real stack cleaned 71 products (71 audit events with before/after, 1 summary event), the empty state followed. Not covered here: 768 dark and the English UI (the strings are in the dictionary and tested).
