# frontend-design: Step 1 critique + Step 2 plan, customer area part 2 (phase s10base)

Method: per page, `node .local/s10/sheet.mjs s10base customer <page>`; the light sheet (390, 768, 1440, 200 % zoom, 200 % text) and
the dark sheet (390, 768, 1440) opened with Read, full images where a detail was too small. E2 = `node scripts/uxui-e2-summary.mjs
s10base --pages`. "Chrome" in the E2 lines = the counts every customer page shares (skip link 16 px font-size, header tool gaps and
nav/tab-bar overlaps, the `.ls-site` clipped-text box, sticky-cover at 200 % text, header bell pink in dark); those are fixed once by
plan-foundation F1.3, F1.7, F2.9, F2.12 and are not re-planned per page. Grey photos are scratch stand-ins (not graded).

### customer/notifications

**Critique**

- "← Quay lại" text link above the h1 at every width (B7/C40): the account tabs are the navigation, this page has no parent.
- 390 light/dark: every message is a grey rounded card of label/value pairs ("Thời gian / Nguồn / Trạng thái"), 5 messages per
  2600 px; identical card kit (tell, B19); source truncated "Lucy Spa Đà Nẵng - 04 Nguyễn Qua..." (C15, E2 clipped-text 9).
- Unread is told by a blue "Chưa đọc" pill in a whole column (every row the same pill): a second chromatic colour for a non-status
  fact, colour + word only; 9.2 asks unread = ink 600 + dot + word for screen readers, no column.
- Every title is an underlined burgundy link ending in a full stop; nine burgundy underlines in a column read as decoration
  (A3: correct role, too much ink). Dark: titles, filter border and refresh icon pink `#dcadb0` (B22, E2 pink-dark).
- 390: the filter is an icon-only outline pill with a burgundy border (secondary look for a neutral toolbar control); 768+:
  "Hộp thư" native select, unstyled (B9). "Đánh dấu tất cả đã đọc" sits in the title band, a second action competing with the tabs.
- 200 % text: Thông báo column squeezed to two words + "..." ("Lịch hẹn đã được...") while "Nguồn" keeps width (C15/C16);
  account tabs wrap to two ragged rows. 200 % zoom: tabs 12 px text, hit-target gaps.
- Tells: identical card kit at 390, decorative full stops on titles; no all-caps, no arrows.
  **Plan**
- Pattern: account record list, 9.2 "Notifications": one hairline surface list on a white band, under the account title band.
- Changes: drop PageBack (F2.11, no parent). One row = dot (unread) + title (ink, 600 when unread, 400 read; the row is the link,
  no underline) + one 14 muted line "time, source code" + trailing ⋮; status column removed; visually hidden "Chưa đọc" word on the
  dot. Phone: the same rows (not cards). Toolbar row: styled "Hộp thư" select (F2.3) + refresh icon button + "Đánh dấu tất cả đã
  đọc" as a neutral pill at the toolbar's trailing edge (moved out of the title band). Source address wraps, never ellipsis.
  Flag copy: titles end with a full stop (Owner/system notification text: flag only, not changed here).
- Tells removed: card kit at 390, burgundy link column, status pill column.
- Baseline findings fixed: E2 clipped-text 19 (390 x2 + text200), overlap 16-23 page part (title links vs tab bar), pink-dark 6;
  chrome counts per F1/F2. wig inbox.tsx:327 (filters to URL via useUrlState), inbox.tsx:396 (archive gets an undo toast),
  inbox.tsx:230 (customer wording for booking/order links); rbp inbox.tsx:24 (workforce dictionary out), :52-90 (one shared unread
  subscription, paused when hidden), :170-179 (cached Intl), :470-497 (functional setState).
- Transitions: route fade only; mark-all = no animation beyond the weight change.
- Checks: E2 clipped-text 0, pink-dark 0, overlap 0 (page part), hover/pressed-missing 0 on rows and toolbar; visual: 390 light
  rows not cards, 200 % text titles wrap fully, dark 1440 no pink, unread readable without colour (screen reader word present).

### customer/orders

**Critique**

- "← Quay lại" on a top-level account tab (B7/C40).
- 390 light/dark: each order a grey rounded card of label/value pairs (B19, identical card kit); product names truncated with
  "..." ("Sữa tắm hương hoa (không ảnh) - 50...", C15, E2 clipped-text 3); the "Sản phẩm" value flips between right-aligned on its
  own line and left-aligned when long: ragged edge (C18).
- Status badges in four colours (orange, grey outline, two blues) with words only, no icon (C5); "Đã hủy" outline vs others tinted.
- Columns change by width: 768 shows product but no date, 1440 everything, 200 % zoom drops date and product; 200 % text keeps
  date + product and pushes Tổng tiền and Trạng thái off the right edge with no scroll sign (C16 fail).
- Row ⋮ menu holds a single "Xem đơn hàng" that repeats the order-code link (two targets for one action).
- Dark: order codes pink underlined (B22, E2 pink-dark `#dcadb0` on "ON000030"); the header "Đặt lịch" pill reads raspberry.
- Date format "03:14 Thứ 4, 14/10/2026" (time first) differs from notifications "14 thg 10, 2026 03:15" (cross-page).
  **Plan**
- Pattern: customer table (8.4/F2.6) on a white band under the account title band; below 768 stacked rows (not cards).
- Changes: drop PageBack. Columns fixed by priority: Mã đơn (link), Ngày đặt (date only, one format shared with all account
  lists: "14/10/2026"), Sản phẩm (wraps to 2 lines, then "+ n sản phẩm" text, never "..."), Tổng tiền (right, nowrap, tabular),
  Trạng thái (badge with icon per F1.8/R26). Below 768: row = code + status on line 1, product on line 2, date and total on
  line 3 (label-free, one alignment). Wide content scrolls inside the table container with a visible edge (F2.6). Remove the
  one-item ⋮ menu (the code/row is the link).
- Tells removed: card kit at 390, colour-only badges.
- Baseline findings fixed: E2 clipped-text 7, pink-dark 3; chrome counts per F1/F2. wig orders-screens.tsx:171 (link, not
  router.push; menu removed), :203 ("Xem thêm" pages into URL state / Pagination 20 per page); rbp orders-screens.tsx:34
  (workforce dictionary import out), Intl cache (lib/shop/online.ts:352).
- Transitions: route fade; row to detail = route fade only (no photo to morph).
- Checks: E2 clipped-text 0, pink-dark 0, overflow-x 0; visual: 200 % text shows every column or a visible inner scroll, 390 rows
  aligned on one edge, dark 1440 codes neutral-underlined (F1.3), every badge has an icon.

### customer/order-detail

**Critique**

- Has a parent (orders) but shows the same text "← Quay lại" as the top-level tabs (B7: chevron icon only, named for the parent);
  the account tab row is also shown, so two navigations sit above the title.
- Four grey rounded boxes of equal weight (Trạng thái, Sản phẩm, Tóm tắt đơn hàng, Địa chỉ giao hàng): identical card kit, no
  hierarchy between record and summary (B19). 1440/200 % zoom: two columns, the record column narrower than the summary column
  at 200 % zoom, so the status sentence wraps in 3 lines.
- Decorative numbering "1." before the single product line; the line reads as an equation "259.000 ₫ × 1 = 259.000 ₫"; no
  thumbnail, product name not a link.
