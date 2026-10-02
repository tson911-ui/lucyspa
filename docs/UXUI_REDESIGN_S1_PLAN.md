# UX/UI Step S1 plan: season registry, tokens, admin accent line

Status: PLAN APPROVED by Owner 2026-10-02 (greetings and windows approved with two edits, applied). Base `f219980`. Contract: `UXUI_REDESIGN_DESIGN.md` 20.1-20.3, 20.8, 20.9 and the
Owner decisions recorded in 20.10 (2026-10-02, incl. the scoped Tet / Mid-Autumn ornament exception to D1).

## Scope (S1 only)

Data registry, generated CSS, scopable selectors, neutral defaults, the admin accent line, the contrast/hue tests. **Not in S1:** ornament
SVGs, particles, greeting strip (S2); table, API, `season_id` (S3); admin tab (S4); reading the schedule, setting `data-season` on
`<html>`, the dashboard greeting chip, `apply_admin` (S5). With no `data-season` every screen renders exactly as today.

## Files

| Area      | File                                              | Change                                                                                                                                                                                     |
| --------- | ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| contracts | `src/season-registry.ts` (+ export in `index.ts`) | 8 presets: key, names VI/EN, default greeting VI/EN (max 80), accent set light + dark (6 tokens), ornament colors light + dark, `ornamentId`, suggested solar window (null for lunar)      |
| ui        | `src/season-css.ts`                               | pure `buildSeasonCss(presets)`; blocks per preset: `[data-season='x']` (light), `:root[data-theme='dark'] ...`, and the `prefers-color-scheme` block (dark systems), all scopable (20.9-1) |
| ui        | `src/season.css` (generated, committed)           | output of the builder; header says "generated, do not edit"                                                                                                                                |
| ui        | `src/tokens.css`                                  | neutral defaults `--ls-season-*` = brand values (`var(--ls-primary)` etc.), so nothing changes without a season                                                                            |
| ui        | `src/shell.css`                                   | topbar accent line: `box-shadow` reading `--ls-season-line`; `[data-season-admin='off']` turns it off (S5 sets it)                                                                         |
| ui        | `package.json`                                    | export `./season.css`; devDependency `@lucy-spa/contracts` (allowed by `check-boundaries`)                                                                                                 |
| web       | `app/[locale]/layout.tsx`                         | one line: import `@lucy-spa/ui/season.css` after `tokens.css` (CSS only, about 3 KB, no behavior)                                                                                          |
| root      | `scripts/generate-season-css.mjs`, `package.json` | `pnpm season:css` writes the file, `--check` fails if stale                                                                                                                                |
| docs      | S1 report (~40 lines), 5 handoff lines            | at the end                                                                                                                                                                                 |

Deviation to confirm: 20.9 says the line's default is the border color. A 2 px line in the border color would thicken today's 1 px
border, so the default is `transparent`; only a preset sets it (to its accent).

## Presets (keys) and greeting proposals for approval (Q-S6; Owner may edit)

Accent families as in 20.3; final hex values are fixed during S1 and must pass the tests below. Ornament colors: Tet and Mid-Autumn carry
the warm yellow ornament color (the exception); every other preset uses its accent family.

