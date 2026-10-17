# Step 4, public area (session 10)

Worker: public. Stylesheet `packages/ui/src/s10-public.css` (placeholders, home, cards, chips, services, products, product page, shop,
orders, contact, info pages; tokens only, pinned by `components/public/s10-public.test.tsx`). Copy: `docs/redesign-s10/copy/public.md`.
Kit requests: 5 `[public]` lines in `docs/redesign-s10/kit-requests.md`. Paths below are under `apps/web/src/components/` unless
written otherwise. Nothing was removed from pages-v2.css / site.css (those rules are pinned by `pages-v2-css.test.ts` and shared); the
public sheet overrides them where the brief changed the rule.

Skills: frontend-design (guided each page: one filled button per view, one surface per idea, the generic tells removed, the hero as
the page's one moment); web-design-guidelines (rules fetched with WebFetch from the raw URL: the tool returns a condensed list, so
the cached `.local/s10/wig-command.md` categories were used for the line-by-line pass); react-best-practices (rules applied:
server-serialization, rerender-defer-reads / derived state (countdown), rerender-no-inline-components, js-cache-function-results
(Intl formatters), js-hoist-regexp, bundle-barrel/dictionary imports, rendering-image priority); react-view-transitions
(`references/implementation.md` read; decisions below).

## Owner answers applied (all pages)

- Answer 2, cards: the service card is one stretched link (name `<a>` + `::after`, pages-v2) with "Đặt lịch" as the **secondary**
  sibling above the layer (public/service-card.tsx:67); the product card is one link, no button, and no second link inside it (the
  campaign line moved to the product page only, public/product-card.tsx). Focus ring drawn round the whole card, card presses in
  (s10-public.css "Cards with a stretched link"). Filled primary: home hero, service detail (hero + booking band + phone bar, one in
  view at a time), product detail buy column (B16), cart/checkout/order pay, 404, campaign hero. Price-list "Đặt lịch" (B4) and the home
  offer are secondaries (my reading of answer 2: they are neither detail, form, hero nor dialog).
- Answer 7: names never truncated: product name clamp lifted (s10-public.css `.ls-pcard-name a`), service/cart/order names wrap by word,
  order "Sản phẩm" column `wrap: true` (shop/orders-screens.tsx:190, kit clamp lifted by the foundation).
- View transitions: the card name links, category tiles, price rows and in-page links carry `transitionTypes={NAV_TRANSITION}` (the
  `ls-page` fade is keyed on `ls-nav`; before, a card click morphed the photo but snapped the page). `SharedPhoto` resolves `share` to
  `ls-morph` (explicit `default: 'ls-morph'` in the type map, so `default="none"` does not disable it). Morph pairs: service card →
  service photo (service-card.tsx:50 / services-view.tsx), product card (list and now the home row, home-product-row.tsx) → gallery
  first image, including the no-photo placeholder (product-gallery.tsx:68 wraps the empty slide in the same name). Route fade
  elsewhere. No GSAP on a SharedPhoto (Reveal removed from every public page).

## Pages

### home (R13-R16, B3-B6) and home-en

