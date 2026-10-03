# Lucy Spa: agent rules

Lucy Spa is a spa management + customer web app (Vietnam, VI/EN). pnpm monorepo, strict TypeScript, Node 24.
Owner reviews every Step. Work only on the Step you are given.

## Repo map

- `apps/web`: Next.js 16 / React 19, routes under `src/app/[locale]` (vi, en). Never imports backend packages or the DB.
- `apps/api`: NestJS 11 REST (`/api/v1`). All business rules and authorization live here.
- `apps/worker`: BullMQ worker (outbox consumers, email, notifications).
- `packages/database`: Prisma 7 / PostgreSQL, migrations in `migrations/`.
- `packages/server`, `packages/contracts`, `packages/ui`, `packages/config`: shared code.
- `docs/`: design contracts and one report per Step.

## Reading budget (important: tokens are limited)

- Do NOT read `LUCY_SPA_PRD.md` or `LUCYSPA_HANDOFF.md` in full. Grep for the section you need
  (e.g. `grep -n "^## 16" LUCY_SPA_PRD.md`) and read only that range.
- Read the Step's own doc and the design contract sections it cites. Nothing else by default.
- Do not scan the whole codebase. Find code with grep/glob, open only the files you will change
  and their direct callers/tests.
- Do not re-read a file you just wrote or edited.
- Before a new Step, the previous Step's context is not needed: rely on git log + its report.

## Validation per Step (targeted only)

- Run only the tests for code touched in this Step, plus typecheck/lint for the affected package.
- Integration tests: run only the relevant suite file(s), not the whole package.
- Full regression, full build and smoke (`pnpm check`, `pnpm test:integration`, `pnpm smoke`)
  run ONLY at the Final Validation Step or when the Owner asks.
- Before every commit run `pnpm format:check` on the whole repo; it must be clean (CI fails otherwise).
- Before every push run `pnpm test` for the whole repo (every package), not only the tests touched in the Step.
  This is the one exception to "targeted only"; it does not include `pnpm test:integration`/`pnpm smoke`.
- If a test fails for an unrelated, known reason (e.g. time-of-day fixtures), note it in one line
  and move on; do not investigate.

## UX quality gate (mandatory for every UI Step; `docs/UXUI_REDESIGN_DESIGN.md` section 21)

- Layout: spacing tokens only (multiples of 4; gaps between blocks 8/16/24/32/48), the fixed type scale, one vertical
  rhythm, aligned edges, sensible max widths, 44px touch targets (40px desktop), no orphaned or oddly placed elements.
- All UI uses the shared `packages/ui` components and motion tokens, never ad-hoc styles or animations.
- Frontend rules FR1-FR15 (section 21.4) bind every Step after 7.5. Digest:
  - One `Card` surface; nothing bordered inside a card; lists have no outer card (the table is one single-border surface).
  - Page = `Page` + `PageHeader` (one h1, one primary action, last at the trailing edge); footers are Cancel then Save, primary last.
  - Actions live in fixed places: page header, list toolbar, row `⋮` menu, card header, form/dialog footer. No stray buttons, no text-link actions.
  - Any list that can exceed 20 rows is `DataTable` + `Pagination` (20/page); no raw `<table>`; one row height; numeric columns nowrap.
  - Create/edit: short form = Dialog, medium = Drawer, long = its own page. Never `<details>`, inline expanding cards or native `fieldset`.
  - A heading never repeats the label of its own control; no horizontal page scroll; toolbar controls have no labels above.
  - No new `wf-*` class, no px/rem spacing literal, no hex color. `apps/web/src/test/ui-ratchet.test.ts` pins these counters (only down).
- Radix primitives are allowed as headless behavior inside `packages/ui` only, when the kit lacks the behavior (plan section 1.1); no Tailwind.
- Before reporting a UI Step done: render only the screens changed in that Step at 360, 768 and 1440 px
  in light plus 1440 px in dark with `node scripts/uxui-screens.mjs <name> <url-or-html>`, review them
  against the checklist, fix, re-render. Screenshots go to `.local/uxui-screens/` (git-ignored). Add a 5-line "UX gate" note to the
  Step report. Do not report a UI Step done without it.
- Never report screenshots without opening each one (Read the image) and saying what was checked; never claim an image
  was reviewed that was not opened. A screenshot of a browser error page or of a missing server is a failed gate: the
  script exits non-zero (3) for it and writes no image. Do not work around that exit code.
- Also run the DOM audit on the changed pages against the real app (section 21.5): scratch DB
  `lucy_spa_uxaudit_20261001` (never the dev DB), `node .local/uxui-audit/capture.mjs <page...>`, then
  `node scripts/uxui-audit-summary.mjs --compare docs/uxui-audit-baseline.json`. No count may rise; lower the ratchet
  (`UPDATE_RATCHET=1`) for what the Step retired. Compare migrated pages with `docs/references/` (8 questions, 21.5).

## Reporting (keep it short)

- Step report in `docs/`: max ~40 lines. What changed, migrations, permissions, tests run + result,
  open questions. No restating of the design contract.
- Update `LUCYSPA_HANDOFF.md` with at most 5 lines for the Step. Do not rewrite older sections.
- Final chat message: max 15 lines, then `git diff --stat` and `git status`, then STOP for Owner review.

## Hard rules

- Never touch or commit `apps/web/next-env.d.ts`.
- No commit/push/deploy unless the Owner explicitly says so.
- Never amend a pushed commit and never force-push `main` (or any shared branch) unless the Owner explicitly asks for
  that exact action; "add it to the same commit" after a push is not enough, ask first. Follow-ups after a push are new commits.
- Do not print or edit `.env`; never commit secrets.
- Windows shell: never use heredocs; write multi-line scripts to a scratch file first.
- Migrations are additive; never reset the DB, never delete volumes, never `db push`.
- Authorization is permission + branch scope server-side; never check role names.
- Money is integer VND. Timestamps are UTC; business dates use the branch timezone.
- Financial/operational history is never deleted or rewritten; corrections are explicit records.
- Do not invent TBD/Future policies (PRD section 61). Ask the Owner instead.
- Locked Owner decisions (Phase 4 Q0–Q10, OP-1…OP-7) are in the Phase 4 design doc; do not reopen them.
