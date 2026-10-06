# Phone app shell (2026-10-06, after production 15cd7e0)

Owner report: page text still showed below the tab bar labels on a phone (about 402x910, dark, mid page); three CSS patches to a
fixed bar failed. Owner decision: stop patching, change the layout model below 1024 px.

## What changed

- **Below 1024 px the customer pages are an app shell.** `.ls-site` is one column of fixed height (`100vh`, `100svh`, `100dvh`,
  `overflow: hidden`); the page lives in `.ls-site-scroll` (`data-ls-scroll`), the ONLY scroll container (`overflow-y: auto`,
  `position: relative`, `scroll-padding-top` = header height); the tab bar is the last item of the column, in the flow, opaque,
  safe area as padding inside it. The document never scrolls, so nothing can be behind or below the bar. `html` is the bar colour
  below the shell, so any browser strip around it only reads as a longer bar.
- **From 1024 px nothing changes:** the wrapper is `display: contents`. Pixel check: 5 pages x 1024 and 1440 px x light/dark,
  before and after: 0 different pixels in all 20 pairs.
- **Scroll listeners follow the scroller** (`packages/ui/src/scroller.ts`: `findScroller`, `onPageScroll`, `scrollPosition`):
  contact button auto-hide, scroll reveal (`startsVisible` measured against the scroller), dialog and drawer scroll lock (also
  locks the scroller; shared with admin, a no-op without one). The header glass uses an intersection observer (works inside a
  scroller). New `SiteScrollManager`: a new page starts at the top; back/forward returns to the position that page was left at.
- **Contact button** sticks to the bottom of the scroller (`--ls-fab-base: 0` on phones). **Booking action bar** stays sticky at
  the bottom of the scroller (the tab bar is hidden on those pages), a deviation from "separate slot": same place, same model.
- **Keyboard:** `interactive-widget=resizes-content` and the bar hides while a text field has focus.
- Kept: `viewport-fit=cover`, `minimum-scale=1`, no flash on navigation (frame recorder: no reload, header/tab bar/footer not
  replaced, opacity 1, no blank frame, layout shift 0), glass header, season frames.

## What is different for customers

- The browser's address bar no longer hides while reading (only a scrolling document does that), so the page area is a bit
  shorter. Pull-to-refresh is left at its default so a pull at the top can still reach it (check on a phone). iOS "tap the status
  bar to scroll to the top" may not reach the inner scroller. A browser window narrower than 1024 px on a desktop now shows the
  shell with a scrollbar inside it.
- No back-to-top button or infinite list exists on the customer pages, nothing to port.

## Gate (`scripts/uxui-tabbar-check.mjs`, rewritten)

Scrolls the scroller, not the window. Per stop (top, 100 px, middle, bottom, fast scrolling), 360/390/402x910/408x908/440x956,
ratios 1/2/2.625/3, light/dark, logged in, safe area 0 and 34 px: the bar is in the flow and its top is the scroller's bottom; every
pixel row from the bar's top to the screen bottom is the bar colour; the document does not scroll; nothing is wider than the screen;
the footer ends above the bar; the header is glass after 100 px and clear at the top; icons and labels are inside the screen.
Plus a keyboard proxy on the login page. At ratio 2.625 the screenshot has one half row below the page's layout box that no element
paints (a red bar, a green html and a green shell left it unchanged): it is not counted and the run prints a note.

## Open (phone checks, headless cannot show them)

Address bar and pull-to-refresh on Chrome Android and Safari; the iOS keyboard moving the shell; the status-bar tap.