- Status badge blue tint, word only (C5); timeline dates and the delivery note in 12 px faint grey (B1); address card labels
  12 px above values (eyebrow pattern, B1).
- Dark: header "Đặt lịch" and the tabs' current underline read pink (B22, E2 pink-dark on secondary "Đặt lịch").
- Tells: decorative numbering, identical card kit, eyebrow labels.
  **Plan**
- Pattern: 9.2 record detail split: left record (status + timeline, then lines), right summary card (totals, then address)
  sticky from 1024; on phone one column, summary after the lines. White band; cards only for the two records (R rule: record cards).
- Changes: PageBack chevron "Quay lại Đơn hàng online" (F2.11) beside the h1 "Đơn hàng ON000027" (code in the title, one line);
  hide the account tab row on detail pages (the chevron is the way back). Status block: badge with icon + the one sentence 17
  body, timeline as a vertical list with icons, dates 14 muted (F1.7). Lines: thumb 64 (flat placeholder when none), name as a
  link to the product, "1 x 259.000 ₫" 14 muted under it, line total trailing (tabular). No numbering. Address: plain lines
  (name, phone, address), no per-field labels. Grid columns 7/5 from 1024, equal start edges.
- Tells removed: "1." numbering, eyebrow labels, card kit (4 boxes become 2 surfaces).
- Baseline findings fixed: E2 overlap page part 4-5 (390/768 over the tab bar), pink-dark 3; chrome per F1/F2. wig
  order-fulfilment.tsx:66 (new-tab hint), :72 (`translate="no"` on tracking code), orders-screens.tsx:467 (tabular-nums on the
  countdown); rbp orders-screens.tsx:283-293 (countdown in its own component), :319 (`useSearchParams` for the arrival notice).
- Transitions: route fade; the product thumb shares `SharedPhoto` with the product page (morph when opened).
- Checks: E2 pink-dark 0, clipped-text 0; visual: 390 one column, 1440 7/5 split aligned, dark no pink, badge has icon; long
  product name (2 lines) wraps without ellipsis.

### customer/orders-empty

**Critique**

- "← Quay lại" on a top-level tab (B7).
- Empty state is a hairline-outlined box (a bordered box inside the white band, B12) with a 16 px cart icon, one sentence and an
  outline "Xem mỹ phẩm →" (arrow tell; A4). No title; the sentence is the only text (8.4 asks icon 24, title, sentence, action).
- 1440: the box spans the full content width for three short lines, leaving a wide empty frame.
- Dark: button text and border pink `#dcadb0` (B22, E2 pink-dark 3).
  **Plan**
- Pattern: account list empty state (8.4) on the white band, centred, max 480, no box.
- Changes: drop PageBack; icon 24 (currentColor, muted), title "Chưa có đơn hàng online" (heading), sentence "Mỹ phẩm bạn mua
  online sẽ hiện ở đây.", action "Xem mỹ phẩm" secondary without arrow (the header pill stays the view's one fill). Same
  component reused for bookings/invoices/notifications/cart empty (cross-page).
- Tells removed: "→" on the button, outlined box.
- Baseline findings fixed: E2 pink-dark 3; chrome per F1/F2. No wig/rbp finding specific to the empty branch.
- Transitions: route fade only.
- Checks: E2 pink-dark 0, secondary-filled 0; visual: 390/1440 light and dark 1440, no border around the state, button without
  arrow, 200 % text centred and unclipped.

### customer/cart

**Critique**

- "← Quay lại" on a top-level page (B7/C40; the cart has no parent).
- 200 % text (1440): the two-column layout is kept and the line column collapses to one character per line ("T / i / n / h ...")
  for the full height of the page, prices and steppers stacked in a 100 px strip: the worst C16 failure of this set.
- Quantity stepper: white pill on the grey card, the input edge measures 1:1 (E2 contrast 3 per mode, control-border); in dark a
  black pill on a dark grey card. Trash icon removes the line at once, no undo (wig cart-screen.tsx:273).
- Summary card stretches to match nothing (E2 card-heights 420 vs 274 at 1440): the list surface and the summary read as two
  unrelated boxes rather than list + sticky aside. Summary note "Giảm giá thành viên ..." 12 px faint (B1).
- Old prices struck through in 12 px faint grey next to the price; line names change scale a lot (20 px at 390, 14 px at 1440).
- "Thanh toán" is the one filled button (good, A4). Dark: header "Đặt lịch" secondary pink (E2 pink-dark 3, B22).
- Tells: none of the listed ones; the page is plain but boxy (grey cards on a white band, B12 risk where the stepper sits inside).
  **Plan**
- Pattern: 9.2 Cart: title band, then a white band with the line list as one surface (rows split by hairlines) and the summary
  as a sticky aside from 1024 (`align-self: start`, top = header height + 16); below 1024 the summary follows the list and
  "Thanh toán" sits in a sticky bottom bar above the tab bar.
- Changes: drop PageBack. Row grid: thumb 80 (links to the product) | name (wraps, 17/500) + variant 14 muted + unit price and
  struck old price 14 | stepper + line total trailing (tabular, nowrap). Below 768 and at 200 % text the row reflows to two lines
  (thumb + name/meta, then stepper / remove / total) with a container query, so no column can shrink below 12 ch. Stepper per
  F2.3 (1 px control border, fill = opposite band). Remove = icon button 44 with name "Xóa <tên>" and an undo toast (F2.8). Note
  under the totals at 14 muted.
- Tells removed: n/a; boxes reduced to one list surface + one aside.
- Baseline findings fixed: E2 contrast 24 (control border), card-heights 3, overlap page part 6 (thumb vs tab bar at 390),
  pink-dark 3; chrome per F1/F2. wig cart-screen.tsx:273 (undo); rbp quantity-stepper.tsx:29 (no prop-to-state effect),
  shop-data.ts:70-93 (one shared cart count).
- Transitions: route fade; removing a row collapses its height over `--ls-dur-fast` (reduced = instant); thumb morph to product.
- Checks: E2 contrast 0, card-heights 0, clipped-text 0, overflow-x 0; visual: 200 % text rows reflow and every name reads in
  words, 390 sticky checkout bar clear of the tab bar, dark 1440 stepper edge visible, undo toast after remove.

### customer/cart-empty

**Critique**

- "← Quay lại" on a top-level page (B7).
- 768/1440 light and dark: two filled burgundy pills in one view, header "Đặt lịch" and the empty-state "Xem mỹ phẩm" (C4/B11);
  the orders empty state uses an outline button for the same job, so the member area has two empty-state designs.
- 16 px cart icon, one 17 px grey sentence, no title (8.4: icon 24 + title + sentence + action, C33). Title band holds only the
  h1 (no sentence), so the band is tall and empty at 390.
- Dark: the fill reads raspberry next to the raspberry header pill (two pink-ish blocks, B22 feel); E2 pink-dark 3 = header secondary.
  **Plan**
- Pattern: 9.2 Cart empty state, using the shared member empty-state component (see orders-empty), centred on the white band.
- Changes: drop PageBack; title band keeps the h1 plus the free-delivery sentence shown on the full cart (same band height in both
  states); icon 24, title "Giỏ hàng đang trống", sentence "Thêm mỹ phẩm từ cửa hàng online để đặt mua.", action "Xem mỹ phẩm" as
  secondary (one fill per view; the header pill keeps it). If the member has unfinished orders, a second line link "Xem đơn
  hàng" (tertiary, navigation) is allowed.
