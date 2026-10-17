# Step 7 final code audit: customer area (session 10)

Scope: `app/[locale]/(site)/**`, `components/{public,shop,customer,notifications}/**`, `lib/customer/**`, i18n `site`, `online-shop`,
`campaigns-public`, `customer`, `customer-loyalty`, `customer-review`, `customer-profile`, `notifications`, and
`packages/ui/src/s10-{public,member,account}.css`. Every file was read (four read-only sweeps, one per file group, then triage).
Shared files (`site-chrome*.tsx`, `site-page-frame.tsx`) and A2 files (`account-deletion*.tsx`, `lib/customer/account-deletion.ts`, the
deletion entry in `profile.tsx`) were audited, not edited; their findings are kit/lead requests tagged `[audit-customer]`.

## Rules and skills

- web-design-guidelines: `command.md` fetched fresh on 2026-10-16 16:36 (+07) from
  `raw.githubusercontent.com/vercel-labs/web-interface-guidelines/main/command.md` (curl; WebFetch only returns a summary). Byte-identical
  to `.local/s10/wig-command.md`. Project overrides applied: sentence case (no Title Case), no truncation of meaningful text (Owner
  answer 7: the fix is wrapping), Vietnamese first person not flagged.
- react-best-practices: SKILL.md + rule set (async-_, bundle-_, server-_, client-swr-dedup, client-event-listeners, rerender-_,
  rendering-*, js-cache-function-results, js-hoist-regexp). react-view-transitions: `references/implementation.md` step 1 (audit).
  frontend-design: used for the copy and the hierarchy fixes (badge after the words, outline for empty-state actions, no eyebrow).

## wig baseline (`wig-customer.md`, 65 findings)

Closed before Step 7 and verified in the code (evidence in step4/public.md, step4/member.md, re-checked): account-menu.tsx:41,
brand-band.tsx:54, photo-slot.tsx:26, contact-view.tsx:25, info-view.tsx:16, services-view.tsx:120, services-list.tsx:104/:125,
products-controls.tsx:43, products-view.tsx:390, home-sections.tsx:65, ticket-view.tsx:94, session.tsx:170, all auth.tsx items
(:244/:302/:381/:406/:483), all book.tsx items (:118/:120/:394/:472/:728/:896), bookings.tsx:107/:190, invoices.tsx:140/:163,
loyalty.tsx:145/:178/:233, review-card.tsx:178, cart-screen.tsx:273, checkout-address.tsx:113, checkout-screen.tsx:449/:470/:558,
orders-screens.tsx:171/:467, inbox.tsx:327, site.ts:651/:752, customer.ts:10/:131/:146/:180, customer-loyalty.ts:29, online-shop.ts:470,
`[locale]/layout.tsx:29` (foundation-v2.css:7-13 sets tap highlight and `touch-action: manipulation`), `(site)/layout.tsx:8` (Owner A1:
the theme follows the device only; no in-page switch left).

Closed in Step 7:

| Baseline                     | Fix                                                                                                                                                          |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| home-content.tsx:93 i18n     | fallback brand in the h1 is `<span translate="no">` (home-content.tsx:90; the Step 4 fix was on the phone)                                                   |
| chat-panel.tsx:172 Forms     | Send stays enabled; an empty send returns focus to the field                                                                                                 |
| chat-panel.tsx:264 Forms     | callback form moves focus to the first `aria-invalid` field; consent error linked by `aria-describedby`                                                      |
| chat-panel.tsx:303 Forms     | `name` on message, phone, name, note, consent                                                                                                                |
| checkout-screen.tsx:71 Forms | `useUnsavedGuard` while the customer edited anything and nothing is being placed; new `stillDirty` option so the PayOS redirect and the order page never ask |
| order-fulfilment.tsx:66 a11y | tracking link says "(Tra cứu hành trình, mở trong tab mới)"                                                                                                  |
| order-fulfilment.tsx:72 i18n | tracking code `translate="no"` (link and plain text)                                                                                                         |
| orders-screens.tsx:203 Nav   | "Xem thêm" pages kept in `?loaded=` and fetched again on return (same as invoices); list page in `?page=`                                                    |
| inbox.tsx:230 Copy           | `NotificationTable audience="customer"`: a member's link reads "Xem chi tiết: …" (new `openDetail`), never "Xem công việc"                                   |
| site.ts:381 Forms            | chat placeholder "Ví dụ: giờ mở cửa hôm nay…"                                                                                                                |
| site.ts:484 Typography       | curly quotes in the no-match line (vi/en)                                                                                                                    |
| customer.ts:271/:278 Copy    | unexpected and not-found errors name the next step                                                                                                           |