- R13 hero: `HomeHero` (public/home-hero.tsx) wraps the server hero; the opening sequence runs through `useMotion().run` only
  (home-hero.tsx:47): the photo (or its placeholder frame) settles 1.04→1 over `--ls-dur-hero` (800 ms), transform only, `clearProps`;
  once per visit (`sessionStorage` `ls-hero-seen`, read in the effect, try/catch); nothing under reduced motion / data saver / `ls-fx=off`
  (useMotion gate). The words do not rise: GSAP loads after the first paint, so a text rise would first drop the painted headline by the
  shift and read as a jump (decision recorded for the lead's full-motion capture). The pages-v2 CSS keyframes are switched off
  (s10-public.css). Without the shop photo the words sit beside the 4:3 photo frame (placeholder icon, no caption posing as
  a credit) from 1024 px (home-content.tsx:113, photo-slot.tsx:27). One primary + one secondary (outline-white only on a photo).
- R16 brand band: light band in the page alternation (brand-band.tsx:93, tone from home-content.tsx:117), logos in ink at one height
  (32 px), white in dark (`--ls-s10-logo-filter`), no boxes; marquee and its still form under reduced motion / fx-off kept; pause
  button neutral; filler logos lazy (wig brand-band.tsx:54).
- B3 facts: address one step smaller, wraps by word, caption is the "Chỉ đường" link (new tab, named) (home-sections.tsx:73); phone a
  44 px `tel:` target, `translate="no"` (:89); caption "Điện thoại" (was "Hotline").
- R14 / B4 / B5: intro + price list; slider button to the service list left out (duplicate of the band's link, home-slider.tsx:44);
  price rows hover one grey step inside the column (no outline drawn past it, never black in dark: `--ls-hover-bg`), pressed one step
  more (s10-public.css "price list rows").
- R15 / B6 category grid: 3 columns from 1024, six-track grid so a last row of one or two tiles widens (no orphan; four tiles = 2 × 2);
  photo fills, white name on the flat scrim; hover never the accent (grey step / photo 2 %), pressed scale (s10-public.css).
- Offer: neutral card, secondary button (no burgundy block). Reveal removed (G2). home-en: EN copy fixes in i18n; `lang="vi"` on VI
  slides not possible without the slide language (kit/data request).

### services, service-detail (B5, B8, B10, B14, B7)

- List: cards server-rendered (public/service-card.tsx, new); `ServicesList` (client) only filters by the search kept in `?q=` with
  `useUrlState` (services-list.tsx:3; wig services-list.tsx:104, rbp :1,90-116 server-serialization). Placeholder with an example and
  "…" (wig :125). Empty search: heading, sentence, one action. Chips row is the bottom of the title band (`ls-band--alt`, B8), chosen chip
  filled with a check (services-view.tsx:59, C50), its hover goes one fill step (B14); rows scroll with snap and the foundation's peek
  (B10). No back on the list (top level).
- Detail: chevron "Quay lại Dịch vụ" only (breadcrumb removed: one back affordance, B7); price (title role) and time with icon, labels
  spoken only (services-view.tsx:188, B1); "Tất cả dịch vụ" a text link (:212); photo `priority` (wig photo-slot.tsx:26); failed read
  keeps an h1 (wig services-view.tsx:120); related cards outline "Đặt lịch".

### products, campaign, product-detail (+ cream, mask, sun, store, soldout, noimage)

- List: h2 "Sản phẩm" removed (band named, anchor kept on the toolbar, products-view.tsx:315); card headings h2; brand is a select in the
  toolbar (products-controls.tsx:54), so one accent chip row (C4); a parent whose sub-category is chosen takes the selected tint and is
  not announced as current (`data-ancestor`, products-view.tsx:177; only the chosen chip has `aria-current`); toolbar controls one height and pill shape; search placeholder with an example (wig
  products-controls.tsx:43); filter button neutral; campaign strips are quiet lines with a text link named for the campaign
  (campaign-views.tsx:70); card labels B18 (Mới neutral outline, sale ink, Hết hàng warning + icon), pre-order line with clock icon.
- Campaign: a slug that matches no running campaign (campaigns read) shows `CampaignEnded` (campaign-views.tsx:145, products-view.tsx:289):
  icon, heading, sentence, one secondary "Xem tất cả mỹ phẩm". Campaign hero: badge neutral and after the words (no eyebrow).
- Detail: chevron only; meta = category link + brand under the price, no middle dot (products-view.tsx:507); variants a kit segmented
  control (product-offer.tsx:4, no per-variant price box, no double border); availability one slot with icon + word; one filled button
  (B16): buy/sign-in, or "Gọi cửa hàng" when bought in the shop (store), secondaries "Chỉ đường" (new tab) (purchase-block.tsx:64);
  sold out: no disabled button, secondary call + directions, related row moved up as "Sản phẩm tương tự" (products-view.tsx:528);
  pre-order hides the usual sending promise (purchase-block.tsx:195); store block = plain text lines (phone a `tel:` link), no buttons,
  no card in the band (B12/B19); gallery 7/5 from 1024, full width below (no centred square with margins, R17); placeholders one grey
  step from the band (noimage).

### cart, cart-empty, cart-pre, cart-problem, checkout

- C72 undo: removing a line pushes the kit toast "Đã bỏ {tên} khỏi giỏ hàng." with action "Hoàn tác" (8 s), which re-adds the variant at
  its old quantity through the existing `/api/v1/me/cart/add` (cart-screen.tsx:150); `ShopFrame` provides the toast region
  (shop-frame.tsx:21); without a region a status row with the same words and button is the fallback.
- Rows reflow by the list's own width (container query, 36 rem; rem grows with text size) so 200 % text never gives one letter per line
  (C16); problem = danger icon + words under the name; shop-only/unavailable lines have one "Bỏ khỏi giỏ" button instead of a stepper
  (cart-screen.tsx:390); "Thanh toán" stays enabled with the reason beside it and moves focus to the first problem (:274); pre-order =
  neutral label + clock line, summary notes 14 muted with icons (no tinted box inside the card, B12); no-photo thumb framed one step
  from the card. No back (top level). Empty/closed: heading, sentence, one secondary.
- Checkout: chevron "Quay lại giỏ hàng" (shop-frame.tsx:55); one payment method = a plain line, no radio (checkout-screen.tsx:405, double
  border gone); policy inline at 14 with "Xem toàn bộ chính sách" toggle (no scroll box in a card, :418); "Áp dụng" neutral; `spellCheck`
  off on codes (:490, wig :470/:500); submit stays enabled, busy only while placing (:575, wig :558; the server re-quotes); no raw
  variant id (wig :449);
  no middle dot in the summary; saved address title without "·" (checkout-address.tsx:90); address fields carry `name` (wig :113).

### orders, order-detail, orders-empty, order-unpaid, order-waiting, order-cancelled, order-soon

- List: kit table without the one-item ⋮ menu (code link is the way in), `phoneRows="compact"` so a phone shows rows in one hairline
  surface, not a card per order (orders-screens.tsx:219, B19); date only ("14/10/2026", cached Intl); goods wrap; status
  badge with icon, SHIPPED no longer the accent (`OrderStateBadge`, orders-screens.tsx:104, B18/C5); pager words from online-shop.ts (no
  direct `i18n/workforce` import; still reached through `lib/workforce/product-orders` → list-view, not my file). Empty: heading,
  sentence, secondary "Xem mỹ phẩm".
- Detail: title "Đơn hàng ON…", chevron "Quay lại Đơn hàng online" (AccountScreen hides the tabs); 4 boxes → 2 surfaces (record card +
  lines card on the left, summary card with the address under a hairline, :711); lines as hairline rows, no "1." numbering, no equation
  (:603); badge and sentence from one state: past the deadline the badge reads "Hết hạn thanh toán" + one sentence + "Xem mỹ phẩm"
  (:550); cancelled: once in the badge, "Bạn chưa bị trừ tiền." when unpaid, totals quiet; waiting goods: short sentence + caveat note;
  countdown in its own component ticking in tabular digits, warning icon under 5 min (:354), the page itself re-renders once at the
  deadline, not every second (:330; rbp orders-screens.tsx:283-293); "Hủy đơn" destructive outline.

### contact, policy-returns / member / terms / privacy, not-found

- Contact: words leading (address heading-weight, phone and hours as icon lines, labels spoken only), map trailing 7/5 from 1024 with a
  hairline frame, "Chỉ đường" under the map, pills in an equal grid (no orphan), "Gọi ngay" the one fill, phone number plain text (one
  `tel:` link) (contact-view.tsx:45); failed read keeps an h1 (wig contact-view.tsx:25).
- Policies: the Owner's bold numbered parts become sections when the text has no `##` (info-view.tsx:19) → TOC aside from 1024 and a
  "Trong trang này" disclosure below (:78); title band has one sentence (description or "Cập nhật ngày …", B17); emails/phones in the text
  become `mailto:`/`tel:` links with a 44 px target (rich-text.tsx:20); parse failure keeps an h1 (wig info-view.tsx:16).
- 404: words from the site dictionary only (ticket strings moved; rbp not-found.tsx:7); one primary, secondary "Đặt lịch".

## Baseline findings closed (audit files)

wig: home-content.tsx:93 (`translate="no"` on the phone), brand-band.tsx:54, photo-slot.tsx:26, services-list.tsx:104/:125,
services-view.tsx:120, products-controls.tsx:43, products-view.tsx:390 (new-tab hint on directions), checkout-screen.tsx:449/:470/:500/:558,
checkout-address.tsx:113, orders-screens.tsx:171 (menu removed), info-view.tsx:16, contact-view.tsx:25, site.ts:651/:752/:816,
online-shop.ts:470. Not closed: orders-screens.tsx:203 ("Xem thêm" cursor kept: the API is keyset), checkout-screen.tsx:71 (leave guard),
order-fulfilment.tsx:66/:72 (file untouched). rbp: services-list.tsx:1,90-116 and :139-161 (catalogue small; content-visibility not added
because it can drop a shared-element pair off screen), products-view.tsx:249,326 (brand links now only in the phone sheet), home-product-row
.tsx:27, orders-screens.tsx:283-293, :34 (direct import), not-found.tsx:7, Intl caches (orders date, info date). Not closed: rbp
sale-countdown.tsx:21-25, quantity-stepper.tsx:29, shop-data.ts:70-93 (not touched).

## web-design-guidelines re-run (changed files)

Findings of the re-run on the edited files, each fixed in this pass:

- shop/checkout-screen.tsx:575 Forms (submit disabled until the quote arrived; now enabled, busy only while placing)
- public/products-view.tsx:176 Accessibility (ancestor chip announced `aria-current` beside the chosen one; now the chosen only)
- shop/orders-screens.tsx:219 Content handling (orders as one card per row on a phone; now compact rows in one surface)
- shop/cart-screen.tsx:150 Navigation & State (destructive remove with no undo; now the toast "Hoàn tác")
- public/product-card.tsx:68, public/service-card.tsx:56/:69, public/home-sections.tsx:132, public/campaign-views.tsx:76/:125
  Animation (links without the `ls-nav` type: the page snapped while the photo morphed; type added)
- public/home-hero.tsx:47 Animation (text rise after a late GSAP load would jump; tween limited to the photo)
  Final list for the changed files: 0.

## react-best-practices re-run (touched components)

Findings of the re-run, each fixed:

- public/rich-text.tsx:31 js-hoist-regexp (separator regex built per match; hoisted `SEPARATORS`)
- public/info-view.tsx:37 js-cache-function-results (Intl formatter per render; cached per locale)
- shop/orders-screens.tsx:69 js-cache-function-results (list date formatter cached per locale)
- shop/orders-screens.tsx:567 rerender-defer-reads (the countdown re-rendered the whole order page each second; isolated in
  `OrderCountdown`, the page re-renders once at the deadline)
- public/services-list.tsx:103 server-serialization (whole catalogue data serialized to a client list; cards now server-rendered)
- public/home-product-row.tsx:29 rendering priority on a lazy row (removed)
- app/[locale]/(site)/(public)/not-found.tsx:24 bundle (shop dictionary in the 404 chunk; words moved to the site dictionary)
  Final list for the touched components: 0.

## Tests run

`node --import tsx --test` (apps/web): public-pages, products-view, info-pages, category-tile, brand-band, s10-public (new),
shop-screens, order-fulfilment, s10-shop (new), ui-ratchet: 77 pass, 0 fail. packages/ui components-css: 13 pass, 0 fail. tsc (web): no error in
my files (errors in customer-profile.ts / profile.test.ts / workforce loyalty.tsx / pos.test.tsx belong to other workers). eslint on my
files: clean. prettier: clean.

## Phone pay bar (cart, checkout; added after the first report)

- New `shop/pay-bar.tsx` (`PayBar`): the kit action bar (`ls-action-bar`, sticky in the flow at the bottom of the scrolling page, above
  the tab bar; it keeps its own room at the end of the content so it never covers the last line; the contact button lifts above it)
  with the total (`price` role, tabular) and the page's one action. Cart: "Tạm tính" + the same action as the summary card (checkout
  link, the problem-focus button, or "Xem đơn hàng" at the unpaid limit), built once (`action` in cart-screen.tsx) and drawn in both
  places. Checkout: "Tổng cộng" + the submit button, inside the form (`submitButton` in checkout-screen.tsx).
- s10-public.css "phone's pay bar": hidden from 1024 px; below it the bar shows and the summary's copy (`.ls-pay-inline`) hides, so one
  filled button is in view; the kit bar's entrance animation is off (no entrance motion); the button is the lg size (44 px); the bar
  wraps (total above the button when narrow) and under `html[data-text-large]` it stops sticking, so at 200 % text it never holds a
  large share of the screen. Test: s10-shop.test.tsx (markup + the three CSS rules).

## Not done (and why)

- Policy-member 3-column table kept as a table on phone; 404 band 60 svh; slide `lang` on /en; contact slot order: kit requests.
- Low-stock line (product-sun): Owner decision whether guests see it (not invented).
- Campaign live-slug re-capture and the order-soon fixture: handled by the lead.
