# frontend-design: POS / counter critique (Step 1) + page plan (Step 2), phase s10base

Scope: staff shell + pos, pos-invoice, walk-in, booking-board, reassignment, cash, product-orders, product-order-detail,
online-orders, online-order-detail, product-returns, product-return-detail, product-return-new, inventory-count-detail.
Method: sheets `staff-<page>-light.png` (columns 1024 / 1280 / 1440 / 200 % zoom (640 css) / 200 % text (1280)) and
`-dark.png` (1024 / 1280 / 1440) opened for every page; full images opened for pos light-1440, zoom200-1280, text200-1280 and
customer-home sheet for the DNA comparison. E2 counts below are light-1440 unless a mode is named (dark non-radix in brackets).
E2 `contrast 1:1 white on white` on the current `.ls-nav-label` (every page) is almost certainly a pill-background measurement
artefact (the label sits on the burgundy pill): verify, likely false positive, not planned as a defect.
Every staff page inherits the shell findings (block "staff/SHELL"); page blocks list only what is page-specific.

### staff/SHELL

**Critique**

- DNA broken against the customer site (D2/D4, B24), side by side with customer-home: staff wordmark is a serif (Fraunces) in
  wide tracking, page titles are Fraunces, body is Nunito Sans; customer uses Be Vietnam Pro for wordmark, headings and body.
  Canvas is rose-cream with a gradient (E2 shadow-gradient on `div.ls-shell` on every page; D7 forbids gradients), customer
  canvas is #f5f5f7/#fff bands. Fields are full pills (customer fields 8 px, D8). Same brand, two families.
- Top bar: no page context at the leading edge (8.5 wants breadcrumb/page context); theme switch = three icon buttons
  (sun / moon / clock) with the selected one a solid burgundy circle (A1 removes it; E2 hit-target gap 0 between them);
  "English" spelled out where customer shows "EN"; bell badge "36" solid burgundy (accent as a count decoration, A3).
- Signed-in name (C74): visible at 1024-1440 and at 200 % text, but at 200 % zoom (640 css) the bar shows only the "NL" avatar.
- Sidebar: group labels in tracked ALL CAPS burgundy (VẬN HÀNH, THANH TOÁN, BÁO CÁO, NHÂN SỰ, DANH MỤC, QUẢN TRỊ) with chevrons
  (tell; E2 brand-text on `.ls-nav-heading`, A3 burgundy on non-interactive labels). Current item = solid burgundy pill (kept
  by 8.5). At 200 % text the 264 px sidebar breaks labels per syllable ("Hóa / đơn", "Thu / gọn / thanh / bên") and icons stay
  12 px (they do not scale with text); at 200 % zoom the rail shows ~25 unlabeled icons with no group separation.
- "← Quay lại" text link above the h1 on EVERY staff page, top-level ones included (B7/C40), and next to a breadcrumb on detail
  pages (two back affordances). It is shell/PageHeader-level, so it is fixed once.
- Every h1 carries a long subtitle "Lucy Spa Đà Nẵng - 04 Nguyễn Quang Bích: <purpose>" (branch name is data; the purpose
  sentence is copy to shorten; flag only).
- Dark (all pages): wordmark pink `#e08a9a` (E2 pink-dark 5-8 per page), current sidebar pill pink fill, primary buttons pink
  fill with dark text, code links pink, pagination current pink (B22).
  **Plan**
