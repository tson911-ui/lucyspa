# UX/UI Part 2, Step P2-1: foundations

Contract: `UXUI_REDESIGN_PART2_DESIGN.md` (sections 3-5, 7). Plan: `UXUI_REDESIGN_PART2_PLAN.md`.

## What changed

- **Tokens** (`packages/ui/src/tokens.css`): `--ls-text-3xl`, `--ls-text-display`, `--ls-font-display`, the customer-side motion
  tokens (`--ls-dur-reveal`, `--ls-dur-zoom`, `--ls-ease-premium`, `--ls-reveal-shift`, `--ls-stagger`, `--ls-parallax-shift`),
  `--ls-site-header-h`, `--ls-tab-bar-h`. Motion tokens are 0 under reduced motion. Playfair Display now loads 400/500/600.
- **Kit** (`packages/ui`): `site.css` (tokens only) and `SiteHeader` (client, scroll sentinel, shadow after scroll), `SiteNav`, `TabBar`,
  `SiteFooter`, `PublicMain`, `Band`, `PublicPage`, `PriceList`, `Steps`, `ChoiceCard` (native checkbox/radio in a label), `Reveal` +
  `reveal-core` (visible without JS, never hidden above the fold, off for reduced motion, data saver, low memory), `ThemeCycle`.
  `buttonClass` moved to the server-safe `button-class.ts` so server components can style a link as a button.
- **Web:** one site chrome (`site-chrome.tsx`, `site-chrome-client.tsx`), `siteNav` registry (`lib/site-nav.ts`: header, 5-tab phone bar,
  footer; a route that does not exist yet is `enabled: false`), `i18n/site.ts` (VI/EN), new home hero in the new chrome with today's copy
  and the existing Slider (brand panel while there is no slide), old `welcome-*`/`site-header`/`site-footer` CSS deleted from `globals.css`.
  The season frame receives the new header/footer unchanged (checked live with the Celebration kit on `/en`).
- **Audit script** (`scripts/uxui-page-audit.js`): the public display tokens count as type scale, `.ls-hero-actions` is an action place,
  public `main.ls-site-main` bands hold their own container (edge rule skipped).
- Not in this Step: account menu (P2-6), shop info and contact column (P2-2..4), services link (enabled in P2-4).

## Migrations, permissions

None.

## Tests

- `packages/ui`: new `site-frame.test.tsx` (menu, tab bar cap 5, steps, price list, footer, bands, ChoiceCard in jsdom, reveal gate and
  observer behaviour, site.css literals, motion tokens zero under reduced motion, admin CSS never reads them); `components-css` covers `site.css`.
- `apps/web`: new `site-nav.test.ts`; `styles.test.ts` (Playfair weights); ratchet gained `siteCssSpacingLiterals` (0).
- Whole repo `pnpm test`: see the final chat message. `pnpm format:check` clean.

## UX gate

- Real app (production build, scratch DB): `/vi` and `/en` at 360/768/1440 light and dark, `gate14.mjs`: DOM audit 0 findings on `/vi`,
  1 on `/en` (footer link "Book" 35 px wide, fixed with a minimum width), axe 0 on all 18 renders, season preview renders without error.
- Opened every screenshot of the final real-app render (`p2-1-final-*`, 360/1440 light and dark, the scratch DB has the Celebration season live,
  so the header row, dividers, strip and footer scene are seen around the new chrome; earlier dev renders at 768 too): header, tab bar
  (4 tabs until services exists), hero, brand panel, footer, dark colours, no horizontal scroll, 44 px targets on phones.

## Open questions

None.
