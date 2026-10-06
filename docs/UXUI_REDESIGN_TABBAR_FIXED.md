# Phone tab bar anchored to the screen edge (2026-10-06, after production d0fc191)

Owner report: on a phone there is a gap below the tab bar labels where the page shows through.

## Cause

The bar was `position: sticky; bottom: 0` as the last child of `.ls-site`, a box of `min-height: 100svh`. A sticky bar follows
its parent box, not the screen: when the phone browser's toolbar shows or hides, the visible screen and the page box
(sized by `svh`) disagree, and a strip of page shows below the bar. Two more weaknesses: the page did not declare
`viewport-fit=cover`, so `env(safe-area-inset-bottom)` was always 0 and the browser decided what lay under the iPhone's
home indicator; and the booking tab's two-line label made the bar taller than the 64 px token the page assumes.
Not causes: no bottom offset or margin, no transform from the scroll code, the shared layout of the flash fix is not involved
(the contact button's own sticky row is unrelated). A desktop browser cannot reproduce the toolbar, so the measured proof
is the position (`sticky` before, `fixed` now) plus the pixel check below on a simulated toolbar and safe area.

## What changed

- `.ls-tab-bar` is `position: fixed; bottom: 0`, opaque surface colour, the safe area is `padding-block-end` INSIDE the bar.
- Below 1024 px the page (`.ls-site`) ends with `tab-bar height + safe area` of padding, so the last content (the footer)
  scrolls fully above the bar; the booking pages (own action bar, no tab bar) reserve nothing; `scroll-padding` keeps a
  focused element out from under the bar.
- Root layout exports `viewport` with `viewportFit: 'cover'` (the page covers the whole screen, the bar draws the safe area);
  `body` pads the left and right notch insets.
- Tab links are exactly 64 px high (was `min-height`); the raised booking button is lifted 20 px so its two-line label fits.

## Tests

- `scripts/uxui-tabbar-check.mjs <url>` (new gate script, headless Edge/Chrome): for 5 pages x 360/390/768 x light/dark, at the
  top, the middle and the very bottom, with the toolbar hidden (viewport +80 px), after fast scrolling and with a 34 px safe area,
  it checks the bar is `fixed`, flush to the bottom, opaque, the bottom screenshot rows are the bar's colour on every column
  (read back through a canvas), the safe area is padding inside the bar, and the footer ends above the bar.
  Before: 70 of 70 checks failed (sticky, labels). After: 210 checks, 0 failed. It first caught the 5 px footer overlap.
- `packages/ui/src/tab-bar-css.test.ts`: fixed, bottom 0, safe area inside, page reserve, booking pages reserve nothing.

## UX gate

Home, Dịch vụ, Lịch hẹn, Hóa đơn, Đặt lịch at 360/390/768, light and dark: rendered; mid-page and very-bottom shots with a
34 px safe area (60 images); opened home end 390 light, Dịch vụ mid 360 dark, Hóa đơn end 768 light, Đặt lịch end 390 dark:
the bar is flush, its colour reaches the edge, nothing shows below it, the last line of the footer is above it.

## Open

- The booking pages' own bottom action bar is still sticky (it replaces the tab bar there); same remedy if the Owner sees
  the same gap on it. Not touched: not reported.
- Landscape phones with a notch now keep content off the notch (new `body` inset padding); not checked on a real device.
