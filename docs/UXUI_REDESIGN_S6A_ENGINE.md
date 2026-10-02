# UX/UI Step S6a: site-wide season art engine, Tet and Christmas kits, screenshot gate

Status: implemented on base `8322941`. Plan and locked Owner decisions: `UXUI_REDESIGN_S6_PLAN.md` (sections 3 and 11). Web, kit and contracts only; no API, schema, migration or permission change.

## What changed

- **Gate**: `scripts/uxui-screens.mjs` fails (exit 3, no image) on an unreachable server, HTTP 4xx/5xx, a browser error page, an empty page or a missing `--expect`; `--theme-cookie` sets `ls-theme` (the app's auto theme follows the clock, not the emulated scheme). CLAUDE.md gained "never report screenshots without opening each one". Test `screens-gate.test.ts` (no browser needed).
- **contracts**: `lunar-year.ts` (Vietnamese 12-animal cycle with correct can-chi; the Tet year is computed from the window's last day in Vietnam time) and `art` palettes + footer lines for `tet` and `christmas` in the registry; `season.css` now also emits `--ls-art-*`.
- **ui** (`season-art-*.tsx`, `season-scene.tsx`, `season-site-fx.tsx`, `season-art.css`): slots header row (lanterns on a cord / string lights), logo accent (mai sprig / santa hat), corners, dividers, greeting strip with the effects switch inside it, footer scene (li xi, paper firecrackers, the 2027 goat / trees, gifts, snowy hills), tint, and one particle layer **behind** the content with a soft hole over every line of text, control and image (measured from the DOM; re-measured on resize, font load, content change). Density low/medium/high = 12/24/40 (6/12/20 on phones), pool grows with page height (max 3 screens). Footer greetings sit on a panel; tablet (1023) and phone (760) tiers.
- **Zodiac**: the Tet footer shows `Xuân Đinh Mùi 2027` computed from the end date; only the goat has art, any other year draws no animal. Rule recorded in the code and test: every animal in Tet style (red/yellow khan, li xi, blossoms, coins).
- **web**: `siteDecorSpec`, `SeasonSiteFrame` (public layout) and the member area (tint, particles, strip; its own shell keeps its header/footer). Kits without art (Valentine ...) keep the S5 band. No season = exact old markup.

## Tests and checks

- New: `season-zodiac` (2020-2031, cycle, window end), `season-art` (palettes, yellow only where allowed, contrast of panel text, generated CSS, goat only), `season-art-css`, `season-site-fx-core` (density, mask), `season-site-fx` (jsdom: after paint only, reduced motion, `ls-fx=off`, hidden tab, keep-out collector), web `season-site` and updated `season-core`. Ratchet counter `seasonArtCssSpacingLiterals` = 0.
- Typecheck, lint, `pnpm format:check`, whole-repo `pnpm test` before the push (see the commit/CI).

## UX gate (real web build over a stub API with an active season; 360/768/1440 light, 1440 dark, Tet and Christmas; 8 images opened)

1. Fixed during the gate: 768 px lanterns overlapped and the strip squeezed its switch (tablet tier added); footer art covered the greeting; Christmas phone plaque wrapped; 1px default button padding.
2. Rows are on the 4 px unit; no horizontal scroll; text never under art; petals fade out over text (frames are random; a frame taken at a resize can lag the 150 ms re-measure).
3. DOM audit (the repo audit script on the real home, with vs without a season): identical counts at 360 and 1440, light and dark. The audit script now ignores season decoration (`.ls-art`, `.ls-fx-site`) like `.ls-fx`.
4. Remaining findings on the home are the legacy public layout (as before). Screenshots: `.local/uxui-screens/s6a-*` (git-ignored).
5. Not run: the full real-API scratch-DB capture (the stub serves the public season only); admin form preview of the computed year name is S6b.

## Deploy / open questions

Web only (kits ship with the build). None.
