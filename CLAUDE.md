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
  - Headings are text only: no decorative number, count, badge or symbol next to a heading (a small count reads as a stray
    "o" or a degree sign). Counts live in the table's "Hiển thị x–y trong n" line and in empty-state messages. (Owner rule, 2026-10-05)
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
  `lucy_spa_uxaudit_20261001` (never the dev DB), `node scripts/uxui-audit-capture.mjs <page...>` (committed; `--baseline` = the 26 baseline pages, `--all`), then
  `node scripts/uxui-audit-summary.mjs --compare docs/uxui-audit-baseline.json`. No count may rise; lower the ratchet
  (`UPDATE_RATCHET=1`) for what the Step retired. Compare migrated pages with `docs/references/` (8 questions, 21.5).
- **Phase 6 standing rule (Owner, 2026-10-07; applies to every Phase 6 UI Step, P6-3 included):** the UI must be polished,
  consistent and detailed, at the level of a professional product designer.
  - Existing design system, tokens, components and spacing scale only; no ad-hoc colors, fonts, sizes or one-off styles.
    Match the current lucyspa.vn site and admin exactly.
  - Clear visual hierarchy, consistent alignment, spacing and typography; nothing cramped or crowded, no overlapping text,
    no layout shift.
  - Every screen designed and checked for all states: loading, empty, error, success, disabled, long text, many items, no image.
  - Responsive: checked at 360, 768 and 1440 px, light and dark mode, and 130% text size.
  - Accessibility: proper contrast, visible focus, keyboard use, tap targets of at least 44px, a label on every input.
  - Short, natural Vietnamese; consistent terms; never "khám" (a spa, not a clinic).
  - Before reporting a UI Step: take the screenshots above, review them yourself against this checklist (and the Lovable
    reference where there is one), fix every issue, then report what was checked and anything that could not be fixed.

## UI design rules (permanent; Owner, 2026-10-09)

These add to the UX quality gate above; none of it is removed.

1. Use the `frontend-design` skill for every UI task: new screens from Phase 9 onward and the polish pass of existing screens.
   Where the skill and these rules disagree, these rules win. The brand is already decided, so the skill is used to raise
   layout, detail, typography hierarchy, motion and copy quality, never to change the brand.