Not a finding (reason): inbox.tsx:396 archive without undo: archiving is not destructive (the notice stays readable under the
"Đã lưu trữ" view) and the API has no unarchive endpoint (UI-only rule).

## New wig findings (found and fixed)

- VT/Navigation: internal links without the `ls-nav` type (page snapped instead of fading): error.tsx:23, brand-band.tsx:48,
  campaign-views.tsx:38/:201, services-view.tsx:88, service-book-bar.tsx:56, footer-blocks.tsx:105, rich-text.tsx:76, home-slider.tsx
  RouterLink, ticket-view.tsx:172, notification-bell.tsx:174/:201, promo popup links, cart-screen.tsx:211/:358/:367,
  purchase-block.tsx:82/:143, orders-screens.tsx:176, checkout-screen.tsx:205/:221/:383, member-ui.tsx:53/:79, bookings.tsx:126/:233/
  :365/:562, book.tsx:461, auth.tsx:296/:686, inbox member links; `router.push`/`replace` after a user action (auth.tsx:87/:250/:505/:685,
  checkout-screen.tsx:387) now pass `transitionTypes`. Fixed.
- home-sections.tsx:30 Navigation (bug): "Tải lại trang" linked to the home page from the services/products pages; now `ReloadButton`
  (new `public/reload-button.tsx`, reloads the current page).
- chat-panel.tsx:198 Navigation: the bot's booking link was a full reload with the chat left open; now a router `Link` with the fade that
  closes the panel.
- campaign-views.tsx:116 brief (eyebrow): offer badge moved after the message (as on the campaign hero).
- s10-public.css `.ls-prod-thumb` Hover: thumbnails had no hover/pressed; outline one step on fine-pointer hover, stronger when pressed,
  focus ring wins.
- checkout-screen.tsx:221 brief: empty-state action was a filled primary; now the secondary outline.
- Typography nbsp: number + unit in site.ts (sale countdown, pre-order days, vi/en) and online-shop.ts (`{days}`, `{max}`, `{range}`
  days, `{minutes}` minutes, vi/en).
- Copy: online-shop.ts back label sentence case ("Quay lại đơn hàng online"); site.ts EN first person (404 title, load error, products
  empty); booking errors with a next step (customer.ts, vi/en); `forbidden` next step; "/ móng" → "/ ngón" (one term); EN title "My
  appointments" (the rest of the EN copy says appointments); EN history column "Points type" (two columns read "Points");
  customer-review "unavailable" next step; customer-profile "liên hệ tiệm" (EN without "we").
- Forms: profile.tsx dialog inputs `name` (name, current-password, email, one-time-code), email code keeps digits only; book.tsx guest
  inputs `name` (guest-name/phone/relation), each guest card and its remove button named by the guest ("Bỏ {tên} khỏi lịch hẹn").
- profile.tsx:194 brief B18: email status badge had no icon; now `StatusBadge`.
- (shop) cart/checkout pages: browser title said "Tài khoản thành viên"; now "Lucy Spa — Giỏ hàng" / "Lucy Spa — Thanh toán".
- Dead code: `public-breadcrumbs.tsx` (imported nowhere) deleted; unused `services/products.breadcrumbs` (site.ts) and `saleLabel`
  (campaigns-public.ts) removed.

Copy rows: `copy/public.md` and `copy/member.md` ("Step 7 audit" tables).

## wig final open list (each with its reason)

- bookings.tsx:579 i18n: booking code in the cancel dialog has no `translate="no"`: kit `ConfirmDialog` facts take a string (kit request).
- loyalty.tsx:233 i18n: the tier marks are sentences that contain "Lucy Spa"/"Lucy Beauty"; `translate="no"` would freeze the sentence.
- lib/customer/profile.ts:87 Locale: `birthdayText` builds dd/mm/yyyy by hand; output is identical to Intl `vi-VN`/`en-GB` 2-digit for a
  calendar date (no zone), so no reader sees a difference.