- Pattern: compact shell = kit `HeaderBar` (F2.9, compact density) + sidebar on the `#f5f5f7` sunken canvas (dark #000).
- Changes: wordmark = the customer wordmark component at compact size (Be Vietnam Pro 600, same tracking as customer); page
  titles and body Be Vietnam Pro via `data-ui="v2"` (F1.1); remove the gradient and rose tokens from `staff.css`; leading edge
  = wordmark + page context (current group › page) ; trailing = bell (count as a neutral badge), "EN/VI", user name + menu.
  Theme switch removed (A1, F1.2). User name never hidden: under 1024 css (200 % zoom) it moves into the top of the rail flyout
  and the avatar menu header, and the top bar keeps first name ("Lucy") at minimum (C74).
- Sidebar group labels: sentence case, 12/600 `--ls-text-muted`, no tracking, no chevron when the group is not collapsible;
  collapsible groups keep a chevron icon button with `aria-expanded`. Hover gray 3 (F1.6), current solid accent (kept).
- Sidebar at 200 % text: width in `rem` (min(20rem, 30vw)), labels wrap by word not syllable (no `word-break`), icons sized in
  `em`; at 200 % zoom the rail gets group separators + tooltips on hover AND focus.
- PageBack (F2.11) replaces "← Quay lại": top-level pages render none; detail pages render the breadcrumb only (parent link),
  no second back control.
- Tells removed: ALL-CAPS group labels, serif display face on a work screen, theme switch, accent count badge.
- Baseline findings fixed (all staff pages): shadow-gradient (5-19/page), pink-dark (5-8/page), brand-text zoom200 6,
  hit-target theme-gap, non-radix colours (old tokens), skip-link font-size 16 (F1.7); rbp-staff shell.tsx:34,53 memo;
  link.tsx:22-24 forced prefetch (24 row links per board page).
- Transitions: 120 ms route fade only (F3.4); no motion on the bar or sidebar except the 120 ms collapse.
- Checks: E2 shadow-gradient 0, brand-text 0, pink-dark 0, non-radix 0 on every staff page; visual: customer home, pos and
  employees side by side at 1440 light + dark (wordmark, header, button, input, badge, table header one family); zoom200 shows
  the staff name; text200 sidebar labels break by word only.

### staff/pos

**Critique**

- (carried from fd-critique) Still direction C: rose canvas, old tokens, serif title; ALL-CAPS sidebar labels; "← Quay lại" on a
  top-level page (B7, C40); two filled actions side by side, "+ Bán combo" (tinted fill) and "+ Bán sản phẩm" (solid) (B11,
  A4, C4); three-icon theme switch (A1); status badges = coloured outline pill + word, no icon (C5, 10 "icon + word").
- It is a list page, not the counter pattern of DESIGN 10: no two panes from 1024, no invoice pane, no pinned totals, no
  "Thanh toán" primary in reach; the cashier must leave the board for /pos/[id] for every invoice.
- Keyboard first fails: no `/` shortcut to focus "Tìm mã hoặc khách" (wig pos.tsx:292), no shortcut to start a sale; Escape
  closes the kit dialogs (pass). No motion on typing or totals (pass, wig Animation clean).
- Targets: invoice-code links are 19 px high (E2 hit-target 19, zoom200 30); row ⋮ fine.
- Toolbar: three full pills (search, date, native select "Mọi trạng thái" B9) then a free-floating helper sentence "7 ngày gần
  nhất, tính đến ngày đã chọn." at the trailing edge plus a bare refresh icon; the "Lượt khách chờ lập hóa đơn" empty section is
  only a heading + a sentence (C33: no next step).
- 200 % zoom (640 css): the amount column (the figure that matters) is cut at the card edge with no scroll affordance; 200 % text:
  status and total both off the edge; staff name hidden at zoom200 (C74). Dark: "Bán sản phẩm" pink fill, codes pink (B22).
  **Plan**
- Pattern: counter (DESIGN 10 "invoice board"): two panes from 1024. Left (8 cols): search pill (`/`), date, status chips, the
  waiting-visits lane, recent invoices table (code, time, customer, status, total). Right (4 cols, sticky): the selected
  invoice summary (lines, totals pinned to the pane bottom in `price` type, "Thanh toán" primary, "Mở hóa đơn" secondary
  link to /pos/[id]). Below 1024: list only, row opens the page. **Owner decision** (structural change; pending Owner approval).
- Changes: header actions = one primary "Bán sản phẩm", "Bán combo" secondary outline (or both in one "Bán mới" menu if the Owner
  prefers; pending). Keyboard: `/` search, Enter on a focused row selects it into the right pane, Escape clears the selection
  / closes the top layer, arrows move rows. Status filter = chips (F2.4), not a native select. Helper sentence moves under the date
  as field help. Empty waiting lane: icon + "Chưa có lượt khách nào chờ lập hóa đơn" + action "Tiếp nhận khách" (walk-in).
  Status badges icon + word (F1.8). Code cell = whole-row link target ≥40 px (row is the link; code keeps `translate="no"`, wig :191).
- Tells removed: two filled buttons, "← Quay lại", ALL-CAPS labels (shell), word-only status.
- Baseline findings fixed: E2 hit-target 19, pressed-missing 31, hover-missing 4, font-size 4, card-heights text200 1, pink-dark
  6, shadow-gradient 5, non-radix 25 (40 dark); wig pos.tsx:53 (filters to URL), :258 (row = Link), :292 (`/`), :191, :124;
  rbp pos.tsx:66-68, :88-92, :133-264 memo, :34-35 dynamic import of the sale dialogs, pos.ts:50 cached formatter.
- Transitions: 120 ms route fade only; the right pane swaps content with no animation.
- Checks: E2 hit-target 0 (fine pointer 40), secondary-filled 0, pink-dark 0, pressed/hover-missing 0; visual 1024/1280/1440
  light + dark: two panes, totals pinned, one filled button; zoom200 table scrolls inside its container with a visible edge;
  keyboard script: `/` focuses search, Enter selects, Escape clears.

### staff/pos-invoice

**Critique**

- Not the counter pattern: seven full-width cards stacked in one column at 1024-1440 (Thanh toán, Đang chờ khách chuyển khoản,
  Sản phẩm, Đơn đặt trước, Ưu đãi theo từng bên, Mã ưu đãi, Người thanh toán), content ~760 px wide at 1440 with the right
  half of the canvas empty. Totals sit mid-page inside "Sản phẩm", not pinned; payment state is at the top, far from the lines.
- No "Thanh toán" primary: the filled button is "+ Thu tiền mặt"; the PayOS card has three tinted pills in a row ("Mở trang
  thanh toán", "Kiểm tra lại", "Hủy mã QR") (A4/B11: a third, tinted, button variant); "Hủy mã QR" cancels at once (wig
  pos-payments.tsx:348).
- Two back affordances: "← Quay lại" + breadcrumb "Hóa đơn › INV-…" (B7). Middle-dot meta subtitle "Bán sản phẩm tại quầy ·
  Lucy Spa Đà Nẵng · 04 Nguyễn Quang Bích" (tell). Status shown twice: badge "Chờ thanh toán" + a blue bordered info notice
  "Hóa đơn đang chờ thanh toán." (duplicate, nested box B12).
- Tables inside cards (FR1 "nothing bordered inside a card"); at 1024 light/dark the payment table ("Tiền thối") and product table
  ("Đã giữ hàn…") are cut at the card edge; product names ellipsised "Mặt nạ ngủ cấp ẩm (đặt trước) · 8…" (E2 clipped-text 4, C15);
  "Chờ thanh toán" badge repeated on every pre-order line; blue "Khuyến mại" / orange "Đặt trước" pills under names (badge noise).
- QR appears with no reserved box (wig :388 layout shift); 1 s countdown announced every tick (wig :381).
- Dark: "Thu tiền mặt" pink fill, current nav pink, wordmark pink (B22). 12 px DL labels (E2 font-size 25, B1).
  **Plan**
- Pattern: counter, two panes from 1024. Left (8): lines (products/services table with seller, qty, price), pre-order lines,
  offers per side, voucher. Right (4, sticky full height): status badge, payer, totals block pinned to the pane bottom in `price`
  type (Tạm tính, Ưu đãi, Tổng tiền, Đã thu, Còn phải thu), then the single primary "Thanh toán" which opens the payment dialog
  (cash / PayOS / transfer inside it; "Thu tiền mặt" becomes a method, not a page button). PayOS pending state renders inside the
  right pane: reserved 240 x 240 QR box, countdown outside the live region, "Kiểm tra lại" secondary outline, "Hủy mã QR"
  destructive outline behind a ConfirmDialog, "Mở trang thanh toán" a menu item.
- Changes: one back = breadcrumb only; subtitle without middle dots ("Bán tại quầy, Lucy Spa Đà Nẵng"); drop the info notice
  (badge carries status, icon + word); line-status badges only where a line differs from the invoice; names wrap to 2 lines.
  Remove-line, clear-combo, remove-voucher get Undo toasts or confirms (wig pos-products.tsx:210, pos-invoice.tsx:335,
  pos-sections.tsx:270). Payment result shows inline in the right pane first, toast second (H11; wig :130 aria-live).
- Tells removed: middle-dot meta, tinted button row, stacked identical cards, duplicate status notice.
- Baseline findings fixed: E2 clipped-text 4, font-size 25, hit-target 9, pressed-missing 22, hover-missing 4, shadow-gradient 11,
  pink-dark 6, non-radix 26 (41); wig pos-invoice.tsx:130, :335; pos-payments.tsx:348, :381, :383, :388, :391, :195; pos-sections
  :167/:169/:202; rbp pos-invoice.tsx:100-776 (split state per pane), :129-136, :589-590 parallel fetch, pos-dialogs :487 prefetch.
- Transitions: 120 ms route fade only; totals update with no motion (tabular nums).
- Checks: E2 clipped-text 0, secondary-filled 0, pink-dark 0; visual 1024/1280/1440 light + dark: two panes, totals visible
  without scrolling, exactly one filled button; no layout shift when the QR appears (CLS probe); Escape closes the payment dialog.

### staff/walk-in

**Critique**

- Empty form: a "Khách" card with three tinted pills ("Tìm thành viên", "Thêm khách lẻ", disabled "Thêm trẻ em") (A4 third
  variant), two instruction sentences as body text, and the primary "Tiếp nhận khách" outside the card at the trailing edge,
  shown disabled as a faded pink pill (dark: pink) with the reason only in a sentence elsewhere (wig :438 disabled on validity).
- "Giá chỉ để tham khảo; không phải hóa đơn." sits beside the primary as a footer caption (fine copy, wrong place).
- Card is ~560 px at 1440 with no summary side; once people are added, sections are titled only "Khách" / "Trẻ em" (wig :300),
  h3 directly under h1 (wig :182); remove buttons share one aria-label (wig :308).
- "← Quay lại" on a top-level page (B7). Dark: disabled primary pink (B22).
  **Plan**
- Pattern: form page (DESIGN 10), one column max 720 plus, from 1280, a 4-col summary aside (people, services, est. price,
  est. duration) that stays visible; footer actions inside the form: "Hủy" then primary "Tiếp nhận khách", sticky.
- Changes: the three add actions become secondary outline buttons in the card header ("Tìm thành viên" first, "Thêm khách lẻ",
  "Thêm trẻ em"; the last disabled with a tooltip + inline reason "Cần một người lớn đi kèm"). Primary stays enabled; on submit
  missing pieces show inline on the field and focus moves (wig :129, :438). Guest sections numbered by name ("Khách 2: Lan"),
  remove buttons named per person; branch change asks before discarding (wig :253). Empty state: icon + "Chưa có khách nào" +
  the add actions.
- Tells removed: tinted pill row, primary floating outside the form.
- Baseline findings fixed: E2 hit-target 7, hover-missing 6, pressed-missing 21, font-size 3, pink-dark 5, shadow-gradient 5,
  non-radix 13 (26); wig walk-in.tsx:182, :300, :308, :309, :253, :129, :438, :379, :405; walk-in-lookup :96, :72, :44; rbp
  walk-in.tsx:224/365-380 memo, :64-66, :69-71.
- Transitions: 120 ms route fade only.
- Checks: E2 secondary-filled 0, hover/pressed-missing 0; visual 1280/1440 light + dark with 0 and 3 guests; keyboard: Enter in
  the member lookup finds, Escape closes it; axe heading-order pass.

### staff/booking-board

**Critique**

- Four stacked sections (Lịch hẹn, Lượt khách đang mở, Khách đang chờ nhân viên, Hàng chờ theo nhân viên): two DataTables and two
  heading-plus-sentence empties; DESIGN 10 asks for a time grid with hairlines and appointment blocks. Each table repeats
  "Hiển thị 1-1 trong 1" (noise for 1 row).
- Middle-dot meta "Ngày 16/10/2026 · cập nhật lúc 01:38" and "Gội thường · bản thân · Lý Ngọc Yến" (tells); the clock lives in
  the toolbar role=status slot and is re-announced every 30 s (wig :272).
- Status pills word-only ("Đã hủy", "Đang làm", "Quá giờ dự kiến") (C5); two pills side by side in one cell.
- At 1024 the staff column is dropped; at 200 % text "Hoàng Thị…" and "Liệu trình trị liệu cổ v…" clip (E2 clipped-text 1, C15).
- Empty sections have no next step (C33). "← Quay lại" on a top-level page. Dark: links pink.
  **Plan**
- Pattern: board. Target = DESIGN 10 time grid (staff rows x time columns, hairlines on #f5f5f7, 8 px blocks, 4 px accent bar for
  selected, status icon + word, keyboard/button alternative to drag). **Scope decision for the Owner**: a grid is new UI, not a
  restyle; Step 2 proposes it as an optional sub-step; the minimum restyle keeps the four sections.
- Minimum restyle: one section per "lane" with a count in the "Hiển thị" line only when > 20 rows; empties = icon + one sentence +
  action ("Tiếp nhận khách" for the waiting lane). Clock moves out of the live region into the header subtitle ("Cập nhật 01:38");
  only real board changes are announced. Service column wraps (2 lines) instead of ellipsis; lists joined with Intl.ListFormat.
- Tells removed: middle-dot meta strings, word-only status.
- Baseline findings fixed: E2 clipped-text 1 (text200), font-size 6, hit-target 7, pressed-missing 19, hover-missing 4,
  shadow-gradient 6, pink-dark 5, non-radix 24 (37); wig booking-board.tsx:272, :301, :99 (pause poll while a menu is open), :66,
  :115; sections :66, :75, :103, :566; dialogs :192, :295; rbp booking-board.tsx:248/303-345, booking-board.ts:39 cached formatter.
- Transitions: 120 ms route fade only; refresh swaps rows with no animation.
- Checks: E2 clipped-text 0 at text200; visual 1024/1440 light + dark with 1 and 20 bookings; screen-reader log shows no clock
  announcement over 2 minutes.

### staff/reassignment

**Critique**

- Long title with "&" ("Xung đột nghỉ phép & đổi kỹ thuật viên", C41) and a two-line explanatory subtitle.
- Toolbar of native controls: branch `<select>` truncated "Lucy Spa Đà Nẵng - 04 Nguyen Quan" (C15, B9), two separate date
  inputs with "dd/mm/yyyy" placeholders, "Chỉ hiện xung đột nghỉ phép" as a native select; wraps to two rows at 1024 (light).
- Result line shows raw ISO "2026-10-16 – 2026-11-15" (wig :274) in a VI UI.
- Empty state is a bordered box with one centred sentence, no icon, no next step (C33, B12 box on canvas).
- "← Quay lại" on a top-level page. Dark: native select chevrons fine, nav pink.
  **Plan**
- Pattern: list page (toolbar + one DataTable), no header primary (the action is per row: "Đổi kỹ thuật viên" in the row ⋮ and
  in the inspect drawer).
- Changes: title "Đổi kỹ thuật viên" (sentence case; the conflict filter is a chip "Chỉ xung đột nghỉ phép"); branch = kit
  Select with the branch short name; one date-range control (kit date-range picker) showing "16/10 – 15/11/2026" (Intl).
  Empty: icon + "Không có dịch vụ nào bị ảnh hưởng trong khoảng này" + "Đổi khoảng ngày" action. Remove the CursorPagination
  "load more" under a paged DataTable (wig :349). Failed reassign keeps the dialog open with its input (wig :169).
- Tells removed: "&" title, boxed empty sentence.
- Baseline findings fixed: E2 font-size 3, hit-target 7, pressed-missing 19, hover-missing 4, shadow-gradient 5, pink-dark 5,
  non-radix 12 (26); wig reassignment.tsx:42 (URL state), :274, :169, :255, :117, :349; dialog :74; rbp reassignment.tsx:62-64.
- Transitions: 120 ms route fade only.
- Checks: visual 1024/1440 light + dark empty and with rows: toolbar one row at 1024; no ISO dates; E2 hit-target 0.

### staff/cash

**Critique**

- Two filled-looking actions: header primary "Ghi sổ quỹ" (solid) and "Chuyển quỹ" (tinted) sitting in the toolbar result line
  (A4/B11; wig cash-book :112 totals in the count slot).
- "Tình hình quỹ" card: native fund `<select>` in the card header (B9), DL label above value, a warning pill that wraps a full
  sentence "1 lần, mỗi lần lệch từ 50.000 đ trở lên" (8.7: badges never wrap), no icon (C5).
- The summary card sits above underline tabs (Sổ quỹ / Chốt ngày / Đối chiếu): hierarchy unclear (does it belong to all tabs?);
  tabs are underline style where 8.5 asks for the segmented pill.
- Filters: two tinted filter pills + two loose date inputs that wrap onto a second row at 1024 and 1440; refresh icon floating.
- Table: signed amounts with hand-written +/− (wig :266), ⋮ only on some rows (an empty actions column elsewhere), "Người ghi"
  column dropped at 1024; "« »" first/last buttons beside page numbers (8.8 has prev/next only).
- Dark: "Ghi sổ quỹ" pink fill, pagination current pink (B22).
  **Plan**
- Pattern: list page with a summary strip. Tabs (segmented) directly under the PageHeader; the fund summary becomes the first
  row of the "Sổ quỹ" tab as a Stat row (Số dư, Số dư đầu kỳ, Đã chốt đến, Sổ bắt đầu) in `title`/`label` roles, fund Select
  in the toolbar.
- Changes: one primary "Ghi sổ quỹ"; "Chuyển quỹ" secondary outline in the header before it (Cancel-then-primary order).
  Warning = status badge with icon + short word "Lệch nhiều" and the sentence as its tooltip/field help. Filters as chips +
  one date-range control, toolbar one row. Money in/out totals move out of the count slot into a totals line under the table
  (tabular). Amounts via Intl signDisplay; ⋮ present on every row (disabled items explain why). Pager prev/next + numbers.
- Tells removed: tinted secondary, wrapped warning pill.
- Baseline findings fixed: E2 font-size 8, hit-target 11, hover-missing 6, pressed-missing 26, shadow-gradient 6, pink-dark 7,
  non-radix 30 (50); wig cash.tsx:331 (totals layout), :185, :178, :48; cash-book :112, :265, :266, :278, :360; cash-closing
  :341, :210, :324; cash-reconcile :47, :49; rbp cash-book.tsx:300, :376-414, cash-closing :231.
- Transitions: 120 ms route fade only; tab switch instant.
- Checks: visual 1024/1440 light + dark: toolbar one row, one filled button; E2 secondary-filled 0, hit-target 0.

### staff/product-orders

**Critique**

- Header action "Cấp hàng" is a tinted pill with a refresh icon (neither primary nor outline; the icon says "reload").
- Underline tabs (Cần đặt / Đã đặt / Hàng đã về / Đã giao / Đã hủy) instead of the segmented control; "14 kết quả" in the
  toolbar AND "Hiển thị 1-14 trong 14" under the table.
- Supplier cell glues the supplier code into the name ("Công ty Mỹ phẩm Hoa Sen MUZTM7IF"); "Chưa có nhà cung cấp" repeated
  on 7 rows in grey (could be a group or a filter); product names ellipsised "Serum phục hồi và làm sáng da chiết xuất rau má…"
  (E2 clipped-text 3, C15); middle-dot variant "Kem dưỡng ẩm ban đêm · 50 ml".
- "20 dòng mỗi trang" native select bottom right (8.8: fixed 20 per page; B9).
- Dark: "Cấp hàng" dark tint, codes pink, current nav pink.
  **Plan**
- Pattern: list page (toolbar + one DataTable), tabs as segmented control with counts only in the "Hiển thị" line.
- Changes: "Cấp hàng" = primary (plain icon "+" or none; refresh stays an icon button in the toolbar) if it is the page's main
  task, else secondary outline (Owner to confirm which is the main task). Supplier code in its own muted second line with
  `translate="no"`; names wrap to 2 lines; variant as "Kem dưỡng ẩm ban đêm, 50 ml" (or a second muted line). Page-size select
  removed (20/page). Drop the toolbar "14 kết quả" (one count line).
- Tells removed: middle-dot variant meta, tinted ambiguous action.
- Baseline findings fixed: E2 clipped-text 3, hit-target 13, pressed-missing 27, hover-missing 5, shadow-gradient 5, pink-dark 7,
  non-radix 20 (37); wig product-orders.tsx:527, :353, :453, :675.
- Transitions: 120 ms route fade only.
- Checks: E2 clipped-text 0; visual 1024/1440 light + dark: no ellipsis on names, one count line.

### staff/product-order-detail

**Critique** (captured last; all 8 modes present)

- No action in the header at all; the only action is the row ⋮. Title "Đơn DT000010" (fine) but status "Đã đặt hàng" is buried
  as the first DL value.
- A bordered amber banner "Trễ hẹn so với ngày dự kiến." above the card AND a "Trễ hẹn" pill on the line (status said twice; the
  banner is a bordered box on the canvas, B12); two pills side by side in one cell ("Đã đặt hàng" + "Trễ hẹn"), word only (C5).
- Phone shown in full "+84905555666" while online orders mask it "•••••••005" (inconsistent; flag for the Owner, data policy).
  Invoice "INV-261009-Q6AFK3" is plain text, not a link to the invoice.
- One card + one bare table section, single column at 1440 (no 8/4 detail layout). "Hiển thị 1-1 trong 1" for one line.
- 200 % zoom: "Dự kiến có hàng" column cut at the edge. "← Quay lại" + breadcrumb (B7). Dark: breadcrumb link pink, nav pink.
  **Plan**
- Pattern: detail page: header "Đơn đặt trước DT000010" + status badge (icon + word; late adds a clock icon "Trễ hẹn") +
  the next step as the single primary (from the row ⋮: e.g. "Báo hàng đã về" when the line is ordered; Owner to confirm which
  action is the main one per status); left 8 = Hàng trong đơn table; right 4 = customer, phone, invoice link, created at.
- Changes: drop the banner (the badge + an inline "Trễ hẹn 2 ngày" line in the summary carry it); one status per line; no
  "Hiển thị" line under 2 rows; breadcrumb keeps tab/search/page (wig product-orders.tsx:931); SKU/invoice `translate="no"`.
- Tells removed: duplicate status banner, stacked pills.
- Baseline findings fixed: E2 font-size 8, hit-target 9, pressed-missing 22, hover-missing 4, shadow-gradient 6, pink-dark 6,
  non-radix 23 (37); wig product-orders.tsx:792, :931, :954, :996, :796, :1247.
- Transitions: 120 ms route fade only.
- Checks: visual 1024/1440 light + dark: status beside the h1, one primary, two columns; zoom200 table scrolls in its container.

### staff/online-orders

**Critique**

- Six underline tabs (Cần gửi, Chờ hàng về, Đang giao, Giao thất bại, Hoàn tất, Đã hủy); at 200 % zoom the row is cut at "H"
  with no peek or scroll sign (B10).
- "1 kết quả" in the toolbar AND "Hiển thị 1-1 trong 1" (duplicate count). At 1024 Tỉnh/thành and Sẵn sàng từ columns drop;
  at 200 % zoom the status pill is cut at the card edge.
- Status "Trễ hạn gửi" amber outline pill, word only (C5). Order-code links 19 px (E2 hit-target 15).
- Dark: code link pink, nav pink.
  **Plan**
- Pattern: list page; tabs = segmented control that scrolls with the next tab peeking (F2.4/8.5) below 1024 css.
- Changes: one count line; status icon + word (late = clock icon + "Trễ hạn gửi"); row is the link (≥40 px); masked phone stays
  as the muted second line; columns keep "Sẵn sàng từ" (the SLA anchor) before "Tỉnh/thành" when width is short.
- Tells removed: word-only status.
- Baseline findings fixed: E2 hit-target 15, pressed-missing 28, hover-missing 4, font-size 2, pink-dark 8, shadow-gradient 5,
  non-radix 19 (35); wig online-orders.tsx:331, :238, :449; i18n online-fulfilment.ts:15.
- Transitions: 120 ms route fade only.
- Checks: zoom200 tabs show a peek and scroll; E2 hit-target 0; visual 1024/1440 light + dark.

### staff/online-order-detail

**Critique**

- Not the detail pattern (two columns 8/4 from 1024): stacked full-width cards (Thông tin đơn, Địa chỉ nhận, Vận chuyển), then
  "Sản phẩm" and "Nhật ký giao hàng" as bare sections outside any card: mixed surfaces on one page.
- Status "Chờ gửi" buried as the first DL value instead of next to the h1; primary "Gửi hàng" in the header is right, but card
  headers carry tinted pills "Sửa địa chỉ" and "Ghi nhật ký" (A4 third variant).
- "← Quay lại" + breadcrumb (B7). Line names numbered "1. Nước cân bằng hoa cúc dành cho…" (decorative numbering + ellipsis,
  E2 clipped-text 1); two status pills stacked in one cell ("Đã thanh toán", "Sẵn sàng gửi").
- Empty "Vận chuyển" card only says "Chưa gửi hàng." (C33). 12 px DL labels (E2 font-size 16, B1). Dark: "Gửi hàng" pink fill.
  **Plan**
- Pattern: detail page: header (title "Đơn online ON000027" + status badge + primary "Gửi hàng"); left 8 = Sản phẩm table,
  Nhật ký giao hàng timeline; right 4 = summary card (Tổng tiền in totals layout, payment date, invoice link, delivery fee) +
  Địa chỉ nhận (edit = icon button "Sửa địa chỉ" in the card header) + Vận chuyển.
- Changes: breadcrumb only; line names wrap, no "1." prefix; one line status (the one that differs from the order); "Ghi nhật
  ký" secondary outline in its card header; Vận chuyển empty = "Chưa gửi hàng. Bấm Gửi hàng khi đơn đã đóng gói." (pointing to
  the primary). Tracking link gets a new-tab cue (wig :664).
