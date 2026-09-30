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
- If a test fails for an unrelated, known reason (e.g. time-of-day fixtures), note it in one line
  and move on; do not investigate.

## Reporting (keep it short)

- Step report in `docs/`: max ~40 lines. What changed, migrations, permissions, tests run + result,
  open questions. No restating of the design contract.
- Update `LUCYSPA_HANDOFF.md` with at most 5 lines for the Step. Do not rewrite older sections.
- Final chat message: max 15 lines, then `git diff --stat` and `git status`, then STOP for Owner review.

## Hard rules

- Never touch or commit `apps/web/next-env.d.ts`.
- No commit/push/deploy unless the Owner explicitly says so.
- Do not print or edit `.env`; never commit secrets.
- Windows shell: never use heredocs; write multi-line scripts to a scratch file first.
- Migrations are additive; never reset the DB, never delete volumes, never `db push`.
- Authorization is permission + branch scope server-side; never check role names.
- Money is integer VND. Timestamps are UTC; business dates use the branch timezone.
- Financial/operational history is never deleted or rewritten; corrections are explicit records.
- Do not invent TBD/Future policies (PRD section 61). Ask the Owner instead.
- Locked Owner decisions (Phase 4 Q0–Q10, OP-1…OP-7) are in the Phase 4 design doc; do not reopen them.
