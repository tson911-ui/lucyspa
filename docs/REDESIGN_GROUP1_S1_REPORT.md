# Redesign group 1, session 1: C1, C2, C3 (report)

Commits (local, not pushed): `312dc3e` plan + C1, `7e05d0e` C2, `dc4590c` C3, `e3d9ade` C3 follow-up.

## What changed

- **C1 (no app code):** `docs/REDESIGN_GROUP1_PLAN.md` (C1-C19, 8 sessions, a status line per Step), `scripts/uxui-customer-pages.json` (42 customer
  pages + the member each needs), `docs/REDESIGN_GROUP1_BASELINE.md` (scratch-DB and capture recipe). "Before" = HEAD, which has the same app code as production `04ceaa5`.
- **C2:** the `data-ui="v2"` token scope in `tokens.css` (light, dark twice, forced-light preview, bands, no shadow, radius 8/18/pill, 44/56 sizes,
  customer motion with `--ls-dur-hero`, `data-density="compact"` hook, document background). Set on the customer frame and the season preview.
  Portals: none exist (no `createPortal`; dialogs, menus, tab bar render inside `.ls-site`), so one attribute covers every overlay.
- **C3:** Be Vietnam Pro only, role tokens (display to caption, heading line height at least 1.2), v2 heading defaults in `base.css`, flat page, serif and italic removed
  from `customer.css`. `site-fonts.ts` is **not** changed: its Fraunces and Nunito variables sit on the root `<html>` and staff screens read them until groups 2 and 3.
  Be Vietnam Pro is already loaded at the root. Deviation from the plan text, forced by the plan's own shared-CSS rule.
- **Follow-up:** footer icon targets 48 px (overhang on the 4 px grid), phone product-card price on the body role, one test updated.

## Migrations, permissions

None.

## Tests

`packages/ui` 515 pass (new: `tokens-v2.test.ts` 14, `tokens-v2-type.test.ts` 10; `customer-tokens.test.ts` and `contact-fab.test.tsx` updated), `apps/web` 1075 pass,
`pnpm lint` clean, ui and web typecheck clean, `pnpm format:check` clean. Staff area checked in a browser: still Nunito/Fraunces, rose page, old radius and shadow.

## UX gate (session 1)

1. **Screens:** 42 pages before (360/768/1440 light, 1440 dark) + extras (hero states, season, popup, 130 % text, footer blocks); after: 10 key pages + season home + 130 % text. All contact sheets opened.
2. **DOM audit vs baseline:** off-grid 251 to 11, surface-style-mix 3 to 0; content-overflow and sibling-gap fixed or equal on the pages re-measured after the follow-up.
3. **Computed styles** (browser, light and dark): v2 tokens, 17 px body, 600 headings, 56 px display, Be Vietnam Pro everywhere on the frame.
4. **Not done yet:** 200 % text and the full all-pages after set (later sessions as pages are rebuilt); `uxui-touch-check` flags only the theme button, which changes theme on tap (time-of-day artifact, 04:00 = dark).
5. **Interim look:** pebble corners, waves, red footer and the home layout are still direction C; they go in C9-C16.

## Open

- Direction C pastel tokens (`--ls-c-*`) now alias the neutral band; deleted in C18.
- Footer icon targets leave 4 px between neighbours (DESIGN.md 12 wants 8); C9 rebuilds the footer.
