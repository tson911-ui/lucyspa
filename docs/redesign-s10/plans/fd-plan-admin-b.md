# frontend-design: admin screens B critique (Step 1) + page plan (Step 2), phase s10base

Scope (staff, admin): import, import-detail, supplier-imports, supplier-imports-all, supplier-sources, pay, payroll,
payroll-detail, payroll-slip, reports-revenue, reports-sales, reports-customers, reports-staff, reports-stock, reports-cash,
reports-pay, reports-profit, reports-refunds, reports-reviews, audit-log, website, website-page, website-page-new,
website-popup, website-popup-new, website-season, website-season-new, seo-drafts, ai-settings, season-preview.
Method: light sheet (1024 / 1280 / 1440 / 200 % zoom 640 css / 200 % text 1280) and dark sheet (1024 / 1280 / 1440) opened for
every captured page; full `dark-1440` images also opened for reports-revenue, reports-customers and reports-profit (chart colours,
callouts). Colour claims in dark beyond the E2 values (e.g. "reads amber") are visual readings of the downscaled sheets.
E2 counts: "page-specific" = the page's own items after removing the shell elements (skip link, wordmark, sidebar, top bar,
theme switch, bell), computed from `.local/s10/e2/s10base/staff/<page>.json`; counts are per mode (light-1440 unless named).
Shell floor on every page (judged by the shell agent, fd-plan-pos `staff/SHELL`, not repeated below): "← Quay lại" text above
the h1 (B7/C40), rose gradient canvas, serif Fraunces titles, ALL-CAPS burgundy group labels, theme switch, pink wordmark in
dark, `.ls-nav-label` 1:1 contrast artefact. The page-level fix of "Quay lại" is F2.11 (PageBack): only pages with a parent
keep an icon-only chevron, which is noted per page as "parent: yes/no".

## Shared pattern plans

### staff/PATTERN-LIST

