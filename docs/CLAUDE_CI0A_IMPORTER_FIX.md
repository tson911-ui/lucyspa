# CI-0a: the importer never imports the supplier's customer comments (2026-10-12)

Design: `docs/PHASE_CLAUDE_INTEGRATION.md` section 3. Owner answer OQ-CI-1: OK, build CI-0 first.

## What changed

- `stripSupplierReviewText` (`packages/server/src/supplier-import/text.ts`): removes a review heading at the start of a line ("Đánh giá…", "Cảm nhận khách…", "Nhận xét…", "Phản hồi…", "Review…", with or without a suffix or the product name appended) together with the
  entries after it (a first name, optional age/city/title, emoji, colon, praise; lone "-" lines between them), and a run of two or more unmistakable entries with no heading. A closing sales paragraph is kept. Ordinary sentences with "đánh giá" are untouched; a review-like
  heading with no readable entries is kept and reported as `suspected`. Cleaning twice gives the same text. Emoji means real emoji only (not ™ ® © or arrows such as ➔, which appear in ingredient lists and routines; found by checking the removed lines, not only the records).
- The WooCommerce normalizer applies it to `description` and `short_description` before hashing and storing, so `source_records.description_text`, candidates and approved products never receive a testimonial. New non-fatal problem codes `REVIEW_TEXT_REMOVED` (count in `detail`) and
  `REVIEW_TEXT_SUSPECTED`, with Vietnamese and English labels on the source-test screen. Problem codes are code constants, not a database enum: **no migration**. WooCommerce review fields (`reviews`, `average_rating`, `review_count`, `rating_count`) are still never read.
- Defence in depth: approving a candidate runs the same function over the candidate text (`supplier-import.core.ts`), so an old dirty candidate cannot create a dirty product.
- Next scan: the content hash of the affected records (71 of 353 in the 2026-10-11 scan) changes once, so they appear as "content changed" notes (P9-7 writes notes only, never products). Expected.

## Checked on the real text

All 353 scanned descriptions (local scratch copy, read-only): 71 cleaned (3 entries each), 0 other records changed, every removed line is a heading, a lone dash or an entry, none missed, cleaning is idempotent.

## Tests run

- `packages/server`: text.test.ts (8 new: 8 heading/entry shapes from the real data, no-heading run, closing paragraph kept, ordinary text and ingredient lines untouched, suspected, idempotence) and woocommerce-store.test.ts (2 new: a Store API object with `reviews`/`average_rating`/`review_count` and a description with comments yields none of it; hash equals the comment-free product; comments-only description). 28 pass.
- API integration on `lucy_spa_p8_scratch` (`supplier-import.integration.test.ts`, 1 new): scan stores no testimonial in `source_records` or the candidate; a product without comments is unchanged; approving an old dirty candidate creates a clean product. 7 pass.
- Web: `public-products-core.test.ts` (JSON-LD never carries `review`/`aggregateRating`), the source-test label test, the UI ratchet: 22 pass. Root `pnpm lint`, `pnpm typecheck`, `pnpm format:check`: clean.

## Open questions

None. Next: CI-0b, the one-click cleanup page for the 348 products that already carry the text.