- Tells removed: decorative numbering, tinted card buttons, stacked badges.
- Baseline findings fixed: E2 clipped-text 1, font-size 16, hit-target 9, pressed-missing 22, hover-missing 4, shadow-gradient 8,
  pink-dark 6, non-radix 22 (36); wig online-orders.tsx:429, :721, :775, :891, :694, :664; dialogs :290, :877, :666, :134.
- Transitions: 120 ms route fade only.
- Checks: visual 1024/1440 light + dark: two columns, status beside the h1, one filled button; E2 clipped-text 0.

### staff/product-returns

**Critique**

- A clean list, but: codes are 19 px underlined links (E2 hit-target 29, zoom200 40, text200 22); two tinted filter pills
  ("Trạng thái", "Lý do"); "55 kết quả" plus "Hiển thị 1-20 trong 55" (duplicate count).
- Product names ellipsised "Kem chống nắng phổ rộng SPF50…", "Serum dưỡng sáng da vitamin C ·…" (C15) with middle-dot variant meta.
- Status pills word only ("Đã chấp nhận", "Đang xử lý") (C5). At 1024 the Hóa đơn and Mở lúc columns drop; at 200 % zoom the
  table is cut at the right edge.
- Primary "+ Mở hồ sơ" correct (one filled); dark: pink fill, codes pink, pager current pink.
  **Plan**