- Tells removed: none present beyond the duplicated fill.
- Baseline findings fixed: E2 pink-dark 3; chrome per F1/F2. wig/rbp: none specific to this state.
- Transitions: route fade only.
- Checks: E2 secondary-filled 0, pink-dark 0; visual: 768 and 1440 show exactly one filled button, 390 band height equal to the
  full-cart band, dark 1440 no pink.

### customer/checkout

**Critique**

- Parent is the cart, but the back affordance is the same text "← Quay lại" as on top-level pages (B7: chevron named "Quay lại
  Giỏ hàng").
- Four stacked grey section cards (address, payment, policy, order) = identical card kit; the policy is a white scroll box inside
  the grey card (nested box + a scroll region inside a card, B12/B19); policy text 12 px at 768/1440 (B1).
- Payment method: one radio card with one option (a choice with nothing to choose); selected border burgundy, in dark pink
  `#dcadb0` (B22, E2 pink-dark 3); tick drawn as a bordered circle inside the bordered label (E2 double-border 1 per mode).
- "Áp dụng →" outline pills with the arrow tell, twice, beside the voucher and referral fields (A4/F2.1).
- 1440: the form column sits at the leading edge with ~700 px of empty space to its right while the summary is a card at the bottom
  of the column; the primary "Đặt hàng và thanh toán" is ~1500 px down at 390 with no sticky bar.
- Field labels 12 px at 768+, quantity "× 2" and delivery notes 12 px faint (B1). 390: E2 overlap 32 (fields pass under the fixed
  tab bar: scroll-padding missing, F2.12).
- Copy flags (not data): "Chúng tôi không thu tiền khi giao hàng" switches to first person (rest says "cửa hàng").
  **Plan**
- Pattern: 9.2 Checkout. One white band; form column max 720 at the leading edge and, from 1024, the order summary as a sticky
  aside (same aside as the cart, so the two steps look like one flow). **(deviation from 9.2 "one column": pending Owner; fallback
  = one column, summary last.)**
- Changes: PageBack chevron to the cart. Sections become plain groups split by hairlines inside one surface (heading 21 + fields),
  no grey card per section. Payment: when one method, a plain line with the PayOS icon and the sentence (no radio); with 2+ methods
  radio cards per 9.2 (accent border + check + word, dark gray 12 border). Policy: the text inline at 14, collapsed to its first
  three lines with an accordion "Xem toàn bộ chính sách" (button + chevron), checkbox under it. Voucher/referral: field + neutral
  pill "Áp dụng" (no arrow). Below 1024 a sticky bottom bar with the total and the primary above the tab bar. Labels 14/500 (8.2).
- Tells removed: "→" x2, card kit, nested scroll box.
- Baseline findings fixed: E2 double-border 8, pink-dark 9, overlap page part ~20 (390); chrome per F1/F2. wig
  checkout-screen.tsx:470 (`spellCheck={false}`, also :500), :558 (primary stays enabled, reason shown on submit), :71 (leave guard),
  :449 (no raw variant UUID), checkout-address.tsx:113 (`name` + autocomplete on address fields); rbp checkout-screen.tsx:83 (lazy
  ref), :112-123 (addresses during render), :233-235 (functional draft update).
- Transitions: route fade from cart; no entrance motion on the form.
- Checks: E2 double-border 0, pink-dark 0, overlap 0, secondary-filled 0; visual: 390 sticky pay bar clear of the tab bar and the
  focused field scrolls above it, 1440 aside aligned to the form top, dark radio/check neutral, 200 % text form readable.

### customer/product-cream

(Product with variants. The six product-* pages share one component set: `products/[code]/page.tsx`, products-view.tsx,
purchase-block.tsx, product-gallery.tsx, product-offer.tsx, sale-price.tsx, sale-countdown.tsx. This block holds the shared plan;
the other five blocks list only what their state adds. fd-critique "product-detail" covers the promotion state.)
**Critique**

- "← Quay lại" + a breadcrumb "Mỹ phẩm > Chăm sóc da" (two back affordances, B7); the breadcrumb is underlined burgundy, pink in dark.
- Eyebrow middle-dot string "Chăm sóc da · Thương hiệu mẫu" above the name (tells: eyebrow + middle dot; B1 faint).
- Price block is four lines (struck 289.000 + "-20%", price, "Tiết kiệm 57.800 ₫", "Khuyến mãi: <link>") then the variants repeat
  the price in each radio card (231.200 twice on screen); variant radio cards stacked full width, selected = burgundy border +
  filled check (E2 double-border 1 per mode), dark pink border (B22).
- Primary "Đăng nhập để mua" (good, one) but the store card below adds a filled "Gọi cửa hàng" + outline "Chỉ đường →" (B16/C4,
  arrow tell); the store card is a grey box inside the description band with 12 px label/value pairs (B12/B1).
- R17: at 768 the photo frame is a centred square with white margins; at 1440 the gallery is ~290 px wide beside a narrow info
  column, the page looks like a small card in a wide band.
- "Mới" badge burgundy outline (accent on a non-action label, A3/B18). Related row: same card kit with 12 px eyebrows, "Mới" +
  "Hết hàng" pills on photos, 20 px arrow buttons (C29).
- Dark: breadcrumb, promo link, badge and variant border pink (E2 pink-dark 6). 200 % text: footer link lines overlap (shared, F2.10).
  **Plan**
- Pattern: 9.2 Product detail split (gallery 7 / info 5 from 1024, stacked below), then bands: description (white), how to use /
  ingredients accordion (#f5f5f7), related row (white). R17: the main photo fills its 1:1 frame edge to edge, 18 px radius.
- Changes: PageBack chevron "Quay lại Mỹ phẩm" only, breadcrumb removed (or kept as the only affordance from 1024: one of the two,
  not both). Name h1 first; category and brand become a 14 muted line _under_ the price as links ("Chăm sóc da", "Thương hiệu
  mẫu"), no middle dot. Price block: price (price role) + struck old price + sale badge on one line, then "Tiết kiệm 57.800 ₫" 14
  muted; promotion as a link line. Variants: segmented pills "50 ml / 100 ml" (F2.4, selected = accent fill + check), the main
  price updates; no per-variant price box. Quantity stepper + primary ("Thêm vào giỏ" / "Đăng nhập để mua"), availability line
  with icon + word. Store block: plain text section (address, phone, hours) with two secondary pills "Gọi cửa hàng" and "Chỉ
  đường" (no arrow, new-tab hint); never filled. Badges per F1.8.
- Tells removed: eyebrow, middle dot, "→", second fill, card-in-band.
- Baseline findings fixed: E2 double-border 8, pink-dark 18, hit-target page part (related arrows); chrome per F1/F2. wig
  products-view.tsx:390 (new-tab hint on "Chỉ đường"); rbp sale-countdown.tsx:21-25 (one shared ticker), Intl cache
  (public-products-core.ts:470,499), product-gallery/purchase-block pass.
- Transitions: route fade + shared photo morph from the list card (F3.6, the page's one moment); variant switch updates in place.
- Checks: E2 double-border 0, pink-dark 0, secondary-filled 0; visual: exactly one filled button per view (390/768/1440, dark),
  1440 photo fills its frame and the split is 7/5, 200 % text price and variant pills wrap without overlap.

### customer/product-mask

(Pre-order product. Everything in product-cream applies: back + breadcrumb, middle-dot eyebrow, store card with filled "Gọi cửa
hàng" + "Chỉ đường →", photo not filling at 768/1440, burgundy "Mới", pink in dark (E2 pink-dark 15).)
**Critique** (state-specific)

- The pre-order fact appears three ways: in the product name "(đặt trước)" (catalog data: flag only), a 14 grey line "Đặt trước,
  dự kiến 3–5 ngày" with no icon, and a 12 px faint clock note at the bottom ("Đơn có hàng đặt trước được gửi một lần khi đủ
  hàng ..."); the free-delivery note above it promises "Gửi trong 2 ngày" which contradicts the pre-order lead time (B1, C15 risk).
- The primary does not say this is a pre-order ("Đăng nhập để mua"); 1440: the name wraps to two lines in the narrow info column.
- 390: E2 overlap 7 page-part (the primary passes under the fixed tab bar while scrolling: no bottom room).
  **Plan** (adds to product-cream)
- Availability line = icon + word, one place: "Đặt trước · giao dự kiến 3–5 ngày" written as two short sentences, no middle dot
  ("Hàng đặt trước. Dự kiến giao sau 3–5 ngày."), 14 muted with a clock icon, directly under the price; the free-delivery line
  hides its "2 ngày" sentence for pre-order items (UI copy choice only; the shipping rule is unchanged). Primary label for a
  signed-in member: "Đặt trước" (pending copy check by the Owner); the pre-order condition sits under it at 14.
- Baseline findings fixed: as product-cream + overlap page part 7 (scroll-padding/bottom room, F2.12).
- Checks: as product-cream; visual: one pre-order message at 390 and 1440, no contradicting delivery promise, dark no pink.

### customer/product-sun

(Low-stock product. Everything in product-cream applies; E2 pink-dark 15, overlap page part 4 at 390.)
**Critique** (state-specific)

- The low-stock state shows nothing to a guest: same page as a normal product (price, primary, delivery note). If the shop
  wants a cue, there is none; if it does not, the seed state is untestable from the page (C5: state never by colour alone, here not
  shown at all). Whether a guest sees stock levels is an Owner choice (not invented here).
- Related row: the pre-order card at 1440 carries an extra "Đặt trước, dự kiến 3–5 ngày" line, so that card is taller than its
  row mates (B6); dark: the burgundy-outline "Mới" badge on the grey photo almost disappears, "Hết hàng" is a black pill (B18).
  **Plan** (adds to product-cream)
- Availability line component (shared by all six states) with four variants: in stock (no line or "Còn hàng" per Owner), low
  stock ("Sắp hết hàng", warning icon + word, status tint per R26) shown **only if the Owner approves showing it**, pre-order
  (clock icon), sold out (see product-soldout). Same slot under the price in every state, so the layout never shifts.
- Related cards per F2.5: card is a flex column, meta lines clamp to the same slot, badges per F1.8 with a solid backing so they
  read on any photo in both modes.
- Checks: as product-cream; visual: related row equal heights at 1440 (E2 card-heights 0), dark badges readable on the photo.

### customer/product-store

(Shop-only product. Everything in product-cream applies; E2 pink-dark 13, overlap page part 4 at 390 / 4 at 200 % zoom.)
**Critique** (state-specific)

- Hierarchy inverted: the purchase slot holds a full-width outline "Mua tại cửa hàng →" (arrow tell) that only jumps down the page,
  while the only filled button, "Gọi cửa hàng", sits in the store card two bands lower (B16/B15: the page's main action is not
  the primary; A4).
- Nothing in the purchase slot says _why_ it cannot be bought online (only the product name carries "(chỉ bán tại cửa hàng)", which
  is catalog data: flag only); the delivery note is (correctly) gone, leaving the slot as one button under the price.
- Dark: outline button text and border pink (B22).
  **Plan** (adds to product-cream)
- Purchase slot for shop-only: availability line "Chỉ bán tại cửa hàng" (store icon + word) under the price, then the primary
  "Gọi cửa hàng" (`tel:` link, the one fill) and the secondary "Chỉ đường" (new-tab hint) side by side, equal size (8.1); the
  store band lower down shows address and hours as text only, no buttons (actions are not repeated).
- Tells removed: "→", jump button.
- Checks: as product-cream; visual: one filled button in the first viewport and none further down, 390 both pills 44 px and
  equal width, dark no pink.

### customer/product-soldout

(Sold-out product. Everything in product-cream applies; E2 pink-dark 13, overlap page part 7 at 390.)
**Critique** (state-specific)

- The purchase slot is a full-width disabled grey pill whose label is the state, "Hết hàng →" (a button that is not an action,
  with the arrow tell), and the same word sits on a 14 px line just above it: "Hết hàng" twice, no icon (C5), no next step (C33).
- Dark: the disabled pill is mid-grey with grey text on the #1c1c1e band, the weakest element on the page yet in the primary slot.
- The only filled button is again "Gọi cửa hàng" two bands down (B16 pattern from product-store).
  **Plan** (adds to product-cream)
- Availability line "Hết hàng" with the warning status icon + word (F1.8, R26), no disabled button in the slot. Next steps in its
  place: secondary "Gọi cửa hàng" (ask when it is back; `tel:`) and the related row moved up as "Sản phẩm tương tự" directly under
  the split on this state. No "báo khi có hàng" control (no such feature; not invented). Store band text only, as product-store.
- Tells removed: "→", state-as-button.
- Checks: as product-cream; visual: no disabled control in the purchase slot at any width, the state readable with colour removed
  (icon + word), dark 1440 contrast of the state line ≥ 4.5.

### customer/product-noimage

(Product without a picture. Everything in product-cream applies; E2 pink-dark 15, overlap page part 4 at 390.)
**Critique** (state-specific)

- The no-photo frame is a pure white square on the #f5f5f7 band (light) and a pure black square on the #1c1c1e band (dark), with a
  small droplet icon: it reads as a hole cut in the page rather than a frame; at 1440 it is the same small 290 px square.
- The related row shows the opposite problem: the no-photo card (in other states' rows) is white while photo cards are grey, so
  one card in four looks unfinished. Dark: burgundy "Mới" on the grey stand-in photos nearly vanishes, "Hết hàng" black pill (B18).
- Product name contains "(không ảnh)" (seed data: flag only, not graded).
  **Plan** (adds to product-cream)
- One flat placeholder for every product/service image (8.9 image frame): fill = the next grey step from the band it sits on
  (light gray 3 on a gray 2 band, gray 2 on white; dark gray 3 / gray 2), 18 px radius, the 24 px product-type icon in
  `--ls-text-subtle`, no text; same size and ratio as a real photo (1:1), so the layout and the shared morph are identical with or
  without a photo. Badges sit on a solid backing (F1.8) so they read on photo and placeholder alike.
- Checks: as product-cream; visual: the placeholder is one step from its band in light and dark (never pure white/black), the
  frame is the same size as product-cream at 390/768/1440, related row placeholders match.

### customer/order-unpaid

(Order waiting for payment, captured after its payment window: the seed date is past the deadline. Everything in order-detail
applies: text back link + tabs, four grey boxes, "1." numbering, equation line, eyebrow labels; E2 pink-dark 3.)
**Critique** (state-specific)

- Two contradicting states in one block: the badge says "Chờ thanh toán" (orange) and the line under the heading says "Đã hết hạn
  thanh toán" in red, with no icon (C5) and no next step (C33): no "Thanh toán" button (correct once expired) but also no
  "Mua lại" / "Xem mỹ phẩm" and no sentence saying the order was not charged.
- The status block has the same weight as the address block; at 390 the one thing the customer must act on is a 17 px red line.
  **Plan** (adds to order-detail)
- Status block per state, one message only: badge (icon + word) derived from the same state as the sentence (the UI never shows a
  badge and a sentence that disagree; when the window has passed, the badge reads "Hết hạn thanh toán" with the danger icon; the
  state mapping is UI only, no API change). Next step under the sentence: within the window, the primary "Thanh toán" (PayOS
  handoff unchanged) + the countdown in tabular nums in its own component (rbp :283-293); after the window, sentence "Đơn chưa được
  thanh toán nên đã tự hủy. Bạn chưa bị trừ tiền." (copy pending Owner check) + secondary "Xem mỹ phẩm".
- Checks: as order-detail; visual: badge and sentence agree in both seeds (unpaid and order-soon), exactly one filled button when
  payable and none when expired, status readable without colour.

### customer/order-waiting

(Paid order waiting for pre-order stock. Everything in order-detail applies; E2 pink-dark 3, overlap page part 6 at 768.)
**Critique** (state-specific)

- The status sentence is a 4-line paragraph set at 20 px semibold on 390 (heavier than the section headings), restating the
  pre-order policy ("... không phải cam kết") instead of the state; at 200 % zoom it wraps to 6 lines in the narrow record column.
- The pre-order line carries two blue pills, "Đặt trước" and "Đã thanh toán" (the second repeats the order status), and a 12 px
  faint "Dự kiến 17/10/2026 – 19/10/2026" (B1); blue tints for non-status labels (A3/R26).
  **Plan** (adds to order-detail)
- Status sentence 17 body, one short line of state ("Đơn đã thanh toán. Cửa hàng gửi hàng khi hàng đặt trước về đủ."); the
  policy caveat moves to a 14 muted note under the timeline. Line meta: one neutral label "Đặt trước" (F1.8 neutral outline) +
  "Dự kiến 17–19/10/2026" at 14 muted with a clock icon; no per-line payment pill (the order badge says it).
- Checks: as order-detail; visual: status sentence ≤ 2 lines at 390, no blue label outside the status badge, 200 % zoom record
  column not narrower than the summary.

### customer/order-cancelled

(Cancelled order. Everything in order-detail applies; E2 pink-dark 3, overlap page part 4 at 390.)
**Critique** (state-specific)

- "Đã hủy" is said three times: the grey outline badge, the sentence "Đơn này đã hủy.", and a second "Đã hủy" pill on the line;
  none says who cancelled or why, or whether money was involved (C33: no next step, no reassurance).
- The cancelled order shows its totals at full weight in the summary card, exactly like a live order; nothing visually marks the
  record as closed apart from the small grey badge (C5: grey outline only, no icon).
- Timeline has only "Ngày đặt" (no "Ngày hủy" step), so the record misses the event it is about.
  **Plan** (adds to order-detail)
- Status block: badge "Đã hủy" with the neutral/closed status icon, one sentence with the reason when the API gives one (no new
  field; if absent, "Đơn đã hủy." only) and, for unpaid cancels, "Bạn chưa bị trừ tiền." (copy pending Owner); timeline shows the
  cancel step when its time is known; per-line "Đã hủy" pill removed. Summary totals rendered at 14 muted (record, not a bill).
  Next step: secondary "Xem mỹ phẩm".
- Checks: as order-detail; visual: "Đã hủy" appears once as badge + once in the sentence at most, icon present, dark 1440
  badge readable.

### customer/order-soon

(Unpaid order close to its deadline. Everything in order-detail and order-unpaid applies; E2 pink-dark 3.)
**Critique**

- The capture shows the _expired_ state, pixel-for-pixel the same as order-unpaid ("Chờ thanh toán" badge + red "Đã hết hạn thanh
  toán"): the seed order was placed 14/10 and the payment window has passed by the capture date, so the near-deadline state
  (countdown + pay action) is **not in the baseline at all**. The most time-critical customer screen is therefore unreviewed.
- Same contradictions as order-unpaid (badge vs sentence, no icon, no next step).
  **Plan** (adds to order-unpaid)
- Capture rig: re-seed this order relative to the capture time (or run the capture under the existing fake-clock script) so
  order-soon shows a live countdown; this is a rig change, not app code. Then review: countdown in tabular nums that does not
  jitter (wig orders-screens.tsx:467), countdown text in its own component (rbp :283-293), primary "Thanh toán" as the one fill,
  warning tint + icon on the "còn n phút" line under 5 minutes, the PayOS handoff unchanged.
- Checks: order-soon capture shows the countdown and one filled "Thanh toán"; two screenshots 2 s apart differ only in the
  digits (no layout shift); dark 1440 warning line readable.

### customer/cart-pre

(Cart with an in-stock and a pre-order line. Everything in cart applies, including the 200 % text one-letter column (seen again
here) and the stepper contrast (E2 contrast 16); card-heights 3 (summary 385 vs list 288 at 1440).)
**Critique** (state-specific)

- The pre-order rule is said twice: a blue "Đặt trước" pill + a 12 px faint "Dự kiến 3–5 ngày, không phải cam kết" on the line,
  then a blue tinted info box inside the grey summary card ("Giỏ có hàng đặt trước ...", 4 lines at 390): a tinted box nested in a
  card (B12) and blue used for a non-status label (A3/R26).
- The mixed cart does not say what happens to the in-stock item (shipped together when the pre-order arrives?); the copy is
  the Owner's existing policy text, so this is a flag, not a change.
  **Plan** (adds to cart)
- Line meta: neutral "Đặt trước" label (F1.8) + "Dự kiến 3–5 ngày" 14 muted with a clock icon. Summary: one 14 muted line with
  the info icon above the primary, no tinted box ("Đơn có hàng đặt trước sẽ gửi một lần khi đủ hàng."), the existing policy
  sentence kept verbatim otherwise. Flag for the Owner: say whether the in-stock item waits for the pre-order.
- Checks: as cart; visual: no tinted box inside the summary, no blue label, 200 % text rows reflow.

### customer/cart-problem

(Cart with more than the shop holds, a shop-only line and a line without a picture. Everything in cart applies; at 200 % text the
one-letter column now also carries the red error text; E2 contrast 24, card-heights 3, hit-target 20 at 390.)
**Critique** (state-specific)

- Line errors are red text only, no icon (C5), placed between the price and the stepper; the over-stock line does not say how many
  the shop holds ("Hiện chưa đủ hàng cho số lượng này") and its "+" stays active.
- The shop-only line keeps a full quantity stepper although the only valid action is to remove it ("Hãy bỏ khỏi giỏ để tiếp
  tục"): the fix is a 24 px trash icon at the far side of the row.
- The no-picture line has a bare 16 px image glyph with no frame, so its text starts at a different x than the other rows (C18).
- Summary: a peach warning box nested in the grey card (B12) and the primary "Thanh toán" shown disabled grey with no reason next
  to it (the reason is in the box above); in dark the disabled pill is grey on grey.
  **Plan** (adds to cart)
- Row error = status line with the danger icon + text at 14, directly under the name; over-stock wording includes the available
  number when the API returns it ("Cửa hàng còn 2. Hãy giảm số lượng.") and "+" is disabled at that number with `aria-describedby`
  to the line. Shop-only row: no stepper; an inline secondary "Bỏ khỏi giỏ" in the stepper's place. No-picture row: the shared
  flat placeholder thumb (see product-noimage), same 80 px frame.
- Summary: one 14 line with the warning icon ("Có 2 sản phẩm cần sửa trước khi thanh toán.") linking to the first problem row;
  "Thanh toán" stays enabled and, when pressed, scrolls to and focuses the first problem (wig pattern of checkout :558).
- Checks: as cart; visual: every problem row has icon + word, row text starts on one x at 390/1440, dark 1440 no grey-on-grey
  disabled primary, 200 % text rows reflow with the error under the name.

### customer/contact

**Critique**

- 768/1440: a ~290 px map thumbnail plus a narrow details column use about half of the 1200 content width; the rest of the band
  is empty. At 390 the map is fine but the actions wrap into a ragged 2 + 1 grid ("Nhắn Messenger" alone on the second row).
- Four pills: filled "Gọi ngay" and three outlines with the "→" tell ("Nhắn Zalo →", "Nhắn Messenger →", "Mở trong Google Maps →");
  the Google iframe adds its own "Mở trong Maps" chip, so the map has two "open in Maps" links; the phone number is also an
  underlined link 113 x 22 px doing what "Gọi ngay" does (E2 hit-target, C29).
- Small labels above values ("Địa chỉ", "Hotline", "Giờ mở cửa") = eyebrow pattern (B1); "Hotline" is an English word in VI copy.
- Dark: the map iframe stays a bright white map on the black band (glare); secondary pills pink (B22, E2 pink-dark 6).
- 200 % zoom: E2 overlap 15 (pills over the tab bar), footer crowding (shared, F2.10).
  **Plan**
- Pattern: 9.2 contact split: R14-style editorial block, text leading (address, hours, phone, actions) and the framed map trailing
  (18 px, 7/5 from 1024, map height = text column height, min 320); phone: text first, map below full width.
- Changes: address as a heading-weight line, hours and phone as plain 17 lines with 20 px icons (no labels above values); actions
  as one row of equal pills: primary "Gọi ngay" (`tel:`), secondary "Nhắn Zalo", "Nhắn Messenger" (no arrows, new-tab hints), and
  "Chỉ đường" as a secondary under the map; the phone number stays text (selectable), not a second link. Copy flag: "Hotline" ->
  "Điện thoại" (UI string, i18n site.ts). Dark: the map frame gets a 1 px hairline and the band's padding so the light map sits as
  a framed image (no CSS filter on a third-party map).
- Tells removed: "→" x4, eyebrow labels, duplicate map link and phone link.
- Baseline findings fixed: E2 hit-target page part (phone link), pink-dark 6, overlap page part 4; chrome per F1/F2. wig
  contact-view.tsx:25 (error state keeps the h1); rbp: contact-view pass (map iframe lazy).
- Transitions: route fade only.
- Checks: E2 hit-target 0, pink-dark 0, overlap 0; visual: 1440 split fills the content width, 390 pills in one equal-width
  column or a 2 x 2 grid (no orphan), dark 1440 map framed, one filled button.

### customer/policy-returns

(The four policy pages share `[...rest]/page.tsx` + info-view.tsx + rich-text.tsx; this block holds the shared plan, the other
three list only what differs. Text is the Owner's CMS/imported content: copy is flagged, never rewritten.)
**Critique**

- B17 title band: a #f5f5f7 band holding only the h1 (no sentence, no updated date); the h1 is 40 px on 390 but ~21 px at 1440, so
  the desktop title is _smaller_ than the phone one and smaller than the band deserves (type scale broken across widths).
- 1440: article column ~680 px at the leading edge with ~520 px of empty band to its right; 9.2 asks a table-of-contents aside on
  desktop for policies (none). Body copy at 768/1440 renders ~14 px (article body should be 17, R3); headings are bold 14-15 px,
  barely above body.
- Numbered headings "1. Điều kiện đổi trả" ... "6. Điểm thưởng" (content numbering; acceptable as document structure, but with no
  TOC the numbers do no navigation work).
- Refund table: one hairline surface, header on sunken at 768+, and stacked label/value rows at 390 (works as 9.2 asks); labels
  12 px faint in the stacked form (B1).
- Dark: fine apart from shared chrome (E2 pink-dark 3 = footer/header secondary). Footer at 200 % text overlaps (F2.10).
  **Plan**
- Pattern: 9.2 info page: title band (h1 `title` 40 at every width ≥ 768, 28 on phone; one 17 muted sentence = the page's
  description if the CMS has one; "Cập nhật <date>" 14 muted when known), then a white band with the article (max 680, body 17,
  h2 21/600 with 48 px space above, lists with 8 px rhythm) and, from 1024, a sticky TOC aside (h2 links, current = accent text,
  R10) in the remaining columns. Below 1024 the TOC is a collapsed "Mục lục" accordion under the title.
- Changes: rich-text maps h2 to the TOC with ids; tables keep the hairline surface/stacked form, stacked labels 14 muted.
  No back link (top-level). Copy flags: none in this page beyond "hotline" (English word in VI text, CMS data: flag).
- Tells removed: none present; the fix is scale and layout.
- Baseline findings fixed: chrome per F1/F2 (E2 here is chrome only: pink-dark 3, overlap page part 3-4). wig info-view.tsx:16
  (parse-failure state keeps an h1); rbp: info-view / rich-text pass.
- Transitions: route fade; TOC link = native smooth scroll (instant under reduced motion), `scroll-padding-top` (F2.12).
- Checks: visual 390/768/1440 h1 size steps up (never down) with width, 1440 TOC aside aligned to the article top, 390 table
  stacked, 200 % text article and TOC wrap without overlap, dark no pink; E2 font-size 0 on article body.

### customer/policy-member

(As policy-returns: title band with h1 only and a smaller h1 at 1440, article at the leading edge with no TOC, 14 px body at
768/1440, chrome-only E2: pink-dark 3, overlap page part 4-5.)
**Critique** (state-specific)

- The tier table (5 rows x 3 short columns: Hạng / Điểm tích lũy / Ưu đãi) is forced into the stacked form at 390: five tall
  blocks of label/value pairs, ~830 px for a table that fits in 358 px as three columns (the stack rule applied without checking
  fit). At 768/1440 it is a clean hairline table; tier names in bold read as row headers (good).
- Copy flags (CMS data, not changed): "1.000đ" with "đ" while the site prints "₫" elsewhere; "liên hệ tiệm" vs "Lucy Spa" naming.
  **Plan** (adds to policy-returns)
- Tables in rich text: stack under 640 only when the table does not fit its container (container query on the table's min
  content width, or a column count > 3 rule); a 3-column table of short values stays a table at 390 with numbers right-aligned
  and tabular. Numeric columns nowrap.
- Checks: as policy-returns; visual: 390 tier table as a table ≤ 300 px tall, refund table (policy-returns) still stacked, 200 %
  text: the tier table stacks (it no longer fits) and reads correctly.

### customer/policy-terms

(As policy-returns: h1-only title band, h1 smaller at 1440 than at 390, no TOC for 7 sections, 14 px body at 768/1440; E2 chrome
only: pink-dark 3, overlap page part 4-7.)
**Critique** (state-specific)

- Longest text of the four (7 sections, ~3 screens at 390) and the one that most needs the TOC; at 390 the reader scrolls ~4000 px
  with no way to jump.
- References inside the text are dead text: "chi tiết tại Chính sách đặt lịch dịch vụ" names another page without linking it;
  the email "hotro@lucyspa.vn" and the hotline are plain text (no `mailto:`/`tel:`), so on a phone they cannot be tapped.
  **Plan** (adds to policy-returns)
- rich-text: auto-link emails and Vietnamese phone numbers in policy bodies (`mailto:`/`tel:`, R10 link style, 44 px line
  hit area via padding); a cross-reference to another policy becomes a link only where the CMS text already contains the link
  (no text edits; flag to the Owner that the reference here is unlinked in the source).
- Checks: as policy-returns; visual: 390 TOC accordion lists 7 sections, email and phone are links (tap targets ≥ 44 px tall).

### customer/policy-privacy

(As policy-returns: h1-only title band, h1 smaller at 1440, no TOC for 7 sections, 14 px body at 768/1440; E2 chrome only:
pink-dark 3, overlap page part 2-4.)
**Critique** (state-specific; content flags for the Owner, nothing rewritten)

- Section 6 "Cookie" says the site uses a cookie for "chế độ sáng/tối": A1 removes the theme switch and the `ls-theme` cookie
  (plan-foundation F1.2), so this sentence becomes untrue when Step 3 ships. Flag for the Owner to update the CMS text.
- Section 5 "Quyền của khách" says account deletion is requested "qua hotline hoặc email" and that issued invoices are kept per
  accounting law: this is the only written deletion rule today and A2 (below) must agree with it or the Owner updates it.
- Same dead-text email/hotline as policy-terms (no `mailto:`/`tel:`); "Xem và sửa thông tin trong mục Hồ sơ" while the profile
  lets the customer edit only the name and email (flag).
  **Plan** (adds to policy-returns and policy-terms)
- No page-specific layout change. Content flags go to the Step 2 report as Owner items (cookie sentence after A1; deletion route
  once A2 ships; profile editability wording).
- Checks: as policy-returns.

### customer/profile

**Critique**

- "← Quay lại" on a top-level account tab (B7/C40).
- Card header actions are outline pills with the "→" tell ("Sửa →", "Đổi email →"; A4/F2.1); at 390 "Sửa" sits beside its heading
  but "Đổi email" drops below its heading, so the two cards place the same kind of action differently (C18).
- Read-only values are label/value pairs with 12 px grey labels above (eyebrow pattern, B1); the managed-data note is 12 px faint.
- "Đã xác minh" green tint pill, word only (C5). 1440: the two cards fill ~690 px at the leading edge; fine as a form width, but
  the cards are boxes on a white band (B19: account records may be cards; here they are settings groups).
- Dark: "Sửa"/"Đổi email" text pink (B22, E2 pink-dark 6). 200 % zoom: account tabs wrap to two rows (Thông báo, Hồ sơ alone on
  row 2), E2 overlap page part 7 (Đổi email over the tab bar).
  **Plan**
- Pattern: account settings page (9.2 "Account home" sub-page): white band, one column max 720, settings groups split by
  hairlines inside one surface (not one card per group): "Thông tin cá nhân", "Email đăng nhập", then the new "Xóa tài khoản"
  group last (see ACCOUNT-DELETION below).
- Changes: drop PageBack. Each group = heading row with its action pinned at the trailing edge at every width (wraps under the
  heading only at 200 % text): "Sửa" and "Đổi email" as secondary pills without arrows (F2.1), opening the existing Dialogs.
  Values as a definition list: label 14 muted on the leading column, value 17 ink trailing (stacked under 480). Verified = status
  badge with check icon + word. Managed note 14 muted. Account tabs per 8.5 (pill segmented, scroll with a peek on phone; no wrap).
- Tells removed: "→" x2, eyebrow labels, card-per-group.
- Baseline findings fixed: E2 pink-dark 6, overlap page part 4-7; chrome per F1/F2. wig profile.tsx and customer-profile.ts pass
  (no finding); rbp profile.tsx pass.
- Transitions: route fade; dialogs per F2.7.
- Checks: E2 pink-dark 0, secondary-filled 0; visual: both group actions at the trailing edge on one line at 390/768/1440,
  200 % zoom tabs scroll (no second row), dark 1440 no pink, verified badge has an icon.

### customer/home-en

(English home. The home critique and plan are in fd-critique.md "home" and the home plan; this block covers only what English
adds. E2 matches the VI home: overlap 12-21 per mode incl. the marquee links at negative x, hit-target 11-15, pink-dark 15.)
**Critique** (EN-specific)

- Mixed languages on one page: the slider slide is Vietnamese ("Thư giãn tận tâm", "Massage chân và gội đầu dưỡng sinh ...",
  "Xem dịch vụ →"), and the footer policy links are Vietnamese ("Chính sách bảo mật thông tin cá nhân" ...) under English headings:
  CMS/slide data without an English version (flag; the plan cannot invent translations).
- Data flags (Owner's catalog, not changed): category "Hari wash" (typo for "Hair"); two cosmetics categories both shown as "Skin
  care"; hero headline in Title Case ("Heartfelt Relaxation – Elevated Beauty", sentence case expected).
- English strings are longer: at 200 % text the price-list 3-column grid breaks "Chrome / Ombre / Cat Eye" into 2-3 letters per
  line ("Chr / om / e /") and service names into one word per line (C15/C16); at 390 the hero headline takes 3 lines at 40 px.
- The language switch shows only "VI" (a code, no name, no current-language cue); EN wording flags from wig: "See the shop other
  services." (site.ts:752, also :816), "Leave a phone number, we call you back" (site.ts:651), "We received your payment."
  (online-shop.ts:470, first person).
- Dark: same as home (raspberry band and fills, pink secondary text, B22).
  **Plan** (adds to the home plan)
- Language-aware fallbacks: a slide or footer block with no English text is not shown on /en (or falls back with `lang="vi"` on
  the element so screen readers switch voice) — which of the two is pending Owner; default in this plan = keep the VI text and mark
  it `lang="vi"`. Price list: from 1024 three columns only when each column is ≥ 280 px, otherwise two/one (container query), so
  200 % text never splits words. Language switch: "Tiếng Việt" / "English" as words with `hreflang` and `lang` on each, current
  language not offered.
- Copy fixes in UI strings only (i18n, not data): site.ts:752/:816 -> "See the shop's other services/products.", site.ts:651 ->
  "Leave your number and the shop will call you back.", online-shop.ts:470 -> "The shop received your payment.". Data flags
  ("Hari wash", duplicate "Skin care", Title Case headline) go to the Owner list.
- Checks: E2 as the home plan; visual: /en 390/1440 light + 1440 dark, 200 % text price list wraps by word, every Vietnamese
  string on /en carries `lang="vi"` (DOM check), language switch reads as words.

### customer/ACCOUNT-DELETION (new, A2)

**Plan only** (no code; the business rules are pending the Owner: the PRD has no deletion/retention policy, section 61 does not
list it; open items in `.local/s10/LEDGER.md` lines 33-44. Nothing below decides a policy; where a rule is missing the screen says
"pending Owner" in this plan and the build waits.)

- Entry: the profile page ("Hồ sơ", `customer/screens/profile.tsx`), a third section after "Email đăng nhập", same surface rules as
  the two above it: heading text only "Xóa tài khoản" (no icon, no badge, no red heading), one 14 muted sentence "Xóa vĩnh viễn
  tài khoản Lucy Spa của bạn và dữ liệu cá nhân đi kèm.", and one **destructive outline** button "Xóa tài khoản" (DESIGN 8.1:
  `--ls-danger` border and text, trash icon + word, never the accent, never filled, never the primary, never the default button
  of a form, never the first focus). It sits last on the page and is the only control in its section.
- Step 1, explain (a Drawer from 640, a full-height bottom Sheet on phone, with a visible Close; title "Xóa tài khoản?"): what
  is removed (sign-in, name and email on the account, saved addresses, notifications; balances are pending Owner, below) and what the
  shop keeps as records the law and the accounts require (invoices and paid orders stay as financial history, never rewritten:
  hard rule). The exact lists come from the Owner; until then the two lists are placeholders marked pending. Footer: "Hủy"
  (neutral, first, initial focus) then "Tiếp tục" (destructive outline). No filled button in step 1.
- Step 2, confirm (the same Drawer/Sheet, next step; or a Dialog sm when opened from step 1 on desktop): re-enter the password
  ("Mật khẩu hiện tại", reusing the `currentPassword` / `wrongPassword` / `passwordRequired` strings and inline-error pattern of
  the email change), optional checkbox "Tôi hiểu tài khoản không thể khôi phục". Footer: "Hủy" (focus starts here, Escape =
  Hủy) then the filled danger "Xóa vĩnh viễn" (the only filled danger, inside the confirm only, 8.1); busy = spinner + "Đang
  xóa…", same width. Cancel is present on every step and returns focus to the "Xóa tài khoản" button.
- Blockers (shown in step 1 instead of "Tiếp tục", with plain copy and a way out, never a dead end):
  - Upcoming bookings: "Bạn còn {n} lịch hẹn sắp tới. Hãy hủy hoặc hoàn tất các lịch hẹn này trước khi xóa tài khoản." + a list
    of the bookings (date, service) each linking to its detail, and a neutral "Xem lịch hẹn" button.
  - Unfinished online orders (awaiting payment, paid and not delivered, returns open): "Bạn còn {n} đơn hàng chưa hoàn tất. ..."
    - links to each order and "Xem đơn hàng".
  - Prepaid combo sessions, wallet/credit and unused rewards (money or money-like): copy and rule **pending Owner** (block, warn
    or forfeit is a business decision, LEDGER 40-44); the plan reserves a third blocker slot with the same layout.
  - Whether blockers stop deletion or only warn is pending Owner; the default in this plan is "stop" (nothing irreversible
    without the Owner's rule).
- Success: signed out, a full page "Tài khoản đã được xóa" with one sentence and a secondary "Về trang chủ" (no primary needed);
  an email confirmation if the Owner wants one (pending).
- Copy rules: short Vietnamese, sentence case, never "khám"; the word "xóa" in the button's accessible name; no humour, no
  guilt copy ("Bạn có chắc muốn rời bỏ chúng tôi?" style is not used).
- Checks that will prove it: E2 on profile + the open Drawer/Sheet + Dialog at all 8 modes: secondary-filled 0, pink-dark 0,
  hit-target 0 (44 px), contrast 0 (danger text and border ≥ 4.5 / 3); visual 390/768/1440 light + 1440 dark + 200 % text and
  zoom: exactly one filled control per view and it is the danger confirm only in step 2, the danger button is never the first
  focus, Cancel is first in every footer; keyboard: Tab order, Escape closes and returns focus, focus trapped; screen reader:
  dialog named by its title, blocker list announced, error tied to the password field (`aria-describedby`); the blocker states
  rendered with seeded upcoming bookings and an unpaid order (scratch seed members "orders" and "empty").
- Consistency with today's text: the privacy policy (policy-privacy, section 5) says deletion is requested "qua hotline hoặc
  email" and that issued invoices are kept per accounting law. The in-app flow must match it, or the Owner updates the policy
  text in the same release (flag; no policy is written here).

## Cross-page patterns

1. **Text "← Quay lại" everywhere** (every account tab, cart, orders, profile; plus breadcrumb on products): B7/C40. One rule via
   F2.11: chevron only where a parent exists (order detail -> orders, checkout -> cart, product -> list), none on top-level pages,
   never chevron + breadcrumb together; account detail pages hide the account tab row.
2. **Grey card per section** (order detail x4, checkout x4, profile x2, notifications/orders at 390 as label/value cards): the
   identical card kit is the dominant tell of the member area (B19/B12). Records become one surface split by hairlines; lists stay
   rows (not cards) on phone; only the summary aside is a card.
3. **"→" on outline buttons and eyebrow labels above values**: Sửa, Đổi email, Áp dụng, Chỉ đường, Nhắn Zalo/Messenger, Mua tại cửa
   hàng, Hết hàng, Xem mỹ phẩm; and 12 px grey labels above every value (address, order, profile, product meta "A · B"). F2.1 removes
   the arrow globally; pages switch label/value pairs to definition lists or icon + value.
4. **Status by colour only and states that contradict**: blue/orange/grey/green tint pills without icons on orders, notifications,
   profile, order detail; the unpaid order shows "Chờ thanh toán" next to "Đã hết hạn thanh toán"; low stock shows nothing; sold out
   is a disabled button labelled with the state. One status badge component (icon + word) driven by one state mapping per record.
5. **Wrong primary**: two fills in one view (cart-empty + header; product store card "Gọi cửa hàng" + page primary), the main action
   as outline while a lesser one is filled (product-store, product-soldout), empty states inconsistent (outline in orders, filled in
   cart). Rule: the view's task gets the one fill; empty states use a secondary because the header pill is the fill.
6. **200 % text breaks two-column layouts**: cart, cart-pre, cart-problem collapse to one letter per line; orders table pushes
   columns off-screen; price list (home-en) splits words. Container queries on row/grid components, minimum column width in ch.
7. **Dark mode**: pink `#dcadb0` on every secondary, link and selected border (E2 pink-dark on all 26 pages) and pure white/black
   placeholders; fixed by F1.3/F1.4 plus the shared placeholder step rule.
8. **Content flags for the Owner** (data, not changed): Title Case EN headline, "Hari wash", duplicate "Skin care", "(đặt
   trước)/(không ảnh)" inside product names (seed), untranslated slide/footer on /en, privacy-policy cookie sentence after A1,
   "hotline" wording, unlinked policy cross-references; and a rig gap: order-soon cannot show its countdown in the baseline.
9. **Member-area data layer (one fix for every account page, cited per page only under notifications/orders)**: rbp session.tsx:
   109-127 and :155-198 (session read twice, children mount after it), bookings.tsx:51-73 (`useFetch` without cache, skeleton on
   every navigation), notification-bell.tsx:11 + inbox.tsx:24 (workforce dictionary in the site header), Intl formatter cache.
   Do it once in Step 4/5, not per page.

## Not available

None: all 26 assigned pages had 8 images and both sheets; every sheet was opened (light and dark).
