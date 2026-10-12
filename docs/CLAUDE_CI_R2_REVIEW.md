# CI-R2: review of AI drafts, import text lock, product page sections (Wave A, 2026-10-12)

Design: `docs/PHASE_CLAUDE_INTEGRATION.md` sections 4.3, 4.6, 4.7. Owner answers OQ-CI-3 and OQ-CI-5 (first three one by one; Lucy-written text never overwritten by an import unless ticked with a reason).

## What changed

- **Migration 126** `20261212000003_claude_item_applied_via`: `ai_items.applied_via` (`SINGLE`/`PAGE`, tied to `applied_at`); the page approval of CI-R3 needs three drafts applied singly.
- **API** `api/v1/ai/product-drafts` (`USE_AI_CONTENT`, global; apply also `MANAGE_PRODUCTS`): list (20/page, counts), detail (current text beside the draft), view, edit (checks run again on the reviewer's text), apply, reject, regenerate (3 times, one line of guidance), retry (a stale item is re-read from the product). Apply locks item and product, refuses a changed product (item becomes `STALE`, nothing written), refuses blocking warnings, needs `acknowledgeWarnings` for quality notes, writes only the draft's fields (`content_origin` `LUCY_AI`, or `LUCY_MANUAL` when edited; the Vietnamese name only if the suggestion was chosen) and audits the full before and after.
- **Import text lock** (design 4.6): the Excel/CSV preview shows `TEXT_LOCKED` for products whose text Lucy wrote (anything but `SUPPLIER_COPY`) and skips their name/description columns; other columns still import. Overriding needs `MANAGE_PRODUCTS`, the SKUs of locked rows and a reason, and is audited per product; the apply declares `lucy.text_change_source` and lifts the database guard only for the overridden update. The apply dialog has the tick and the reason. Supplier importers never update existing text (checked: no writer).
- **Public product page**: the four sections (Công dụng, Thành phần, Cách dùng, Phù hợp với ai) in the visitor's language (Vietnamese where English was not written), the approved search title and description, JSON-LD `InStoreOnly` while online ordering is closed or for a variant not sold online. **Deviation:** the design said `sku` in JSON-LD; Phase 6 design 16 (pinned by a test) says internal SKUs are never public, so the product's public `code` is the `sku`. Owner may overrule.
- **Screens**: "Viết lại nội dung" list and a page per draft (two language tabs, old text beside the editable draft, character counts for the search texts, warnings by field, reject/rewrite/retry in the header, Apply the one primary action, disabled with a short reason).
- `scripts/test-claude-integration.mjs` registers the Claude integration tests (they had not run in CI before): cleanup, settings, spending cap, key check, rewrite engine, draft review, import lock; chained in `apps/api` `test:integration`. One pre-existing flaky assertion made deterministic (resync notice test matched "999" inside timestamps; CI run 332 failed on it).

## Tests run

56 Claude integration steps, import suites (18), public products (11), foundation DB test, web unit tests (helpers, screens, JSON-LD, sections, nav), root lint, typecheck, format, whole-repo `pnpm test`.

## UX gate

List and detail pages rendered at 360, 768, 1440 light and 1440 dark plus 130% text; states: ready, blocking and quality warnings, failed, stale, applied, apply dialog, reject dialog; public product page with sections. Images opened and read. Fixed after review: one row height in the list (short failure reasons, code in its own column), warnings grouped by field, one message for an over-long search text, short disabled reason on Apply. DOM audit: 0 findings on the list and three detail pages. Not done: Owner approval of the screenshots.

## Open

None for the Owner except the `sku` deviation above.