2. Brand: primary red `#782b37` with white. Keep the existing light and dark modes, the approved fonts and the "LUCY SPA"
   text logo. No new palette, no new fonts. (Staff, POS and admin screens only; the customer site follows the section
   "Customer site redesign" below, which replaces this rule and rule 1's "never change the look" for the customer site.)
3. No gold or yellow anywhere, except holiday decorations (Tết, Mid-Autumn, national days) in the seasonal theme layer.
4. Hover: light mode = solid `#782b37` background with white text (not a pale pink tint); dark mode = the existing
   dark-mode pink accent.
5. Polish passes change UI only: no business logic, API, database or data changes. Never touch `apps/web/next-env.d.ts`.
6. Every UI change still goes through the quality gate (screenshots at 360/768/1440 px, light and dark, 130% text, all
   states, DOM audit vs baseline), with before/after screenshots for the Owner to approve.
7. Copy stays natural Vietnamese. Lucy Spa is a spa; never use "khám".

## Customer site redesign (permanent; Owner, 2026-10-09; the customer site only)

The owner finds the current customer site dated. The customer site (public pages, booking, account, shop) is redesigned to feel
modern, luxurious, simple and professional, like the current best brand websites. The owner's old Lovable prototype is no longer
a reference (do not use or copy it, cosmetics pages included). Brief, in the owner's words and our reading: minimal and calm, lots of
white space, a restrained palette (the brand red used sparingly as an accent), large confident typography, strong visual hierarchy,
large imagery, clean grids, subtle refined motion, a fast and clear booking path; nothing cluttered or decorative for its own sake.

- **Kept (unchanged):** `#782b37` as the brand accent, the "LUCY SPA" text logo, light and dark modes, no gold or yellow except holiday
  decorations in the seasonal theme layer, the hover rule (rule 4), natural Vietnamese copy (never "khám"), UI-only changes (rule 5), and
  the quality gate (rule 6, with before/after screenshots for the owner).
- **Now allowed on the customer site:** a new modern font pairing with full Vietnamese support (self-hosted through `next/font`), a
  refined secondary and neutral palette around the red, a larger type scale, generous spacing, bento and card layouts with large radius
  and soft shadows, subtle gradients or texture, a translucent or blurred sticky header, tasteful motion (always honouring reduced motion),
  modern icons.
- **Photos:** no stock photos without rights. Where the shop's photos are missing, use tasteful placeholders designed to be swapped for the
  shop's real photos later, and list the photos the owner should take.
- **Staff, POS and admin screens keep the current rules** (rules 1-7 above and the UX quality gate); this section does not apply to them.
- **Approved style (Owner, 2026-10-10): direction C, "Ấm áp thư giãn".** Soft and round: Fraunces titles with Nunito Sans text
  (self-hosted through `next/font`, set on the `.ls-site` frame only), a rose-cream page with a gentle wash, white / sage / blush / sand
  "pebble" cards (three big corners, one small), pill buttons and fields, soft rose shadows, round photo frames with a slowly
  breathing ring, soft waves between bands, a brand-red footer. All of it lives in `packages/ui/src/customer.css` (tokens scoped to
  `.ls-site`; the staff area is untouched). Every customer page follows it; holiday themes sit on top. The hidden preview routes are
  removed. Contract and the photo list: `docs/CUSTOMER_SITE_C.md`.

## Reporting (keep it short)

- Step report in `docs/`: max ~40 lines. What changed, migrations, permissions, tests run + result,
  open questions. No restating of the design contract.
- Update `LUCYSPA_HANDOFF.md` with at most 5 lines for the Step. Do not rewrite older sections.
- Final chat message: max 15 lines, then `git diff --stat` and `git status`, then STOP for Owner review.

## Hard rules

- Never touch or commit `apps/web/next-env.d.ts`.
- No commit/push/deploy unless the Owner explicitly says so.
- Production state is known only from the Owner's deploy reports recorded in `LUCYSPA_HANDOFF.md`. Never assume something
  is or isn't deployed; if the handoff doesn't record it, ask the Owner. When the Owner reports a deploy, immediately
  record the commit, applied migrations and date in `LUCYSPA_HANDOFF.md`.
- Never amend a pushed commit and never force-push `main` (or any shared branch) unless the Owner explicitly asks for
  that exact action; "add it to the same commit" after a push is not enough, ask first. Follow-ups after a push are new commits.
- Do not print or edit `.env`; never commit secrets.
- Windows shell: never use heredocs; write multi-line scripts to a scratch file first.
- Migrations are additive; never reset the DB, never delete volumes, never `db push`.
- Authorization is permission + branch scope server-side; never check role names.
- Money is integer VND. Timestamps are UTC; business dates use the branch timezone.
- Financial/operational history is never deleted or rewritten; corrections are explicit records.
- Vietnamese wording: Lucy Spa is a spa, not a clinic. Never use "khám" (e.g. "lượt khám", "lần khám") in Vietnamese UI text,
  emails, docs or reports; say "lượt đến" or "lượt làm dịch vụ". (Owner rule, 2026-10-04. The footer label "Khám phá" (Explore) was
  decided by the Owner on 2026-10-07: it stays as is, and this rule does not cover it.)
- Do not invent TBD/Future policies (PRD section 61). Ask the Owner instead.
- Locked Owner decisions (Phase 4 Q0–Q10, OP-1…OP-7) are in the Phase 4 design doc; do not reopen them.
- Never mark an open question (OQ-n) or a proposed technical decision (P5-Tn, OP-n, etc.) as approved yourself. Only the Owner's own
  words approve it. Stop and ask, and record it as "pending Owner approval" until the Owner answers; an answer collected through a
  question tool still has to be recorded exactly as given, and anything built on it is provisional until the Owner confirms.
