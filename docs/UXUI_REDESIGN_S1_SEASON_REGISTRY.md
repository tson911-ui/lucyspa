# UX/UI Step S1: season registry, tokens, admin accent line

Status: implemented on base `f219980`. Plan: `UXUI_REDESIGN_S1_PLAN.md` (approved 2026-10-02, greetings and windows approved with two edits). Contract: `UXUI_REDESIGN_DESIGN.md` 20.1-20.3, 20.9, Owner decisions in 20.10.

## What changed

- **contracts** `season-registry.ts` (exported from `index.ts`): 8 presets (`tet`, `christmas`, `valentine`, `womens-day`, `vn-womens-day`, `mid-autumn`, `reunification-labour`, `national-day`) with VI/EN names, approved greetings (max 80), light and dark accent sets, three ornament colors per theme, ornament id, suggested solar window (lunar = none). Data only.
- **ui** `season-css.ts` builds `season.css` (generated, committed, `pnpm season:css`, `--check`); selectors are scopable (`[data-season='x']` plus the dark toggle and system-preference blocks). `tokens.css` gained neutral `--ls-season-*` defaults equal to the brand. `shell.css`: topbar accent line (`box-shadow`, `--ls-season-line`, transparent by default; `[data-season-admin='off']` opts out, set by S5). `package.json`: `./season.css` export, `@lucy-spa/contracts` dev dependency (lockfile updated).
- **web** root layout imports `season.css` after `tokens.css` (inert: nothing sets `data-season` until S5).
- **Q-S1 exception** enforced by test: yellow only in the ornament colors of Tet and Mid-Autumn; no accent, frame, or other preset color is gold hue. No token or file uses the word "gold" (existing guard stays green).

## Migrations, permissions

None. No API, DB or permission change.

## Tests

- New `packages/ui/src/season.test.ts` (registry, greetings, windows, contrast for 8 presets x light/dark on 4 surfaces, hue rules, flag-day presets apart from danger red, generated file freshness, scopable blocks, neutral defaults, only the topbar reads a season token).
- Green: `@lucy-spa/ui` 286/286 (incl. `tokens.test.ts`, `components-css.test.ts`), contracts and ui typecheck, `pnpm season:css --check`, web `styles.test.ts` and `ui-ratchet.test.ts` (no counter moved), `pnpm lint`, `pnpm format:check`, whole-repo `pnpm test`.

## UX gate (specimen, not a page)

- Rendered a scratch specimen (`.local/season-s1/`, git-ignored) at 360, 768, 1440 light and 1440 dark: swatches, frame, ornament dots, topbar line, brand button and link.
- Layout is on the 4 px grid, edges align, no horizontal scroll; the brand button and link stay `#782b37` (dark: brand fill) in every season.
- Accent line is visible under the topbar for each season and invisible for the neutral card; yellow appears only in the Tet and Mid-Autumn dots.
- The 24 px link and 40 px button flagged by the helper are specimen mock-ups, not shipped UI.
- DOM audit on the real app (scratch DB, built web and API, servers stopped): dashboard 86 -> 10, login 11 -> 10 versus the baseline; no count rose.

## Open questions

None. Next: S2 (decoration kit), after Owner review of S1.
