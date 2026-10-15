# frontend-design: Step 1 critique + Step 2 plan, customer group 1 (phase s10base)

Method: every light and dark contact sheet of the pages below opened with Read (invoices-empty, loyalty and loyalty-empty sheets
regenerated with `.local/s10/sheet.mjs` once their 8 images existed); E2 blocks from `node scripts/uxui-e2-summary.mjs s10base --pages`;
file:line findings from wig-customer.md / rbp-customer.md. Plans add to plan-foundation.md (F1-F4); what F does is not repeated.

**Shared chrome in every E2 count (fixed by the foundation, not per page):** skip link 16 px + wordmark 18 px (font-size 3),
header tool gaps of 4 px (hit-target 2-4 at 1440 on public pages; 7/10/4 at 390/768/1440 on member pages, which add cart + bell), skip-link non-radix colour, footer and tab bar overlapping "Trang chủ" (overlap 11),
footer "Đặt lịch →" secondary pink in dark (pink-dark 1), sticky header + tab bar 34 % at text 200 % (sticky-cover 1), header nav
clipped at text 200 % (clipped-text 1), ~22-24 chrome controls without hover/pressed. Each page's **Checks** therefore name the
page-own residue (count minus that chrome baseline), which must reach 0.

**Brief over DESIGN.md, applied the same way on every page:** no back control on a top-level page; a detail page gets the F2.11
icon-only chevron (`aria-label` "Quay lại <list>") instead of DESIGN 9.2's "← Quay lại" text (B7/C40); no arrow on secondaries (A4);
no theme control (A1); shop "Mới" neutral (F1.8); auth pages follow the fd login direction (white band, hairline card, wordmark in
the header only).

### customer/campaign

**Critique**

