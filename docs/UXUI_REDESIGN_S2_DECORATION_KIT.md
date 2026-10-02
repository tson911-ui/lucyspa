# UX/UI Step S2: season decoration kit

Status: implemented on base `796cdf1` (S1 approved, CI green). Plan: `UXUI_REDESIGN_S2_PLAN.md` (approved 2026-10-02: particles only inside the banner band, particles per preset as recommended, ornament art approved after the specimens). Contract: `UXUI_REDESIGN_DESIGN.md` 20.2, 20.5, 20.10.

## What changed

- **ui** `season-ornaments.tsx`: 8 flat inline-SVG motifs (`SeasonOrnament`, one corner or a row of up to 3). Decorative only: `aria-hidden`, no focusable child, no image or request; colors only through classes that read `--ls-season-ornament-1..3`.
- **ui** `season-frame.tsx`: `SeasonFrame` (gradient banner from the frame tokens, ornaments in fixed side gutters, `presetKey` scopes a preview with `data-season`) and `GreetingStrip` (thin strip, wraps to two lines on a phone).
- **ui** `season-particles.tsx` + `season-fx-core.ts`: `SeasonParticles` (petal, snow, lantern, heart), `SeasonFxToggle` and `useSeasonFx` (`ls-fx` cookie, 1 year, Lax). Pool 24 (12 on phones), deterministic layout, `transform`/`opacity` only, nothing on the server or first paint, nothing under reduced motion or `ls-fx=off`, paused in a hidden tab. Particles stay in the two outer gutters of the band, never over the text.
- **ui** `season-decor.css` (export `./season-decor.css`), token `--ls-dur-drift`; root layout imports it (inert without `data-season`).
- **contracts** registry gains `particle` per preset and typed ornament ids. **Ornament colors from S1 were re-chosen**: the light sets were invisible on the frame gradient (1:1), so every ornament color is now at least 3:1 against both frame stops in both themes (new test). Yellow stays only in Tet and Mid-Autumn (Q-S1). `season.css` regenerated.

## Migrations, permissions

None. No API, DB or permission change.

## Tests

- New: `season-decor.test.tsx` (jsdom: ornaments, frame, greeting, particles, phone pool, reduced motion, cookie switch, hidden tab, no focusable child), `season-fx-core.test.ts`, `season-decor-css.test.ts`, `season-kit.test.ts` (registry table, ornament-on-frame contrast, specimen guard); `components-css.test.ts` now also covers `season-decor.css`.
- Green: `@lucy-spa/ui` 314+ tests, contracts and ui typecheck, `pnpm season:css --check`, web `styles.test.ts` and `ui-ratchet.test.ts` (new counter `seasonDecorCssSpacingLiterals` = 0), lint, `pnpm format:check`, whole-repo `pnpm test`.

## UX gate (specimens)

- A temporary route rendered all 8 presets (banner with ornaments and particles, strip, ornament close-up) at 360, 768, 1440 light and 1440 dark, plus the switch turned off; it is deleted and a test fails if it returns. Specimens: `.local/season-s2-specimens/` (git-ignored).
- First review showed particles crossing the greeting; they now live only in the gutters, and the unused close-up on a light surface was dropped (ornaments are made for the frame).
- Spacing is on the 4 px grid, edges align, no horizontal scroll, text never under an ornament; the toggle is a real ghost button (40/44 px) whose label switches "Tắt hiệu ứng" / "Bật hiệu ứng".
- Deviations from the plan: no `--ls-z-fx` token (the layer is clipped inside the band) and the switch uses a changing label instead of `aria-pressed`.
- DOM audit on the real app (scratch DB, servers stopped): dashboard 86 -> 10, login 11 -> 10; no count rose.

## Revision 2 (Owner art review of the specimens, 2026-10-02)

- Tet, Valentine, 8/3 and 20/10 unchanged. **Christmas** `christmas-ornaments`: pine tree with star, baubles and a bell (replaces the branch). **Mid-Autumn** `star-lantern-moon`: five-point star lantern (đèn ông sao) and a crescent moon; the rising particle is now a star lantern too. **30/4-1/5** `star-fireworks` and **2/9** `star-lotus`: brighter red banner, solid yellow five-point star, static firework bursts (2/9 also a lotus outline).
- The scoped yellow exception now covers the ornaments of Tet, Mid-Autumn, 30/4-1/5 and 2/9 (design 20.2, 20.3, 20.10, D1 updated; accent, frame text and buttons never yellow). The two flag-day presets keep a rose accent (at least 20 degrees from danger red) with a red decorative banner; tests for hue, contrast (ornaments 3:1 on the banner) and the motif shapes were updated.
- Ornament ids renamed (`pine-branch`, `lantern`, `line-star`, `lotus` are gone); nothing stores them yet. `season.css` regenerated. Re-rendered specimens: `.local/season-s2-specimens/rev2-all-8-presets-1440-light.png` and `-dark.png` (temporary route deleted again).

## Open questions

None. Next: S3 (migration `website_seasons`, API), after Owner review of the specimens.
