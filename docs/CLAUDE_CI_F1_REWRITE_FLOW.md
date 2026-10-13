# CI-F1: complete drafts, notes that never block, select and approve (2026-10-13)

Owner decision of 2026-10-13, recorded verbatim in `docs/PHASE_CLAUDE_INTEGRATION.md` section 15. Drafts are still never published by themselves: they wait for the Owner.

## What changed

- **Free fixes before saving** (`packages/server/src/ai/rewrite-fix.ts`, pure code, no cost): customer comments, ratings, emoji, links, markup, medical or absolute claims, the clinic word, authenticity words (while off) and skin conditions in "who it suits" are cut out (the clause or sentence, not the whole text); titles are shortened at a word and keep the brand, the size and "Lucy Spa"; descriptions end at a sentence; the ingredient list is brought back to what the supplier text lists (the supplier's own list is the fallback); a missing brand is put back in the English name. Every change is checked: the whole draft is checked again and a change that adds a problem elsewhere is undone.
- **One targeted AI repair** (`rewrite-repair.ts`): only where a real problem is left (a field emptied, a title that cannot be shortened, a wrong language), one call that rewrites only the failing fields, under the same switches, caps, reservation and ledger. Its ledger rows are `REPAIRED` / `REPAIR_FAILED` (migration **132** `20261213000004_claude_repair_outcome`, only widens a CHECK), so the repair cost adds up apart from the rewrite cost. If the repair cannot run (cap, switch, failed call) the free-fixed draft is still delivered with its notes.
- **False positives fixed**: `™ ® © ➔` are not emoji (only real emoji count); "bước 3 trên 5" and ratios are not star ratings; "khám phá" is not the clinic word; a percentage in a dropped marketing claim is not a missing fact; an ingredient list is never "too similar to the source"; the Vietnamese ingredient warning now names its field. "Who it suits" empty is now flagged (it is always written).
- **Notes never block**: apply, page approval and "Duyệt tất cả" no longer look at notes (no acknowledgement box, no "Cần sửa", no refusal). Notes show in a card "Lưu ý của hệ thống" and what the worker fixed in "Đã tự sửa trước khi lưu". The page approval is removed; kept: stale product, changed draft, not ready, and the first three approvals one by one.
- **Review list**: a checkbox on every pending draft, "Chọn tất cả" (every pending draft on the server, not the page), the selection bar with "Duyệt các bài đã chọn (n)" and one confirm; sent in batches of 100, each product audited (`AI_DRAFT_APPLIED`, applied via ALL) and each batch once (`AI_APPROVE_ALL`). The detail page keeps "Viết lại bản nháp".
- **Pending drafts** (Owner item 5): `pnpm --filter @lucy-spa/worker ai:fix-pending [--repair] [--limit=N]` (`apps/worker/src/ai-fix-pending.ts`): free fixes for every pending draft, then with `--repair` the repair call where a problem remains. Re-runnable (a second run changes nothing), skips drafts a person edited, locks each draft, advances the row version by one, publishes nothing. It prints `pending= skippedEdited= fixedFree= needRepair= repairCalls= repaired= repairCostMicroUsd= repairCostVnd=`.

## The numbers the Owner asked for

**Not available here**: the pending drafts are in production and there is no server access. The command above prints them when the deploy guide runs it (fixed for free, needed repair, repair cost in USD and VND); a re-runnable check query in the guide shows the repair cost from the ledger (`outcome` `REPAIRED`, `REPAIR_FAILED`). Rehearsed on the scratch copy with seeded drafts (see Tests).

## Decisions taken in our reading (Owner may correct)

- "4 sections" and "facts only from the source" meet where the source has nothing for a section: it stays empty and is never filled by a repair (an invented ingredient list would break the facts rule). "Phù hợp với ai" is always written.
- The search-description drafts (CI-E1) keep their own review rules: not part of this decision. **Question for the Owner**: should they lose their warning block too?

## Tests run

Unit: free fixes and every false positive (13), checks and parsing (24 with the existing), client tool-call loop (10). Integration on a scratch DB: rewrite engine (free fix, targeted repair with two ledger rows and summed cost, repair unavailable, injection corpus), pending drafts (free, repair, edited untouched, idempotent), drafts review (apply with notes), approve selected (notes never skip, only stale or changed), runs, database foundation (ledger outcomes). Whole-repo `pnpm test`, lint and format before the push.

## UX gate

List with the checkbox column, the selection bar (one and all selected), the confirm dialog and the detail page at 360, 768, 1440 light and 1440 dark (opened and read). Fixed after review: the toolbar button overflowed at 360 (label shortened), the auto-fix rows read as problems (now "problem (who fixed it)").