| Key                    | VI greeting                                                                 | EN greeting                                                              | Suggested window |
| ---------------------- | --------------------------------------------------------------------------- | ------------------------------------------------------------------------ | ---------------- |
| `tet`                  | Chúc mừng năm mới! Lucy Spa kính chúc quý khách an khang, thịnh vượng.      | Happy Lunar New Year from Lucy Spa. Wishing you health and prosperity.   | lunar: none      |
| `christmas`            | Giáng sinh an lành! Lucy Spa chúc quý khách một mùa lễ ấm áp.               | Merry Christmas from Lucy Spa. Warm wishes for the season.               | 15-26 Dec        |
| `valentine`            | Valentine ngọt ngào: dành thời gian chăm sóc người thương cùng Lucy Spa.    | Happy Valentine's Day: treat someone you love at Lucy Spa.               | 12-15 Feb        |
| `womens-day`           | Chúc mừng Quốc tế Phụ nữ 8/3! Hãy dành cho mình một chút yêu thương.        | Happy International Women's Day. Take a moment just for you.             | 6-9 Mar          |
| `vn-womens-day`        | Chúc mừng Ngày Phụ nữ Việt Nam 20/10! Lucy Spa chúc quý khách luôn rạng rỡ. | Happy Vietnamese Women's Day from all of us at Lucy Spa.                 | 18-21 Oct        |
| `mid-autumn`           | Trung thu vui vẻ! Chúc quý khách và gia đình một mùa trăng đoàn viên.       | Happy Mid-Autumn Festival. Wishing you and your family a joyful reunion. | lunar: none      |
| `reunification-labour` | Mừng lễ 30/4 và 1/5! Chúc quý khách kỳ nghỉ thư thái cùng Lucy Spa.         | Happy holidays on 30/4 and 1/5. Enjoy a relaxing break with Lucy Spa.    | 28 Apr-2 May     |
| `national-day`         | Mừng Quốc khánh 2/9! Chúc quý khách một kỳ nghỉ vui vẻ và bình an.          | Happy National Day, 2 September. Wishing you a joyful, peaceful holiday. | 31 Aug-3 Sep     |

## Tests (all in `packages/ui`, run by `pnpm test`; contracts is built first by that script)

1. **Registry:** exactly these 8 unique keys, VI and EN names and greetings non-empty and at most 80 characters, every accent and ornament
   value a 6-digit hex in light and dark, solar windows valid, lunar presets have none.
2. **Contrast, presets x {light, dark}** (20.3): accent text on page and surface at least 4.5:1; `on-accent` on accent and on both frame
   stops at least 4.5:1; `frame-text` on both stops at least 4.5:1; accent as a boundary at least 3:1.
3. **Hue rules (Q-S1):** no accent or frame token is gold/yellow hue in any preset; a gold-hue ornament color exists only in `tet` and
   `mid-autumn`; `reunification-labour` and `national-day` accents are rose/coral, clearly apart from danger red (6.4).
4. **Generated CSS:** `season.css` equals `buildSeasonCss(registry)` (fails when stale); every preset has the three scopable blocks; the
   two dark blocks are identical (extends the 20.9-3 rule); `--ls-season-ornament-*` is not read by `components.css`, `shell.css`,
   `base.css` (ornaments only), and only the topbar reads `--ls-season-line`.
5. **Neutral defaults:** `tokens.css` season defaults resolve to brand values; `tokens.test.ts` stays green (if its "every token has a dark
   value" check trips on `var()` defaults, the defaults go in one shared block instead).
6. **No-gold guards stay green:** `styles.test.ts` and `components-css.test.ts` ban the word "gold" and three old hex values in
   `apps/web/src` and `packages/ui/src`, so S1 names the tokens `ornament-warm-*` and avoids those hexes.
7. Also run: `pnpm --filter @lucy-spa/contracts typecheck`, `pnpm --filter @lucy-spa/ui test typecheck`, web `styles.test.ts` and
   `ui-ratchet.test.ts` (counters must not rise), `pnpm lint`, `pnpm format:check`. Whole-repo `pnpm test` only before a push.

## Screenshots and gate

- A scratch specimen page under `.local/` (git-ignored, not committed) loads the real `tokens.css`, `season.css`, `shell.css`,
  `components.css`: per preset, swatches (accent, soft, on-accent, frame gradient with its text, ornament colors), a topbar mock showing
  the accent line, and a primary button plus link to show brand tokens did not move.
- Render with `node scripts/uxui-screens.mjs seasons-s1 <file>` at 360, 768, 1440 light and 1440 dark; review against the 21 checklist;
  fix and re-render. UX gate note (5 lines) goes in the report. I will also run the DOM audit (scratch DB `lucy_spa_uxaudit_20261001`) on
  the dashboard and login pages, since `shell.css` changed, and confirm no count rises.

## Risks and open points

- Specificity: season blocks must win over `:root` when `data-season` is on `<html>`; `season.css` loads after `tokens.css` and the dark
  blocks use the attribute form. A test renders both cases in jsdom-free CSS string checks, plus the screenshots.
- S1 ships dormant CSS (about 3 KB on every page) until S5; Owner may prefer the layout import to move to S5. Default: keep it in S1.
- No other Owner question. Stop for approval before coding.
