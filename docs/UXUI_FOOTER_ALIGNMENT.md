# Public footer alignment (2026-10-06, Owner feedback on production)

## What changed

- **Icons on the text edge.** The Facebook and Zalo links were 40-44 px round boxes with the glyph centred, so the glyph sat
  about 10 px inside the column. The link keeps its full touch target, a negative margin makes it take only its glyph's width
  (24 px Facebook, 32 px Zalo), and the glyphs sit in one row with a 16 px gap. Measured: glyph left = text left at 360 (16),
  768 (272) and 1440 (544).
- **One rhythm.** Every row of every column (`.ls-site-footer-list > li`) is one control-height line (44 px on touch, 40 px
  with a mouse); the link column was 44 px per row and the contact column plain text lines. The logo and the column titles
  share the same line box, so the headings stand on one baseline (measured: same top at 768 and 1440). A two-line address at
  768 makes the contact column one row taller; that is the only place rows differ.
- **Tagline.** The shop's own tagline (Shop info, `site.tagline`, already on the home page) under the logo in the small muted
  type; nothing new is written. Without a profile the brand column is the logo alone.
- Mobile: columns stack on one left edge (16 px), the page reserves the tab bar's height so the last line sits above it.

## Tests and gate

`packages/ui` 462 tests (css contract for the icons and the rows), `public-pages` footer tests (tagline, blocks order).
UX gate: 360/768/1440, light and dark, and the Tết season (360 light, 1440 dark): rendered and opened, measured as above.
No migration.