- Pattern: DESIGN 10 list page. `Page` + `PageHeader` (h1 24/600 ink, optional one-sentence description 14 muted, one primary
  at the trailing edge, nothing else filled); toolbar line (search pill, facet pills, refresh icon button with a tooltip, result
  count on the trailing edge only when no pager shows it); ONE `DataTable` surface on the `#f5f5f7` canvas (dark #000),
  no outer card, header row on sunken, 48 px rows (one row height: a second line of meta is 12 muted inside the same 48 px, or
  the row grows for every row, never for some), row `⋮` at the trailing edge, `Pagination` 20/page with "Hiển thị x-y trong n"
  leading; the "20 dòng mỗi trang" select is the kit-styled select (B9, F2.3).
- Status cells: kit status badge = tint + word + 16 px icon (C5, DESIGN 8.7); never three coloured outline pills in one row;
  when a row carries several states, one "Trạng thái" badge + the rest as plain 14 muted text.
- Primary text cell: name in ink 14/500 (not a burgundy underlined link: the whole row or the name is the link, A3 keeps the
  accent for links only, so the link is ink with underline on hover; dark = gray 12, F1.3); names wrap to 2 lines, never an
  ellipsis that hides the distinguishing end of a product name (C15); the cell is a 40 px target (E2 hit-target 19 px today).
- Wide tables at 200 % zoom / 200 % text: DataTable scrolls inside its own container with a visible trailing edge (hairline +
  the next column peeking, no shadow) (F2.6); the first column sticks; no column silently cut at the card edge.
- Tabs on a list page: kit segmented tabs (DESIGN 8.5) under the header; the section h2 that repeats the tab label is removed
  (FR "a heading never repeats the label of its own control").
- Transitions: 120 ms route fade only (F3.4); no row or toolbar motion.
- Checks: E2 on the page = 0 clipped-text, 0 overlap, 0 hit-target (page items), 0 shadow-gradient (`.ls-table-wrap` shadow
  gone), 0 pink-dark, 0 non-radix, 0 hover/pressed-missing on tabs, sort headers, pager, checkboxes; visual 1440 light + dark:
  one surface, no pink, status icon+word; zoom200: first column + status visible, table scrolls in place.

### staff/PATTERN-DETAIL

- Pattern: DESIGN 10 detail page. Breadcrumb (parent link) as the only back affordance + icon-only PageBack chevron (F2.11);
  header = title + status badge + one primary; from 1024 two columns (record 8 cols / summary 4 cols); description list
  (label 12/500 muted above value 14 ink, F1.7; values not 16 px), no border inside the card; secondary record lists are a
  DataTable on the canvas (not inside the card); row `⋮`.
- Card title = `heading` step (compact 17/600), no `⋮` in a card header unless it holds more than one action.
- Transitions / checks: as PATTERN-LIST, plus E2 font-size 0 for `dd.ls-dl-value` / card titles (compact scale).

### staff/PATTERN-FORM

- Pattern: DESIGN 10 form page: one column max 720, groups = h2 + 32 px gap (no bordered fieldset or nested card), fields
  R9/F2.3 (8 px radius, not pills), footer Cancel then primary, sticky on long forms; in-app navigation guarded when dirty.
- Switches with the word on/off; preview panes (popup, season) sit in the 4-col trailing column from 1280, below at 1024.
- Transitions: 120 ms route fade; busy label "Đang lưu…" (C38). Checks: E2 0 for page items; one filled button per view.

### staff/PATTERN-REPORT

- Pattern: DESIGN 10 dashboard/report: PageHeader (h1 + one primary "Xuất file" when export exists, else none; print as an
  icon button), toolbar (date range pill + branch facet + compare toggle), a KPI row of `Stat` cards (value `title`, label
  `label`, delta = icon + sign + text, C5) in one grid with equal heights, then one chart per Card, then the detail
  `DataTable` (20/page, pager in the URL: wig reports-kit.tsx:317).
- Charts: flat series (no gradient fill, no texture), 2 px lines, six-slot chart palette re-tuned so slot 1 is burgundy 9 in
  light and a NON-pink slot in dark (burgundy 9 dark `#9b424e`, never `#e08a9a`/`#dcadb0`), slots 2-6 distinct by hue AND by
  shape (line dash / marker shape) so the legend reads without colour (DESIGN 10, C5); direct labels at line ends when ≤ 3
  series, else a legend with shapes; gridlines hairline gray 5, axis text 12 muted, tabular numbers.
- Empty period: one Card with an icon, one sentence, and the next step ("Chọn khoảng ngày khác") (C33).
- Transitions: 120 ms route fade; charts draw without an entrance tween (CountUp renders the final number, F3.2).
- Checks: E2 0 shadow-gradient inside the content (chart `linearGradient` fills gone), 0 pink-dark (series, links, active
  segment), 0 font-size; visual dark 1440: no pink series, legend shapes visible; zoom200 KPI cards wrap 2-up, no clipped value.

## Pages

### staff/import

**Critique**

- Two filled actions side by side in the header: "Nhập ảnh từ ZIP" (tinted rose fill) + "Tải tệp lên" (solid) (B11, A4, C4);
  dark: "Tải tệp lên" pink fill with dark text, ZIP button dark burgundy fill, file link pink (B22). Parent: no (top-level).
- Status "Chờ xác nhận" is an amber outline pill with no icon (C5); file name is a burgundy underlined link 19 px high (C29).
- The table surface carries a shadow (`.ls-table-wrap`, D7) and floats like a pill on the rose canvas.
- 200 % zoom (640 css): table cut after "Trạn", status pill half visible, no scroll sign (C16, B24); 200 % text holds.
- Only 1 row in scratch data: no empty state to judge; ~70 % of the 1440 canvas is empty under the pager.
  **Plan**
- Pattern: PATTERN-LIST.
- Changes: "Tải tệp lên" stays the one primary; "Nhập ảnh từ ZIP" becomes secondary outline (F1.4); status badge with icon;
  file-name cell = ink link with a 40 px target; table scrolls in place at zoom200 with "Tệp" sticky; empty state (C33) =
  icon + "Chưa có lần nhập nào" + the upload action (header primary hidden then, to keep one primary).
- Tells removed: tinted second button beside the primary, floating table shadow.
- Baseline findings fixed: page E2 hit-target 1 (link 19 px), shadow-gradient 1 (`.ls-table-wrap`), pressed-missing 1 (file
  link), pink-dark 3 (icons, file link), non-radix 13 (20 dark); wig-admin-a imports.tsx:69 (page in useState), :132 (row
  "open" via navigate, use href), :203 (formatBytes separator); i18n/imports.ts:50 straight quotes.
- Transitions: 120 ms route fade.
- Checks: PATTERN-LIST checks; one filled button in the header (light + dark 1440); zoom200 status column reachable by scroll.

### staff/import-detail

**Critique**

- Two back affordances: "← Quay lại" plus breadcrumb "Nhập dữ liệu › bang-gia-moi.csv" (C40). Parent: yes (import).
- Summary card: 2-col description list with 16 px values and an 18 px card title (E2 font-size 9), above the compact scale;
  "Nguyễn Thị Lucy · 11:11 11/10/2026" is a middle-dot meta string (tell); a lone `⋮` in the card header hides the
  record's other actions.
- Rows table: "Kết quả" pills (Có lỗi red, Cập nhật blue, Không đổi grey) are colour outlines with no icon (C5); "Ghi chú"
  wraps to 3 lines so rows have three different heights (one row height rule); names ellipsised (C15).
- 1024 light: "Kết quả" pills cut at the edge and "Ghi chú" hidden; 200 % zoom: table cut at "Gh", no scroll sign (C16).
- "Lọc dòng" is a tinted filled pill beside the search (reads as a second primary, A4).
- Dark: primary "Nhập vào hệ thống" pink fill, breadcrumb link pink, "Lọc dòng" tinted pink (B22).
  **Plan**
- Pattern: PATTERN-DETAIL (header: file name + status badge "Chờ xác nhận" + primary "Nhập vào hệ thống").
- Changes: summary becomes the trailing 4-col column from 1280 (Tổng số dòng / Hợp lệ / Có lỗi / Cập nhật / Không đổi as a
  label-value list), rows table 8 cols; uploader and time as two dl rows (no "·"); card `⋮` removed, its actions go to the
  header (destructive outline "Hủy lần nhập" before the primary); "Lọc dòng" = neutral facet pill; result badges icon + word;
  "Ghi chú" clamps to 2 lines (full text in the row drawer) so every row has one height.
- Tells removed: middle-dot meta, card-header `⋮`, tinted filter pill, double back.
- Baseline findings fixed: page E2 font-size 9 (dl values 16, card title 18), shadow-gradient 2 (card + table), pressed-missing
  1, pink-dark 3, non-radix 27 (37 dark); wig-admin-a import-detail.tsx:350 (textarea name/autocomplete), :382 (formatVnd),
  :487 (placeholder repeats the label, no "…").
- Transitions: 120 ms route fade. Checks: PATTERN-DETAIL checks; 1024 light shows "Kết quả" fully; equal row heights.

### staff/supplier-imports

**Critique**

- Every product name is a burgundy underlined link cut with an ellipsis (E2 clipped-text 17, 34 at 200 % text; C15), 19 px
  high (E2 hit-target 18), and the link box runs under the row `⋮` (E2 overlap 1, 7 at zoom200).
- Two status columns: "Cần xử lý" (amber "Chưa chọn nhóm", "Ảnh trùng sản phẩm khác +1", "SKU không đúng dạng") and
  "Trạng thái" (amber "Cần xem lại", green "Sẵn sàng"): two coloured outline pills per row, no icons (C5).
- Header has the one primary "Nhập và đăng tất cả" (correct), but the description quotes it in straight quotes; tabs
  "Chờ duyệt / Thay đổi" are underline tabs, not the kit segmented control (8.5), with no pressed state.
- Facet pills "Trạng thái: Chờ xử lý" / "Cần xử lý" are tinted rose fills (accent family on a filter, A3).
- Dark: active tab pink text + underline, primary pink fill, facet summary `#f0b3be` (E2 pink-dark 7) (B22).
- 200 % zoom: name column shrinks to "Sữa rửa ..." while "Trạng thái" is cut at the edge (C16). Parent: no.
  **Plan**
- Pattern: PATTERN-LIST with tabs.
- Changes: one "Trạng thái" badge column (icon + word); "Cần xử lý" as 14 muted text (first issue + "+1"); names wrap to 2
  lines in ink, whole cell a 40 px link; segmented tabs; neutral facet pills (F2.4); description to one sentence (copy flag);
  at zoom200 the name column sticks and the table scrolls.
- Tells removed: two pill columns, tinted facet pills, quoted button label inside prose.
- Baseline findings fixed: page E2 clipped-text 17 (19 at 1024, 34 text200), hit-target 18, overlap 1 (7 zoom200),
  pressed-missing 20 (tabs + name links), pink-dark 7, shadow-gradient 1, non-radix 18 (29 dark); wig-admin-b
  supplier-imports.tsx:115 (`?review=` href drops tab/filter/page), :130 (SKU translate="no").
- Transitions: 120 ms route fade; the review drawer slides from the trailing edge within the 200 ms compact clamp.
- Checks: PATTERN-LIST checks; clipped-text 0 at text200; dark 1440 tabs and facets neutral.

### staff/supplier-imports-all

**Critique**

- Before any data: a 3-line description, a blue bordered info callout (4 paragraphs), a row of outlined count pills
  ("Làm sạch 6", "Mặt nạ 1") and an amber bordered warning callout: three boxed blocks on the canvas (B12, C19); counts beside
  labels are the count-next-to-a-label tell.
- "Chọn tất cả" + "Bỏ chọn tất cả" are two tinted filled buttons side by side (B11, A4) with the primary "Nhập và đăng 14 sản
  phẩm" also in view: three filled buttons.
- The second table (the 3 blocked products, "Sản phẩm / Ghi chú") has no heading; it reads as an orphan under the pager, with a
  different row height from the main table.
- 14 checkboxes have no hover/pressed (E2 15/15); names ellipsised (E2 clipped-text 15, 31 at text200); old price struck
  through under the price at the same weight (needs muted).
- 200 % zoom: name column 3-4 letters, "Giá bán" off the edge (C16).
- Dark: primary pink fill with dark text, checkboxes pink, info callout navy (the only chromatic surface). Parent: yes
  (supplier-imports).
  **Plan**
- Pattern: PATTERN-LIST (review page with bulk selection).
- Changes: description one sentence; info callout becomes 2 lines of 14 muted text (no box); category counts move into the
  "Nhóm" facet menu; warning = one inline notice row (icon + sentence + "Xem 3 sản phẩm" link to the blocked table); blocked
  table gets an h2 "Chưa nhập được" and the same row height; select all/none = the header checkbox + a bulk bar on the toolbar
  line ("14 đã chọn", neutral "Bỏ chọn"); with 0 ticked the primary keeps an action label and is disabled with a hint (wig :290).
- Tells removed: stacked bordered callouts, count pills, two tinted buttons, orphaned table.
- Baseline findings fixed: page E2 clipped-text 15 (17 at 1024, 31 text200), hover/pressed-missing 15 (checkboxes),
  shadow-gradient 2, pink-dark 2, non-radix 21 (29 dark); wig-admin-b supplier-import-all.tsx:85 (filters/page in URL), :284
  (bulk publish without confirmation), :288 (progress not live), :290, :366, :470 (unbounded table), :67 (error state has no
  h1), :221; rbp-staff supplier-import-all.tsx:118-124, :381-382, :106-115 (2,000-row iterations).
- Transitions: 120 ms route fade; bulk progress inline next to the primary (H11), toast second.
- Checks: PATTERN-LIST checks; one filled button in view at 1440 light/dark; zoom200 "Giá bán" reachable by scroll.

### staff/supplier-sources

**Critique**

- Up to three coloured outline pills per row ("Giấy phép": Chờ xác nhận / Đã xác nhận / Chưa ghi; "Chạy thử"; "Trạng thái":
  Đang bật / Đang tắt), no icons (C5); 15 identical "Chưa ghi / Đang tắt" rows turn the trailing half into a wall of pills.
- Two sort arrows at once ("Nguồn ↑" and "Nhà cung cấp ↑"): the active sort is ambiguous; sort headers and pager buttons have
  no hover/pressed (E2 4/4).
- Pager « ‹ 1 2 › » plus a native-looking "20 dòng mỗi trang" select pill (B9); at 200 % zoom the pager drops to its own line.
- 200 % zoom: "Giấy phép" and "Trạng thái" cut at the edge; long source name ellipsised (E2 clipped-text 1, C15).
- Dark: current page "1" pink (E2 pink-dark 3), primary "Thêm nguồn" pink fill; the "Nhà cung cấp" column reads warm amber at
  dark 1024 (old warm ink family; recheck after F1.1).
- Header correct: one primary "Thêm nguồn" with a "+" icon. Parent: no.
  **Plan**
- Pattern: PATTERN-LIST.
- Changes: one "Trạng thái" badge (icon + word; Đang bật success tint, Đang tắt neutral); "Giấy phép" and "Chạy thử" as 14 text
  with an icon only when attention is needed; only the active sort column shows its arrow; pager per DESIGN 8.8 (no « »).
- Tells removed: pill wall, double sort arrows.
- Baseline findings fixed: page E2 clipped-text 1, hover/pressed-missing 4 (sort headers, pager), pink-dark 3, shadow-gradient 1,
  non-radix 23-26 (31-34 dark); wig-admin-b supplier-sources.tsx:543 (type="url"), :149 (paging in URL), :482 (names);
  rbp-staff supplier-sources.tsx:106-108 (mirror effect).
- Transitions: 120 ms route fade. Checks: PATTERN-LIST checks; one sort arrow at rest; dark 1024 cell text neutral.

### staff/pay

**Critique**

- Underline tabs (Lương cơ bản / Tiền tour / Hoa hồng / Mã nhân viên) touch each other (E2 hit-target gap 0, 3 pairs) and
  have no pressed state (E2 4); then an h2 "Lương cơ bản theo tháng" (18 px, E2 font-size 1) repeats the active tab (FR).
- "Bùi Thị Bích Thủy Tiên · NV0004": middle-dot meta string (tell); the "· NV0006" hint overlaps the salary at 1024 (E2
  overlap 1); the long name is ellipsised (E2 clipped-text 1, C15).
- No primary action in the header (changes only through row menus): no obvious next step on the page.
- Two-line policy description ("…không bao giờ bị sửa") under the h1.
- 200 % zoom: "Lương hiện tại" cut, "/ tháng" cut, "Từ ngày" and "Số lần đổi" hidden (C16).
- Dark: active tab pink text + underline (E2 pink-dark 4) (B22). Parent: no.
  **Plan**
- Pattern: PATTERN-LIST with tabs (one tab = one list).
- Changes: segmented tabs; the h2 removed; employee code in its own "Mã" column (no "·"); one header primary per tab when the
  tab has a create action (e.g. "Thêm mã" on Mã nhân viên), never two; "₫ / tháng" moves to the column header so the value
  column is right-aligned tabular numbers only.
- Tells removed: middle-dot meta, heading repeating its tab.
- Baseline findings fixed: page E2 overlap 1, clipped-text 1, font-size 1 (h2 18), hit-target 3 (tab gaps), pressed-missing 4,
  pink-dark 4, shadow-gradient 1, non-radix 17 (26 dark); wig-admin-b pay.tsx:43 (no-permission shown as a load error),
  pay-salaries.tsx:150/224/247/250, pay-codes.tsx:189/275, pay-tour.tsx:150/166/237/261/264, pay-commission.tsx:140/224/246/388.
- Transitions: 120 ms route fade; tab change instant. Checks: PATTERN-LIST checks; zoom200 salary column visible.

### staff/payroll

**Critique**

- No primary in the header (no "Tạo bảng lương" for the next month), so the page's main job has no action (C4, C33).
- A 3-line process description under the h1, then an h2 "Các kỳ lương" (18 px, E2 font-size 1) on its own line and the
  "1 kết quả" + refresh icon floating on a second line at the trailing edge: three loose rows before the table (FR toolbar).
- Month "10/2026" is a burgundy underlined link 19 px high (E2 hit-target 1, pressed-missing 1); status "Đã trả" green
  outline pill, no icon (C5).
- 200 % zoom: "Tip" and "Ngày trả" cut at the card edge (C16). Dark: month link pink (E2 pink-dark 3). Parent: no.
- One row in scratch data; the rest of the canvas is empty (fine, but there is no hint of what a draft row looks like).
  **Plan**
- Pattern: PATTERN-LIST.
- Changes: header primary "Tạo bảng lương" (the existing create command; shown only when a month can be created); the
  description cut to one sentence (copy flag); h2 removed (the h1 already names the list); count + refresh on the toolbar line;
  the whole row opens the run (month cell ink, 40 px); status badge icon + word ("Nháp", "Đã chốt", "Đã trả").
- Tells removed: orphan h2, floating count row.
- Baseline findings fixed: page E2 font-size 1 (h2 18), hit-target 1, pressed-missing 1, pink-dark 3, shadow-gradient 1,
  non-radix 13 (18 dark); wig-admin-b payroll.tsx:55 (paging not in URL); lib/workforce/payroll.ts:26 (`monthLabel` MM/YYYY).
- Transitions: 120 ms route fade. Checks: PATTERN-LIST checks; zoom200 shows "Ngày trả" by in-place scroll.

### staff/payroll-detail

**Critique**

- Two back affordances ("← Quay lại" + breadcrumb "Bảng lương › 10/2026") (C40). Parent: yes (payroll).
- Status "Đã trả" sits inside the summary card instead of beside the h1 (DESIGN 10 detail header); the summary card spans the
  full width with 6 label/value pairs in two far-apart columns at 1440 (eye travel); values 16 px, card title 18 (E2 font-size 7).
- Rows: "Bùi Thị Bích Thủy Tiên · NV0004" middle-dot meta (tell), "· NV0006" overlaps the amount at 1024 (E2 overlap 1),
  long name ellipsised (E2 clipped-text 1); "Phiếu lương" column shows a status pill "Đã trả" rather than the slip itself; the
  slip opens only from the row `⋮` (wig payroll-run.tsx:235, no link).
- The h2 "Từng người" + search + count + refresh repeat the list chrome of the parent; "Tip" shows "—" for 10 of 11 rows.
- 200 % zoom: "Phiếu lương" cut ("Phiếu lươ"), status pills hidden (C16). Dark: breadcrumb link pink (E2 pink-dark 3).
  **Plan**
- Pattern: PATTERN-DETAIL.
- Changes: header = "Bảng lương tháng 10/2026" + status badge + the run's one primary for its state (e.g. "Chốt bảng lương"
  on a draft, none when paid); summary = KPI row of 4 compact Stat cards (Thực lãnh, Tip, Số người, Ngày trả) instead of a
  dl card; "Chốt lúc" goes into the header meta line; rows table: employee code in its own column, "Phiếu lương" = a "Xem
  phiếu" row link (href) with the slip status as a badge in the "Trạng thái" column.
