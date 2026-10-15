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

- **C7: GSAP wrapper (M).** Status: done (238bf10).
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

- **C8: header, nav, theme and language (L).** Status: done (43c0dda).
  Wordmark, translucent sticky header with blur, the always-visible "Đặt lịch" pill, compact-on-scroll (64 to 52), the three-option theme
  toggle, bell and account menu. Files: `site-chrome*`, `site.css` header part.
  Verify: `uxui-touch-check`, no layout shift, and the season layer renders as before.
  Carry-over (Owner, session 1 review): `uxui-touch-check` flags the theme button, which changes theme on tap. Verify against HEAD whether
  this is a time-of-day artifact or a real failure, and say which.
  Owner decision (session 2 review): the v2 select drops the platform arrow for the `icons.tsx` chevron (customer scope only), done here.
  As built: new `chrome-v2.css` (under `[data-ui='v2']`, loaded after `components-v2.css`; the direction C header rules in `customer.css` are removed,
  the ones in `site.css` stay until C18). Surface: page color at 96 % with 16 px blur and a hairline, no shadow, opaque without blur, under reduced
  transparency and in forced colors; clear at the top as before (DESIGN.md does not say to drop it; open reading for the Owner), the surface switches
  without a fade and only the 64 to 52 shrink slides. Menu: 14/500 ink, current = accent text + 2 px underline offset 8, the sliding pill is drawn only
  on hover or focus. Tools: bare 44 px circles, hover = solid accent. Header call to action (icon + text, no sheen) from 640 px; below 640 px the
  booking tab of the phone tab bar is the always-visible call to action, because a 360 px member bar has 9 px free (measured; decision for the Owner).
  The theme control stays the single cycle button. Select: `SelectIconScope` (provided by the site frame) makes the kit `Select` a wrapper with a positioned
  chevron; staff selects keep their markup. Touch-check carry-over, answered: not a real failure. Tapping the theme button changes the theme, so its own
  colors differ afterwards; with `ls-theme=auto` it only flags when the clock resolves to dark, with a fixed cookie it always flagged. The tool now takes
  `--theme` and compares the theme button with an untouched tool in the new theme; light, dark and auto all pass.

- **C9: footer, tab bar, contact button, popup (M).** Status: done (3ba876e).
  Footer from the existing footer blocks (no brand-red band, no waves), phone tab bar and app shell, contact button, promo popup.
  Verify: `uxui-tabbar-check` and safe areas.
  Carry-over (Owner, session 1 review): footer icon spacing. Targets are 48 px with 4 px between neighbours; DESIGN.md 12 wants 8 px. Fix here.
  As built: all in `chrome-v2.css`; the direction C footer (brand-red fill, wave, light-on-red colors), the tab bar's rose lift and the popup pebble are deleted from
  `customer.css`. Footer: the alternate band under a hairline, 2 columns on a phone and 12 from 1024 px (brand 6, the others 3), 14/600 titles, 14/400 links, 12 px legal
  line; the footer icons now sit 32 px apart, which measures 12 px between their 48 px targets (was 4). Tab bar: page color, the hairline is a pseudo-element above the bar
  (a border would add a non-bar row to the bar box and `uxui-tabbar-check` fails it), flat accent disc for the booking tab, an outline ring on the booking page. Contact
  button: no shadows, hover darkens the fill. Popup: 18 px, hairline, no shadow, 21/600 title. The compact header no longer scales the logo and menu (0.92 left the
  wordmark link 40 px high, under the 44 px target). The Messenger icon of the contact panel keeps its official gradient (a brand mark).

### Owner decisions on the session 3 report (2026-10-14)

- Header "Đặt lịch" pill from 640 px; below that the tab bar's booking tab is the call to action: accepted. `DESIGN.md` 8.5 updated.
- Clear-at-top (transparent) header over the home hero: keep. Recorded in `DESIGN.md` 8.5.
- Bundle budget approved: first load +3 KB gzip at most, lazy GSAP 50 KB gzip at most. Recorded in `DESIGN.md` 11.6.
- Home offer ribbon "Mua ngay" contrast: fix in C10.

### Session 4

