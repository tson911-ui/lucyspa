# frontend-design: baseline critique (Step 1), phase s10base

Method: per-page contact sheets (`node .local/s10/sheet.mjs s10base <area>`, one column per mode, top 2600 px of each scaled to 520 px)
opened with Read; single full images opened where a sheet shows a problem. "Tells" = the generic-AI traits named in the brief:
all-caps labels, eyebrow labels above headings, "→" appended to buttons, identical rounded card kits, decorative numbering,
middle-dot meta strings, scattered fade/slide entrances.

## Customer

### home (sheets customer-home-light.png, customer-home-dark.png)

- Hero (B2): no photograph at all. A flat #f5f5f7 band (dark: #1c1c1e) with the headline left and a floating caption "Ảnh của tiệm:
  không gian thư giãn" bottom-right (a placeholder label pretending to be a photo credit). R13 not met: needs a full-width photo with
  a flat scrim. Headline is CMS copy in Vietnamese Title Case ("Thư Giãn Tận Tâm – Nâng Tầm Nhan Sắc"): sentence case expected.
- Tells: "→" appended to "Xem dịch vụ", "Đặt lịch →" (price band), "Xem dịch vụ →" (slider); wordmark "LUCY SPA" tracked all-caps
  (the wordmark is the brand, kept; but caption/eyebrow labels "Chăm sóc da" above product names act as eyebrows); the brand band is
  a burgundy strip with logos in mixed faces/heights (R16: light band, uniform height, no colour).
- Facts strip (B3): three big 28 px figures with 12 px faint captions; at 390 and 200 % zoom the address wraps word by word
  ("04 / Nguyễn / Quang / Bích,") and the hairline dividers stand between ragged columns.
- Price list (B4): main action "Đặt lịch" is an outline secondary with an arrow; a slider inside the band repeats a "Xem dịch vụ"
  outline button; three-column price list text 14 px cramped at text 200 % ("Gội / thường").
- Featured products: identical rounded tiles with a tiny 12 px faint category eyebrow above each name (B1 captions too small and faint);
  badges "Mới" outline + "Hết hàng" grey pill on the photo (B18 inconsistent meaning/colour).
- Category grid (R15 not met): white cards with the label bottom-left but NO photo; uneven grid (3 + 1 orphan, then 2) (B6).
- Campaign promo: a solid burgundy card with a white pill button (accent used as a decorative background; D5/R11).
- Footer: 12 px grey links, but four columns at 1440 are not aligned to the content grid (B13); a "Đặt lịch →" outline button in the
  footer brand column.
