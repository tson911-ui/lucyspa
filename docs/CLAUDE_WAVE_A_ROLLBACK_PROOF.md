# Claude Wave 0 + A: proof that the old build runs on the new database (2026-10-12)

Question: if the Owner rolls back from the new build to production's current build `06badcf` (Phase 8, 122 migrations, 77 permissions) **keeping the database** (127 migrations, 79 permissions), does the old build work? Migrations are additive, so the expected answer is yes, with one step: the two new permission rows must be deleted first.

## What was run (this machine, scratch database, nothing real touched)

1. A fresh scratch database was migrated with the **new** build to 127 migrations and the permission catalog synced to 79 (the two new codes `MANAGE_AI_SETTINGS`, `USE_AI_CONTENT` present, granted to nobody).
2. The **old** build was checked out into its own worktree at `06badcf`, installed, generated and built (`pnpm build:server`, API build), then pointed at that database.
3. **Old `pnpm db:permissions:sync` with the two new rows present: FAILS** ("Permission catalog sync failed"): the old catalog does not know the new codes. This is why the rollback block deletes them first.
4. The rollback block's SQL (delete from `role_permissions`, `user_permission_overrides`, `permissions` for the two codes) removed 2 rows; **old `db:permissions:sync` then printed `0 inserted, 77 already present`**, exactly the line the rollback guide expects.
5. Old build's integration tests against the 127-migration database: **authorization (+ role admin), product catalog, Excel/CSV product import, supplier import (approval), POS product sale, customer invoice, public products: 69 of 69 pass** (38 + 31).

## Result

- The old build runs on the new schema: the new tables are unused by it, the new product columns default (`content_origin` = `LUCY_MANUAL`, search text empty), the text-lock trigger fires only for an import that declares itself (the old import does not), and the new `bot_visible` column defaults to false.
- **Required step:** delete the two new permission rows before the old sync (done by the rollback block in `DEPLOY_CLAUDE_WAVE_0_A.md`). After a later redeploy of the new build the sync inserts them again (`2 inserted, 77 already present`), still granted to nobody.
- Things the old build cannot do on that database, by design: nothing reads the AI tables, so AI drafts, runs and the spend ledger stay as history; products created by the old supplier approval carry `content_origin` `LUCY_MANUAL` (they are locked against Excel text overwrite once the new build runs again, which is the safe side); text already applied from a draft stays on the product.
- Not proven here: a rollback after the Owner has applied drafts to many products and then relies on the old build's own product screens; those screens read and write only the old columns, which are unchanged.
