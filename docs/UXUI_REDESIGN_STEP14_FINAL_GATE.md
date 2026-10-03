# UX/UI Step 14: Part 1 final gate

Status: run 2026-10-03 on base `219d33e` (production). Contract: `UXUI_REDESIGN_DESIGN.md` 18 (Step 14), 21.5. Real app on the scratch DB `lucy_spa_uxaudit_20261001` (API 3101, web 3100); integration on a fresh `lucy_spa_authtest_20261001` (all 43 migrations from empty).

## What passed

- `pnpm check` (format, lint, boundaries, typecheck, every package test, build): green (api 194, web 367, ui 392, server 35, worker 15 tests; unit counts before this Step's fixes).
- Integration, fresh scratch DB: database suites 70/70 + races 5/5; API suites 478/478 (0 skipped), including the new race file.
- Deferred races (S3 season lock, Step 12 popup lock, Step 13 slider lock): `website.race.integration.test.ts`, 9 cases on separate committed connections: one of two overlapping seasons/popups wins, the ninth slide is refused, touching seasons both enable, a season edit and a save of its linked popup/slide never deadlock. The three lock cases hold the advisory lock from a third connection and assert both commands wait. Mutation-checked: removing the season, popup or slide lock fails the test.
- Browser flow waived for Steps 12-13 (`flow-s12-13.mjs`, 22 checks, read back from the API): slider add through drawer and image picker, move button, keyboard drag, hide, delete; popup create page, overlap refusal naming the other popup, schedule strip; public home shows the live slide and popup (a dirty form triggers the unsaved-changes prompt).
- Real-app render, DOM audit and axe on 52 pages (admin 34, customer 8, public and auth 10) x 360/768/1440 light + dark = 312 renders: no error page, no 4xx/5xx, no redirect to login, no in-app error text. Theme forced by cookie.
- DOM audit on the 26 baseline pages, light: no count above `uxui-audit-baseline.json` or `uxui-audit-after-7_5.json` (off-grid 1202 to 0, small-target 43 to 0, off-scale-font 423 to 0; remaining: row-height-uneven 11 and list-height-uneven 3 on phone cards, sibling-gap 6, edge-left 4 and surface-style 4 on login/forgot/dashboard, wrapped-label 1).
- Every screenshot (312 + flow shots) was opened and reviewed.

## Fixed (one commit per group)

1. API keep-alive: Node closed idle sockets after 5 s, so the web proxy sometimes got `ECONNRESET` and showed "Đã có lỗi xảy ra" (seen on employee detail). Keep-alive 65 s.
2. UI: slide rows lost their text at 360 px (grip and arrows took the width; schedule clipped); date-time inputs overflowed the form column (266 px); phone card title alignment (centered or right on cells with a code line); breadcrumbs no longer repeat the page title on a phone; selected tab scrolls into view; income pager buttons no longer wrap alone; tablet/phone layout tests.
3. Accessibility (axe): form-section titles were `h3` under `h1` (now `h2` on pages, `h3` in dialogs); radiogroup ARIA on `fieldset`; unnamed landmarks (walk-in card, auth header, footer scene); 4 icon-nudge and 2 safe-area literals are tokens (`componentsCssSpacingLiterals` 6 to 0).

## Left for the Owner

- Ratchet not at 0: the customer area only (Part 2): `wfClassUses` 80, `nativeFieldsets` 4, `nativeCheckboxes` 1, `solidDangerButtons` 1 (booking cancel). The public/customer pages also carry the off-grid, off-scale-font and small-target findings.
- Axe after fixes: see the numbers in the final message; remaining items, if any, are listed there.
- `pnpm smoke`: see the final message.

## Deployment checklist (production at `219d33e`)

- No migration and no permission change since `219d33e`: `db:deploy` is a no-op; `db:permissions:sync` safe to repeat.
- Restart the API (keep-alive change). `MEDIA_STORAGE_DIR` must already be set, absolute, writable by the API user (API refuses to start otherwise).
- Backup scope: PostgreSQL plus `MEDIA_STORAGE_DIR` (originals and variants).
- Rollback: redeploy `219d33e`; nothing is stored in a new shape.
