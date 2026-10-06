# Strip below the tab bar + see-through header (2026-10-06, after production cdde1cf)

Owner report (logged-in customer, `/vi/account/bookings`, dark, mid page, about 408x908): (1) the tab bar shows fully but a thin
strip of page shows below its labels; (2) page text is readable through the header.

## Header (found, fixed, measured)

`--ls-header-glass-mix` was 78 %: text under the scrolled header showed through (reproduced: "Hiển thị 1-2 trong 2" behind the logo).
Now 96 % (blur kept), light and dark; a test keeps it at 94 % or more. Opened the 408 px dark and light mid-page pictures: nothing readable.

## Strip (partly reproduced)

- Reproduced only with a screen height that is not a whole number of device pixels (ratio 2.625 on 908 px, DevTools zoom does the
  same): the LAST device row (row 2383 of 2384) is the page colour, rgb(20,15,16), not the bar's rgb(29,22,24); mid-page it is a half
  covered blend. At ratios 1, 1.25, 1.5, 1.75, 2, 2.25, 2.5, 2.75, 3, 3.5 and DevTools zoom 50 % / 75 % at 408x908 and 440x956 the
  last 188 pixel rows of the bar are all the bar colour. Owner of that row: the page (`.ls-site` background), the tab bar's own
  layer is clipped before it (a full-viewport red fixed layer covers it, any smaller fixed layer, a 50 px bleed below the bar, a
  sticky backing, a fixed gradient or the html background do not). I found no stylesheet change that colours it; it may be a headless
  capture artefact, so it is opt-in in the gate (`--fractional`), not counted.
- Most likely cause on a real Android phone (not proven here): `viewport-fit=cover` was removed in cdde1cf. Without it the browser
  keeps the page above the system navigation bar and shows a strip of its own below the bar; with it the page reaches the screen
  edge, the bar's opaque background too, the inset is padding inside the bar. Restored, with `minimum-scale=1` and the
  `overflow-x: clip` of cdde1cf (the real cause of the first report) kept. Left/right insets back for landscape.

## Gate

`scripts/uxui-tabbar-check.mjs` compares EVERY pixel row from the top of the bar to the bottom of the screenshot with the bar colour
(except under a tab's own icon and label), logged-in, light and dark, at 360, 390, 414, 408x908, 440x956 and 768, device ratios 1 and 3,
safe area 0 and 34, 130 % text, toolbar shown and hidden, scrolled top, middle, bottom. `--dpr --scale --fractional --inject --shots`.

## Open

- Check on the phone: bar to the last pixel, mid-page, dark. If a strip remains, send the model, Chrome version, navigation mode
  (gesture or 3 buttons) and a crop of the strip; then the row's colour tells whose it is.