- Dark: burgundy band and filled buttons read raspberry/pink (#9b424e, text #dcadb0) (B22); nav current link pink.
- 200 % zoom (720 css px): header holds wordmark + EN + theme + account + "Đặt lịch": crowded but no overlap at top; E2 sticky-cover
  flags the header + tab bar > 30 % (B20).

## Staff (POS)

### pos (sheets staff-pos-light.png)

- Still direction C (rose-cream canvas #fbf3f1-ish, old tokens; data-ui v2 not on the staff shell): DNA with the customer side broken
  (D1/D2/D7: different canvas, different header, wordmark in a different weight and tracking).
- Tells: sidebar group labels in tracked ALL CAPS (VẬN HÀNH, THANH TOÁN, BÁO CÁO, NHÂN SỰ, DANH MỤC, QUẢN TRỊ) with chevrons; a
  "← Quay lại" text link above a top-level page (B7, C40: POS has no parent).
- Page header has two pills side by side: "+ Bán combo" (tinted fill) and "+ Bán sản phẩm" (solid) (B11/C4: two filled).
- Theme switch: three icon buttons (sun / moon / clock) in the top bar, the selected one a solid burgundy circle (A1 removes it).
- Table: header row not on the sunken colour, invoice codes underlined burgundy links (fine as links), status badges as coloured
  outline pills (amber, green, red) without icons (C5/H5: colour + word only, no icon).
- Text 200 %: sidebar labels break per syllable ("Hóa / đơn", "Thu / gọn / thanh / bên"), table runs off the card edge with no
  inner scroll affordance; 200 % zoom (640 css px): sidebar collapses to icons, the table is cut at the right edge.

### services (customer-services-light.png)

- "← Quay lại" above the title of a top-level page (B7/C40).
- Title band then a chips row; at 390 the chips are cut at the edge with no peek or affordance (B10); chips selected = solid burgundy
  (fine), others flat grey with no hover (B14).
- Cards: identical rounded tiles, no photos (flat placeholder + tiny image icon), name, 12 px faint duration with a clock icon, price,
  and an outline "Đặt lịch →" (B15 wants the primary; "→" tell). Heights differ where names wrap (B6), e.g. "Đính đá/charm" vs
  "Tráng gương / ombre / mắt mèo" at text 200 %.
- 1440: four columns of small cards in a narrow band: the page reads as a spreadsheet of grey boxes, not an Aevi grid.

### service-detail (customer-service-detail-light.png)

- "← Quay lại" text link AND a breadcrumb (two back affordances; B7 wants one chevron with a label, parent = Dịch vụ).
- Photo frame is a white box captioned "Ảnh của tiệm: dịch vụ này" (placeholder label as content).
- Meta strip "Dự kiến / Giá": 12 px faint labels above values (eyebrow tell; B1).
- Primary "Đặt lịch" + outline "Tất cả dịch vụ →" (arrow tell).
- Related row: same card kit with outline "Đặt lịch →" buttons; a "Sẵn sàng đặt lịch?" CTA band repeating the primary.
- Footer at text 200 %: link lines overlap each other ("Chính sách thành toán" over the next line), brand column "Đặt lịch →".

### product-detail (customer-product-detail-light.png)

- Two filled buttons in one view: "Đăng nhập để mua" (full-width primary) and "Gọi cửa hàng" (filled) in the store card (B16, C4).
- Middle-dot meta string "Chăm sóc da · Thương hiệu mẫu" as a 12 px faint eyebrow above the name (tell, B1).
- "← Quay lại" + breadcrumb (B7). "Chỉ đường →" arrow tell. "Mới" badge in burgundy outline, "-20%" text in ink (B18).
- Gallery at 768 / 1440: the photo sits centred in a large padded grey frame instead of filling it (R17).
- "Mua trực tiếp tại cửa hàng" is a bordered/filled card inside the alt band with 12 px label/value pairs (B12/B19 style box).
- Footer overlaps at text 200 % (same as other pages).

### products (customer-products-light.png)

- "← Quay lại" on a top-level page (B7). Promo strip: pale pink tinted pill with an eyebrow word "Ưu đãi" + "Mua ngay ›" (pink tint,
  eyebrow tell, accent as decoration).
- "Sản phẩm" h2 right under the h1 "Mỹ phẩm" (heading repeats the page); two stacked chip rows (categories, brands) cut at the
  edge at 768 and 390 with no peek (B10), selected chips solid burgundy in both rows (two filled controls at once, C4).
- Card kit: every card carries a burgundy outline "Mới", some an ink "-20%", some a grey "Hết hàng": three badge styles, the
  accent used for a non-action label (B18, A3). 12 px faint category eyebrow above every name; names truncated with an ellipsis
  ("Dầu gội thảo mộc (chỉ bán tại cửa...") (C15); an inline "Khuyến mãi: <link>" inside a whole-card link (nested target).
- Row heights vary a lot at 768 (pre-order note, promo line) (B6). 390: filter "Lọc" outline + select side by side fine.

### login / register / forgot (customer-login-light.png; register and forgot share the frame)

- The whole page is a solid burgundy panel (Q4 flat auth panel): the accent as a decorative background (R11, C8, A3) and a branded
  screen (C34) with the wordmark repeated in tracked white caps above the card. At 1440 the card floats in a sea of red.
- Card: segmented Đăng nhập / Đăng ký; labels "Email (bắt buộc)" fine; "Quên mật khẩu?" underlined link in burgundy (link OK).
- C68: one line "Đăng nhập để đặt lịch và xem lịch hẹn của bạn" (does not say why booking needs an account; no return-to-booking cue).
- Plan direction: white page (band base), centred 26 rem card with a hairline, no panel colour; the wordmark stays in the header only.

### services, dark (customer-services-dark.png) - B8

- The chip row sits on its own black band (#000) with hairlines, between the grey title band and the first black section: a black
  strip that belongs to neither (B8). Plan: the chips live inside the title band (same surface), sticky below the header on scroll.
- Secondary "Đặt lịch →" outlines and the selected chip read pink/raspberry (#dcadb0 text, #9b424e fill) (B22).
- Placeholder photo frames alternate black and grey with the band, so the grid looks like empty holes in dark.