- Pattern: list page.
- Changes: filters = chips (F2.4) with a check when set; one count line; names wrap to 2 lines with the variant on a muted
  second line; status icon + word; row link ≥40 px; header "Mở hồ sơ" as a Link (wig :300).
- Tells removed: middle-dot meta, word-only status.
- Baseline findings fixed: E2 hit-target 29, pressed-missing 43, hover-missing 6, font-size 2, pink-dark 7, shadow-gradient 5,
  non-radix 25 (42); wig product-returns.tsx:276, :300, :597.
- Transitions: 120 ms route fade only.
- Checks: E2 hit-target 0 (40 fine pointer); zoom200 table scrolls inside its container; visual 1024/1440 light + dark.

### staff/product-return-detail

**Critique**

- h1 is a bare code "TH000055" (C41: name the record); status "Đã chấp nhận" buried as the first DL value.
- One big "Thông tin hồ sơ" card with 16 label/value pairs in two columns (12 px labels, E2 font-size 25, B1), then three more
  stacked cards; at 1440 the record still runs full width (no 8/4 detail layout).
- Middle-dot meta "Nguyễn Thị Lucy · 18:36 08/10/2026" in "Mở bởi" / "Xử lý bởi" and in the history list (tell).
- "Lịch sử" is plain paragraphs in a card with a tinted "+ Thêm ghi chú" pill; "Ảnh bằng chứng" is a card with a caption and
  "Chưa có ảnh nào." and no upload action (C33).