- services-view.tsx:116, products-view.tsx:89/:171/:331 filter chips and pager: same-route lateral filters, deliberately no fade.
- Shared/A2 files (reported, not edited): site-chrome.tsx:122 hotline `translate="no"`; site-chrome-client.tsx:95 language switch;
  profile.tsx:210, account-deletion.tsx:116/:117/:133/:331, account-deleted.tsx:23 links without the fade; account-deletion.tsx:133 target
  size; customer-profile.ts:65/:68 "gói dịch vụ" vs "Combo". All in `kit-requests.md` `[audit-customer]`.

## rbp baseline (`rbp-customer.md`, 47 findings)

Closed before Step 7, verified: fonts preload (`[locale]/layout.tsx`, Playfair `preload: false`, staff faces gone), notification-bell.tsx:11
and lib/notifications.ts:7 (bell imports `notifications/unread`, `fill` from `i18n/fill`), chat-contact.tsx:6 (next/dynamic), not-found.tsx:7,
services-list.tsx:1,90-116, home-product-row.tsx:27, products-view.tsx:249,326 (brands only in the sheet), session.tsx:109-127/:155-198,
bookings.tsx:51-73 (fetch-cache), member workforce imports (bookings/invoices/loyalty), loyalty.tsx:63-92, invoices.tsx:392/:333-336,
all book.tsx items, auth.tsx:199-209, orders-screens.tsx:283-293, inbox.tsx:170-179 and :470-497, ticket-view Intl.

Closed in Step 7:

| Baseline                                                                                  | Fix                                                                                                                                        |
| ----------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| promo-popup.tsx:4 bundle-conditional                                                      | dialog in its own chunk (`promo-popup-dialog.tsx`, next/dynamic), loaded only once a live popup is found                                   |
| sale-countdown.tsx:21-25 client-event-listeners                                           | one shared one-second clock (`useSyncExternalStore`), started by the first countdown, stopped by the last                                  |
| notification-bell.tsx:68-88 rerender-move-effect-to-event                                 | the panel's read and focus run in the click handler (`toggle`)                                                                             |
| inbox.tsx:52-90 client-swr-dedup                                                          | `unread.ts`: one feed per ApiClient shared by every caller; no reads while the tab is hidden, a read when it is shown                      |
| shop-data.ts:70-93 client-swr-dedup                                                       | one cart count, one in-flight read, one `CART_CHANGED` listener for the header and the account menu                                        |
| quantity-stepper.tsx:29 derived-state-no-effect                                           | the outside value replaces the draft while rendering                                                                                       |
| checkout-screen.tsx:83 lazy-state-init                                                    | request id from `useState(newRequestId)`                                                                                                   |
| checkout-screen.tsx:112-123 derived-state-no-effect                                       | saved addresses fill the form while rendering (no empty first paint)                                                                       |
| checkout-screen.tsx:233-235 functional-setstate                                           | `setDraft((old) => …)`; saved-address match checked per changed key                                                                        |
| orders-screens.tsx:319 derived-state-no-effect                                            | arrival read once in a lazy `useState`                                                                                                     |
| orders-screens.tsx:34 bundle-barrel                                                       | `expectedRange` from member-format and two words in online-shop.ts: no `lib/workforce` (staff dictionary) and no product-orders dictionary |
| Intl group (lib/customer invoice/booking/loyalty, booking-view) js-cache-function-results | `numberFormat`/`dateFormat` caches in invoice.ts, used by booking.ts, loyalty.ts, booking-view.ts                                          |

## New rbp findings (found and fixed)

- profile.tsx:44 bundle-barrel (high): `Badge` from `workforce/ui` pulled the staff dictionary into the profile page; now `StatusBadge`.
- bookings.tsx:211, invoices.tsx:175 rerender-memo: `columns.filter(...)` built a new array every render (the memo was undone); the
  branch filter moved into the memo.
