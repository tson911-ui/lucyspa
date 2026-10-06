# Public header and motion package (2026-10-06)

Owner-approved package for the public site and the member pages. The staff top bar is untouched.

## What changed

- **A. Active tab bug.** Cause: the sliding pill and the no-script fallback were painted with `--ls-brand-soft` (pale pink,
  brand-coloured text); only a `:has(...:hover)` rule swapped them to the solid hover fill. The transparent header was not
  involved. Now the pill and the fallback read `--ls-nav-active-bg/-text` (brand red + white, pink + dark in dark mode),
  the same tokens as the staff sidebar. The member row (`SiteSubNav`) shares the pill, so it is solid red too.
- **B. Header on every page.** `SiteHeader` has no `overlay` switch any more. At the top it is clear. After 48 px
  (`--ls-header-shrink-at`) it shrinks and becomes frosted glass. The box stays `--ls-site-header-h` high (no layout
  jump, `main` keeps its place). The glass surface is the header's `::before` (opacity + translate), the row follows by
  half the shrink, logo and menu scale to `--ls-header-lead-scale`. Solid surface where `backdrop-filter` is missing.
- **C. Motion.** Pill glides to the hovered or keyboard-focused tab and back (`useSlidingPill({ follow })`, mouse and
  keys only, text colour follows via `data-under`); tab zoom removed. Round tools scale up on hover. Person menu and bell
  panel grow from the trigger and close the same way (`Popover` stays mounted for the exit, opt-in by CSS; staff menus
  unchanged). Bell rings once when the unread count rises (not on first read). `Đặt lịch ngay` keeps the zoom and gets a
  sheen (`ls-btn-sheen`). Arrow nudge uses a token. Scroll reveal added to the member pages (cards and sections, not rows).
- **D.** All durations, distances and scales are tokens (`--ls-dur-header/-glide/-pop/-wiggle/-sheen`, `--ls-pop-*`,
  `--ls-tool-zoom`, `--ls-wiggle-angle`, `--ls-arrow-nudge`), zero or neutral under reduced motion. Hover effects sit
  behind `(hover: hover)`; transform/opacity only.
- Popover places itself relative to its containing block (probe), because the shrinking row is translated and a fixed
  panel inside it would otherwise land 6 px off. Checked open while scrolled at 360 and 1440.

## Migrations / permissions

None.

## Tests

Full `pnpm test` (all packages, green), typecheck ui and web, `format:check`, eslint, boundaries. New: pill follow, header CSS
contract, motion tokens, `popover-exit.test.tsx`. In the browser: the bell rings on 3 to 4 unread (once, clears, no
re-ring on the same count); with reduced motion the pill never slides and the panel closes at once.

## UX gate

1. Rendered 360/768/1440 light and dark (home, Dịch vụ, Lịch hẹn, Hóa đơn, Điểm thưởng, Tài khoản at top and scrolled;
   Tết and Christmas at the same sizes). Opened and read: the services, home, bookings, invoices, loyalty, account,
   Tết and Christmas shots listed in the Owner report (the other PNGs were measured, not opened).
2. Measured: header box 64 px in every state, `main` position identical top vs scrolled, no horizontal scroll, pill
   `rgb(120,43,55)` light / `rgb(224,138,154)` dark with its own text colour.
3. Hover, keyboard focus, bell and person panel, top and scrolled, 360 and 1440, light and dark: panel top = trigger
   bottom + 4 px.
4. Frame sheets (not video) of shrink/grow and glide: `.local/uxui-screens/motion-frames-1440-light.png`; capture latency
   misses most in-between frames.
5. DOM audit (scratch DB `lucy_spa_uxaudit_20261001`), home and account-login: home 360 keeps one `sibling-gap-uneven`
   finding, identical on the parent commit (rebuilt without these changes). The compare's `edge-left` 4 to 8 comes from
   stale staff results (`forgot`, `login`) that this change does not touch.

## Open

- Not rendered: booking detail and invoice detail (stub has no data); they use the same `Page` grid, which only reads
  its children's `gap`.
- Điểm thưởng and Tài khoản are in the person menu, so no tab is highlighted there (by design).
- The seasonal wordmark accent (Christmas hat, Tết branch) fades out in the compact bar, where it would be clipped.