- "← Quay lại" + breadcrumb (B7). Dark: "Đổi hàng" pink fill.
  **Plan**
- Pattern: detail page: header "Hồ sơ trả hàng TH000055" + status badge + primary "Đổi hàng"; left 8 = Sản phẩm and quantities,
  Các lần đổi hàng, Lịch sử as a timeline (actor, time, note); right 4 = Khách, Hóa đơn (link), Chi nhánh, deadlines, evidence
  photos (empty: "Chưa có ảnh nào" + "Thêm ảnh" when allowed).
- Changes: "Thêm ghi chú" secondary outline in the timeline header; actor and time on two lines or "Nguyễn Thị Lucy, 18:36
  08/10/2026" (no middle dot); DL labels 14 muted (F1.7).
- Tells removed: middle-dot meta, tinted card button, bare-code title.
- Baseline findings fixed: E2 font-size 25, hit-target 9, pressed-missing 22, hover-missing 4, shadow-gradient 8, pink-dark 6,
  non-radix 17 (30); wig product-returns.tsx:966, :1378; product-refunds/exchanges DL totals (refund/credit money tabular).
- Transitions: 120 ms route fade only.
- Checks: visual 1024/1440 light + dark: two columns from 1024, status beside the h1, one filled button.

### staff/product-return-new

