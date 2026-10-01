# UX/UI Step 7.5a: frontend rules and quality gate v2

Status: CLOSED / OWNER APPROVED (2026-10-01). Not deployed. Plan: `UXUI_REDESIGN_STEP7_5_PLAN.md` (7.5a). No UI code changed.

## What changed

- **Design contract** (`UXUI_REDESIGN_DESIGN.md`): new **21.4** (rules FR1-FR15, each with how it is checked) and **21.5** (gate v2: tooling, environment, per-Step procedure, DOM checks, ratchet, 8-question reference comparison, baselines). Approved amendments written in: 9.1 `RowActions` and 10.4 (single `⋮` menu, name cell is the link), 10.3 (Cancel then Save, primary last, also in forms and dialogs), 21.1-1 (multiples of 4, block gaps multiples of 8). Index and Step table get a 7.5 row. Prettier re-padded the tables of that file, so the diff is larger than the content.
- **`CLAUDE.md`**: UX gate section now carries the spacing rule, a 7-line FR digest, the Radix/no-Tailwind note and the audit + ratchet commands.
- **`scripts/uxui-page-audit.js`** (new, committed): the DOM audit promoted from `.local`, every finding tagged `FR*`. Added checks: `unpaged-list` (>20 rows without pagination), `sibling-gap-uneven`, `heading-equals-control`, `orphan-action` (lone buttons; header actions under the title on desktop), `toolbar-label-above`, `wrapped-label`. Existing checks unchanged (counts match the Step 7 audit: the new run is light only, so exactly half of its light+dark numbers).
- **`scripts/uxui-audit-summary.mjs`** (new): table, `--write`, `--compare`, `--page/--type`.
- **`apps/web/src/test/ui-ratchet.test.ts` + `ui-ratchet-baseline.json`** (new): static counters that may only go down (raise fails; lowering must be recorded with `UPDATE_RATCHET=1`).
- **Baselines**: `docs/uxui-audit-baseline.json` (for `--compare`) and `docs/UXUI_AUDIT_BASELINE_7_5A.md` (readable). Ratchet at baseline: raw `<table` 24, `wf-*` uses 726, `<details` 23, `<fieldset` 20, native checkbox 18, solid danger outside dialogs 10, spacing literals workforce.css 80 / components.css 7 / shell.css 1.

- **Owner addition at approval:** `.claude/settings.json` + `.claude/hooks/block-heredoc.mjs`: a PreToolUse hook on Bash that blocks any command containing `<<` and answers "Dùng Write/Edit thay heredoc (CLAUDE.md)" (exit 2). Tested: a sample JSON input exits 2, a plain command exits 0, and a live heredoc call in the session was blocked. No other permission or hook was changed.

## Migrations / permissions / API

None. No change to `apps/api`, `packages/database`, `packages/contracts`, `packages/ui`, screens or CSS. `apps/web/next-env.d.ts` untouched.

## Tests and checks run

- Audit DB `lucy_spa_uxaudit_20261001` found, migrations "no pending", permissions synced (40 present); built API (3101) and web (3100) started, **26 pages x 3 widths (light) audited twice** (second run after fixing two checks); both servers stopped afterwards. Dev DB not touched.
- Ratchet test: 1/1 pass; verified both failure paths (raised counter fails, lowered counter fails until recorded) and `UPDATE_RATCHET=1`.
- eslint 0 warnings on the three new files; prettier clean on touched files; `--compare` of the baseline with itself shows 0 delta.

## UX gate

No screen changed, so no 360/768/1440 renders were taken; the gate for this Step is the audit itself: 26 pages at 1440/768/360 in light on code `99d77d5` (UI identical to `4d540c6`).
Baseline totals (findings): off-grid spacing 1,202, off-scale font 423, sibling gaps 159, wrapped labels 157, content overflow 98, nested borders 47, toolbar labels 40, small targets 43, duplicate titles 15, unpaged lists 3 (Services), orphan action 3, horizontal scroll 1 (Leave, 768).
Limits: `orphan-action` is a heuristic (finds the POS "Tải lại" at 1440 only); `sibling-gap-uneven` and `wrapped-label` may flag deliberate layouts and are reviewed, not silenced; the audit cannot see closed dialogs. Dark mode was not re-run (identical in the Step 7 audit).
Images: none new; Step 7 audit shots remain in `.local/uxui-audit/shots/`, results in `.local/uxui-audit/results/` (first run kept in `results-7_5a-first/`, Step 7 results in `results-step7-audit/`).

## Open questions

- None blocking. `.local/uxui-audit/capture.mjs` (credentials, seeds) stays machine-local and now loads the committed `scripts/uxui-page-audit.js`; 21.5 documents how to rebuild it.
- Reminder for 7.5b/7.5d: the Owner deploys and reviews on the real app before the next session starts.