- loyalty.tsx:326/:377/:436/:483/:525 rerender-memo: column arrays per render; now module builders per language + `useMemo`.
- loyalty.tsx:285: ref written during render; the last total is state adjusted while rendering.
- unread.ts:23-26 derived-state: count reset in an effect when the client is null; now derived (`NOTHING`).
- booking-view.ts:116 js-cache-function-results: `localeCompare(…, locale)` per comparison; one `Intl.Collator` per language.

## rbp final open list (each with its reason)

- lib/customer/auth.ts:25-38 async-dependencies: reading `/auth/me` beside `/auth/context` would send a request that always fails 401 for
  every anonymous visitor on every page; the two steps cost one round trip only for members, and the member area reads the session
  once (site frame) since Step 4.
- `(home)/page.tsx:23` async-suspense-boundaries: the shared site frame awaits its own reads before any HTML, so a Suspense split of the
  home bands cannot reach the browser earlier; filed with the frame (`site-page-frame.tsx:19-23`, shared, kit request).
- inbox.tsx:25-42 bundle-barrel (member notifications page loads `i18n/workforce`): the inbox is shared with the staff area; moving
  its toolbar and pager words is a kit request.
- bookings.tsx:31, loyalty.tsx:32 bundle-barrel (`i18n/loyalty` for wallet and tier names): the Owner keeps those names in one place in a
  staff file; split requested (kit request), no copy made.
- invoices.tsx:19 bundle-conditional (low): the product-orders dictionary serves the invoice detail; list and detail are one module.
- products-view.tsx:322/:325 server-dedup-props: category links drawn twice (chips from 640 px, the sheet below), by design.
- services-list.tsx:139-161 content-visibility: left out, it can drop a shared-photo pair that is off screen.
- notification-bell.tsx `SignedInBell` not `next/dynamic` (low): small now that the staff inbox is out; loading it late would shift the
  header tools when the session resolves.
- Out of scope (lib/public-*, ttl-memo, search-core, site-nav, season, next.config, `[locale]/layout.tsx` async-parallel): still open,
  for the lead.

## View-transition audit (implementation.md step 1)

- Route fade: `page-transition.tsx:32` (`name="ls-page"`, `update={{'ls-nav':'ls-fade', default:'none'}}`) on the persistent `(site)`
  layout; every in-site navigation in scope now carries `NAV_TRANSITION` (scan of all `<Link>` and `router.push/replace`: the only links
  without it are the lateral filters above, the staff-only `NotificationIndicator`, and the shared/A2 files reported).
- Shared elements: `SharedPhoto` names are unique per page: `ls-photo-svc-{code}` (service-card.tsx:50 / services-view.tsx:185),
  `ls-photo-prod-{code}` (product-card.tsx:65 / product-gallery.tsx:67, :90 mutually exclusive); related rows on detail pages do not
  share. `share={{'ls-nav':'ls-morph', default:'ls-morph'}}` resolves even with `default="none"` (shared-photo.tsx:15).
- Suspense: no `<Suspense>` in scope; route `loading.tsx` only. Reduced motion: site.css `prefers-reduced-motion` block (:2116) and zero
  duration tokens. G7: GSAP only through `useMotion` (home-hero.tsx:42 on the hero photo, book.tsx step slide on `.ls-booking-main`); no
  `ViewTransition` on either element; no `Reveal` left in scope (order-fulfilment.tsx wrappers removed).

## Tests and checks

- `node --import tsx --test` (apps/web): account-frame, auth, profile, review-card, account-deletion, account-menu, brand-band,
  category-tile, info-pages, notification-bell, products-view, public-pages, s10-public, order-fulfilment, s10-shop, shop-screens,
  lib/customer booking, booking-view, fetch-cache, invoice, loyalty, profile, review, notification-center, notifications, ui-ratchet:
  168 pass, 0 fail. Updated with the same intent: products-view.test (no-break space in "3–5 ngày/days"), public-pages.test (brand in
  `translate="no"`), s10-shop.test (no-break space). Kit `components-css.test.ts`: 13 pass.
- `tsc --noEmit` (web): 0 errors in scope; 8 errors remain in `workforce/screens/product-text-cleanup.tsx` (another worker's file).
- `eslint` on the 52 changed files: clean. `prettier --write`/`--check` on the changed files and the three docs: clean.