**Critique**

- Step 1 lookup only: one pill-shaped field "Mã hóa đơn _" (D8 wants 8 px fields; "_" without the word, 8.2), help text, and a
  tinted "Tìm hóa đơn" pill; no primary, no Cancel; card ~760 px at 1440 (form max 720).
- "← Quay lại" + breadcrumb (two backs). Found-invoice result appears with no live region (wig :575).
- Dark: tinted button dark burgundy, nav pink.
  **Plan**
- Pattern: form page (one column max 720, footer Cancel then primary).
- Changes: label "Mã hóa đơn (bắt buộc)"; the field is a search field with "Tìm" as its trailing primary-sized button (the only
  filled control while nothing is found); after a hit the invoice summary appears in a `role=status` region and the footer
  primary becomes "Tạo hồ sơ"; "Hủy" returns to the list (with a leave guard once dirty, wig :519). Enter looks up with an
  isComposing guard (wig :556).
- Tells removed: tinted pill button, "*"-only required mark.
- Baseline findings fixed: E2 font-size 2, hit-target 9, pressed-missing 22, hover-missing 4, shadow-gradient 5, pink-dark 6,
  non-radix 14 (29); wig product-returns.tsx:519, :550, :556, :575, :478, :687, :741.
- Transitions: 120 ms route fade only.
- Checks: visual 1024/1440 light + dark empty + found + error; keyboard: Enter looks up, focus moves to the result.

