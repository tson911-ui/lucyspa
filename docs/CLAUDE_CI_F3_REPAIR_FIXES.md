# CI-F3: repair fixes after the first production run (Owner decision 2026-10-13)

Cause and numbers: `docs/CLAUDE_REPAIR_DIAGNOSIS_2026-10-13.md`. Deploy: `docs/DEPLOY_CLAUDE_REPAIR_FIXES.md` (one block, no migration, no permission).

**What changed (the Owner's 8 items)**

1. Banned phrases match whole words (`bannedHit`, plural "s" allowed; "semi-permanent" excepted) and a phrase inside the product's own name or brand is not a claim (`activeBannedPhrases`). Also used by the search-text and customer-card checks.
2. A free fix never empties a required field (`attempt` refuses); a field the supplier may leave out (benefits, ingredients, usage) can still become empty. The text stays and goes to the repair.
3. Repair rule for ingredients: a comma list (prompt `product-repair.v2`).
4. `ai:fix-pending` also prints `needRepairAfter`, `codesBefore`, `codesAfter`, `blankedDrafts`, `notesRefreshed`, `stoppedByBudget`, `estimatedRepairVnd`; new `--max-vnd=N` (a call whose worst-case cost does not fit what is left of the cap is not made).
5. Stored notes of every draft are refreshed to what the checks find now (the draft text is not changed; the DB rule forces a row-version step on every update).
6. `ai:fix-blanked` (dry run, `--apply`): restores empty fields of applied products from the audit before-values or, for a description, the official name (of the sections only "who it suits": the others may be empty on purpose and an older value may be supplier copy); never a hand-edited draft, a non-AI product, or a product changed since the apply; one SYSTEM audit event per product. Findings: the database refuses an empty `name_en` or search text (`products_names`, `products_seo_text`), so only descriptions and "who it suits" could be blank in applied products.
7. The cause of the "Dữ liệu vừa được thay đổi ở nơi khác" error is that DB refusal (23514) mapped to CONFLICT, which rolled back the whole chunk of 10. Now: drafts with an empty required field or a too-long search text are skipped with a reason (`EMPTY_FIELD`, `TOO_LONG`); each write is under a savepoint (`REJECTED`); an unknown id is `NOT_READY`; one request carries the whole selection (`approveBatchMax` 1000); a draft is stale only when its source snapshot (name, brand, category, variants, cleaned supplier text, attributes) differs, not when the product row version moved; an unedited draft is applied at its current item version (only a hand-edited one is `CHANGED`); the single apply says `emptyFields` / `tooLong` plainly. Preview adds `blocked`; the screen says "Chưa chọn N bài: lý do" and, after the confirm, "Đã bỏ qua N bài: lý do (số)".
8. Deploy block: free re-check of all waiting drafts, estimate printed, repair capped at 100,000 VND.

**Tests run (all green):** server AI unit tests 56; web `ai-drafts` 8; API integration on a scratch database: rewrite-pending 7, rewrite-engine 18, approve-all and drafts 20, rewrite-blanks 4; Claude set 127, authorization 15, DB foundation 37; `pnpm test` (whole repo), lint, typecheck, format. The end-to-end run on the audit stack confirmed 26 drafts in one request: 24 applied, 2 skipped `EMPTY_FIELD`.

**UX gate:** the review list with "Chọn tất cả" opened at 360, 768 and 1440 px light, 1440 px dark and at 130% text (360 and 768), plus the result state (toast "Đã duyệt 0 bài. Đã bỏ qua 1 bài: còn trường trống (1)." at 360 and 1440), each of those images opened and read except the dark variants of the 130% shots (`.local/uxui-screens/dr-*`). The one new element is the existing info `Notice` under the selection bar, aligned with the table, no overlap or layout shift. At 360 px and 130% the existing "Duyệt các bài đã chọn" button wraps to two lines inside its pill (not changed). The tap-target check lists only existing shell items (side links 40x44 at 768, toast close 28x28). DOM audit of the page (not in the 26-page baseline): 0 findings at 360, 768, 1440 (run on the Phase 8 scratch stack, not `lucy_spa_uxaudit_20261001`).

**Open / for the Owner**

- A draft that still carries a real error after the repair stays approvable (notes never block, Owner rule). The deploy report lists the codes left; read those before approving.
- The "system pass only" path compares the stored source snapshot with a fresh one; `buildProductSnapshot`, `snapshotOf` and the review-text stripper are unchanged since 7e194b3, so production drafts compare fairly. The deploy block prints how many waiting drafts have a product whose version moved (query 7).
- Drafts already blanked need one paid repair each (an `EMPTY_FIELD` target); that is inside the 100,000 VND cap. A description restored from the official name is a placeholder: rewrite it later.
