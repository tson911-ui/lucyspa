# CI-R3: runs, first-three unlock, page approval (Wave A, 2026-10-12)

Design: `docs/PHASE_CLAUDE_INTEGRATION.md` 4.3 and the Owner's answers OQ-CI-3 and OQ-CI-5 (section 14). No migration (126 from CI-R2 holds `applied_via`).

## What changed

- **API `api/v1/ai/product-runs`** (`USE_AI_CONTENT`, global): `GET` (latest runs with item counts, spend, and what starting more needs), `GET preview` (what a run would take, estimated and maximum cost in VND at the typed rate, cap left, and the reasons it cannot start), `POST` start, `POST :id/pause|resume|cancel`, `POST unlock` (`MANAGE_AI_SETTINGS`).
  Rules enforced on the server, not only on the screen: only products that are still the supplier's copy, have at least 20 characters of text and no open draft are taken; **FIRST_THREE** is exactly three products and happens once (a cancelled one does not count); **more than three at once (SELECTION above 3, ALL_PENDING, up to 400) stays locked** until three drafts were applied or rejected by a person and the Owner presses **Cho phép chạy tiếp** (recorded with who and when); one open run at a time; AI and the rewrite switch must be on and a rate typed. Starting writes the run and one item per product (the product's text as it is now) and an audit event; **it makes no call to Anthropic and changes no product**. Cancelling releases the queued items (`REJECTED`, `RUN_CANCELLED`) so their products are free; a finished run is reopened by a regenerate or retry.
- **API page approval** `api/v1/ai/product-drafts/page` (read a page of 20 ready drafts as the text that would go on the website), `page-view` (records that this reviewer was shown them), `page-approve` (one confirm). Allowed only after three drafts were applied one by one; applies a draft only if it is ready, has no note at all (stored or found by a fresh check), its product is unchanged and this reviewer saw it; others are skipped with the reason. One audit event per product (`appliedVia` PAGE) plus a summary event. The single-apply write is one shared function.
- **Screens**: "Chạy viết lại" (the page's one primary action) opens a dialog with the scope, the product count, the estimate, the cap left and the reasons it is blocked; a runs card with state, counts, pause/resume/cancel, the unlock notice for the Owner and the "locked until 3 reviewed" hint; "Duyệt cả trang" in the list toolbar (shown after three single approvals) opens a drawer to read the page and one confirmation.
- `ai-runs.integration.test.ts` registered in `scripts/test-claude-integration.mjs`.

## Not built

- The summary notification to holders of `USE_AI_CONTENT` (design 4.3 step 3, counts only): the notification kinds and their templates need their own small step; the runs card shows the same counts and refreshes while drafts are being written.

## Tests run

Runs integration (7 steps: switches and preview reasons, first run of exactly three without any change, pause/resume/cancel, selection rules, unlock with its guards, page approval with skipped reasons, page approval refused before three single approvals) plus the 11 draft-review steps; web dictionary test; root lint, typecheck, format; whole-repo unit tests; full integration on a fresh scratch DB (stage 1: 23, stage 2: 627 + 396 + 95 + 78 + 56 pass).

## UX gate

Drafts list with the runs card, start dialog (blocked reasons visible), page-approval drawer at 360, 768, 1440 light and 1440 dark; images opened and read. Fixed after review: clearer card labels. DOM audit of the list page: see the step note in the handoff.