### staff/inventory-count-detail

**Critique** (captured last; light-1024 shows the error state, see "Not available")

- Title is a bare code "KK000001" (C41). Two action places: header primary "Duyệt kiểm kê" and, in the "Mặt hàng" section
  header, tinted "+ Thêm mặt hàng" + a disabled tinted "Lưu số đếm" (A4 third variant; saving the count, the task in progress,
  is the weakest-looking control on the page).
- Count sheet: pill-shaped count inputs inside the table, "Chênh lệch" rendered as a circled number "0" (decorative
  treatment of data; no sign, no icon for a shortfall), a bare trash icon per row that removes at once (wig :383), names ellipsised "Kem chống nắng
  phổ rộng SPF50…" (E2 clipped-text 12, C15) while the SKU column takes the width.
- 46 lines paged 20 with a "20 dòng mỗi trang" select; every save remounts the sheet and returns to page 1 (wig :584); no
  leave guard while counts are typed (wig :300). Middle-dot "Nguyễn Thị Lucy · 01:47 16/10/2026" (tell).
- 200 % zoom (640 css): Hệ thống, Đếm được and Chênh lệch are cut off: the count input, the whole job, is off-screen.
- Error state (light-1024 capture, API 503): a pink bordered box with "Hệ thống tạm thời không phản hồi. Vui lòng thử lại.",
  a raw reference id and a tinted "Tải lại": acceptable copy, but tinted button and pink box (8.4 wants inline message + retry).
