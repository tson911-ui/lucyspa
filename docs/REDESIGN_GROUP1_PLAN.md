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

- **C1: before baseline (S).** Status: done (312dc3e).
  Capture current-look screenshots and the DOM audit for every group 1 page, in all states. Add the page list to
  `uxui-screens`/`uxui-audit-pages.json` and write down the scratch-DB seed recipe.
  Verify: the images are opened and kept in `.local/uxui-screens/before/`. No app code.

- **C2: token v2 scope (L).** Status: done (7e05d0e).
  Add the v2 blocks to `tokens.css` and set `data-ui="v2"` on the customer frame. The blocks cover: light, and dark declared twice
  (identical); the preview scope; `--ls-bg-pressed`, `--ls-nav-hover-bg`, `--ls-dur-hero`; shadows set to none; radius 8/18/pill; the
  `data-density` hook. Also settle the portal question. Update `tokens.test.ts`, `customer-tokens.test.ts` and the ratchet baseline.
  Verify: the contrast ratios from DESIGN.md section 6 are asserted in tests, and the season layer renders as before.

- **C3: Be Vietnam Pro and type roles (M).** Status: done (dc4590c, follow-up e3d9ade).
  In `site-fonts.ts`, replace Fraunces and Nunito with Be Vietnam Pro (400/500/600, vietnamese subset) on the customer frame. Set the
  section 6.3 type roles in `base.css` (heading line height at least 1.2). Make the wordmark 600 weight, typeface only.
  Verify: Vietnamese stacked marks are not clipped, and text holds at 130% and 200%.
  As built: `site-fonts.ts` is unchanged, because its Fraunces and Nunito variables sit on the root `<html>` and the staff screens read them
  until groups 2 and 3 (the plan's own shared-CSS rule). Be Vietnam Pro is already loaded at the root, so the customer frame reads it
  through the v2 tokens (`--ls-font-sans`, `--ls-font-display`, the role sizes). The roles live in `tokens.css`; `base.css` carries the
  element defaults; `customer.css` follows the tokens.

### Session 2

- **C4: core controls (M).** Status: done (d27edd6).
  Restyle buttons, icon button, inputs, selects, textarea, checkbox, radio and switch under the v2 scope, with pill buttons, boxed 8 px
  fields, labels, error states and the compact prop. Verify: a component gallery covering all states, and 44 px touch targets.
  As built: all v2 rules are in `components-v2.css` (loaded last, every selector under `[data-ui='v2']`); the gallery is `packages/ui/scripts/v2-gallery.tsx`.
  Added: the `neutral` button variant, the `compact` prop (buttons and fields), the `--ls-bg-field` tokens (a field is the step its container is not).
  The select keeps the platform arrow (no gradient chevron). Direction C control rules were removed from `customer.css` and `site.css`.

- **C5: surfaces and feedback (M).** Status: done (c133e80).
  Cards, badges (Bán chạy / Mới / ink-filled "-%"), chips, tabs/segmented, tooltip, skeleton, spinner, empty/error blocks and image frame
  with its flat placeholder. Verify: gallery in light and dark, no shadow or gradient left.
  As built: Badge tones accent / outline / ink (the three shop labels), the new `ImageFrame`, applied-filter chips and filter pills, tabs and the
  segmented control as pill tracks. The pebble cards (`.ls-site-card`, product cards) are rebuilt with their pages (C10-C15).

- **C6: overlays and data parts (M).** Status: done (c61d871).
  Dialog, drawer/sheet, menu/popover, toast, confirm dialog, pagination, customer table, breadcrumbs, accordion, stepper, progress bar and
  quantity stepper. Verify: focus trap and return, Escape, no stacked modals, overlays carry the v2 tokens.
  As built: the new `Accordion`; `suspended` on Dialog / Drawer (the discard prompt hides the form under v2, so one modal shows); the form overlays
  and the confirm dialog use the neutral Cancel; `Pagination` takes an optional `pageOf` label (callers add it as they are rebuilt, C12-C15).
  Toasts: none is mounted on the customer site yet (the provider is in the staff shell), so a customer page that needs one mounts the provider inside the frame. Not changed (behavior, shared with staff): the toast keeps 4 at most, no `role="alert"` for errors and no action button (DESIGN.md 8.6 says 3, alert, 8 s with an action).
  Owner (session 2 review): deferred until a customer page first mounts a toast, or group 2.

### Owner decisions on the session 2 report (2026-10-14)

- Default `Button` = accent outline; each page Step picks its one primary (accepted).
- Badge side padding 12 px (accepted); `DESIGN.md` 8.7 updated to 12 px.
- Select arrow: replace the platform arrow with the chevron from `packages/ui/src/icons.tsx` (a positioned icon element, no gradient, no
  colored image), customer v2 scope only. Done in C8.
- Toast rules of `DESIGN.md` 8.6 (max 3, `role="alert"`, 8 s with an action): deferred until a customer page first mounts a toast, or group 2.
- Table columns per page: accepted; each page Step chooses its own.
- Checkout coupon fields at 130 % text: fixed in C13.

### Session 3

- **C7: GSAP wrapper (M).** Status: done (see the commit below).
  License check on gsap.com, then add `gsap` core + ScrollTrigger with a dynamic import. Set the bundle budget and measure it. Add the
  `useMotion` hook (durations from tokens, clamped to 200 ms in the compact scope). Extend `MotionGate` and `ls-fx=off` into the global off
  switch, with the staff-wide motion setting stubbed. Re-base `Reveal` on the wrapper.
  Verify: reduced motion and the off switch both give the final state with no tween, plus a bundle-size report. The only Step that installs
  a package.
  As built: `gsap` 3.15.0 (exact) in `packages/ui`. Files: `motion-core.ts` (pure: the switches, token parsing, the 200 ms staff cap),
  `motion.ts` (`useMotion().run(scope, build)`, one dynamic import of `gsap` + `gsap/ScrollTrigger` after the first paint, a `gsap.context`
  per scope that is reverted on unmount and when motion turns off), `MotionGate` (now also reads `ls-fx=off`, a `staffSetting` prop that is the
  stubbed staff-wide setting, and the kill flag; the attribute `data-ls-motion` stays the one mark the stylesheet and the wrapper read).
  `Reveal` runs through the wrapper (ScrollTrigger, `once`, `top 85%`); the CSS transition path is gone.
  License (gsap.com/standard-license, effective 2025-04-30, modified 2025-05-30; npm `license: Standard 'no charge' license`): free for anyone,
  commercial use included, ScrollTrigger included; the only limit is building a no-code visual animation tool that competes with Webflow.
  Bundle budget: first load may grow by at most 3 KB gzip for the wrapper, and the lazy GSAP chunks stay at or under 50 KB gzip together.
  Measured (gzip, home `/vi`): first load 340.4 to 342.4 KB (+2.0), lazy GSAP 44.6 KB (core 27.2 + ScrollTrigger 17.4; 114 KB raw), loaded
  after first paint only. A build with `NEXT_PUBLIC_LS_MOTION=off` emits no GSAP chunk at all.

- **C8: header, nav, theme and language (L).** Status: todo.
  Wordmark, translucent sticky header with blur, the always-visible "Đặt lịch" pill, compact-on-scroll (64 to 52), the three-option theme
  toggle, bell and account menu. Files: `site-chrome*`, `site.css` header part.
  Verify: `uxui-touch-check`, no layout shift, and the season layer renders as before.
  Carry-over (Owner, session 1 review): `uxui-touch-check` flags the theme button, which changes theme on tap. Verify against HEAD whether
  this is a time-of-day artifact or a real failure, and say which.
  Owner decision (session 2 review): the v2 select drops the platform arrow for the `icons.tsx` chevron (customer scope only), done here.

- **C9: footer, tab bar, contact button, popup (M).** Status: todo.
  Footer from the existing footer blocks (no brand-red band, no waves), phone tab bar and app shell, contact button, promo popup.
  Verify: `uxui-tabbar-check` and safe areas.
  Carry-over (Owner, session 1 review): footer icon spacing. Targets are 48 px with 4 px between neighbours; DESIGN.md 12 wants 8 px. Fix here.

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
  Carry-over (Owner, session 2 review): the checkout coupon fields shrink to a sliver at 130 % text; fix here.

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
  Carry-overs (Owner, session 1 review): the 200 % text check and the full 42-page "after" set with the full DOM audit are done here.
  Also accepted by the Owner: `site-fonts.ts` unchanged (Be Vietnam Pro through the v2 tokens on the customer frame only).

- **C19: deploy guide (S).** Status: todo.
  A single `docs/DEPLOY_REDESIGN_GROUP1.md` for the Owner to run. Not a deploy; group 1 ships once, after the Owner approves C18.
