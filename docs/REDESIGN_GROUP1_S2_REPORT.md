# Redesign group 1, session 2: C4, C5, C6 (report)

Commits (local, not pushed): `d27edd6` C4, `c133e80` C5, `c61d871` C6, then `1852f2b` (follow-up: badge padding to 12 px, compact booking button on the service rows) and this report. Plan: `docs/REDESIGN_GROUP1_PLAN.md`; the session 1 carry-overs are recorded under C8, C9, C18.

## What changed

- **C4 controls:** `components-v2.css` (new, loaded last, every selector under `[data-ui='v2']`): primary / secondary (accent outline) / neutral / ghost / danger-outline pills at 44 px, boxed 8 px fields on the opposite-band fill, hint, error, required, a 20 px checkbox and radio, a 44 x 28 switch. New: the `neutral` variant, the `compact` prop (buttons and fields), tokens `--ls-bg-field` and `--ls-control-h-compact`. Direction C control rules removed from `customer.css` and `site.css`.
- **C5 surfaces:** flat card, 24 px badges (status tints with icon and word; shop labels as tones `accent` = Bán chạy, `outline` = Mới, `ink` = sale %), flush notices with a 44 px dismiss, chips and filter pills, tabs and segmented as pill tracks, tooltip, skeleton, empty state, and the new `ImageFrame` (18 px, cover, flat placeholder).
- **C6 overlays and data:** dialog, drawer (512), bottom sheet, menu, option list, toast, pager (pills, "Trang x / y" on a phone), table (one hairline surface, card list on a phone), breadcrumbs, stepper, progress bar, quantity pill, and the new `Accordion`. `suspended` on Dialog and Drawer: the discard prompt hides the form under v2, so one modal is on screen (H13). Kit Cancel is `neutral`.
- **Follow-up:** badge side padding 12 px (the DOM audit rose with 10 px); `services-list.tsx` passes `compact` to the booking button of each service row (app code, one prop), so the names are no more clipped at 360 than before. Gallery harness: `packages/ui/scripts/v2-gallery.tsx`.

## Migrations, permissions

None.

## Tests (all green)

`packages/ui` 533 pass (new: `components-v2-css`, `controls-v2`, `surfaces-v2`, `overlays-v2`), `apps/web` 1075 pass, `pnpm lint`, ui and web typecheck, `pnpm format:check`. Not run: `pnpm test` of the other packages and the integration suites (no push, no API change).

## UX gate (session 2)

1. **Gallery** (controls, surfaces, overlays, data): before and after at 360, 768 and 1440, light and dark, with a staff-look control frame; all opened. A computed-style sweep found no shadow, gradient or radius off 8 / 18 / pill inside the scope.
2. **Real pages** (login, register, book, bookings, invoices, cart, checkout, products, services, account): 360 and 1440 light, 1440 dark, each pair opened. "Before" is the session 1 final state, except register, book, bookings and invoices (only the C1 baseline, the production look, exists). A real dialog (cancel booking) opens inside the v2 frame at 360 and 1440. 130 % text at 360 on the controls, data gallery, login and checkout: wraps, no horizontal scroll.
3. **DOM audit**, 10 pages x 3 widths: no count rises against the C1 baseline or the session 1 final (products 360 improves, 9 to 7). A first run rose on 5 pages through the 10 px badge padding, fixed in the follow-up.
4. **Staff control:** a staff screen is not in the scope (`data-ui` absent) and keeps its look; the form dialog Cancel (`neutral`) computes the same as a staff `secondary`. No toast is mounted on the customer site yet (the provider is in the staff shell only).
5. **Not done here:** 200 % text and the full 42-page set (C18); header, footer, tab bar and the pages themselves are still direction C.

Images: `.local/uxui-screens/group1-session2/` (sheets, and `raw/` for the full-size before and after).

## Needs your decision

- The default `Button` variant is `secondary`, now an accent outline: every unspecified customer button became outlined. Kit Cancel buttons are `neutral`; each page Step migrates its own.
- Badge padding is 12 px, not the 10 px of DESIGN.md 8.7, because the FR1 audit flags anything off the 4 px grid.
- The select keeps the platform arrow (a drawn chevron needs a gradient or a colored image).
- Toast behavior is unchanged (shared with staff): DESIGN.md 8.6 asks for at most 3, `role="alert"` for errors and an action button. When a customer page needs toasts, the provider must be mounted inside the frame.
- Table text is 17 px (body): a 4-column table needs about 700 px, so between 640 and 768 px it scrolls inside its frame until each page chooses its columns.
- Seen, not changed (page Steps): at 130 % text the checkout coupon fields shrink to a sliver (C13).