- Captured in the wrong state: `products?campaign=ngay-hoi-lam-dep-mv0qetvl` is unknown/ended, so products-view.tsx:252 falls back to
  the normal list filtered to nothing; no campaign banner exists in any mode. The live campaign seen on product-detail ("Ngày hội làm
  đẹp mùa thu") has another slug.
- What is shown is itself a defect: a stale campaign link lands on a generic "Không có sản phẩm phù hợp…" with "Xóa bộ lọc →" and never
  says the sale ended (C33 next step weak, copy misleading).
- B7 "← Quay lại" on a top-level list (all modes); h2 "Sản phẩm" repeats the h1 "Mỹ phẩm" (FR heading rule).
- Two chip rows (categories, brands) each with a solid burgundy selected chip = two accent fills at once (C4); brand row cut at 768 with
  no peek (B10); category row shows "Chăm sóc da" twice (Owner data: flag only).
- 390: search pill + outline "Lọc" + native select at 3 different heights/radii; dark 768: chips flat grey, no hover (B14).
- Tells: "→" on "Xóa bộ lọc" and footer "Đặt lịch"; text 200 %: footer columns overlap (B13).
  **Plan**
- Pattern: products list (title band + toolbar + grid, 9.2); campaign view = R13 banner in the title band. Banner layout cannot be
  judged: re-capture with the live slug (fix `scripts/uxui-customer-pages.json`) before Step 4.
- Changes: when `state.campaign` is set but no running campaign matches, show an empty state "Ưu đãi này đã kết thúc hoặc không còn"
  (wording pending Owner) + one primary
  "Xem tất cả mỹ phẩm" (UI only, same data); drop the h2 "Sản phẩm" (toolbar has no heading); brand filter moves into the filter
  drawer below 1024 so one chip row is visible; toolbar controls one height (44) and one pill shape.
- Tells removed: "→" (F2.1), back text link, duplicate heading.
- Baseline findings fixed: E2 overlap 11 (chrome), hit-target 5/3/2, pressed-missing 24, pink-dark 4/4/1 (svg stroke #dcadb0);
  wig products-controls.tsx:43 (placeholder = label); rbp products-view.tsx:249,326 (chip sets rendered twice).
- Transitions: route fade only.
- Checks: pink-dark 0, page-own hover/pressed-missing 0; visual: banner present on the re-capture (light 1440, dark 1440), one accent
  chip row, brand row peeks at 390/768, stale-slug empty state copy.

### customer/register

**Critique**

- Solid burgundy page panel (light, all widths) = accent as decoration (A3, R11, C34); dark switches to a grey panel, so the two modes
  are different designs. Wordmark repeated in tracked white caps above the card (tell: all-caps label; header already has it).
- Title "Đăng ký thành viên" + segmented "Đăng nhập | Đăng ký" directly under it: title and selected segment say the same thing
  twice (navigation, not the form's control, so kept; flagged as redundancy only).
- 7 stacked fields in one column with 12 px faint helpers (B1); "dd/mm/yyyy" placeholder is an English literal.
- 768+: the header "Đặt lịch" primary and "Tạo tài khoản" primary are both filled in one view (C4/B11).
- 390: E2 overlap 21 (10 own): inputs and the submit pass under the fixed tab bar and contact button; the contact button sits on the
  card edge at 1440 (white circle on red).
  **Plan**
- Pattern: auth card (9.2) per fd login direction: white band, centred 26 rem card with a hairline, wordmark only in the header.
- Changes: header hides its "Đặt lịch" pill on auth routes (one primary in view); segmented control stays as navigation, the h1
  stays "Đăng ký thành viên" and the submit stays "Tạo tài khoản" (no heading repeats its own control); helpers 14 muted (F1.7); referral field grouped under an "optional" sub-label; date
  placeholder from i18n; submit row pinned above the tab bar with `scroll-padding-bottom`.
- Tells removed: tracked caps wordmark above the card, accent panel.
- Baseline findings fixed: E2 overlap 21/17/13 (own 10/6/2), hit-target 6/4/3, pressed-missing 27 (own ~4: segments, eye toggles),
  pink-dark 1; wig auth.tsx:483 (literal "dd/mm/yyyy"), :244 (no `name`), :406 (password errors in top Notice, no focus), :381 (no
  unsaved guard); rbp auth.tsx:199-209 (third session read).
- Transitions: route fade; segmented switch login/register = cross-fade of the form (≤ 200 ms), no slide.
- Checks: page-own overlap 0 at 390, pink-dark 0, no accent fill except the submit; visual: light and dark identical layout, 200 %
  zoom card fits 720 without the header covering the first field.

### customer/forgot

**Critique**

- Same burgundy panel and caps wordmark as register (A3, C34); at 1440 a 290 px card floats in a sea of red; dark is grey.
- "Về trang đăng nhập" is an unstyled text action (stacked above "Gửi mã" at 390, beside it at 768+): order is right (back then
  primary), but FR forbids text-link actions; it needs the neutral pill.
- Helper sentence centred under the title, label "Email (bắt buộc)" fine; contact button white on red (light) cut at 390 bottom.
  **Plan**
- Pattern: auth card, same as login/register.
- Changes: footer row = Neutral "Quay lại đăng nhập" (8.1 neutral pill) then primary "Gửi mã", same order at every width; title and
  helper left-aligned with the field.
- Tells removed: caps wordmark, accent panel.
- Baseline findings fixed: E2 overlap 11 (chrome only), hit-target 5/3/2, pressed-missing 23, pink-dark 1; wig auth.tsx:302/:601
  (OTP format error in the top Notice, focus not moved).
- Transitions: route fade; step email → code swaps content with a cross-fade.
- Checks: pink-dark 0; visual: one primary, back as neutral pill at 390/768/1440, dark = light layout.

### customer/ticket

**Critique**

- Pickup code "DT000001" in burgundy (light) and pink #dcadb0 (dark): accent on a non-action label (A3, B22; E2 brand-text 1 per mode).
- Status "Chờ thanh toán" orange tint, colour + word, no icon (C5), and repeated on every line as well as under the code.
- 12 px eyebrow labels ("Mã đơn", "Nhận hàng tại", "Tổng tiền") above values (B1); middle-dot meta "Số lượng 1 · 520.000 đ" (tell).
- Two stacked grey tiles of different widths' content; no QR (9.2 wants code/QR large, printable) and the full public footer + "Đặt
  lịch →" is drawn where 9.2 wants chrome limited to the wordmark.
  **Plan**
- Pattern: public ticket (9.2): one centred card max 480 on a white band, wordmark-only header, no footer, print stylesheet.
- Changes: code in `display` ink with `translate="no"` and tabular nums; one status badge with icon under it; lines as a hairline
  list (name, then "SL 1" and price right-aligned, no dot string); line-level status only when it differs from the order's; footer and
  tab bar not rendered on this route.
- Tells removed: eyebrow labels as tiny caps-like captions, middle-dot meta, repeated badges.
- Baseline findings fixed: E2 brand-text 8, pink-dark 2/2/2, font-size 4 at 390/768 (one own 12 px), pressed-missing 22; wig
  ticket-view.tsx:94 (`translate="no"`); rbp not-found.tsx:7 (ticket strings ship in the not-found chunk: move to i18n/site).
- Transitions: none (a page opened from a link; route fade only).
- Checks: brand-text 0, pink-dark 0; visual: 390 code readable at arm's length (≥ 34 px), print preview one page, dark no pink.

### customer/not-found

**Critique**

- 768+: header "Đặt lịch" primary + page "Về trang chủ" primary = two filled buttons in view (C4/B11); "Đặt lịch →" secondary with
  arrow (tell) and a third "Đặt lịch" in the footer, a fourth in the tab bar.
- 1440: content band is ~250 px, the footer takes most of the viewport; text 200 %: footer columns overlap and the contact button
  covers footer text.
- 390: contact button stacked on the tab bar booking circle (E2 overlap 19, 8 own).
- Dark: primary raspberry #9b424e, secondary text pink (B22).
  **Plan**
- Pattern: 404 (9.2): centred `title`, one sentence, primary "Về trang chủ", secondary "Đặt lịch".
- Changes: band min-height 60 vh so the footer starts below the fold at 1440; header "Đặt lịch" pill hidden on this route (one primary
  per view); contact button safe-area offset above the tab bar (8.9).
- Tells removed: "→".
- Baseline findings fixed: E2 overlap 19/15/11 (own 8/4), hit-target 6/4/2 + text200 1, pressed-missing 24, pink-dark 1; rbp
  (public)/not-found.tsx:7 (product-orders dictionary in an entry chunk).
- Transitions: route fade.
- Checks: page-own overlap 0, pink-dark 0; visual: one filled button per view at 768/1440, 200 % text footer no overlap.

### customer/account

**Critique**

- B19 is this page: four grey rounded tiles (identical card kit) each with a heading, data and a white pill "Xem lịch hẹn ›" inside
  the card (nested surface, B12); the card is not one link (9.2 says whole card = one link). Dark: the pills read as black filled
  buttons on grey (A4).
- B7 "← Quay lại" on the account home (top-level).
- 200 % zoom (720 css px): the tab row under the title AND the sub-nav list under the cards are both shown (two sub-navs; 390 shows
  the list only, 768 the tabs only).
- Middle-dot "620 · Silver", "1.774 · Gold"; 12 px faint captions ("Rửa mặt sạch sâu", dates) (B1).
- Text 200 %: tabs wrap to two lines and header nav is clipped; dark: current tab underline pink.
- 390 E2 overlap 21 (10 own): `.ls-acct-card` under the tab bar.
  **Plan**
- Pattern: account home (9.2): title band with greeting + tabs, 2-column grid of summary cards on the alt band, each card one link.
- Changes: card = whole link with a trailing chevron in its header, no inner pill; values as label/value rows (tier as its own word,
  no dot); greeting h1 "Xin chào, <tên>" with the purpose sentence muted 14; one sub-nav per width: list below 768, tabs from 768
  (one breakpoint for both, never both visible); cards stretch to equal height (F2.5).
- Tells removed: identical pill-in-card kit, middle-dot strings, back text link.
- Baseline findings fixed: E2 overlap 21/19/11 (own 10/8), hit-target 12/10/4, pressed-missing 28, pink-dark 1; rbp bookings.tsx:51-73
  (useFetch no cache: overview and lists refetch), session.tsx:109-127 and :155-198 (session read twice, children wait).
- Transitions: route fade; tabs switch without animation.
- Checks: page-own overlap 0, pink-dark 0; visual: no button inside any card, equal heights at 768/1440, 200 % text tabs one
  scroll row.

### customer/account-empty

**Critique**

- Same card kit as account; the empty "Lịch hẹn sắp tới" card's only action is a white neutral pill "Đặt lịch ›" (B15: a card's main
  action must be the primary).
- "0 · Chưa có hạng" middle-dot strings; "Chưa có" values in the same weight as real values.
- Dark: neutral pills look like black filled buttons; 390 E2 overlap 19 (8 own) under the tab bar.
  **Plan**
- Pattern: account home, empty states per 8.4 (one sentence + one action).
- Changes: the next-booking card when empty shows "Bạn chưa có lịch hẹn sắp tới." + primary "Đặt lịch" (the page's one primary; the
  header pill is the only other, hidden below 640 anyway); other empty cards stay whole links with no button; tier "Chưa có hạng" as a
  neutral badge per F1.8; same one-sub-nav-per-width rule as account (both show at 200 % zoom today).
- Tells removed: middle-dot, pill-in-card.
- Baseline findings fixed: E2 overlap 19/17/11 (own 8/6), hit-target 12/10/4, pressed-missing 28, pink-dark 1.
- Transitions: route fade.
- Checks: page-own overlap 0, pink-dark 0; visual: exactly one filled button in the content area (390/768/1440).

### customer/book

**Critique**

- B7 "← Quay lại" above a top-level flow; stepper bars + "1. Chọn dịch vụ" labels (numbering is allowed, it is a sequence); dark: the
  current step label is pink (E2 `.ls-steps-short` #dcadb0).
- Service choices are ~30 grey rounded tiles with a checkbox (identical card kit, B12 tiles on the band) instead of one list surface.
- 390/768: the summary and "Tiếp tục" are not in the first 2600 px: no sticky footer (9.2 asks for sticky Back + Continue and a
  collapsible summary); 1440: the aside "Tiếp tục" is a disabled grey pill with no reason (C38/wig).
- Nail rows: the note "Tính theo số ngón…" sits beside the price on some rows and below on others (B6 uneven rows, 768/1440); text
  200 %: names break word by word ("Massage chân 30 / phút") and the range price wraps in a narrow column.
- Placeholder "Tìm dịch vụ" = label; primary label generic "Tiếp tục" (wig).
  **Plan**
- Pattern: booking flow (9.2): one column max 720 + sticky summary aside from 1024, stepper pills, sticky footer Back (neutral) +
  Continue (primary) on phone/tablet with a collapsible summary line ("2 dịch vụ · 190.000 đ" as two labelled values, not a dot).
- Changes: services in one hairline list surface per category (row = checkbox, name/duration, price right, note as a second line on
  every row); stepper current = ink + accent bar (no pink); Continue stays enabled and points at the missing choice (inline message);
  Continue label names the next step ("Chọn khách", "Chọn giờ") (copy, i18n).
- Tells removed: tile kit, back link.
- Baseline findings fixed: E2 overlap 11/16/11 (own 5 at 768), hit-target 7/4/4, hover-missing 4, pressed-missing 25, pink-dark 3/3/2;
  wig book.tsx:120 (step not in URL), :394 (disabled Continue), :118 (no unsaved guard), :472, :728 (slot time not via formatTime),
  :896 (remove guest no undo), customer.ts:10 ("Tiếp tục"); rbp book.tsx:153-156, :487-493, :478-491, :499.
- Transitions: step change keeps `useStepSlide` (horizontal = a sequence, D9) ≤ 240 ms; reduced = instant.
- Checks: pink-dark 0, page-own overlap 0; visual: Continue visible without scrolling at 390/768, all nail rows one shape, 200 % text
  no per-word name breaks.

### customer/bookings

**Critique**

- B7 "← Quay lại" on a top-level list; no page action (booking lives only in the header/tab bar: acceptable, noted).
- 390: every row a large grey card (~170 px) with the date as an underlined burgundy link and a ⋮ menu whose only item repeats the link
  (two targets for one action); dark: the date links are pink (E2 pink-dark 4).
- Status badges colour + word, no icon (C5); "Gội thường +1" hides the second service with no way to read it (C15).
- "Hiển thị 1–1 trong 1" in 12 px faint (B1); section headings "Sắp tới"/"Lịch sử" at 17 px barely above table text.
- Text 200 %: account tabs wrap to two lines.
  **Plan**
- Pattern: customer list (8.4): one hairline table surface per section; below 768 stacked rows inside one surface (label/value), not
  one card per row.
- Changes: whole row is the link to the detail (date in ink 500, chevron trailing), ⋮ menu removed while it has one item; status
  badge with icon; services cell lists all names (wraps) or "Gội thường và 1 dịch vụ khác" with the full list in the row's accessible
  name; the "Hiển thị x–y trong n" line stays (Owner rule: counts live there) but sits at the table's leading edge in 14 muted.
- Tells removed: card per row kit, duplicated link/menu.
- Baseline findings fixed: E2 overlap 16/14/11 (own 5/3), hit-target 7/13/7 + text200 3 (own 0/3/3 + 3), pressed-missing 27, pink-dark 4/4/1; wig
  bookings.tsx:190 (menu `router.push`), :107 (NotFound h1); rbp bookings.tsx:51-73, :34,47 (workforce dictionary import).
- Transitions: route fade; row → detail no morph.
- Checks: pink-dark 0, page-own hit-target 0; visual: 390 one surface with hairline rows, status readable in greyscale.

### customer/booking-detail

**Critique**

- Back as "← Quay lại" text plus the account tabs (two navigation devices on a detail page); label does not say where it goes.
- Code repeated: subtitle "BK-261015-BNU6ZJ" and again as "Mã lịch hẹn" in the record (C41); 12 px eyebrow labels (B1).
- 1440: services card left, record aside right: reversed vs 9.2 (record left, actions/summary right); 768/390 order record first, so
  the order changes per width; cards end at different heights (B6).
- Middle-dot meta "00:45–01:30 · 45 phút", "Người sử dụng: … · Nhân viên: …"; numbered lines "1. Gội thường" (tell).
- "Hủy lịch hẹn" danger outline sits in the title band; its hover fills red (E2 secondary-filled 1, DESIGN 8.1 allows it, brief A4
  forbids filled secondaries: pending Owner).
  **Plan**
- Pattern: account detail (9.2): split, left record + services timeline, right summary card (status, total, actions).
- Changes: F2.11 chevron "Quay lại lịch hẹn" in place of the text link; tabs hidden on detail routes (current tab kept in the
  header nav); subtitle shows date/time, code only in the record; services as a vertical list with time icon + duration + staff as
  labelled rows; "Hủy lịch hẹn" moves to the summary card footer (destructive outline + confirm dialog, focus on Cancel).
- Tells removed: middle-dot strings, decorative numbering, eyebrow labels.
- Baseline findings fixed: E2 overlap 17/11/11 (own 6 at 390), hit-target 7/10/4, secondary-filled 1 (danger hover: kept per 8.1
  pending Owner), pressed-missing 24, pink-dark 4/4/1.
- Transitions: route fade.
- Checks: secondary-filled 0 except this danger button (0 if the Owner says no fill), pink-dark 0; visual: same order at 390/768/1440,
  equal column tops, cancel dialog keyboard path.

### customer/booking-cancelled

**Critique**

- The cancelled state is only a small red "Đã hủy" badge inside the record (C5 colour + word, no icon); nothing at the top says the
  booking is cancelled and there is no next step (C33).
- Same split reversal, code repetition, middle-dot meta and eyebrow labels as booking-detail; 1440 cards of unequal height (B6).
  **Plan**
- Pattern: as booking-detail.
- Changes: a status line under the title ("Lịch hẹn đã hủy" with icon, neutral tone) and in the summary card one primary "Đặt lịch
  mới" (link to the booking flow, no logic change); no cancel action.
- Tells removed: as booking-detail.
- Baseline findings fixed: E2 overlap 16/11/11 (own 5), hit-target 7/10/4, pressed-missing 24, pink-dark 4/4/1.
- Transitions: route fade.
- Checks: pink-dark 0; visual: status understood in greyscale, one primary, equal column heights at 1440.

### customer/bookings-empty

**Critique**

- Empty state = a bordered box inside the band (B12; other account pages use grey tiles: two surface styles); icon 24 px, sentence,
  "Đặt lịch" primary, no title (8.4 wants icon, title, sentence, action).
- 768+: header "Đặt lịch" primary + empty-state primary both filled in one view (C4/B11).
- Dark: primary raspberry, bordered box hairline barely visible.
  **Plan**
- Pattern: customer list empty state (8.4), no surrounding box.
- Changes: unboxed centred block: icon, `heading` "Chưa có lịch hẹn", sentence, primary "Đặt lịch"; header pill hidden while a page
  primary with the same target is in view (rule shared with not-found, account-empty).
- Tells removed: boxed empty card.
- Baseline findings fixed: E2 overlap 11 (chrome), hit-target 7/10/4, pressed-missing 24, pink-dark 4/4/1.
- Transitions: route fade.
- Checks: pink-dark 0; visual: one filled button per view at 768/1440, no bordered box.

### customer/invoices

**Critique**

- Rows identified only by date: all seven read "14/10/2026" (C15 meaningful identifier missing); the invoice code is not shown.
- 390: seven 220 px grey cards (card per row kit) with ⋮ menus duplicating the date link; dark: date links pink (E2 pink-dark 4).
- Status: "Đã thanh toán" green tint, "Chờ thanh toán" orange tint, "Đã hủy" neutral outline: three styles, none with an icon (C5).
- "Còn phải trả" shows "—" for zero; at 768 "Tổng cộng" header alignment drifts from its right-aligned values.
  **Plan**
- Pattern: customer list (8.4), same as bookings.
- Changes: first column = invoice code (ink, tabular) with the date under it; whole row a link, ⋮ removed while it has one item;
  amounts right-aligned with headers right-aligned, "0 ₫" instead of "—"; status badges one family with icons; 390 stacked rows in one
  surface.
- Tells removed: card per row kit.
- Baseline findings fixed: E2 overlap 14/15/11 (own 3/4), hit-target 7/17/11 + text200 7 (own 0/7/7 + 7), pressed-missing 31, pink-dark 4/4/1; wig
  invoices.tsx:140 (menu `router.push`), :163 ("Xem thêm" pages in state); rbp invoices.tsx:24,36 (workforce import), bookings.tsx:51-73.
- Transitions: route fade.
- Checks: pink-dark 0, page-own hit-target 0; visual: rows distinguishable at a glance, numeric columns aligned at 768/1440.

### customer/invoice-detail

**Critique**

- Four stacked identical grey tiles (record, products, payment, review) in one column at 390/768; at 1440 the record is a narrow right
  column with review form left, uneven heights (B6).
- Record: six label/value pairs with 12 px eyebrow labels, three overlapping dates ("Ngày", "Lập lúc", "Thanh toán lúc") (B1, C41).
- Middle-dot "Tiền mặt · 03:15 Thứ 4"; "311.200 đ × 2" fine; numbered line "1. Tinh chất…" (tell).
- Review card: "Để sau →" outline with arrow (A4 tell) beside a disabled grey "Gửi đánh giá" with no reason (C38); dark: "Để sau" pink.
- Review copy switches to first person "Chỉ chúng tôi đọc" (Lucy Spa elsewhere): flag copy.
  **Plan**
- Pattern: account detail split (9.2): left lines + payment, right summary card (status, totals, code, dates); review below as its
  own band block.
- Changes: F2.11 chevron "Quay lại hóa đơn"; totals as one summary list (Tạm tính, Tổng cộng emphasised, Đã thanh toán); dates
  merged to "Lập lúc" + "Thanh toán lúc"; payment line as method + time in two labelled cells; review footer = Neutral "Để sau" then
  primary "Gửi đánh giá" kept enabled with inline error on submit; keep existing print/PDF if present.
- Tells removed: arrow, middle-dot, numbering, eyebrow labels, tile kit.
- Baseline findings fixed: E2 overlap 13/16/11 (own 2/5), font-size 5 (own 2), hit-target 11/14/8 + text200 4, hover-missing 4,
  pressed-missing 31, pink-dark 4/4/2; wig review-card.tsx:178 (disabled submit); rbp invoices.tsx:392 (review read after detail),
  :333-336.
- Transitions: route fade; review sent = inline success swap (≤ 200 ms fade).
- Checks: pink-dark 0, page-own font-size 0; visual: one filled button in the review footer, equal column tops at 1440.

### customer/invoices-empty

**Critique**

- Bordered box with one centred sentence "Bạn chưa có hóa đơn nào.": no icon, no title, no next step (C33); differs from
  bookings-empty (icon + action) on the next tab.
- Dark: the box hairline is barely visible; 1440 the box spans the full content width for one short line.
  **Plan**
- Pattern: customer list empty state (8.4), same block as bookings-empty.
- Changes: icon + `heading` "Chưa có hóa đơn" + sentence "Hóa đơn sẽ hiện ở đây sau lượt làm dịch vụ đầu tiên." + primary "Đặt lịch"
  (copy pending Owner wording); no box.
- Tells removed: boxed empty card.
- Baseline findings fixed: E2 overlap 11, hit-target 7/10/4, pressed-missing 24, pink-dark 4/4/1.
- Transitions: route fade.
- Checks: pink-dark 0; visual: identical empty-state anatomy to bookings-empty in light/dark.

### customer/loyalty

**Critique**

- Tier badges "Silver"/"Gold" and "Hạng của bạn ở Lucy Spa" in pale blue = a second chromatic colour on a non-status label (A3, R26);
  at 390 the blue pills wrap to two lines (8.7: never wraps).
- Points "620"/"1.774" at heading size, not `display` (9.2); "Số điểm"/"Ưu đãi hội viên" 12 px eyebrows (B1).
- Tier table is `div role=table` with inset-shadow separators (E2 shadow-gradient 5 per mode, D7 no shadows).
- Four sections at the end (combo, combo history, referrals, gifts) are heading + 12 px faint paragraph + "chưa có" sentence each: a
  long tail of empty states with no next step (C33); 768 "Quà tặng của tôi" captured mid-fade (Reveal entrance, tell).
- Hand-written "1.000đ" and `${bp/100}%` percents; 390 history = card per row kit.
  **Plan**
- Pattern: loyalty (9.2): points band (two `display` figures side by side, progress bar with text), tier table as kit DataTable,
  history table, rewards/combos sections.
- Changes: tier labels neutral badges (ink outline), "Hạng của bạn" as a check icon + word in the row; progress text 14 muted; empty
  sub-sections collapse into one muted line each under a single "Combo, quà tặng và giới thiệu" heading, the referral one with its
  existing rule sentence; history 390 = stacked rows in one surface.
- Tells removed: scattered fade entrance (F3.2), eyebrow labels, blue chips.
- Baseline findings fixed: E2 shadow-gradient 5/mode, overlap 16/11/11 (own 5), font-size 5 (own 2), hit-target 7/10/4,
  pressed-missing 24, pink-dark 1; wig loyalty.tsx:145, :207 (hand-built %), :178 (div table), :233 (page in state),
  customer-loyalty.ts:29 ("1.000đ"); rbp loyalty.tsx:63-92 (section reads after summary), :32,46.
- Transitions: route fade; progress bar no animation.
- Checks: shadow-gradient 0, pink-dark 0, page-own font-size 0; visual: no blue anywhere, badges one line at 390, 200 % text table
  scrolls in its own container.

### customer/loyalty-empty

**Critique**

- "Chưa có hạng" badge wraps under the card title in one card and sits beside it in the other (768): unequal card heights (B6).
- 390/768: "Lịch sử dùng combo", "Người tôi đã giới thiệu", "Quà tặng của tôi" render faded grey: entrance fade captured mid-way, so the
  content reads as disabled (tell: scattered fade entrances).
- "0" points at full weight with a 0 % progress bar and "Chưa có" values: nothing tells the member how to start (C33).
- Same blue/neutral badge mix, div table, inset shadows as loyalty.
  **Plan**
- Pattern: as loyalty.
- Changes: badge on its own line under the title in both cards (fixed slot, equal heights); empty points band adds one sentence
  "Mỗi 1.000 ₫ thanh toán được 1 điểm." (from the existing rule copy) + primary "Đặt lịch"; empty sub-sections as in loyalty.
- Tells removed: fade entrances, eyebrow labels.
- Baseline findings fixed: E2 shadow-gradient 5/mode, overlap 16/11/11 (own 5), font-size 5 (own 2), hit-target 7/10/4,
  pressed-missing 24, pink-dark 1; same wig/rbp lines as loyalty.
- Transitions: route fade.
- Checks: shadow-gradient 0, card-heights 0 at 768; visual: no faded text in any capture (reduced and full motion).

## Plan only (critique in fd-critique.md)

### customer/home

**Plan**

- Pattern: 9.1 order: R13 hero (full-width photo, flat scrim, `display` headline, primary "Đặt lịch" + outline-white "Xem dịch vụ"),
  brand band R16 per F3.5 (light band, ink logos one height, no boxes), trust band, R14 split intro + 3-column service price list,
  bestsellers row, R15 category grid (photo fills card, white label bottom-leading on a flat scrim, whole card one link), footer.
- Changes: hero photo slot replaces the flat band and the "Ảnh của tiệm…" caption (placeholder frame stays until real photos);
  facts strip = `title` figure + 14 muted caption, address shortened to a link "Chỉ đường" so nothing wraps per word (B3); price band
  main action primary "Đặt lịch" (B4), the in-band slider's duplicate "Xem dịch vụ" removed; category grid 3 columns with photos, no
  orphan (B6); campaign promo becomes a band with a neutral surface and one primary (no burgundy card, D5); product eyebrows removed.
  Copy flag only: CMS headline in Title Case ("Thư Giãn Tận Tâm – Nâng Tầm Nhan Sắc") should be sentence case (Owner data).
- Tells removed: "→" (×3), category eyebrows, burgundy decorative card, burgundy logo strip.
- Baseline findings fixed: E2 overlap 18/21/12 (own 7/10/1, brand links vs tab bar), hit-target 14/12/11 (phone link 35 px),
  hover-missing 15, pressed-missing 87, pink-dark 5/5/5; wig home-content.tsx:93 (`translate="no"`), home-sections.tsx:65 (new-tab
  hint), brand-band.tsx:54 (lazy logos), photo-slot.tsx:26 (no lazy/priority); rbp (home)/page.tsx:23 (await 6 reads),
  home-product-row.tsx:27 (priority on a lazy row).
- Transitions: route fade; the one main moment = hero opening sequence (F3.3, ≤ 800 ms, once per visit).
- Checks: pink-dark 0, secondary-filled 0, sticky-cover 0 at 200 % zoom; visual: hero photo full width at 390/768/1440, category
  grid 3 equal columns, dark no burgundy band/pink.

### customer/services

**Plan**

- Pattern: services list (9.2): title band (`title-xl`, sentence, search + chips), category bands with 3/4-column cards (photo, name,
  duration, price, primary "Đặt lịch"), sticky chips row.
- Changes: no back link (B7); chips scroll with peek below 768 (F2.4); card CTA becomes the primary pill (B15), card is a flex column
  with the CTA pinned (B6); duration 14 muted (B1); 1440 = 3 columns at 1200 max with real photo frames (not 4 small grey boxes).
- Tells removed: back link, "→", tile kit look (photo now carries the card).
- Baseline findings fixed: E2 overlap 15/15/11 + zoom 19 (own 4), hover-missing 26, pressed-missing 69, pink-dark 4/4/1; wig
  services-list.tsx:104 (search not in URL), :125, :139; rbp services-list.tsx:1,90-116 (whole list client), :139-161
  (content-visibility).
- Transitions: route fade; card photo → service-detail photo shared morph (F3.6).
- Checks: card-heights 0, pink-dark 0; visual: chips peek at 390/768, equal card heights at text 200 %.

### customer/service-detail

**Plan**

- Pattern: service detail (9.2): split hero (photo left, name/duration/price/copy/primary right), bands, related row, CTA band.
- Changes: one back affordance = breadcrumb "Dịch vụ" + F2.11 chevron, text link removed (B7); placeholder caption removed from the
  photo frame; "Dự kiến / Giá" as labelled values at 14 (B1); "Tất cả dịch vụ" becomes a tertiary link (no arrow pill); related cards
  use the services card (primary CTA); sticky bottom bar on phone; footer per F2.10.
- Tells removed: "→", eyebrow meta labels, duplicate back.
- Baseline findings fixed: E2 overlap 14/13/11 + zoom 15 (own 3/2), hover-missing 9, pressed-missing 37, pink-dark 4/4/1; wig
  services-view.tsx:120 (failed state has no h1), photo-slot.tsx:26 (LCP image without priority).
- Transitions: shared photo morph from the list (the page's one moment); route fade otherwise.
- Checks: pink-dark 0; visual: one primary per view, footer no overlap at text 200 %.

### customer/products

**Plan**

- Pattern: cosmetics list (9.2): title band + toolbar (search, chips, sort select, filter drawer on phone), product grid 2/3/4 (R17).
- Changes: no back link; promo strip becomes a neutral line with a tertiary link (no pink tint, no "Ưu đãi" eyebrow); h2 "Sản phẩm"
  removed; brand chips move into the filter drawer below 1024 (one accent chip row, C4); badges per F1.8 (B18); names wrap to 2 lines,
  no ellipsis (C15); inline "Khuyến mãi: <link>" removed from inside the card link (nested target); grid rows equal (F2.5).
- Tells removed: category eyebrow above every name, back link, pink promo pill.
- Baseline findings fixed: E2 clipped-text 4/3/3 + zoom 7 + text 5 (ellipsised names), overlap 19 (own 8 at 390), hover-missing 24,
  pressed-missing 45, pink-dark 5/5/5 (`.ls-badge-brand`); wig products-controls.tsx:43; rbp products-view.tsx:249,326,
  sale-countdown.tsx:21-25, public-metadata.ts:228.
- Transitions: route fade; card photo → product-detail gallery morph (F3.6).
- Checks: clipped-text 0, pink-dark 0, card-heights 0; visual: one filled chip row, badges one family in light/dark.

### customer/product-detail

**Plan**

- Pattern: product detail (9.2): split gallery left (image fills the 1:1 frame, R17) and buy column right; bands for description,
  usage accordion, related row.
- Changes: one primary only: "Đăng nhập để mua" primary, "Gọi cửa hàng" becomes secondary outline (B16, C4); "Mua trực tiếp tại cửa
  hàng" box flattened into the column with hairline rows at 14 (B12/B19); brand/category meta as a labelled line, no middle dot, no
  eyebrow; back = breadcrumb + chevron only; "Chỉ đường" tertiary link with new-tab hint.
- Tells removed: middle-dot eyebrow, "→", padded centred photo.
- Baseline findings fixed: E2 overlap 17/12/11 (own 6/1), hit-target 11/5/4, hover-missing 9, pressed-missing 35, pink-dark 5/5/5;
  wig products-view.tsx:390 (new-tab hint).
- Transitions: gallery photo morph from the list (the page's one moment); route fade.
- Checks: pink-dark 0; visual: exactly one filled button at 390/768/1440, gallery image fills its frame.

### customer/login

**Plan**

- Pattern: auth card (9.2) per fd direction: white band, centred 26 rem hairline card, wordmark only in the header.
- Changes: panel colour removed (A3, C34); header "Đặt lịch" pill hidden on auth routes; one line under the title says why
  (C68: "Đăng nhập để đặt lịch, xem lịch hẹn và điểm thưởng."; when arriving from booking, "Đăng nhập để tiếp tục đặt lịch"); "Quên mật
  khẩu?" tertiary link with a 44 px hit area; password toggle inside the field without overlapping the text.
- Tells removed: tracked caps wordmark above the card.
- Baseline findings fixed: E2 overlap 12 (password toggle over input, own 1), hit-target 7/5/4 ("Quên mật khẩu?" 18 px), pressed-missing
  27, pink-dark 1 ("Quên mật khẩu?"); wig auth.tsx:244 (no `name`), :302 (OTP error not inline); rbp auth.tsx:199-209.
- Transitions: route fade; login/register segment cross-fade.
- Checks: page-own hit-target 0, pink-dark 0; visual: light/dark identical layout, no accent background.

## Cross-page patterns

1. **Back text on every account page, top-level included** (account, bookings, invoices, loyalty, book, plus campaign/products/
   services): F2.11 removes it on top-level pages and turns detail ones into a chevron; detail pages also drop the tab row.
2. **Identical grey rounded tiles everywhere in the member area**: summary cards with a pill inside, one card per table row at 390,
   choice tiles in booking, four stacked tiles on detail pages. Plan: one surface per idea (hairline list/table, whole-card links,
   split detail with a summary card).
3. **Pink in dark** (links, current tab/step, secondaries, ticket code) and **accent on non-actions** (ticket code, loyalty blue/
   tier badges, burgundy auth panel): F1.3/F1.8 plus page fixes; status badges everywhere lack an icon (C5).
4. **Two filled buttons in one view at 768+**: the header "Đặt lịch" pill plus the page primary (not-found, bookings-empty,
   account-empty, auth pages). Proposed rule: the header pill hides on auth routes and when the page's primary has the same target
   (pending Owner, it touches the 8.5 header rule).
5. **Empty states without anatomy or next step**: invoices-empty (sentence only), loyalty tail sections, cancelled booking, stale
   campaign link; bookings-empty has an action but no title and a box. One kit EmptyState (icon, heading, sentence, one action).
6. **Middle-dot meta strings and 12 px eyebrow labels** on every record (ticket, booking/invoice detail, account cards, loyalty).
7. **Phone chrome collisions**: tab bar and fixed contact button overlap content and each other (page-own overlap 5-10 at 390 on
   account, register, not-found, loyalty, booking-detail); footer columns overlap at text 200 % (B13/F2.10).
8. **Scattered fade entrances captured mid-way** (loyalty, loyalty-empty): F3.2 makes Reveal a plain wrapper; nothing on these pages
   may depend on scroll to become readable.

## Captured in the wrong state

- campaign: slug `ngay-hoi-lam-dep-mv0qetvl` no longer matches a running campaign; re-capture with the live slug before Step 4.

## Not available

- none (all 17 pages had light and dark sheets; invoices-empty, loyalty and loyalty-empty sheets were generated in this run).
