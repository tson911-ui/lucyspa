# CI-B0: "Duyệt tất cả" (Wave B, 2026-10-13)

Owner request of 2026-10-13 (verbatim in `docs/PHASE_CLAUDE_INTEGRATION.md` section 14): approve every rewrite draft with zero warnings after one preview and one confirm, audited; drafts with warnings still need a single (or per-page) review.

## What changed

- **Migration 128** `20261213000000_claude_applied_via_all`: the check on `ai_items.applied_via` also allows `ALL` (next to `SINGLE`, `PAGE`). Additive; no row changes.
- **API** `api/v1/ai/product-drafts/approve-all` (`USE_AI_CONTENT`; applying also `MANAGE_PRODUCTS`, both GLOBAL):
  - `GET`: the preview. Every ready draft with no stored note, no note found by a fresh check and an unchanged product, oldest first, each with its row version (at most 400); counts of ready, with warnings, product changed; whether the viewer may confirm.
  - `POST`: the confirm sends back exactly that list. The server applies a draft only if it is still ready, has the same row version, still has zero warnings and its product is unchanged; otherwise it is skipped with a reason (`NOT_READY`, `CHANGED`, `WARNINGS`, `STALE`; a changed product also becomes `STALE`). A draft that became ready after the preview is never touched. Applied in chunks of ten, each its own transaction; one audit event per product (`AI_DRAFT_APPLIED`, applied via `ALL`) plus one summary event (`AI_APPROVE_ALL`).
  - Still required: three drafts applied one by one first (`ALL` and `PAGE` are not counted as those).
- **Screen**: the list toolbar has one "Duyệt hàng loạt" menu with "Duyệt tất cả" and "Duyệt cả trang" (two buttons overflowed at 360 px). "Duyệt tất cả" opens a drawer: counts, the list of what will be approved (20 a page), one confirm.

## Not changed

Page approval and single approval work as before. Drafts with any warning are never approved in bulk (the Owner's rule).

## Tests run

`ai-approve-all.integration.test.ts` (6 steps: permissions and the three-singles gate, preview counts and the reader, exactly the previewed list with a changed, an annotated and a late draft, STALE and 25 drafts in chunks with the audit counts, input limits); web typecheck, eslint on the touched files, prettier.

## UX gate

Drawer at 360, 768, 1440 light and 1440 dark (images opened and read); toolbar menu at 360 and 1440. Fixed after review: the two toolbar buttons made the list scroll sideways at 360 (one menu now); the drawer table showed a cut-off third column (two columns now). The page has no horizontal scroll at 360 after the fix. The page is not one of the 26 baseline pages of the DOM audit.