- Tells removed: middle-dot meta, double back, status buried in a card.
- Baseline findings fixed: page E2 overlap 1, clipped-text 1, font-size 7 (dl 16, card title 18), shadow-gradient 2,
  pressed-missing 1, pink-dark 3, non-radix 20 (28 dark); wig-admin-b payroll-run.tsx:114/115 (search, paging in URL), :235
  (slip via navigate), :365, :454 (refresh swallows errors), :156; payroll-dialogs.tsx:66/87/92/164/293.
- Transitions: 120 ms route fade. Checks: PATTERN-DETAIL checks; zoom200 status column reachable; 4 KPI cards equal height.

### staff/reports-revenue

**Critique**

- The page opens with an AI card "Hỏi trợ lý" (title, sentence, blue "AI đang tắt" notice, textarea, disabled ghost "Hỏi")
  above the filters and KPIs: ~330 px of a switched-off feature before any number (C4 hierarchy, B24); the same card repeats
  on every report.
- Filters: date range as a tinted rose pill + two native selects "Không so sánh" / "Nhóm tự động" (B9) + "Số liệu lúc 02:13"
  - refresh; at 1024 they wrap and the refresh floats alone.
- KPIs: 6 cards in a 3 x 2 grid, each with an ⓘ icon; values 18 px at 1024 (E2) and larger from 1280, while reports-sales uses 32 px and
  customers/cash 18 px at every width (one role, three sizes); dark 1024 hides "Hoàn khi đổi hàng" in the table; and
  card heights differ (the "Hóa đơn" card has a sub-line; B6/C18); at 200 % zoom the 6th card is an orphan on its own row.
