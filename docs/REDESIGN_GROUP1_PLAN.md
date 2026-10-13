# Redesign group 1 (customer site): Step plan

Spec: `DESIGN.md` (approved by the Owner, 2026-10-14). Group 1 = the customer site (public pages, booking, account, shop). Groups 2 (POS) and 3
(admin) are not in this plan. The staff-wide motion setting UI, the staff auth panel and removal of the old tokens belong there.

Each Step is one unit of work. Every UI Step runs the full gate: screenshots at 360/768/1440 light plus 1440 dark, all states, 130% text,
DOM audit and ratchets (G1-G10). "Verify" names the extra checks. C2-C6 are infrastructure, so their visible check is a component gallery.
Sizes: S, M, L. Nothing is pushed or deployed until the Owner approves C18; group 1 ships once.

Two constraints shape the order:

- **Shared CSS:** `components.css` is shared with staff, so all v2 component CSS sits under `[data-ui='v2']`. Otherwise staff screens change
  before groups 2 and 3.
- **Portals:** dialogs, toasts and menus may render outside `.ls-site`. C2 finds where `data-ui="v2"` must sit so overlays get the new tokens.

## Sessions

| Session | Steps      |
| ------- | ---------- |
| 1       | C1, C2, C3 |
| 2       | C4, C5, C6 |
| 3       | C7, C8, C9 |
| 4       | C10, C11   |
| 5       | C12, C13   |
| 6       | C14, C15   |
| 7       | C16, C17   |
| 8       | C18, C19   |

## Steps

Status values: `todo` / `done` (with commit hash).

### Session 1

- **C1: before baseline (S).** Status: done.
  Capture current-look screenshots and the DOM audit for every group 1 page, in all states. Add the page list to
  `uxui-screens`/`uxui-audit-pages.json` and write down the scratch-DB seed recipe.
  Verify: the images are opened and kept in `.local/uxui-screens/before/`. No app code.

- **C2: token v2 scope (L).** Status: done.
  Add the v2 blocks to `tokens.css` and set `data-ui="v2"` on the customer frame. The blocks cover: light, and dark declared twice
  (identical); the preview scope; `--ls-bg-pressed`, `--ls-nav-hover-bg`, `--ls-dur-hero`; shadows set to none; radius 8/18/pill; the
  `data-density` hook. Also settle the portal question. Update `tokens.test.ts`, `customer-tokens.test.ts` and the ratchet baseline.
  Verify: the contrast ratios from DESIGN.md section 6 are asserted in tests, and the season layer renders as before.

- **C3: Be Vietnam Pro and type roles (M).** Status: todo.
  In `site-fonts.ts`, replace Fraunces and Nunito with Be Vietnam Pro (400/500/600, vietnamese subset) on the customer frame. Set the
  section 6.3 type roles in `base.css` (heading line height at least 1.2). Make the wordmark 600 weight, typeface only.
  Verify: Vietnamese stacked marks are not clipped, and text holds at 130% and 200%.

### Session 2

- **C4: core controls (M).** Status: todo.
  Restyle buttons, icon button, inputs, selects, textarea, checkbox, radio and switch under the v2 scope, with pill buttons, boxed 8 px
  fields, labels, error states and the compact prop. Verify: a component gallery covering all states, and 44 px touch targets.

- **C5: surfaces and feedback (M).** Status: todo.
  Cards, badges (Bán chạy / Mới / ink-filled "-%"), chips, tabs/segmented, tooltip, skeleton, spinner, empty/error blocks and image frame
  with its flat placeholder. Verify: gallery in light and dark, no shadow or gradient left.

- **C6: overlays and data parts (M).** Status: todo.
  Dialog, drawer/sheet, menu/popover, toast, confirm dialog, pagination, customer table, breadcrumbs, accordion, stepper, progress bar and
  quantity stepper. Verify: focus trap and return, Escape, no stacked modals, overlays carry the v2 tokens.

### Session 3

- **C7: GSAP wrapper (M).** Status: todo.
  License check on gsap.com, then add `gsap` core + ScrollTrigger with a dynamic import. Set the bundle budget and measure it. Add the
  `useMotion` hook (durations from tokens, clamped to 200 ms in the compact scope). Extend `MotionGate` and `ls-fx=off` into the global off
  switch, with the staff-wide motion setting stubbed. Re-base `Reveal` on the wrapper.
  Verify: reduced motion and the off switch both give the final state with no tween, plus a bundle-size report. The only Step that installs
  a package.

- **C8: header, nav, theme and language (L).** Status: todo.
  Wordmark, translucent sticky header with blur, the always-visible "Đặt lịch" pill, compact-on-scroll (64 to 52), the three-option theme
  toggle, bell and account menu. Files: `site-chrome*`, `site.css` header part.
  Verify: `uxui-touch-check`, no layout shift, and the season layer renders as before.

- **C9: footer, tab bar, contact button, popup (M).** Status: todo.
  Footer from the existing footer blocks (no brand-red band, no waves), phone tab bar and app shell, contact button, promo popup.
  Verify: `uxui-tabbar-check` and safe areas.

### Session 4

- **C10: home (L).** Status: todo.
  Hero, trust band, split intro/services, bestseller row with labels, and the service and cosmetics category grid, built from the existing
  CMS data (slider, facts strip, why-us). No reviews band (Q5). Photo placeholders are flat; the photos to be taken are listed.
  Verify: G4 against section 9.1, all states.

- **C11: services list and detail (M).** Status: todo.
  Title band, category sections and cards, then a split hero with a sticky mobile bar, accordion FAQ and related row.

### Session 5

- **C12: products list and detail (L).** Status: todo.
  Toolbar, grid and pagination, then the gallery, purchase block, sale price and countdown, and related row.

- **C13: cart, checkout, orders (L).** Status: todo.
  Rows, summary card, radio-card payment methods, order list and detail. The PayOS states are unchanged.
  Verify: G7, and the money flow still works against the scratch DB.

### Session 6

- **C14: booking flow (L).** Status: todo.
  `book.tsx` (903 lines): stepper, sticky footer, summary card and success state. Logic untouched.

- **C15: auth and account (L).** Status: todo.
  Customer login, register and forgot pages as a centered card, then account home, bookings, invoices (with detail), loyalty,
  notifications and the review card. The shared auth layout's flat panel is used by staff too, so check it against staff login.

### Session 7

- **C16: ticket, info/CMS pages, 404 and error (S-M).** Status: todo.
  `/ticket/[token]`, the `[...rest]` pages, contact and policies, and the 404/error pages.

- **C17: motion pass (M).** Status: todo.
  Hero sequence, scroll reveals, row/grid stagger, list-to-detail ViewTransition, booking step slide and loyalty counter.
  Verify: G6, with the off switch and reduced motion tested on every page.

### Session 8

- **C18: closing gate (L).** Status: todo.
  A sweep of all states and long text, plus a keyboard/focus/label audit. The DOM audit compared with the C1 baseline, then ratchets
  lowered and dead direction C rules deleted from `site.css`/`customer.css`. A copy review (no "khám"), season-layer and toggle
  regression, and a performance check. Full `pnpm test` and `format:check`, then the before/after pairs for Owner approval (G10).

- **C19: deploy guide (S).** Status: todo.
  A single `docs/DEPLOY_REDESIGN_GROUP1.md` for the Owner to run. Not a deploy; group 1 ships once, after the Owner approves C18.