- **C10: home (L).** Status: done (539bc55).
  Hero, trust band, split intro/services, bestseller row with labels, and the service and cosmetics category grid, built from the existing
  CMS data (slider, facts strip, why-us). No reviews band (Q5). Photo placeholders are flat; the photos to be taken are listed.
  Verify: G4 against section 9.1, all states.
  As built (details: `docs/REDESIGN_GROUP1_S4_REPORT.md`): new `pages-v2.css` (under `[data-ui='v2']`, guard test), tokens `--ls-scrim` (0.55, 4.5:1
  over a white photo asserted) and `--ls-on-photo`. Hero = the Owner's `heroImage` under one flat scrim with white text and the outline-white
  secondary, else the alternate band with normal buttons (PROVISIONAL, pending the Owner: the slider no longer sits in the hero, it sits in the split
  intro's 18 px photo slot with every function kept; the Slider takes a `ctaVariant`). The product row shows the products the Owner marked "Nổi bật"
  (the `featured` flag), headed "Sản phẩm nổi bật", labels Mới (outline) and the sale percent (ink); no label says "Bán chạy" because no sales
  data is public (PROVISIONAL, pending the Owner). Top services = 3 columns (first 3 groups, 3 services each, the Owner's group description kept).
  Category grid = flat tiles (no category photo field exists). The Owner's why-us cards stay (flat cards, before the offer) and the offer is one flat
  accent block whose button reads in both modes (the "Mua ngay" contrast fix). Bands alternate base/alt from the hero down whichever are present.
  `customer.css` lost the direction C home, facts, pebble, offer and photo-slot rules.

- **C11: services list and detail (M).** Status: done (6020e62).
  Title band, category sections and cards, then a split hero with a sticky mobile bar, accordion FAQ and related row.
  As built: list = title band + search, a chips row that sticks under the compact header, one band per group, cards (flat photo placeholder, one
  stretched name link, time, price, "Đặt lịch" pill). Detail = split hero, same-group row (ScrollRow), booking band (from 1024 px) and a phone bar
  that shows only while the hero and band buttons are out of view and lifts the contact button. NOT built (pending the Owner): the FAQ accordion,
  "what is included" and steps, because the service data has no such text and writing it would invent policy; the `Accordion` stays unused.

### Owner decisions on the session 4 report (2026-10-14)

1. The slider moved into the split intro's photo slot and the hero uses one hero photo: accepted.
2. The product row stays "Sản phẩm nổi bật" and uses the Nổi bật flag. No "Bán chạy" label for now; a real sales-based "Bán chạy" label comes later.
3. Service detail content, option A: optional CMS fields per service, "what's included" (list), "steps" (ordered list) and "FAQ" (question/answer pairs),
   editable in the existing admin service form, VI/EN like the other service text. An empty field hides its band.
4. Photo upload for each service, each service group and each cosmetics category, through the existing media library and upload flow, in the existing admin
   forms. Customer pages show the photo, or the flat placeholder when empty.
5. The home product row loads after first paint (below the fold), to remove the +12.4 KB from the first load.

Items 3, 4 and 5 are Step C11b below. Answers 1 and 2 close the matching "pending" notes in the C10 entry.

### Session 5

- **C11b: service content, photos, lazy product row (M).** Status: done (46fe6bf).
  Items 3, 4 and 5 above. Additive and nullable database fields with one migration (no change to existing rows or functions); the admin forms keep
  their current look (the admin redesign is group 3); the existing service-edit permissions apply. Tests added. **The migration joins the group 1 deploy:
  group 1 is then no longer a web-only reload, it needs the migration, an API restart and a web reload (C19 writes the guide).**
  As built (details: `docs/REDESIGN_GROUP1_S5_REPORT.md`): migration `20261214000000_redesign_service_content_photos` (services: included / steps / FAQ per
  language as JSONB, NULL = none, and `photo_media_id`; service_categories and product_categories: `photo_media_id`; all RESTRICT media keys, each with an
  index). Service update takes the content and photo, group update and the cosmetics category edit take `photoMediaId`; same permissions; limits 12 items, 300
  characters, 10 FAQ pairs; media usage list, delete protection and public serving cover the new keys; the public catalog sends `image` and, on the service
  detail only, the content. Admin: the existing service drawer and the group / category dialogs got a Photo section and the content fields. The home product row
  is a lazy chunk (skeleton, loads within 600 px of the screen or 2 s after the first paint); home first-load 345.4 KB gzip. The product card is shared
  (`ProductCard`) by the home row, the list and the related row.

- **C12: products list and detail (L).** Status: done (9ae12ea).
  Toolbar, grid and pagination, then the gallery, purchase block, sale price and countdown, and related row.
  As built: title band, list band with search, sort, chips (from 640 px; a phone keeps the filter sheet) and a 2 / 3 / 4 column grid, pager, commitment band; the
  product page is a split hero (gallery with arrows), an about band (description, usage / ingredients accordion, where to buy), a commitment band and a related
  row. The purchase block, sale price and countdown are unchanged. The old direction C product rules stay in `site.css` (overridden under `[data-ui='v2']`).

- **C13: cart, checkout, orders (L).** Status: done (8308b67).
  Rows, summary card, radio-card payment methods, order list and detail. The PayOS states are unchanged.
  Verify: G7, and the money flow still works against the scratch DB.
  Carry-over (Owner, session 2 review): the checkout coupon fields shrink to a sliver at 130 % text; fix here. Done: the rows wrap, the field keeps at least 10 rem.
  As built: `ShopScreen` (title band + content band) for the cart and checkout; one 720 px checkout column with PayOS as the one (selected) radio card; the order
  page has the record left, a summary card (totals, Pay / Cancel) and the delivery card right, and a timeline of the real moments (placed, paid, shipped,
  delivered). The orders list is the kit table already and the member frame around it (no title band) is C15. Money flow checked on the scratch stack: cart,
  checkout, order placed, PayOS link reached.

### Session 6

- **C14: booking flow (L).** Status: done (3db551a).
  `book.tsx` (903 lines): stepper, sticky footer, summary card and success state. Logic untouched.
  As built (`docs/REDESIGN_GROUP1_S6_REPORT.md`): title band + content band, a 720 px column with a sticky 22 rem summary from 1024 px, the phone summary as an `Accordion` row above a flat action bar, neutral Back, flat `ChoiceCard` (shared rule in `components-v2.css`), time pills, success state in the same bands. The step names and order are unchanged (services, guests, staff and time, confirm).

- **C15: auth and account (L).** Status: done (e3e2da5).
  Customer login, register and forgot pages as a centered card, then account home, bookings, invoices (with detail), loyalty,
  notifications and the review card. The shared auth layout's flat panel is used by staff too, so check it against staff login.
  As built: the customer sign-in does not use the staff `AuthLayout`; they share only root tokens. New v2 tokens `--ls-auth-flat` and `--ls-on-auth-flat` (Q4), the panel is a band with the wordmark above one 26 rem hairline card (aside dropped; accepted by the Owner, see the decisions below). Staff login and forgot password screenshots are byte-identical before and after. New `AccountScreen` (title band, `SiteSubNav` tabs from 768 px, content band) carries the account home (four summary cards), bookings, invoices, loyalty, notifications, orders and their details; `CustomerShell` is only `main`. Direction C rules for booking, sign-in and the member frame stay in `site.css` until C18 (`.ls-booking-*`, `.ls-member-auth`, `.ls-member-aside`, `.ls-member-page`, `.ls-choice*`, `.ls-hub`, `.ls-account-grid`).

### Owner decisions on the session 6 report (2026-10-14)

1. Sign-in is one centered card on a flat panel band, aside dropped: accepted. The unused copy keys are removed.
2. Booking step names and order stay as built (services, guests, staff and time, confirm): accepted. DESIGN.md 9.2 updated.
3. Account area: dropping the title "Đặt lịch" button on the account home is accepted. The profile has a "Hồ sơ" tab (last of the account tabs and
   quick links, `/account/profile`); every account detail page (booking, invoice, order) has a visible "← Quay lại" link to its list.
   As built: there is **no customer profile API** (`/me/account` is workforce only and refuses customers), and the old account home card was
   read only (name, language), so the tab is read only and edit is **pending Owner approval** (it needs a new customer endpoint). The back link
   already existed on every detail page (`PageBack`); it goes to the page the person came from and to the list when opened directly.

### Session 7

- **C16: ticket, info/CMS pages, 404 and error (S-M).** Status: done (07c5365, test fix 81b1346).
  `/ticket/[token]`, the `[...rest]` pages, contact and policies, and the 404/error pages.
  As built (`docs/REDESIGN_GROUP1_S7_REPORT.md`): ticket = a centered 30 rem column, header reduced to the wordmark, printable. 404, error and missing ticket are flat and
  centered. `InfoPage` and `ContactPage` layouts exist in `packages/ui` but are **not routed**: no info, contact or policy route, content store or admin exists, so the
  Owner decides where the content lives (pending). No QR, no map.

- **C17: motion pass (M).** Status: done (7d18d6c).
  Hero sequence, scroll reveals, row/grid stagger, list-to-detail ViewTransition, booking step slide and loyalty counter.
  Verify: G6, with the off switch and reduced motion tested on every page.
  As built: hero sequence in CSS (transform only, nothing hidden), `data-ls-fx` from the `ls-fx` cookie, `SharedPhoto`, `useStepSlide`, `CountUp` (`Stat countUp`). G6 was run
  in a real browser on 22 pages in full, off and reduced (`.local/g7/motion-check.mjs`). History Back does not morph the photo back (it cross-fades).

### Owner decisions on the session 7 report (2026-10-14)

1. The "← Quay lại" link returns to the previous page (browser history): accepted.
2. The error page's primary action is "Tải lại": accepted.
3. Customer profile edit is approved: a customer self-service API and an edit form on `/account/profile` (name, email, birthday; phone read only;
   birthday editable by the customer only while empty, then staff only). See session 7b.
4. Info pages are approved as a managed website-admin section ("Trang thông tin"), with the footer policy column, legal line and a contact map. See session 7b.

### Session 7b (between 7 and 8)

- **Item 0:** pnpm shim block (NVM4306) investigated and cleared, see the session 7b report.
- **Item 2:** customer profile edit. Status: done.
  `GET/POST /api/v1/me/profile` (session identity; the name is the only field written; phone, birthday and email are refused as unknown fields) and an edit
  dialog on `/account/profile`. The sign-in email changes through the existing verified flow (`/api/v1/me/email/*`: current password, then a code sent to the
  new address), now open to customers: migration `20261215000000_customer_email_change_guard` relaxes the challenge trigger, and `proveCurrentPassword`
  takes an `allowCustomer` option that only the email change sets (password change stays staff only). The birthday is **never empty** (registration
  requires it, the column is NOT NULL, no other path creates a customer), so the "editable while empty" rule cannot occur; it is shown read only. No staff
  screen changes a customer's birthday yet. Both points are pending Owner decision.
- **Item 3:** info pages (admin editor, public rendering, footer, contact). Status: done (migration `20261215000001_website_info_pages`).
  Pages live at `/{locale}/{slug}` (catch-all, reserved-slug list); the policy column holds POLICY pages, the legal line TERMS then PRIVACY;
  `/contact` has a keyless Google embed. See `docs/REDESIGN_GROUP1_S7B_REPORT.md`. Pending Owner: the staff-only email guard relaxed for customers,
  the birthday rule (never empty), no staff screen for a customer's birthday.

### Owner decisions on the session 7b report (2026-10-15)

1. Customer email change by the current password plus a code to the new address, with `allowCustomer` on the guard: accepted. The "pending Owner"
   notes of items 2 and 3 above are closed by this answer.
2. The birthday stays read only for customers. A staff screen to edit a customer's birthday goes into **group 3** (admin); it is not built in group 1.
3. The contact page's orphan action pills are fixed in session 8 (before C18).
4. Policy pages: `docs/policies.md` holds the Owner's 8 pages (Vietnamese only, one per `## ` heading, wording unchanged). They are imported as published
   Info pages, the footer "Chính sách" column lists all 8, the legal line is "Điều khoản sử dụng · Chính sách bảo mật". A one-time idempotent import
   command is written for production and documented in the deploy guide (run after the group 1 deploy; it skips pages that already exist).

Carried to group 3: a staff screen to edit a customer's birthday (Owner, 2026-10-15).

### Session 8

- **C18: closing gate (L).** Status: todo.
  A sweep of all states and long text, plus a keyboard/focus/label audit. The DOM audit compared with the C1 baseline, then ratchets
  lowered and dead direction C rules deleted from `site.css`/`customer.css`. A copy review (no "khám"), season-layer and toggle
  regression, and a performance check. Full `pnpm test` and `format:check`, then the before/after pairs for Owner approval (G10).
  Also here: delete the direction C rules that C10 to C13 overrode: the `ls-prod-*`, `ls-sale*`, `ls-qty*`, `ls-shop-*`, `ls-order-*` blocks of `site.css`
  (about lines 2300 to 4770) and the home and service leftovers.
  Carry-overs (Owner, session 1 review): the 200 % text check and the full 42-page "after" set with the full DOM audit are done here.
  Also accepted by the Owner: `site-fonts.ts` unchanged (Be Vietnam Pro through the v2 tokens on the customer frame only).

- **C19: deploy guide (S).** Status: todo.
  A single `docs/DEPLOY_REDESIGN_GROUP1.md` for the Owner to run. Not a deploy; group 1 ships once, after the Owner approves C18.
  Group 1 carries the C11b migration (see C11b), so the guide covers: migration, API restart, web reload.