- Dark: "Duyệt kiểm kê" pink fill, current page number pink, wordmark pink (B22).
  **Plan**
- Pattern: form page in a wide variant (count sheet) with a sticky footer: "Lưu số đếm" primary while counting (dirty),
  "Duyệt kiểm kê" moves to the header as secondary outline until the sheet is saved, then becomes the primary (one filled
  button at any time; Owner to confirm the order of the two steps).
- Changes: title "Kiểm kê KK000001"; count inputs = kit NumberInput 8 px, `inputMode="numeric"`, right-aligned, Enter moves to
  the next row (keyboard first); Chênh lệch = signed tabular number with an icon for under/over ("−2" warning icon); row
  remove in the ⋮ menu with Undo toast; names wrap 2 lines, SKU as the muted second line; page kept across saves; leave guard;
  fixed 20/page, page-size select removed; "+ Thêm mặt hàng" secondary outline in the section header.
- Tells removed: decorative circled difference, tinted section buttons, middle-dot meta, bare-code title.
- Baseline findings fixed: E2 clipped-text 12, hit-target 17, pressed-missing 31, hover-missing 7, font-size 7, pink-dark 7,
  shadow-gradient 6, non-radix 31 (51); wig inventory-counts.tsx:145, :300, :336, :341, :383, :486, :584; i18n inventory.ts:193.
- Transitions: 120 ms route fade only; no motion when the difference recalculates.
- Checks: E2 clipped-text 0; zoom200 the count column visible (table scrolls inside its container, SKU column narrows first);
  visual 1024/1440 light + dark loaded + error state; keyboard: Enter walks the count inputs, saving keeps the page.

## Cross-page patterns

1. One shell decides most of it: serif wordmark/titles + Nunito + rose gradient canvas break D2/D4/D7 on every staff page; fixed
   once by `data-ui="v2"` + compact density + HeaderBar (F1.1, F2.9). No page should restyle it locally.
2. A third button variant: tinted burgundy pills ("Bán combo", "Chuyển quỹ", "Sửa địa chỉ", "Ghi nhật ký", "Thêm ghi chú",
   "Tìm hóa đơn", filter pills) on 11 of 12 pages. Map each to primary, secondary outline or neutral; never tinted (A4).
3. Back affordances: "← Quay lại" on every page plus a breadcrumb on details (B7/C40). PageBack/breadcrumb only.
4. Status as coloured word pills with no icon on every list (C5, DESIGN 10); badges also stacked two per cell and repeated per line.
5. Detail pages are full-width stacks of cards (pos-invoice, online-order-detail, product-return-detail) where DESIGN 10 wants
   two panes / 8-4 columns from 1024; the counter (pos, pos-invoice) lacks pinned totals and a single "Thanh toán" primary.
6. Ellipsis on product names in every table (C15) and middle-dot meta strings ("A · B") in subtitles, variants and actors.
7. Duplicate counts ("14 kết quả" + "Hiển thị 1-14 trong 14"), page-size selects, underline tabs: kit DataTable/Tabs used
   inconsistently; one count line, segmented tabs, fixed 20/page.
8. Targets: code links 19 px in every list (E2 hit-target 7-29/page); the row should be the link.
9. Keyboard-first is missing on the counter (`/`, Enter-to-add, arrows); dialogs already close on Escape.
10. Dark mode: pink wordmark, pink current nav, pink primaries and links everywhere (E2 pink-dark 5-8/page): F1.3/F1.4 fix it globally.

## Not available

- All 14 pages captured in all 8 modes and reviewed (light + dark sheets opened).
- inventory-count-detail light-1024: the capture shows the app error state (E2 console-errors 2: HTTP 503 from the API,
  `notifications/unread-count`), not the loaded page; its E2 counts for light-1024 (font-size 2, non-radix 14, no clipped-text)
  are therefore not comparable. The other 7 modes are valid. Re-capture that one mode before the Step 2 baseline compare.
