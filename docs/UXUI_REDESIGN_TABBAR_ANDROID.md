# Tab bar cut off + hover stuck on touch (2026-10-06, after production 0be4abe)

Owner report: (1) the phone tab bar sits too low, only the top half of the icons shows, the labels are off screen (real
Android Chrome phone, toolbar collapsed; also in Chrome DevTools "iPhone 16 Pro Max" 440x956 at 50 % and 75 % on
`/vi/account/bookings`); (2) the round header button stays red after a tap.

## Cause

1. A page wider than the screen. A phone browser answers it by zooming out to fit the page; the layout viewport (where the
   `position: fixed; bottom: 0` bar is anchored) is then taller than the visible screen, so the bar's lower part falls below the
   screen edge. Reproduced here: at 360 px with 130 % text the header tools overflow by 23 px, `innerHeight` becomes 830 while the
   visual viewport stays 780, and the bar is 50 px below the screen (labels cut off). The old gate compared the bar with
   `innerHeight` only, so it could not see this. I could NOT reproduce the Owner's exact 440 px case on the scratch data (nothing
   overflows there); on their real data some element overflows, and the fix below covers any source.
   `viewport-fit=cover` (also added in 0be4abe) was my first suspect and is not proven; it is removed as a precaution.
2. Every colour hover rule of the round header tools (`.ls-site-tool:hover`, `.ls-theme-cycle:hover`) was bare. A tap leaves
   `:hover` on the element in a touch browser until the next tap elsewhere, so the red fill stayed. Only the zoom was guarded.

## What changed

- Root layout: `viewport` is `width=device-width, initial-scale=1, minimum-scale=1` (no zoom-out to fit; zooming in stays free),
  no `viewport-fit=cover`. `.ls-site` has `overflow-x: clip` (no scroll container, the sticky header is unaffected).
- Tab bar: height token 4rem to 4.5rem (the two-line "Đặt lịch ngay" label touched the screen edge at safe area 0); the top line is
  a 1 px shadow instead of a border, so the page's reserved height matches the bar exactly (the footer was 1-2 px under it).
- All `:hover` rules of the kit (`components.css`, `shell.css`, `site.css`, 88 selectors) are inside
  `@media (hover: hover) and (pointer: fine)`; grouped selectors with `:focus-visible` were split, focus stays unconditional.
  Touch keeps the `:active` press dip only (it ends with the tap). The bell panel's flat buttons rest flat on touch.

## Tests and gates

- `packages/ui` 461 tests pass (new: no bare `:hover` anywhere; no `viewportFit`, `minimumScale: 1`, `overflow-x: clip`); typecheck clean.
- `scripts/uxui-tabbar-check.mjs` now also fails when a tab's link, icon or label is outside the layout or visual viewport, a label
  touches the edge of its tab, the bar is not flush with the visual viewport, or the page is wider than the screen (names the
  elements). Runs safe area 0 and 34 px, 360/390/414/768, light/dark, toolbar shown/hidden, touch emulation, 130 % text;
  `--height --scale --dpr --cover --inject --shots` for repro and pictures. Before the fix, 130 % text at 360 px: 76 of 840 failed.
- New `scripts/uxui-touch-check.mjs`: taps theme, language, bell, account, contact buttons and a tab, compares the computed look
  before and after; `--inject-sticky` (the old bare rule) fails it, the fixed CSS passes.

## Open

- Verify on the Owner's phone and in DevTools 440x956 before deploy. If an overflow source exists on their pages it is now
  clipped, not visible; tell me the page and I will fix the element itself.
- At 130 % text on 360 px the header tools are 23 px too wide and now clip instead of scrolling; they should shrink (not done).
- The hero slider pauses on `mouseenter`, which a tap also fires (not changed).
