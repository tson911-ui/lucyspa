# UX/UI Redesign Step 2: Foundations (tokens, theme, typography)

Status: CLOSED / OWNER APPROVED (dark brand variant kept). Follow-up: `accent-color` set to the brand token in `base.css`. Not deployed. Contract: `UXUI_REDESIGN_DESIGN.md` sections 5-8.

## What changed

- `packages/ui/src/tokens.css` v2: `--ls-*` color (light, dark), status, chart (6 slots + surface/grid), typography scale,
  spacing, radius, sizes (control/row height switch to 44/56 px on touch), motion, z-index. Dark values are declared for
  `data-theme="dark"` and for system preference; legacy `--lucy-red/ink/muted/border/font-*` are aliases. `--lucy-gold`,
  `--lucy-gold-light`, `--lucy-ivory` are removed.
- `packages/ui/src/base.css` (new): reset, body typography, one focus ring, `::selection`, `prefers-reduced-motion`.
- Theme: `theme-core.ts` (cookie `ls-theme`, parse/serialize, `themeInitScript`) and `use-theme.ts` (`useTheme()` returns
  preference, resolved, `setPreference`). The root layout inlines the script in `<head>` (no flash); no cookie means system.
- `packages/ui/src/icons.tsx` (new): `Icon` with 35 inline line icons (24 grid, 20 px, 1.75 stroke, decorative unless `label`).
- Font: Be Vietnam Pro via `next/font/google` (latin + vietnamese, 400-700) in `[locale]/layout.tsx`, exposed as `--ls-font-sans`.
- `workforce.css`, `customer.css`, `globals.css`: every hex/gold/ivory literal replaced by tokens; the local `--wf-*` status
  palette and the login-only color overrides are gone (same values now come from global tokens). Layout rules untouched.
- `packages/ui`: `test` script added, tsconfig now includes `.ts`, `./base.css` export.

## Migrations / permissions / API

None. No change to `apps/api`, `packages/database`, `packages/contracts`, permissions or navigation.

## Additions beyond the contract table (all additive)

`--ls-on-danger` (text on solid danger; dark needs dark text), `--ls-brand-on-soft` (light = brand, dark `#f0b3be` from 6.2),
`--ls-chart-other`, `--ls-gutter`. Contract values are otherwise used verbatim.

## Tests run

- `@lucy-spa/ui` test: 18 pass (contrast >= 4.5 text / 3.0 UI over the token table in both themes, published 6.2 ratios
  reproduced, chart slots >= 3:1, both dark blocks identical, no gold, cookie/script behavior).
- `apps/web` `src/app/styles.test.ts`: 3 pass (no gold/ivory in web+ui src, no hex in the three stylesheets, no legacy aliases used).
- Typecheck `ui` and `web`, eslint + boundaries, prettier check on touched paths: clean. `pnpm --filter @lucy-spa/web build`:
  passes (font fetched; prerendered HTML carries the pre-paint script and font class).

## Not verified / notes

- No browser/visual check of either theme was done (no toggle UI until Step 5); the theme can be tried by setting cookie
  `ls-theme=dark|light` or via OS preference. Owner may want a quick look at `/vi/workforce` in both.
- Body font is now Be Vietnam Pro everywhere (public and member pages too); body `line-height` is 1.5 globally. Display
  serif (Georgia) stays for public `h1`/wordmark until Part 2.
- Dark elevation uses no shadow (`--ls-shadow-*: none`); dialogs keep their existing 1 px border.
- Sequential/diverging chart ramps are left to Step 6 (only the 6 series slots are tokenised).

## Open questions

None.