- Chart (one series): area under the line; dark: series `#c9647a` stroke + fill = pink (E2 pink-dark, B22, DESIGN 10 "six-slot
  palette must not read pink in dark"); the "Xem dạng bảng" toggle floats far right above the plot; x-axis labels collide at
  200 % text (E2 overlap 1 "text/text").
- Bottom: underline tabs (Chi nhánh / Nhóm và loại / Cách thanh toán; no pressed, gaps 0) over a 1-row table, then a blue bordered
  "Cách tính doanh thu" callout of 4 lines (B12; methodology prose as a box).
- 200 % zoom: table shows "Chi nhánh / Doanh thu / Đã th…" only (C16). Light: chart line burgundy (accent on a non-action, A3
  allows status/selection only; acceptable as chart slot 1 per DESIGN 10). Parent: no.
  **Plan**
- Pattern: PATTERN-REPORT (KPI row, one chart Card, breakdown DataTable).
- Changes: order = header ("Xuất file" primary) → toolbar (date range neutral pill, compare + grouping as kit selects) → KPI
  row (6 Stat cards, 3-up at 1024-1280, 6-up from 1440 only if each ≥ 160 px, else 3-up; one value size = compact `title`) →
  chart Card (flat line, no area fill, "Xem dạng bảng" as an icon toggle in the card header) → segmented tabs + DataTable
  → methodology as a 14 muted paragraph with an ⓘ heading, no box. AI card moves out of the report flow: a "Hỏi trợ lý"
  icon button in the header opens it in a drawer; when AI is off the button is absent (no dead UI).
- Tells removed: blue callout box, disabled ghost button in a dead card, tinted date pill.
- Baseline findings fixed: page E2 font-size 8 at 1024 (card title 18, KPI values 18), shadow-gradient 9 (AI card, 6 KPI cards,
  chart card), hit-target 2 (tab gaps), hover-missing 1 / pressed-missing 4 ("Hỏi", tabs), pink-dark 6 (series `#c9647a`, active
  tab), overlap 1 at text200 (axis labels), non-radix 23 (34 dark); wig-admin-b reports-revenue.tsx:515 (percent via Intl),
  :254 (raw ISO print period), :420 (raw counts); reports-kit.tsx:226/317/344; rbp-ui charts.tsx:97-103 (full SVG re-render
  on pointer move).
- Transitions: 120 ms route fade; no chart draw-in. Checks: PATTERN-REPORT checks; dark 1440 series not pink; text200 axis
  labels thinned (no overlap); zoom200 KPI grid 2-up with no orphan.

### staff/reports-sales

**Critique**

- Same AI card at the top (B24). No chart at all: the report is 2 KPI cards ("Doanh thu", "Số lượng") each half the width,
  32 px values (E2 font-size 3: 32 vs 18 on other reports) and a 3-row table: the KPI cards dominate a page with 3 rows of data.
- Underline tabs (Dịch vụ / Sản phẩm / Combo / Giảm giá / Đơn online) sit ABOVE the KPI cards, so it is unclear whether the
  KPIs belong to the tab (they do); tabs touch each other (E2 hit-target 4 gaps) and have no pressed state (E2 6).
- The date range pill has no compare/grouping (unlike revenue): the toolbar differs from report to report (C18 consistency).
- "Tỷ trọng" values "77%", "12,7%" mixed decimal formats; 200 % zoom: "Số lượng" cut, "Doanh thu" hidden (C16).
- Dark: active tab pink (E2 pink-dark 4); the "Nhóm" column text reads amber in dark 1024 (warm ink). Parent: no.
  **Plan**
- Pattern: PATTERN-REPORT (tabbed: tabs first, then that tab's KPI row + table).
- Changes: segmented tabs directly under the toolbar; per tab a KPI row of compact Stat cards (Doanh thu, Số lượng, plus the
  existing share/discount figures where the tab has them) at a fixed 4-up width (cards not stretched to half the page); one
  bar chart Card "Top 10 theo doanh thu" only if the data exists in the response (no new API; else none); "Tỷ trọng" via
  Intl percent with one decimal everywhere; AI card handled as in reports-revenue.
- Tells removed: oversized half-width KPI cards, dead AI card.
- Baseline findings fixed: page E2 font-size 3 (KPI 32, card title 18), hit-target 4, hover-missing 1 / pressed-missing 6,
  pink-dark 4, shadow-gradient 4 (AI card, KPIs, table), non-radix 22 (32 dark); wig-admin-b reports-sales.tsx:227/498/504/549
  (codes translate="no"); reports-export.tsx:88 ("Đang tạo file..." → "…").
- Transitions: 120 ms route fade. Checks: PATTERN-REPORT checks; KPI value size equal across all 10 reports (one token).

### staff/reports-customers

**Critique**

- Same dead AI card at the top (B24). Underline tabs (Lượt đến / Lịch hẹn / Điểm thưởng / Khách chi nhiều) touching (E2
  hit-target 3 gaps) above the KPIs, as on reports-sales.
- 5 KPI cards wrap 3 + 2 at 1024, 4 + 1 at 1280 (an orphan card on its own row, C18), 5-up at 1440; only the 5th has an ⓘ, and
  its two-line label makes it taller than the others (B6); values 18 px (E2 font-size 7).
- Chart (2 series): "Lượt đến" `#c9647a` (pink in dark: E2 pink-dark incl. `span.ls-chart-swatch`, B22) and "Số khách" blue;
  the legend is two identical square swatches (colour alone, C5 / DESIGN 10 "legend with shapes"); the blue series is all
  zeros and is hidden under the x-axis line; x labels collide at 200 % text (E2 overlap 1).
- Date pill tinted rose (dark: burgundy fill); "Nhóm tự động" native select (B9). Parent: no.
  **Plan**
- Pattern: PATTERN-REPORT (tabbed, as reports-sales).
- Changes: tabs first, then KPI row; 5 KPI cards on a 5-up grid from 1280 and 3-up (+2 spanning) under it, all one height
  (label clamps to 2 lines for every card, ⓘ tooltips on all or none); chart: slot 1 line solid + circle markers, slot 2
  dashed + square markers, legend shows those shapes; a series of all zeros is drawn 1 px above the axis or noted in the
  legend ("0 trong kỳ"); AI card handled as in reports-revenue.
- Tells removed: colour-only legend, orphan KPI card.
- Baseline findings fixed: page E2 font-size 7 (KPI 18, card titles 18), hit-target 3 (tab gaps), hover-missing 1 /
  pressed-missing 5, pink-dark 6 (series + swatch `#c9647a`, active tab), shadow-gradient 7, overlap 1 at text200, non-radix 19
  (29 dark); wig-admin-b reports-customers.tsx: pass; reports-kit.tsx:317 (table page in URL).
- Transitions: 120 ms route fade. Checks: PATTERN-REPORT checks; dark 1440 legend + lines readable without colour.

### staff/reports-staff

**Critique**

- Report is one wide table only (no KPI row, no chart) under the dead AI card and a blue bordered permission callout ("Cột
  doanh số cần quyền…", B12): the pattern differs from the other reports (C18 consistency).
- 9 numeric columns with long two-word headers ("Phút làm thực tế", "Doanh số sản phẩm"): at 1024 the last column header is
  cut to "D", at 1280 "Doanh số sản phẩm" is off the edge, at 200 % zoom only 3 columns show; no scroll sign (C16).
- 15 of 17 rows are all zero ("0 phút", "0 ₫"): the table is a wall of zeros; no sort on columns.
- Dark: some count cells render blue (drill-down links in a non-brand blue, A3/R24) and names warm amber at 1024; primary
  "Xuất file" pink fill. Parent: no.
  **Plan**
- Pattern: PATTERN-REPORT, table-led variant (KPI row of 3 totals from the existing rows: Lượt làm dịch vụ, Phút làm thực tế,
  Doanh số; no chart).
- Changes: permission note becomes one muted line under the toolbar (no box); DataTable with sticky "Nhân viên" column,
  in-place horizontal scroll, sortable numeric columns (`aria-sort`), zero shown as "0" muted (ink only for non-zero), short
  headers ("Lượt", "Khách", "Phút thực tế", "Phút kế hoạch", "Doanh số DV", "Doanh số SP") with the full name in a header
  tooltip; drill-down counts are ink links (F1.3), not blue.
- Tells removed: blue callout, blue links.
- Baseline findings fixed: page E2 font-size 1 (AI card title 18), shadow-gradient 2, hover/pressed-missing 1 ("Hỏi"),
  pink-dark 2, non-radix 19 (27 dark); wig-admin-b reports-staff.tsx: pass; reports-kit.tsx:317/344.
- Transitions: 120 ms route fade. Checks: PATTERN-REPORT checks; 1024 and zoom200 reach the last column by scroll; dark no blue.

### staff/reports-stock

**Critique**

- Seven underline tabs (Bán chạy / Sắp hết / Bán chậm / Hạn dùng / Giá trị tồn / Biến động / Nhập kho) touching (E2 hit-target
  6 gaps) with no pressed state (E2 10); at 200 % zoom the tab row is cut at "Giá trị tồ" with no scroll sign (B10, C16).
- Table-only report under the dead AI card (no KPI row although "Giá trị tồn" and "Sắp hết" are natural KPIs).
- Product names ellipsised "Kem chống nắng phổ rộng SPF50+ PA++++ dành…" (E2 clipped-text 7, C15): the variant that tells two
  rows apart is the cut part; columns hide by width (SKU gone at zoom200, "Còn lại"/"Doanh thu" cut at 1024).
- Pager « ‹ 1 2 › » with no hover/pressed on edge buttons (E2 3); select "20 dòng mỗi trang" (B9).
- Dark: active tab pink (E2 pink-dark 4); primary pink fill. Parent: no.
  **Plan**
- Pattern: PATTERN-REPORT, table-led with tabs.
- Changes: segmented tabs that scroll on narrow widths with the next tab peeking (F2.4/8.5 phone rule applied to the 640 css
  case); a 3-card KPI row computed from the current tab's existing totals where the API returns them (no new API); names wrap
  to 2 lines; SKU sticky first column at zoom200 with in-place scroll; pager per DESIGN 8.8.
- Tells removed: cut tab row, ellipsised variant names.
- Baseline findings fixed: page E2 clipped-text 7, hit-target 6 (tab gaps), hover-missing 3 / pressed-missing 10, pink-dark 4,
  font-size 1, shadow-gradient 2, non-radix 25 (37 dark); wig-admin-b reports-stock.tsx:330 (raw days), :199 (blank branch →
  "—"), :203/:368 (SKU, lot translate="no").
- Transitions: 120 ms route fade. Checks: PATTERN-REPORT checks; clipped-text 0; zoom200 every tab reachable.

### staff/reports-cash

**Critique**

- 5 KPI cards: 3 + 2 at 1024, 4 + 1 orphan at 1280 (C18); the "Chênh lệch các ngày đã chốt" card has a 2-line label + ⓘ, taller
  than its neighbours (B6); values 18 px (E2 font-size 7).
- Daily table has 8 numeric columns: at 1024 "Chênh lệch" is hidden and "Đếm thực tế" cut; at 200 % zoom "Chi" is cut (C16).
  Status "Chưa chốt" (neutral outline) / "Đã chốt" (green outline) with no icon (C5); "+60.000 ₫" sign added by hand.
- The first table has no heading (the tab label stands in) while the second has h2 "Theo loại bút toán": two tables, two
  heading rules on one page; each has its own "Hiển thị" line.
- Dark: active tab pink (E2 pink-dark 4), status pills legible. Parent: no.
  **Plan**
- Pattern: PATTERN-REPORT (tabbed: Theo ngày / Số dư các quỹ / Chênh lệch).
- Changes: KPI grid 5-up from 1280 (3 + 2 spanning below), one height; daily table with sticky "Ngày", in-place scroll, status
  badges icon + word ("Đã chốt" check, "Chưa chốt" clock); signed amounts via Intl `signDisplay` (wig :103), negatives also
  marked with "−" and the word in the cell's accessible name (C5); both tables get an h2 (or neither) and share one style.
- Tells removed: orphan KPI card, unlabeled first table.
- Baseline findings fixed: page E2 font-size 7, hit-target 2 (tab gaps), hover-missing 1 / pressed-missing 4, pink-dark 4,
  shadow-gradient 8 (AI card + 5 KPI + 2 tables), non-radix 28 (38 dark); wig-admin-b reports-cash.tsx:103; format.ts:19
  (`formatDate` by hand).
- Transitions: 120 ms route fade. Checks: PATTERN-REPORT checks; 1024 shows "Chênh lệch" by scroll; status not colour-only.

### staff/reports-pay

**Critique**

- Dead AI card first (B24); underline tabs Tip / Bảng lương / Chi phí nhân sự / Tạm ứng touching (E2 hit-target 3) with no
  pressed state (E2 5).
- 4 KPI cards (Tổng tip, Tip tiền mặt, Tip chuyển khoản, Tip chưa vào kỳ lương): 3 + 1 orphan at 1024 (C18), the 4th taller
  (2-line label + ⓘ, B6); values 18 px (E2 font-size 5). "Tổng tip" equals the sum of the next two: a total shown as a peer.
- Table (Nhân viên / Mã / Tiền mặt / Chuyển khoản / Tổng tip / Đã vào kỳ lương / Còn nợ): "Còn nợ" cut at 1024, "Tổng" cut at
  200 % zoom (C16); zeros "0 ₫" in ink at full weight.
- Dark: active tab pink (E2 pink-dark 4); primary pink fill. Parent: no.
  **Plan**
- Pattern: PATTERN-REPORT (tabbed).
- Changes: KPI row 4-up from 1024 (compact cards fit: 4 x ≥ 160 px), one height; cards ordered total → parts → pending
  ("Tổng tip", "Tip tiền mặt", "Tip chuyển khoản", "Tip chưa vào kỳ lương"), no middle-dot sub-lines; table: sticky "Nhân viên", in-place scroll, zero values muted; employee code column
  "Mã" keeps `translate="no"`.
- Tells removed: orphan KPI card.
- Baseline findings fixed: page E2 font-size 5, hit-target 3, hover-missing 1 / pressed-missing 5, pink-dark 4, shadow-gradient 6,
  non-radix 22 (32 dark); wig-admin-b reports-pay.tsx: pass (shared helpers: reports-b.ts:125 `monthLabel`, format.ts:19).
- Transitions: 120 ms route fade. Checks: PATTERN-REPORT checks; 1024 KPI row one line; "Còn nợ" reachable at 1024 and zoom200.

### staff/reports-profit

**Critique**

- Three bordered callouts on one page: blue "Chỉ là số tạm tính…", amber "2 tháng chỉ nằm một phần…", and a second amber "Một số
  sản phẩm chưa có giá vốn…" between the two tables (B12, C19); in dark they are navy and brown boxes, the only colour on the page.
- "Từng khoản" is a profit statement rendered as a paged DataTable: deductions print "-45.000 ₫" with a hyphen (not a minus),
  "Ghi chú" mostly "—", and a pager line "Hiển thị 1-7 trong 7" under a fixed 7-line statement; the total row "Lãi tạm tính"
  is only bold (no rule above it).
- 3 KPI cards (Lãi tạm tính, Doanh thu, Hàng bán có giá vốn 0,0 %): two with ⓘ, uneven; values 18 px at 1024 (E2 font-size 6).
- "Sản phẩm chưa có giá vốn": names ellipsised (E2 clipped-text 7, C15) while "Số lượng chưa có giá vốn" takes half the width;
  pager edge buttons no hover/pressed (E2 3); current page pink in dark (E2 pink-dark 3).
- 200 % zoom: "Ghi chú" cut; 200 % text: SKU + product only. Parent: no.
  **Plan**
- Pattern: PATTERN-REPORT (KPI row → statement Card → action table).
- Changes: the two notes about scope become one muted line under the KPI row with an ⓘ (no boxes); "Từng khoản" becomes a
  description-list statement inside one Card (label leading, amount trailing tabular, true minus "−" via Intl, a hairline above
  the "Lãi tạm tính" total, note as 12 muted under its line) with no pager; the missing-cost warning becomes the h2 + one
  sentence of the product table, with the row action "Nhập giá vốn" in the row `⋮` (existing route only) or none.
- Tells removed: three callout boxes, paged statement table.
- Baseline findings fixed: page E2 clipped-text 7, font-size 6 (KPI 18, h2 18 x2, card title), hover/pressed-missing 3, pink-dark
  3, shadow-gradient 6, non-radix 30 (42 dark); wig-admin-b reports-profit.tsx:136 (SKU translate="no").
- Transitions: 120 ms route fade. Checks: PATTERN-REPORT checks; no bordered callout on the page; negatives with "−".

### staff/reports-refunds

**Critique**

- The period totals are a middle-dot meta string at the trailing edge, "Hoàn tiền 3.789.600 ₫ · Đổi hàng 1.200.300 ₫ · Khoản
  thu bị đảo 0 ₫" (tell; at 200 % zoom it wraps and the refresh icon drops to its own line) instead of KPI cards.
- h2 "Danh sách" (18 px, E2 font-size 1) says nothing; the date pill sits under it, so the toolbar is below a heading, unlike
  every other report (C18). No AI card here although the other reports have one (inconsistent; plan removes it everywhere).
- 7 columns: "Lý do" cut to "Lý d" at 1024 and ellipsised at 1280-1440 (reasons are the useful part, C15); at 200 % zoom "Mã"
  is cut (C16); the date column is not tabular (wig :197).
- Dark: no pink in the page content besides icons (E2 pink-dark 2); primary "Xuất file" pink fill (shell/F1.4). Parent: no.
  **Plan**
- Pattern: PATTERN-REPORT, table-led (KPI row of 3: Hoàn tiền, Đổi hàng, Khoản thu bị đảo; then the DataTable).
- Changes: totals become 3 Stat cards; "Danh sách" h2 removed; toolbar order as other reports; "Lý do" wraps to 2 lines and the
  table scrolls in place with "Ngày" sticky; "Loại" as a neutral badge with an icon per type (refund / exchange / reversal).
- Tells removed: middle-dot totals line, empty heading.
- Baseline findings fixed: page E2 font-size 1, shadow-gradient 1, pink-dark 2, non-radix 13 (19 dark); wig-admin-b
  reports-refunds.tsx:197 (date column `numeric`).
- Transitions: 120 ms route fade. Checks: PATTERN-REPORT checks; "Lý do" readable at 1024; zoom200 "Mã" reachable.

### staff/reports-reviews

**Critique**

- Scratch data is empty (0 reviews): two half-width KPI cards with 32 px "0" and "0,0%" (E2 font-size: KPI 32 here vs 18 on
  revenue at 1024) dominate an empty page; the "Số đánh giá" card carries a sub-line "Chưa đủ đánh giá" the other lacks (B6).
- Empty state of "Theo người phục vụ" is a centred 16 px sentence in a box with no next step (C33; E2 `p.ls-empty-text` 16).
- Blue bordered privacy callout ("Đánh giá chỉ dùng nội bộ…") under the date pill (B12) + the dead AI card on top (B24).
- "Theo chi nhánh" table: branch name ellipsised "Lucy Spa Đà Nẵng - 04 Nguyễn Q..." (C15, a branch name is data, the cut is
  the layout's), star counts as five "5 sao … 1 sao" columns (fine) but "Trung bình" shows "—"; "Hiển thị 1-1 trong 1" pager
  line under a 1-row table.
- Dark: no page-level pink beyond icons (E2 pink-dark 2). Parent: no.
  **Plan**
- Pattern: PATTERN-REPORT, table-led (KPI row of 2-3 compact cards at the standard width, then two DataTables with h2).
- Changes: KPI cards at the fixed compact width (not half the page), sub-line slot on both or neither; privacy note as one muted
  line (no box); empty states = icon + title + one sentence + next step ("Đổi khoảng ngày") (C33, DESIGN 8.4); branch column
  wraps; the pager line hides when one page.
- Tells removed: oversized empty KPIs, callout box.
- Baseline findings fixed: page E2 font-size 6 (KPI 32 x2, h2 18 x2, empty text 16, card title), shadow-gradient 5 (incl.
  `.ls-table-state`), hover/pressed-missing 1, pink-dark 2, non-radix 21 (29 dark); wig-admin-b reports-reviews.tsx:123.
- Transitions: 120 ms route fade. Checks: PATTERN-REPORT checks; empty state has an action; KPI value one size site-wide.

### staff/audit-log

**Critique**

- "Việc đã làm" cells read "Tài khoản và phân quyền · SESSION_CREATED": a middle-dot string ending in a raw ALL-CAPS event
  code (two tells; the code is system text shown to people), repeated on 15 of 20 rows.
- Two paging mechanisms at once: the pager (« ‹ 1 2 … 5 › », "…" at 16 px, E2 font-size 1) AND a tinted "Tải thêm dòng cũ hơn"
  button under it (A4: a second filled-looking button; FR one pagination model).
- Blue bordered scope callout "Bạn chỉ thấy những dòng…" (B12); no primary action (correct for a read-only log), but the
  search placeholder doubles as the label and lacks "…" (wig :112).
- "Loại dữ liệu" and "Lý do" are "—" on every row (two empty columns); at 1024 "Liên quan đến" is cut and the trailing columns
  hidden; at 200 % zoom "Việc đã làm" is cut mid-code (C16).
- Dark: current page pink (E2 pink-dark 3), date pill burgundy fill; "Tải thêm" pink-tinted. Parent: no.
  **Plan**
- Pattern: PATTERN-LIST (read-only; row opens the event drawer).
- Changes: "Việc đã làm" = the human label only (area as a 12 muted second line, no "·"); the event code moves to the detail
  drawer (with `translate="no"`); one pagination model: the URL-state pager (20/page), "Tải thêm dòng cũ hơn" becomes the
  pager's last-page action only when the server has older rows, as a neutral button; columns that are empty for the whole page
  collapse into the drawer; scope note as one muted line.
- Tells removed: middle-dot + ALL-CAPS code, double paging, callout box.
- Baseline findings fixed: page E2 font-size 1 (pager gap 16), hover/pressed-missing 2 (pager edges), pink-dark 3,
  shadow-gradient 1, non-radix 21 (32 dark); wig-admin-a audit-log.tsx:58/59 (drawer + page in useState), :112 (placeholder),
  :204/:294/:296/:299 (codes translate="no"); i18n/audit.ts:93.
- Transitions: 120 ms route fade; drawer within the 200 ms compact clamp. Checks: PATTERN-LIST checks; no ALL-CAPS text in cells.

### staff/website

**Critique** (default tab "Thư viện ảnh"; the other five tabs were not captured)

- Brand logos are cropped by `object-fit: cover` in landscape tiles ("y Bea", "OHUI", "NA s", "ELADC", "son L"): the library
  hides what the file is (DESIGN 10 media library = square thumbnails, 8 px radius, selection check; logos need `contain`).
- Dark: the black-on-transparent logo files sit on a near-black tile and vanish (6 of the first 7 tiles look empty) (B24).
- Every tile is its own bordered, shadowed card (E2 shadow-gradient 24, one per tile) with a `⋮` overlapping the image corner;
  title 16 px (E2 font-size 24), ellipsised long names (E2 clipped-text 8, C15), meta "6,1 KB · 394 × 116" middle dot (tell);
  the title is a button with no hover/pressed (E2 hover-missing 26).
- Six underline tabs (Thư viện ảnh / Popup / Slider / Mùa lễ / Thông tin tiệm / Trang thông tin) touching (E2 hit-target 5) and
  no pressed state; at 200 % zoom they are cut at "Thông tin tiệ" with no scroll sign (B10, C16); dark active tab pink.
- Grid is 3 columns at 1024, 5 at 1280-1440, 2 at zoom200; 24 per page; the h1 "Nội dung website" + upload primary fit, but the
  description is about images only (it does not describe the other tabs). Parent: no.
  **Plan**
- Pattern: admin extra (DESIGN 10): tabbed hub; this tab = media grid, the other tabs = PATTERN-LIST.
- Changes: tiles = square 1:1 thumbnail on the sunken step with `contain` for images whose aspect ratio is extreme (logos) and
  `cover` otherwise, 8 px radius, no tile border or shadow (one grid surface), name 14/500 wrapping to 2 lines, meta 12 muted
  as two values without "·" ("6,1 KB", "394 × 116"); selection check top-leading, `⋮` icon button below the image (not on it);
  a checkerboard-free neutral tile background that keeps dark logos visible in dark (gray 3 tile, not black); segmented tabs
  that scroll with a peek; the header primary follows the tab (upload on media, "Tạo popup" on popups…), one at a time;
  description per tab or none.
- Tells removed: card-per-tile kit, middle-dot meta, cropped logos.
- Baseline findings fixed: page E2 clipped-text 8, font-size 24 (tile titles 16), shadow-gradient 24, hit-target 5 (tab gaps),
  hover-missing 26, pressed-missing 32, pink-dark 4, non-radix 15 (25 dark); wig-admin-b website-slides.tsx:47,
  website-popups.tsx:41/197, website-seasons.tsx:51, website-pages.tsx:29/124/135 (unpublish without confirm),
  website-shop-info.tsx:175/283/362/421, website-shop-lists.tsx:138/363/364/406/471, website-footer-blocks.tsx:150/238/308/312/394;
  media-library findings belong to wig-admin-b media-library.tsx (shared component); rbp-staff media-library.tsx:601-603.
- Transitions: 120 ms route fade; tab change instant. Checks: PATTERN-LIST checks for the list tabs; visual dark 1440: every
  logo visible; zoom200 all six tabs reachable; E2 clipped-text 0.

### staff/website-page

**Critique** (edit form of an info page; parent: yes, website)

- Double back ("← Quay lại" + breadcrumb "Nội dung website › Sửa trang thông tin") (C40).
- The markdown toolbar is 7 tinted rose filled pills (Tiêu đề, Tiêu đề nhỏ, Đậm, Nghiêng, Danh sách, Danh sách số, Liên kết)
  that wrap to 2 rows, twice (VI and EN): 14 accent-family filled buttons on one form (A3/A4, tell of identical pill kits).
- "Soạn thảo / Xem trước" segmented: active = solid burgundy fill (accent fill on a view switch; E2 contrast 1.16 / 1.09 on the
  active segment = its label measured against its own fill, verify; hit-target gap 0).
- Fields are full pills (D8 says 8 px for fields); textareas 300 px tall for both languages; helper "Mẫu: ## Tiêu đề, ### Tiêu
  đề nhỏ, - mục danh sách, **đậm**…" is raw markdown syntax as help text (copy flag) and both languages stack into a 2,600 px form.
- Section h2s 18 px (E2 font-size 5) inside one bordered card; switch track bordered inside the card (E2 double-border 1, FR).
- Footer "Hủy" (tinted fill) + "Lưu trang" (solid) side by side (B11), below the card, not sticky on a long form.
- 200 % zoom: two field columns squeeze to 90 px wide inputs ("Tiếp nhận và giả") and the slug helper wraps per word (C16).
- Dark: Lưu trang, active segment, switch and breadcrumb pink (E2 pink-dark 4).
  **Plan**
- Pattern: PATTERN-FORM (long form = own page; kept).
- Changes: one column max 720 (two-column field pairs only from 1280 and only for VI/EN twins); a language switch (segmented
  "Tiếng Việt / English") above "Nội dung" so one editor shows at a time; markdown toolbar = a compact icon toolbar (neutral
  icon buttons with tooltips: heading, bold, italic, list, numbered list, link) on the editor's top edge, not filled pills;
  "Soạn thảo / Xem trước" as the kit segmented control (selected = surface pill + ink, DESIGN 8.5); helper = one line
  ("Hỗ trợ tiêu đề, danh sách, in đậm và liên kết") + a "Xem cú pháp" link to a popover (copy flag); textarea grows with content
  from 160 px; sticky footer "Hủy" (neutral) then "Lưu trang" (primary); in-app navigation guarded when dirty (wig :374).
- Tells removed: filled pill toolbar, accent-filled segment, double back.
- Baseline findings fixed: page E2 double-border 1 (switch track), font-size 5 (h2 18, switch label 16), contrast 2 (segment),
  hit-target 2, hover-missing 3 / pressed-missing 6 (segment, switch, breadcrumb), pink-dark 4, shadow-gradient 1, non-radix 15
  (28 dark); wig-admin-b website-page-form.tsx:222 (names), :374 (Cancel/breadcrumb drop edits), :367 (switch hint
  aria-describedby); rbp-staff website-page-form.tsx:99-106 (form reset effect → key).
- Transitions: 120 ms route fade; language switch instant. Checks: PATTERN-FORM checks; one filled button in view; zoom200
  fields full width in one column.

### staff/website-page-new

**Critique** (same component as website-page, empty; parent: yes)

- Same findings as website-page: double back, 14 tinted toolbar pills, accent-filled "Soạn thảo", pill fields, two empty
  300 px textareas (VI and EN) making an empty create form ~2,400 px tall, "Hủy" tinted + "Lưu trang" solid side by side (B11).
- The form card is ~720 px wide at 1280-1440 (correct max width) but the footer buttons sit outside the card at its trailing
  edge, detached from the form.
- Empty state of the editor has no placeholder example; the slug helper says "Trang sẽ ở /vi/..." with a literal "..." (copy
  flag: show the computed address once the slug is typed).
- Dark: switch off-state reads as a grey pill with a white knob (fine); Lưu trang pink fill; breadcrumb pink (E2 pink-dark 3).
  **Plan**
- Pattern: PATTERN-FORM; identical plan to website-page (shared component `website-page-form.tsx`).
- Changes specific to create: textareas start at 160 px; the EN editor hidden behind the language switch; the slug helper
  shows the live address; the primary reads "Tạo trang" (create) vs "Lưu trang" (edit).
- Tells removed: as website-page.
- Baseline findings fixed: page E2 double-border 1, font-size 5, contrast 2, hit-target 2, hover-missing 3 / pressed-missing 6,
  pink-dark 3, shadow-gradient 1, non-radix 17 (28 dark); wig-admin-b website-page-form.tsx:222/367/374.
- Transitions: 120 ms route fade. Checks: PATTERN-FORM checks; empty create form ≤ 1,600 px tall at 1440.

### staff/website-popup-new

**Critique** (parent: yes, website)

- Double back (C40); "Xem trước" sits BELOW the form card, so the preview cannot be seen while typing (10 Form "preview panes in
  the trailing column from 1280"); the empty preview is a bordered box with one centred sentence.
- Date-time fields show US format "10/16/2026 02:23 AM" in a Vietnamese UI (native datetime input; vi expects 16/10/2026 02:23);
  at 200 % zoom the calendar icon overlaps the value ("10/16/2026 (▦") (C16).
- "Chọn ảnh" tinted filled pill, "Hủy" tinted + "Lưu popup" solid side by side (B11); six 18 px h2 sections (E2 font-size 9).
- Helper copy shows developer notation "/{locale}/account/book" and "https://..." (copy flag); "Mùa lễ" select is native (B9).
- Dark: switch off-state grey, breadcrumb pink (E2 pink-dark 3), primary pink fill.
  **Plan**
- Pattern: PATTERN-FORM with preview pane (8 cols form / 4 cols sticky preview from 1280; below at 1024).
- Changes: date-time via the kit date + time fields (dd/mm/yyyy, 24 h, as the rest of the app); "Chọn ảnh" = secondary outline
  (opens the media picker); helper rewritten as a plain example ("Ví dụ: /vi/account/book hoặc https://zalo.me/…") (copy flag);
  preview empty state = the popup frame drawn with placeholder lines, not a box with a sentence; sticky footer "Hủy" (neutral)
  → "Lưu popup"; guard in-app navigation (wig :185).
- Tells removed: tinted secondary fill, preview below the fold, double back.
- Baseline findings fixed: page E2 double-border 1 (switch track), font-size 9, hover/pressed-missing 1/2 (switch, breadcrumb),
  pink-dark 3, shadow-gradient 1, non-radix 16 (26 dark); wig-admin-b website-popup-form.tsx:291 (names), :382 (type="url"),
  :185/:473 (Cancel/breadcrumb unguarded, Cancel via navigate); rbp-staff website-popup-form.tsx:159-166, 167-179.
- Transitions: 120 ms route fade; preview updates without animation. Checks: PATTERN-FORM checks; dates read dd/mm/yyyy at vi.

### staff/website-season-new

**Critique** (parent: yes, website)

- A ~5,000 px create form: 10 theme presets, dates, greetings, 2 + 7 switches with six "Chọn ảnh" tinted pills on the trailing
  edge, a density segmented "Thưa / Vừa / Dày" (accent-filled active, E2 contrast 1.16/1.09), then the preview, then the footer.
- Theme presets are 10 gradient tiles with holiday art (allowed: the seasonal layer), but the selected tile is only a 1 px
  ring + tint (selection by border alone, C5/C50 wants a check icon).
- Preview (a full scaled customer home) sits below the form with two accent-filled segmented controls side by side ("Máy tính /
  Điện thoại" and "Nền sáng / Nền tối"): two filled controls in one row (A4/B11 spirit); "Nền tối" previews dark mode, fine.
- 13 section/switch labels at 18/16 px (E2 font-size 13); switch tracks bordered inside the card (E2 double-border 5); 15 switches
  without hover/pressed (E2 hover-missing 15, pressed-missing 20); segments touching (E2 hit-target 4).
- 200 % zoom: greeting fields 90 px wide showing "Chúc mừng năm" / "Happy Lunar Ne" (C16); the info box about the zodiac in the
  footer art is a blue bordered callout (B12).
- Dark: switches pink border/fill (E2 pink-dark 4); preset tiles stay saturated (fine, holiday art).
  **Plan**
- Pattern: PATTERN-FORM with preview pane, long form = own page (kept), grouped into 4 steps on one page with an in-page index
  (Sự kiện & trang trí · Lịch & lời chúc · Áp dụng · Hiệu ứng) — anchors, not a wizard (no new flow).
- Changes: preview sticky in the trailing 4 cols from 1280 (scaled, device + light/dark as ONE neutral segmented each, selected
  = surface pill, not accent fill); preset tiles get a check icon + "Đã chọn" label on selection; each decoration row = switch +
  its label + a neutral "Chọn ảnh" icon button with the chosen file name, so six tinted pills disappear; zodiac note as one
  muted line under the dates; sticky footer "Hủy" → "Lưu mùa lễ".
- Tells removed: accent-filled segmented controls, tinted pill column, callout box.
- Baseline findings fixed: page E2 double-border 5, font-size 13, contrast 1, hit-target 4, hover-missing 15, pressed-missing 20,
  pink-dark 4, shadow-gradient 1, non-radix 16 (27 dark); wig-admin-b website-season-form.tsx:341/416/430 (names), :418/:432
  (placeholders), :547/:613 (navigate → ButtonLink), :601-602/:629/:652 (load errors shown as "none"); rbp-staff
  website-season-form.tsx:144-151.
- Transitions: 120 ms route fade; preview swaps instantly. Checks: PATTERN-FORM checks; preview visible beside the form at
  1280/1440; selection never by border alone.

### staff/seo-drafts

**Critique** (scratch list is empty; parent: no)

- Empty state is a bordered box with one 16 px sentence that quotes the header button ("Bấm “Tạo bản nháp” để bắt đầu") instead
  of offering the action; no icon (C33 partial; E2 font-size 2 incl. `p.ls-empty-text` 16, shadow on `.ls-table-state`).
- A 4-line description under the h1, then an h2 "Danh sách bản nháp" (18 px) that names the list the h1 already implies.
- Toolbar: two tinted facet pills (Trạng thái, Loại) and a lone "0" count + refresh at the far trailing edge.
- Primary "Tạo bản nháp" with a sparkle icon (AI tell when it is the only icon of its kind; keep only if the icon set has it);
  whether AI is off (reports say "AI đang tắt") the primary still shows as enabled (no state hint).
- Dark: primary pink, facet pills burgundy fill. Page title "Mô tả tìm kiếm và tiếng Anh" mixes two tasks (copy flag).
  **Plan**
- Pattern: PATTERN-LIST (drafts list; draft opens in a drawer).
- Changes: empty state per DESIGN 8.4 (icon + "Chưa có bản nháp" + one sentence + the create action; header primary hidden while
  empty); h2 removed; description one sentence; facet pills neutral; when AI is off the primary is disabled with the hint "Bật
  trong Cài đặt AI" as a link (status near the action, H11).
- Tells removed: quoted-button empty text, sparkle-only AI marker (if not in the icon set).
- Baseline findings fixed: page E2 font-size 2, shadow-gradient 1, pink-dark 2, non-radix 7 (13 dark); wig-admin-a ai-seo.tsx:114
  (drawer id not in URL), :171/:292 (formatVnd), :199 (bare count), :440/:644 (names), :455 (editable drawer without dirty
  guard), :541 (load error without retry), :625 (rewrite dialog no `dirty`); rbp-staff ai-seo.tsx:116-120, :392-396 (polling
  deps), :386-390 (mirror effect), :404-406 (parallel awaits).
- Transitions: 120 ms route fade; drawer within 200 ms. Checks: PATTERN-LIST checks; empty state has one action, no box shadow.

### staff/ai-settings

**Critique** (parent: no; settings form)

- Three stacked cards (Kết nối, Chi phí tháng này, the settings form) each with boxes inside: an amber bordered warning inside
  the connection card and a blue bordered info inside the cost card (B12/C19, FR nothing bordered inside a card; E2 double-border
  8 incl. switch tracks).
- Connection card header holds a status pill "Máy chủ chưa có khóa" + a tinted "Kiểm tra kết nối" button: the card's action is
  a second filled-looking button on a page whose primary is "Lưu cài đặt" (A4).
- Cost card: description list values 16 px (E2 font-size 28 incl. card titles 18) with "Chưa có tỷ giá / 2.000.000 đ" composite
  values; 2-col dl puts "Đã dùng" and "Đang giữ…" far apart at 1440.
- The settings form spans the full content width at 1280-1440 (two money fields per row ~550 px wide each), not max 720.
- 7 feature switches with no hover/pressed (E2 10/10); all off, the dependent sections (chat, models, budgets) stay fully
  editable with no "turned off" state.
- Footer "Hoàn tác" (tinted) + "Lưu cài đặt" (disabled, washed pink) side by side, not sticky on a ~2,400 px form.
- Dark: warning/info boxes brown/navy; switch track pink (E2 pink-dark 3).
  **Plan**
- Pattern: PATTERN-FORM (settings) with a summary column: from 1280 the form (8 cols, max 720) leads and a 4-col trailing
  column holds "Kết nối" (status badge icon + word, "Kiểm tra kết nối" as secondary outline) and "Chi phí tháng này" (compact
  Stat list); under 1280 they stack above the form.
- Changes: warning and info become one inline status line each (icon + sentence, no box); dl values 14, composite values split
  into "Đã dùng" / "Hạn mức" rows; sections that depend on a feature switch show a muted "Đang tắt" note and stay editable (no
  logic change); sticky footer "Hoàn tác" (neutral) → "Lưu cài đặt" (primary, disabled until dirty).
- Tells removed: boxes inside cards, tinted card action, full-width form.
- Baseline findings fixed: page E2 double-border 8, font-size 28, hover/pressed-missing 10, pink-dark 3, shadow-gradient 3,
  non-radix 21 (32 dark); wig-admin-a ai-settings.tsx:333 (names, autocomplete), :373/:397 (MoneyInput separator),
  i18n/ai-settings.ts:116 (quotes); rbp-staff ai-settings.tsx:89-93 (polling deps), :85-87 (mirror effect).
- Transitions: 120 ms route fade. Checks: PATTERN-FORM checks; no bordered box inside a card; one filled button in view.

### staff/season-preview

**Critique** (staff-only route `/season-preview`, renders the customer home through `SeasonPreviewStage`; parent: none shown)

- The page is the bare customer home with no staff chrome, no title and no visible control or label saying which season is
  previewed (the captured state shows the default site with no decoration): a staff member cannot tell this is a preview (C40
  no way back, C41 no title).
- Customer-site defects inherited (judged in the customer plans, listed here for the preview only): burgundy brand band (B8) that
  reads pink-red in dark (B22), "→" on secondary pills (A4 tell), Title Case CMS headline "Thư Giãn Tận Tâm – Nâng Tầm Nhan Sắc"
  (data, flag only), theme icon in the header (A1).
- 200 % text: the service price list breaks per letter in the "Nail" column ("Đ i n h đ á / c h a r m") and "Gội cặp (dầu cao
  cấp)" stacks word by word (C16, B24); E2 overlap 12 (brand-band link under the pause control, nav links, footer links), hit-
  target 11 (35 px phone link, slider dots touching).
- Pressed state missing on 84 elements (customer kit, F1.4/F2.1 fix).
  **Plan**
- Pattern: staff preview frame (admin extra): a 48 px compact bar above the stage (HeaderBar compact: wordmark, "Xem trước mùa lễ:
  <tên mùa>", device + light/dark segmented, "Đóng" icon button back to the season), then the stage at full width; the stage
  itself follows the customer home plan (R13-R16) unchanged.
- Changes: preview bar is the only staff addition; price-list grid gets `minmax(0, 1fr)` columns with name wrapping by word at
  200 % text (customer plan item, verified here); brand band per F3.5 (light band, ink logos).
- Tells removed: as the customer home plan ("→", burgundy band).
- Baseline findings fixed: page E2 overlap 12, hit-target 11, hover-missing 12, pressed-missing 84, clipped-text 2 (customer
  side); wig-customer season-preview-stage.tsx: pass; wig-admin-b season-preview-panel.tsx, season-select.tsx: pass.
- Transitions: customer home moments only inside the stage; the staff bar has none. Checks: text200 price names wrap by word;
  the bar names the season at 1024-1440; dark band not pink.

## Not available

- staff/payroll-slip: skipped by the capture ("no record in payroll" for a `/workforce/payroll/slip/` link); no sheet.
  Code findings to carry when it is captured: wig-admin-b payroll-slip.tsx:84 ("LUCY SPA" title lacks translate="no"),
  lib/workforce/payroll.ts:26 (`monthLabel`). Pattern when planned: PATTERN-DETAIL (print-friendly slip, one Card).
- staff/website-popup: skipped ("no record in website?tab=popups"); the create form (website-popup-new) shares
  `website-popup-form.tsx`, so its plan applies; list-side findings wig-admin-b website-popups.tsx:41/197.
- staff/website-season: skipped ("no record in website?tab=seasons"); the create form (website-season-new) shares
  `website-season-form.tsx`, so its plan applies; list-side finding wig-admin-b website-seasons.tsx:51.
- staff/website: only the default "Thư viện ảnh" tab was captured; Popup, Slider, Mùa lễ, Thông tin tiệm and Trang thông tin
  tabs were not seen (their wig findings are listed in the website block).

## Cross-page patterns

1. Dead AI card on every report except refunds: "Hỏi trợ lý" with a disabled ghost "Hỏi", a blue "AI đang tắt" box and a
   textarea sits above the data (~330 px). Plan: one header icon button opening a drawer, absent when AI is off.
2. Underline tabs everywhere (pay, supplier-imports, reports x6, website): touching hit targets (gap 0), no pressed state, pink
   active tab in dark, cut at 200 % zoom with no scroll sign. One kit segmented control (8.5) fixes ~40 E2 items.
3. Boxes on boxes: blue info / amber warning bordered callouts (supplier-imports-all, reports-revenue/staff/profit/reviews,
   audit-log, ai-settings, season-new) and boxes inside cards. Plan: inline status line (icon + sentence), never a box; FR1.
4. Two filled buttons side by side: tinted secondary + solid primary (import header, form footers "Hủy"/"Lưu", "Chọn tất cả /
   Bỏ chọn", "Kiểm tra kết nối", markdown toolbar pills, accent-filled segmented controls). F1.4 + one neutral secondary rule.
5. Tables that hide their decisive column: ellipsised product/branch names (C15), status/amount columns cut at 1024 and 200 %
   zoom with no in-place scroll; plus colour-only status pills (no icon) and middle-dot meta strings ("Tên · NV0004",
   "Hoàn tiền … · Đổi hàng …", "Khu vực · EVENT_CODE", "6,1 KB · 394 × 116"). DataTable F2.6 + badge icon + split meta.
6. KPI cards: value size differs by report and width (18 px on customers/cash, 18 at 1024 on revenue, 32 on sales/reviews), heights differ (ⓘ and sub-lines on some cards), orphan last card at
   1024/1280 (5 or 4 cards on a 3- or 4-col grid). One Stat token + fixed grid per count.
7. Charts: slot 1 `#c9647a` is pink in dark (series + swatch), legends are colour squares only; area fill under single lines.
8. Dark mode in general: warm rose-white ink `#f6ebec` reads amber/peach in table cells at 1024 (pay, supplier-sources,
   reports-sales/staff), and some drill-down counts are blue (reports-staff): both go with F1.1/F1.3 neutral tokens.
9. Forms: pill-shaped fields, 18 px section titles, footer outside the card and not sticky, US date-time format in vi, preview
   panes below long forms, in-app navigation unguarded (kit `useUnsavedChangesGuard`, wig kit note).
