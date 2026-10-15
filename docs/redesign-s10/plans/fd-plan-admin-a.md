# frontend-design: admin screens A critique (Step 1) + page plan (Step 2), phase s10base

Scope (staff area, admin screens): staff-login, staff-forgot, dashboard, account, notifications, advances, attendance, leave,
income, my-payslips, my-services, collaborator-schedule, chat-requests, employees, employee-detail, employee-new, teams,
team-detail, roles, skills, organization, branches, branch-detail, services, service-detail, discounts, discount-detail,
discount-new, discount-version-new, loyalty, products, product-detail, product-new, product-campaigns, product-campaign-detail,
product-rewrites, product-text-cleanup, online-sales, shipping-carriers, inventory, inventory-item, inventory-receipt,
inventory-receipt-edit, inventory-receipt-new.
Method: sheets `staff-<page>-light.png` (columns 1024 / 1280 / 1440 / 200 % zoom (640 css) / 200 % text (1280)) and
`-dark.png` (1024 / 1280 / 1440) opened for every page listed; full `<page>__<mode>.png` images opened where a page block says so.
E2 counts are quoted as `metric n` at light-1440 (pink-dark at dark-1440, hover/pressed at light-1280, brand-text at zoom200),
`zN` / `tN` = the 200 % zoom / 200 % text count when it differs. "page-specific" = items not shared by most staff pages.
The shell (top bar, sidebar, theme switch, "← Quay lại", wordmark) is judged in `fd-plan-pos.md` block `staff/SHELL` and by the
shell agent; it is not repeated here. Every page inherits from it: shadow-gradient (sidebar + canvas gradient), brand-text zoom200 6
(ALL-CAPS burgundy group labels), pink-dark 5 (wordmark/current pill), skip-link font-size, theme-switch hit-target gaps, and the
sidebar nav hover/pressed-missing items. E2 `contrast 1:1 white on white` on the current `.ls-nav-label` (every page) is a
pill-background measurement artefact (same verdict as fd-plan-pos.md): verify, not planned as a defect.
Old-token colours (E2 non-radix: `#2b1a1e` ink, `#6a5558` muted, `#efd9d9` hairlines, `#8a7377` field borders) and dark pink
(`#e08a9a` links, tabs, pager, primary) are fixed by plan-foundation F1.1-F1.4 for every page; page blocks cite the counts only.

## Not available

- staff/my-payslip-detail: capture skipped, no record to open from my-payslips (the scratch user has no payslip; E2 unmeasured).
- staff/loyalty-member: capture skipped, no record to open from loyalty (E2 unmeasured).
- staff/product-rewrite-detail: capture skipped, no record to open from product-rewrites (E2 unmeasured).
  These three need a seeded record before Step 2 can be verified on them; their plan = PATTERN-DETAIL by default.
- Partial: staff/inventory-receipt-edit was captured on a confirmed receipt, so it shows only "Chỉ sửa được phiếu nháp." and
  the edit form itself is not on the sheets; seed a draft receipt and re-capture. income, my-payslips, my-services,
  collaborator-schedule, chat-requests, shipping-carriers, product-rewrites, product-text-cleanup were captured empty only;
  their filled states need seeded rows for the Step 2 check.

## Shared pattern plans

### staff/PATTERN-LIST

Applies to: notifications, advances, attendance, leave, my-payslips, collaborator-schedule, chat-requests, employees, teams, roles,
skills, organization, branches, services, discounts, products, product-campaigns, product-rewrites, product-text-cleanup,
shipping-carriers, inventory.

- Anatomy (DESIGN 10 list): `Page` + `PageHeader` (one h1, short description of at most one line, one primary at the trailing
  edge, `ButtonLink` when it navigates), then ONE toolbar line (search pill, facet pills, date range, refresh icon, no labels
  above), then ONE `DataTable` surface on the sunken canvas (hairline, header on sunken, sticky header, 48 px rows, 20/page,
  "Hiển thị x–y trong n", row `⋮` menu). No card around the table, no second table stacked below it: groups become a facet
  or tabs, never 2-4 stacked tables each with its own pager.
- Primary column = record name as a plain ink row link (whole row is the target, 48 px; not a 19 px underlined burgundy text
  link: hit-target C29); codes in tabular nums `--ls-text-muted`, `translate="no"`.
- Long names wrap to two lines inside the cell (no `ls-cell-truncate` ellipsis on the name column, C15); secondary columns
  may truncate with a tooltip. At 200 % text and under 1280 the table scrolls inside its own container with a visible edge
  (F2.6), it never clips the trailing columns or pushes the `⋮` menu over the name (E2 overlap zoom200).
- Status = kit `Badge` status tone + icon + word (C5), never a coloured outline pill alone; counts never next to headings
  (tab labels "Dịch vụ (114)" lose the count, it lives in the "Hiển thị" line).
- Row-menu "Chi tiết/open" and create buttons get `href` (wig-admin-a summary: `onSelect: navigate()` / `Button onClick`).
- Search placeholder gives an example and ends with "…" (not the label repeated).
- Empty state: kit `EmptyState` (title, one sentence, the next step as the one button), not a sunken shadowed box.
- Transitions: 120 ms route fade only (F3.4); no row stagger, no Reveal.
- Checks: E2 hit-target on row links 0, clipped-text on the name column 0, overlap zoom200 0, hover/pressed-missing on
  `ls-th-sort` and `ls-page-btn` 0, pink-dark 0; visual 1440 light + dark: one surface, one primary, no stacked tables;
  200 % text: trailing columns reachable by the table's own scroll.

### staff/PATTERN-DETAIL

Applies to: account (personal detail), employee-detail, team-detail, branch-detail, service-detail, discount-detail,
product-detail, product-campaign-detail, inventory-item, inventory-receipt (and the three Not available detail pages).

- Anatomy (DESIGN 10 detail): breadcrumb parent link only (no second "← Quay lại", F2.11), header = h1 (record name, wraps) +
  status badge (icon + word) + one primary at the trailing edge; secondary actions in an overflow `⋮`.
- From 1024: two columns, record 8 / summary 4; under 1024 one column. Tabs (kit `Tabs`, URL state) for sections; the tab bar is
  NOT pink/burgundy text in dark (F1.3) and carries no count.
- Facts = description list, label above value, label 12/14 muted, value 14 ink, NO bordered box or hint text overlapping the
  value (E2 overlap on employee-detail); each section is one `Card` with the card header holding its one action ("Sửa").
- Related records = `DataTable` inside the tab (no card around it, no nested border).
- Transitions: 120 ms route fade; tab switch instant.
- Checks: E2 overlap 0, double-border 0, pink-dark 0, font-size (card titles 18 → heading step of the compact scale) 0;
  visual 1440 light + dark one primary, no nested boxes; 200 % text: header wraps, no clipped title.

### staff/PATTERN-FORM

Applies to: employee-new, discount-new, discount-version-new, product-new, inventory-receipt-new, inventory-receipt-edit,
online-sales (settings form).

- Anatomy (DESIGN 10 form): long form = own page, one column max 720 px, groups = heading + 32 px gap (no card per group, no
  bordered sub-box), footer actions Cancel (secondary, a link) then the one primary last at the trailing edge, sticky on long
  forms; `useUnsavedChangesGuard` on every page form (wig: employee-create.tsx:121, product-create.tsx:105,
  inventory-receipts.tsx:656 lack it).
- Fields per F2.3 (8 px radius, not pills; native select styled B9); money = kit `MoneyInput`; codes `spellCheck={false}`;
  every input `name`; errors inline at the field + focus the first invalid field (not one Notice at the bottom).
- Submit never disabled to signal "incomplete" (wig: many `disabled until` lines); validate on submit.
- Transitions: 120 ms route fade; no field animation.
- Checks: E2 hover-missing on inputs 0, pressed-missing on footer buttons 0, font-size 0, double-border 0; visual: one
  primary, Cancel then Save order, 720 max width at 1440, 200 % text no clipped label.

### staff/PATTERN-REPORT (self-service and report views)

Applies to: income, my-services, loyalty (lookup), dashboard is its own pattern below.

- Anatomy: `PageHeader` (h1, filters in the toolbar line: period / branch / date, filter state in the URL), a row of Stat
  cards when there are totals, then one `DataTable`. Empty = `EmptyState` with the next step. No decorative card per section.
- Transitions: 120 ms route fade; CountUp renders the final number (F3.2).
- Checks: E2 font-size 0 (stat values on the compact scale), hit-target 0; visual empty + filled states.

### staff/PATTERN-AUTH

Applies to: staff-login, staff-forgot.

- Anatomy: staff auth = compact HeaderBar-free split (kit `AuthLayout`): flat `#f5f5f7` canvas (dark `#000`), one card (18 px
  radius, hairline, no shadow, no gradient), wordmark in the customer component at compact size, h1 at the title step (not 18),
  one primary full width, secondary links as `.ls-link` with 40 px targets, language switch "EN/VI" top trailing. No theme
  switch (A1).
- Transitions: none beyond the 120 ms fade.
- Checks: E2 shadow-gradient 0, brand-text 0, pink-dark 0, hit-target 0, overlap 0.

### staff/PATTERN-DASHBOARD

See the dashboard block (single page).

## Pages

### staff/staff-login

**Critique**

- Canvas is a burgundy gradient with a repeating leaf pattern behind a white card with a soft shadow (D7 no gradient / no decoration; E2 shadow-gradient on `.ls-auth` + `.ls-auth-card`), every width and both modes; the serif wordmark in wide tracking does not match the customer wordmark (D2) (sheets: light, dark).
- Three-icon theme switch top trailing (A1) next to "English" spelled out; at 200 % zoom the switch and the card crowd the top edge.
- Segmented "Mã nhân viên | Email" = solid burgundy thumb (a second burgundy fill beside the primary "Đăng nhập", A4/B11); the segments touch with gap 0 (E2 hit-target). The E2 contrast items ("English" ghost 1.08, active segment 1.16) are measurement artefacts: on the sheet both are white on burgundy and readable, not defects.
- "Quên mật khẩu?" is a 19 px tall link sitting 7 px from the password field and its eye toggle (C29); the eye toggle overlaps the input box (E2 overlap, by design but the hit area spills).
- h1 "Đăng nhập" at 18 px under the wordmark plus "Dành cho nhân viên" caption: two headings stacked, the title step is not used (D4).
- Dark 1024-1440: wordmark, active segment, "Quên mật khẩu?" and the primary all pink `#e08a9a` with dark text (A3/B22).
- 200 % text: card grows and still fits; nothing clipped.
  **Plan**
- Pattern: PATTERN-AUTH.
- Changes: flat `#f5f5f7` canvas (dark `#000`), leaf pattern and gradient removed; segmented control per F2.4 (neutral track, selected = raised white segment + ink text, not a burgundy fill), equal widths, 4 px inner gap; "Quên mật khẩu?" moves below the password field as its own 40 px `.ls-link` row (not inside the label row); h1 at the compact title step, caption 14 muted.
- Tells removed: decorative leaf wallpaper + gradient, serif wide-tracked wordmark, theme switch, burgundy-filled segment next to the primary.
- Baseline findings fixed: overlap 1, font-size 2, contrast 2 (artefact, verify 0), hit-target 6 t4, non-radix 15, brand-text 1, shadow-gradient 3, hover-missing 3, pressed-missing 8 (segments, "Quên mật khẩu?", eye toggle), pink-dark 6 (segment thumb, link, primary; F1). wig: login.tsx:110 id/email input lacks `spellCheck={false}`.
- Transitions: pattern (120 ms route fade).
- Checks: E2 shadow-gradient, brand-text, pink-dark, hit-target, overlap, hover/pressed-missing 0; visual 1440 light + dark one burgundy fill only, 200 % zoom card fully visible, 200 % text no clipped label.

### staff/staff-forgot

**Critique**

- Same burgundy gradient + leaf wallpaper + shadowed card as login (D7, E2 shadow-gradient 3), serif wordmark (D2), theme switch (A1) (sheets: light, dark).
- Body copy under the h1 is a 2-line paragraph centred while the form below is left-aligned: two alignments in one 300 px card.
- "Quay lại đăng nhập" is an underlined text link at 16 px, 22 px tall (C29), left-aligned under a full-width primary; it is the parent link, so it is legitimate but should read as the back affordance.
- Dark: primary "Gửi mã" pink fill (B22, A3); light at 1024 fine.
- 200 % text: card wraps cleanly; no clipping.
  **Plan**
- Pattern: PATTERN-AUTH.
- Changes: copy block left-aligned with the form (one alignment); "Quay lại đăng nhập" = 40 px `.ls-link` row with a leading chevron icon (parent exists, C40), 14 px; code and new-password steps keep errors inline at the field (wig).
- Tells removed: leaf wallpaper + gradient, serif wordmark, theme switch.
- Baseline findings fixed: font-size 3, contrast 1 (artefact), hit-target 3 t2, non-radix 11, brand-text 1, shadow-gradient 3, hover/pressed-missing 3/5 ("Quay lại đăng nhập"), pink-dark 4 (F1). wig: forgot-password.tsx:152 email lacks `spellCheck={false}`/`name`; :174 code lacks `name`; :213 code/length/mismatch errors are Notices below the form, not tied to fields, no focus.
- Transitions: pattern (120 ms route fade).
- Checks: E2 shadow-gradient, hit-target, pink-dark, hover/pressed-missing 0; visual light + dark 1440 one primary; error state rendered with an inline field error.

### staff/dashboard

**Critique**

- Identical card kit repeated 15 times: serif title, grey label, big number, caption, then a tinted-pink filled pill ("Mở lịch hẹn", "Mở hóa đơn", "Xem báo cáo") in every widget: 15 filled buttons on one view (A4/B11, C4) plus a solid primary "Gửi mã xác minh" inside the recovery-email widget and "Sắp xếp bố cục" in the header (sheets: light, dark; full: none needed).
- The recovery-email card (a settings task that lives on /account) sits first on the dashboard above the work widgets; an info notice "Tài khoản chủ spa không có chấm công…" also takes the top slot.
- Grid breaks: at 1280 widgets of 4 columns truncate their titles ("Hoàn tiền h…", "Cảnh báo thanh to…", "Đơn nghỉ phép chờ…", E2 clipped-text 3); at 200 % text the 4-column row keeps its column count and collapses to letter-per-line text ("H ô m n a y…") and one-word title stubs "Kh…", "C." (C16, E2 clipped-text t10); heights uneven within a row (C18).
- Revenue chart: area under the line filled with a pink gradient (DESIGN 10: no gradient fills), segmented "Không | Kỳ trước" uses "Không" as a compare label (copy unclear); burgundy thumb is a second filled control. Dark: line and area pink `#c9647a` (E2 pink-dark path/circle).
- "Lối tắt": ~60 tinted pill buttons with icons in a 3-column grid duplicating the whole sidebar (decorative, not a task; tell: chip wall).
- Notifications widget: underlined links 19 px tall (C29, E2 hit-target 3) each followed by a blue "Mới" badge (repeated label, colour only, C5).
- Stat values 32 px and card titles 18 serif (E2 font-size 32): display type on a work screen (DESIGN 10).
  **Plan**
- Pattern: dashboard (DESIGN 10): `PageHeader` h1 "Xin chào, <tên>" + description one line + trailing "Sắp xếp bố cục" as the one secondary (no primary needed); 12-col widget grid on the sunken canvas: Stat widgets span 3 (4 per row at ≥1280, 2 at 1024, 1 at 200 % text via container queries on the widget, not the viewport); chart widgets span 6-12.
- Stat card (kit `Stat`): label 12/14 muted, value at the compact heading step (tabular nums), one-line caption; the action is the whole card as a link (or one ghost text button "Mở" in the card header), never a filled pill; titles wrap to 2 lines, no clamp.
- Charts: flat 2 px series line, no area fill, six-slot chart palette, direct labels; compare = kit segmented with equal widths and labels "Không so sánh | Kỳ trước"; "Xem dạng bảng" kept.
- Recovery-email card leaves the dashboard (it stays on /account; a one-line `Notice` with a link only when unverified). "Lối tắt" removed (sidebar is the navigation) or reduced to the user's 6 pinned shortcuts as a plain link list; flag to the Owner as a content decision.
- Notifications widget: 3 latest as rows (48 px, unread = 600 weight + dot icon + "Chưa đọc" for SR), one "Xem tất cả" link.
- Tells removed: identical card kit with filled pill per card, chip wall, gradient area chart, serif display numbers, "Mới" badge per line.
- Baseline findings fixed: font-size 32, contrast 2 (1 = segment artefact), hit-target 7 z24 t4, non-radix 25, shadow-gradient 19 z25 (cards), clipped-text z1 t10 (light-1280: 3), hover/pressed-missing 9/20 (segments, notification links), pink-dark 8 (chart path/circle; F1). wig: dashboard.tsx:56 branch scope not in URL; :129 "Đặt lại mặc định" no confirm/undo; revenue-widget.tsx:30 compare mode in state; widget-frame.tsx:35 loading label lacks "…"; money-widgets.tsx:98 / report-widgets.tsx:122 / revenue-widget.tsx:71 `formatVnd`. rbp: dashboard.tsx:58-61 layout read in an effect (default widgets mount then swap), :74-79 branch via effect, registry.ts:11-33 widget chunks start late.
- Transitions: 120 ms route fade; no widget stagger; CountUp renders the final value (F3.2); layout read in a lazy initializer so nothing swaps after mount.
- Checks: E2 clipped-text 0 in every mode (incl. text200), font-size 0, shadow-gradient 0, pink-dark 0, hit-target 0; visual 1024 / 1280 / 1440 light + dark: no filled button inside widgets, equal heights per row; 200 % text: one widget per row, no letter-per-line wrap.

### staff/account

**Critique**

- Three stacked cards (Thông tin cá nhân, Tài khoản & bảo mật, Email khôi phục) each with tinted-filled header buttons "Sửa", "Đổi email", "Đổi mật khẩu" and a solid primary "Gửi mã xác minh" in the third card: four filled controls, two side by side (A4/B11, C4) (sheets: light, dark).
- Column stops at ~780 px at 1440 with an empty right half; the facts are a 2-column dl inside each card, fine, but card titles are 18 serif (E2 font-size 11) and the dl values 16 (one step too big for compact).
- Copy/data: "Chức danh" shows a blue info badge "Chủ Spa" (status styling on a plain value, A3/C5; Title Case "Spa", wig shell note); "Trạng thái tài khoản: Chủ Spa" shows the role where a status is expected (flag: wrong field or label).
- Warning notice "Quan trọng: nếu quên mật khẩu…" + "Chưa xác minh" badge + body sentence say the same thing three times.
- h1 description ("Thông tin của bạn. Đây là cùng một hồ sơ… — sửa ở đây là quản lý thấy ngay.") is two lines with an em dash (copy flag).
- Dark: primary pink fill; 200 % text: header buttons drop under the title and the two security buttons sit side by side tinted.
  **Plan**
- Pattern: PATTERN-DETAIL (personal record, one column max 960, no summary column).
- Changes: one `Card` per section with a card-header action as a secondary (outline) button, never tinted fill; "Đổi email" and "Đổi mật khẩu" become two rows in the security card with their own trailing text button each (not two buttons in a header); the only primary on the page = "Gửi mã xác minh" while the email is unverified, otherwise none; "Chức danh" as plain text; status of the recovery email = badge with icon + word, the notice drops to one sentence. Flag "Trạng thái tài khoản" value to the Owner.
- Tells removed: tinted pill buttons in card headers, serif card titles, triple-repeated warning.
- Baseline findings fixed: font-size 11, hit-target 2 z20 t3, non-radix 18 z17, shadow-gradient 6 z12 (cards), hover/pressed-missing 3/14, pink-dark 5 (F1). wig: my-account.tsx:324/357/371 autocomplete tokens (`name`, `bday`, `street-address`) and `name`; :654 new-email lacks `spellCheck={false}`; :710 MySchedule ignores `mine.error` (loads forever); :746 shift time raw string; :132 login id lacks `translate="no"`; recovery-email.tsx:72 silent return on a bad code, :135 code input lacks `name`.
- Transitions: pattern (120 ms route fade).
- Checks: E2 font-size 0, shadow-gradient 0, pink-dark 0, hover/pressed-missing 0; visual 1440 light + dark one filled button at most; 200 % text card actions wrap below the title without overlap.

### staff/notifications

**Critique**

- Two paging models at once: pager "« ‹ 1 2 › »" plus a "Tải thêm" tinted button under it (C42 one way to continue) (sheets: light, dark).
- Every row carries a blue "Chưa đọc" pill; unread is shown only by that badge (no weight change), and with all rows unread the column is noise (C5).
- Notification text is a burgundy underlined link clamped to 2 lines with an ellipsis (E2 clipped-text 1 z9 t20, C15); at 1024 the title column is ~130 px so the clamp cuts most messages, and adjacent links sit 7 px apart (E2 hit-target gap, overlap t31 at 200 % text).
- Toolbar: two native selects "Tất cả (36)" and "Hộp thư" (count inside a filter label; B9 select styling), refresh icon floating far right; header action "Đánh dấu tất cả đã đọc" tinted fill.
- 200 % text: table clipped at the right edge, "Trạng thái" cut ("Trạng tha"), no scroll sign (C16).
- Dark: links and current page pink (B22).
  **Plan**
- Pattern: PATTERN-LIST.
- Changes: one paging model (DataTable pager, 20/page; remove "Tải thêm"); columns = Thông báo (wraps, up to 3 lines, no clamp), Thời gian, Nguồn (code `translate="no"` + branch on a second muted line); unread = 600 weight + 8 px dot icon + SR text, the "Trạng thái" column dropped; row click opens the target (whole row link, row `⋮` "Đánh dấu đã đọc"); filters = facet pills "Nhóm", "Hộp thư" (no count in the label); "Đánh dấu tất cả đã đọc" stays as the header secondary (outline).
- Tells removed: repeated status pill per row, count in a filter label, double paging.
- Baseline findings fixed: overlap t31, clipped-text 1 z9 t20, font-size 2, hit-target 21 z31 t3 (row links 39 px), non-radix 24, shadow-gradient 4 z10, hover-missing 5 (pager edge buttons), pressed-missing 35 (row links), pink-dark 7 (link, pager; F1). wig: notifications.tsx pass.
- Transitions: pattern (120 ms route fade).
- Checks: E2 clipped-text 0, overlap 0, hit-target 0, hover/pressed-missing 0; visual 1024 + 1440 light + dark one pager; 200 % text table scrolls in its container.

### staff/advances

**Critique**

- h1 description is 3 lines of policy text at 1024-1440 (copy flag: move to a help disclosure), then an h2 "Các khoản tạm ứng" that repeats the page subject above the only table (heading repeats its own control) (sheets: light, dark).
- Count shown twice: "5 kết quả" in the toolbar and "Hiển thị 1-5 trong 5" under the table.
- Employee cell = "Lý Ngọc Yến · NV0011" middle-dot meta string (tell); status = coloured outline pill without icon ("Đã xóa nợ", "Đã hủy", "Đã thu hồi hết", "Đã duyệt", "Chờ duyệt": five tints, C5).
- Primary "+ Tạo yêu cầu tạm ứng" with a "+" glyph; at 1280+ it sits on the h1 line, at 1024 it is pushed beside a 3-line paragraph (vertical misalignment).
- Row `⋮` only on 2 of 5 rows: a ragged action column.
- 200 % text: "Còn nợ" and "Ngày yêu cầu" columns cut off at the right, no scroll edge (C16).
  **Plan**
- Pattern: PATTERN-LIST.
- Changes: description one line ("Tạm ứng tối đa nửa tháng lương, trừ vào bảng lương kế tiếp.", copy flag to Owner), the policy in a `Notice` only on the create drawer; drop the h2 and the "5 kết quả" count; employee cell = name (wrap) + code on a second muted line, no middle dot; amounts and "Còn nợ" right-aligned tabular nowrap; `⋮` column always present (disabled menu item with a reason when no action); create = Drawer (medium form) with kit `MoneyInput`.
- Tells removed: "+" glyph button, middle-dot meta, duplicate count, repeated h2.
- Baseline findings fixed: font-size 3, contrast 1 (artefact), hit-target 11 z20 t3, non-radix 22, shadow-gradient 5 z11 (table wrap), hover/pressed-missing 4/23, pink-dark 5 (F1). wig: advances.tsx:100 status filter + pager (:101) in state; :162 `requestedAt.slice(0,10)` UTC day; :143 `signedVnd` hand-rolled (+6 lines); :331/:446/:510 generic `errors.validation`; :372 amount plain `TextInput` → `MoneyInput`; :372/:384/:451 inputs lack `name`.
- Transitions: pattern (120 ms route fade); drawer per kit.
- Checks: E2 hit-target 0, pressed-missing 0, pink-dark 0; visual 1024 + 1440 light + dark header aligned on one line, status badges with icons; 200 % text all columns reachable.

### staff/attendance

**Critique**

- At 1024 (light and dark) the table is wider than its card and is cut at the right: the "Giờ ra" status chip shows as "Ch", the `⋮` column is gone, no scroll sign (C16, B24); at 200 % text only three columns are visible (sheets: light, dark).
- h1 "Chấm công" followed by h2 "Chấm công chi nhánh" (heading repeats the title).
- Toolbar = an unlabeled native select "Tất cả" (which facet?) + two bare "dd/mm/yyyy" date fields with no from/to meaning, instead of a facet pill + one date-range control (B9, C51); "11 kết quả" count floats on its own line above the table.
- "Giờ ra" column mixes times and an amber "Chưa kết thúc" pill (status in a time column, no icon, C5); branch names truncated with ellipsis in every row (C15).
- No primary in the header for a manager (check-in/out lives on the personal view); fine, but the page has no action at all at 1440.
- Dark: current-sidebar pink, tinted amber chips readable.
  **Plan**
- Pattern: PATTERN-LIST.
- Changes: drop the h2; toolbar = branch facet pill + kit `DateRangePicker` (one control, named "Khoảng ngày"), state in the URL; columns Ngày làm việc, Nhân viên (name wrap, code second line), Chi nhánh (wrap), Giờ vào, Giờ ra (time or "—"), Trạng thái (badge icon + word: "Đang làm", "Đã kết thúc"); table scrolls in its own container under 1280; check-in/check-out buttons show busy state.
- Tells removed: stacked h1/h2 echo, floating count line, status chip inside a time column.
- Baseline findings fixed: font-size 3, contrast 1 (artefact), hit-target 11 z20 t3, non-radix 22, shadow-gradient 5 z11, hover/pressed-missing 4/23, pink-dark 5 (F1). wig: attendance.tsx:147/229/276 `formatDate` by string; :152/:167 check-in/out no busy label; :309 filters in state; :447 correction submit disabled until a reason; :457/:468/:479 inputs lack `name`. rbp: attendance.tsx:76,307 `useBranches` twice per page; :311-318 resource keyed on a filter object.
- Transitions: pattern (120 ms route fade).
- Checks: E2 hit-target 0, overlap 0, clipped-text 0; visual 1024 light + dark: every column reachable, no cut chip; 200 % text table scrolls with a visible edge.

### staff/leave

**Critique**

- At 1024 the "Lý do" column is ~40 px and wraps one word per line ("Đám / cưới / em…"), "Trạng thái" is cut to "Chờ", rows grow to 3-4 lines (C15/C16) (sheets: light, dark).
- Employee names truncated with ellipsis ("Phạm Thị Phương Khánh Linh (NV…", E2 clipped-text 2) while "Lý do" is the column that needs width.
- h1 "Nghỉ phép" + h2 "Duyệt đơn nghỉ phép" heading pair; filter = native select "Chờ duyệt" with no facet name; "9 kết quả" plus "Hiển thị 1-9 trong 9".
- Status "Chờ duyệt" amber outline pill only (C5); no approve/reject visible except in `⋮`.
- 200 % text: only Nhân viên, Loại nghỉ and part of Thời gian are visible (C16).
- Dark: same layout; pink current item only.
  **Plan**
- Pattern: PATTERN-LIST.
- Changes: tabs "Chờ duyệt / Đã duyệt / Từ chối / Tất cả" (URL state) replace the select and the h2; columns Nhân viên (wrap, code second line), Loại nghỉ, Thời gian (range + "3 ngày" muted second line, nowrap), Lý do (wrap, 2 lines max with full text in the row detail drawer), Trạng thái (icon + word); approve/reject in the row menu and in the detail drawer footer (Từ chối secondary, Duyệt primary).
- Tells removed: h1/h2 echo, duplicate count.
- Baseline findings fixed: clipped-text 2, font-size 3, contrast 1 (artefact), hit-target 11 z20 t3, non-radix 20, shadow-gradient 5 z11, hover/pressed-missing 4/23, pink-dark 5 (F1). wig: leave.tsx:165/:340/:520 `formatDate` by string; :226 submit disabled until filled (reject :524); :248/:272/:283/:544 inputs lack `name`; :403 status filter in state. rbp: data.ts:35-49 `useEmployeeNames` walks 5 pages serially (names pop in late).
- Transitions: pattern (120 ms route fade).
- Checks: E2 clipped-text 0, hit-target 0; visual 1024 light + dark: "Lý do" readable, status not cut; 200 % text table scrolls in place.

### staff/income

**Critique**

- Only the empty state was capturable (owner account has no income source): a bordered box "Tài khoản Chủ Spa không có nguồn thu nhập…" with no next step (C33) and "Chủ Spa" in Title Case (copy flag) (sheets: light, dark).
- Toolbar: native select "Tháng" + bare "‹" "›" glyph chevrons (tiny, unboxed, C29) around a date field showing a single day "15/10/2026" while the period is a month; "Khoảng thời gian: 01/10/2026 – 31/10/2026" repeats the range as a caption line.
- No h2, good; but at 200 % text the empty box and description wrap fine, while the chevrons stay 12 px.
- Dark: neutral, readable; nothing pink on the page itself.
- Filled state (stat totals + per-source table) is not verifiable from this capture; must be seeded.
  **Plan**
- Pattern: PATTERN-REPORT.
- Changes: period control = kit segmented "Ngày | Tuần | Tháng" + a period stepper (prev/next as 40 px icon buttons with `aria-label`) showing the period label ("Tháng 10, 2026") instead of a day field; the range caption removed; filled state = Stat row (Tổng, theo nguồn) + DataTable; empty state = kit `EmptyState` with a next step ("Liên hệ quản lý để thiết lập nguồn thu nhập"), copy "Chủ spa".
- Tells removed: glyph chevrons, duplicated range caption.
- Baseline findings fixed: font-size 3, hit-target 2 z20 t3, non-radix 12, shadow-gradient 3 z9, hover/pressed-missing 3/14, pink-dark 5 (F1). wig: my-income.tsx:35-36 period + date in state, not URL; :129 raw `startTime–endTime`; :249 empty `<li>` for an unknown source key.
- Transitions: pattern (120 ms route fade).
- Checks: E2 hit-target 0 (stepper buttons ≥40 px); visual empty + seeded filled state at 1024 / 1440 light + dark.

### staff/my-payslips

**Critique**

- Empty state only (no payslip for the scratch user; my-payslip-detail therefore not capturable): h2 "Các tháng" orphan heading above "0 kết quả" + a floating refresh icon, then a shadowed box "Bạn chưa có phiếu lương nào." (E2 shadow-gradient on `.ls-table-state`) (sheets: light, dark).
- The empty message has no next step (C33) and the count "0 kết quả" says the same thing again.
- At 1024 and 200 % text the layout holds; nothing clipped.
- Dark: box hairline faint on `#1c1c1e`-ish surface; readable.
  **Plan**
- Pattern: PATTERN-LIST (one table of months: Tháng, Thực nhận, Trạng thái, row link to the slip).
- Changes: drop the h2 and the "0 kết quả" line; empty state = kit `EmptyState` "Chưa có phiếu lương" + one sentence ("Phiếu lương hiện ở đây sau khi bảng lương tháng được chốt.") with no button (nothing to do) ; seed one payslip so list + detail can be verified.
- Tells removed: orphan section heading, count-for-nothing, shadowed empty box.
- Baseline findings fixed: font-size 4, hit-target 2 z20 t3, non-radix 11, shadow-gradient 4 z10 (`div.ls-table-state`), hover/pressed-missing 3/14, pink-dark 5 (F1). wig: payroll-slip.tsx:84 "LUCY SPA" lacks `translate="no"`; payroll.ts:26 `monthLabel` hardcodes MM/YYYY (payroll-slip 84, 163, 170, 205, 277, 284).
- Transitions: pattern (120 ms route fade).
- Checks: E2 shadow-gradient 0; visual empty + seeded list at 1440 light + dark.

### staff/my-services

**Critique**

- Empty state only: "Bạn chưa có quyền thực hiện dịch vụ tại chi nhánh nào." in a bordered box, no next step (C33) (sheets: light, dark).
- Description two lines at 1024 ("Bắt đầu và kết thúc từng dịch vụ… Bạn chỉ nhận dịch vụ tiếp theo sau khi…"): instructions that belong to the filled state, shown even when the user cannot use the page.
- No branch filter visible in the empty state although the screen has one (my-services.tsx:46).
- 200 % text holds; dark neutral.
- Filled state (queue of assigned services with start/finish actions) not verifiable; must be seeded with a technician account.
  **Plan**
- Pattern: PATTERN-REPORT (filled state = branch facet + one list of assigned services, "Bắt đầu" / "Kết thúc" as the row's single primary, 44 px on coarse pointers).
- Changes: empty = kit `EmptyState` with the next step ("Nhờ quản lý thêm kỹ năng hoặc chi nhánh cho bạn"); description shortened to one line and hidden in the no-permission state; capture with a technician account in Step 2.
- Tells removed: none beyond the shell.
- Baseline findings fixed: font-size 3, hit-target 2 z20 t3, non-radix 10, shadow-gradient 3 z9, hover/pressed-missing 3/14, pink-dark 5 (F1). wig: my-services.tsx:46 branch filter in state. rbp: my-services.tsx:57-59 first branch via effect.
- Transitions: pattern (120 ms route fade).
- Checks: visual empty + seeded filled state 1024 / 1440 light + dark; E2 hit-target 0 on the row actions.

### staff/collaborator-schedule

**Critique**

- Empty state only (scratch has no CTV shifts): a bordered sunken box with one sentence "Chưa có lịch làm CTV trong khoảng thời gian này." and no next step, although "Xếp lịch CTV" is the obvious one (C33) (sheets: light, dark).
- Toolbar breaks the list pattern: a native `<select>` "Tất cả chi nhánh" with the system chevron (B9) plus two separate pill date fields, then a second line with a text-link action "Xóa bộ lọc" and a stray "0 kết quả" next to the refresh icon (FR "no text-link actions"; count belongs in "Hiển thị x–y trong n"). 1440 light.
- Primary "+ Xếp lịch CTV" uses a "+" glyph inside the label (tell) and is the only accent on the page, fine as the one primary; dark 1024-1440 it is a pink fill with dark text (B22, A4).
- h1 description runs two lines with an em-dash clause ("… — không tính theo giờ và không đổi theo chấm công"): copy to shorten, flag only (C41).
- 200 % zoom (640 css): primary drops under the description on its own line, the select stays full width and the date fields wrap to a second row; the toolbar becomes three rows with "Xóa bộ lọc" orphaned at the leading edge (C16).
  **Plan**
- Pattern: PATTERN-LIST (date-range variant).
- Changes: toolbar = one line: branch facet pill (kit select per F2.3, no native chevron) + kit `DateRangePicker` (one control, not two inputs) + refresh icon; "Xóa bộ lọc" becomes the facet's own clear item (shown only when a filter is set); remove "0 kết quả". Empty state = kit `EmptyState` "Chưa có lịch làm CTV" + sentence + `ButtonLink`/drawer trigger "Xếp lịch CTV" (secondary inside the empty state, header keeps the one primary). Drawer form (medium): agreed pay via `MoneyInput`, errors inline at the field.
- Tells removed: "+" glyph label, stray result count, text-link filter action.
- Baseline findings fixed: font-size 3, contrast 1 (nav artefact), hit-target 7 z20 t2, non-radix 12 (F1), shadow-gradient 4 z10 (F1), hover-missing 4, pressed-missing 19, pink-dark 5 (F1). wig: collaborator-schedule.tsx:70-71 range/branch in `useState` (move to URL), :207/:298 `formatDate` by string, :405 validation Notice not inline, :518 pay is plain `TextInput` (MoneyInput), :486-548 inputs lack `name`.
- Transitions: pattern (120 ms route fade).
- Checks: E2 hit-target 0 (zoom200 included), hover/pressed-missing 0, pink-dark 0; visual: empty state with its next step at 1440 light + dark; 200 % zoom toolbar at most two rows, no orphaned control.

### staff/chat-requests

**Critique**

- Empty list: h1 "Yêu cầu gọi lại", then an h2 "Danh sách yêu cầu" that only restates the page (heading repeats its own content, FR rule), a tinted "Trạng thái" filter pill, a bare "0" floating at the trailing edge beside refresh (reads as a stray glyph, Owner count rule), and a bordered empty box with no next step (C33) (sheets: light, dark).
- The h1 description is three lines at 1280 and states a retention policy ("tự xóa 90 ngày sau khi bạn đóng yêu cầu"): useful, but it belongs to the close-confirmation, not to the page header (copy flag, C41).
- Filter pill = burgundy-tinted fill in light, dark brown-pink fill in dark: a filled look for a non-primary control (A4, B22 dark).
- 200 % zoom/text: layout holds (single column), but the "0" and refresh drift to the trailing edge on their own row.
- No primary action, correct for an inbox; nothing else on the page, so the card-in-card look of the empty box on the canvas is the only surface.
  **Plan**
- Pattern: PATTERN-LIST (inbox, no primary).
- Changes: drop the "Danh sách yêu cầu" h2 and the bare count; toolbar = status facet + refresh; empty state "Chưa có yêu cầu gọi lại" + "Yêu cầu mới từ trợ lý trên website sẽ hiện ở đây." (no button: there is no action to take). Row menu "Đóng yêu cầu" gets a confirmation dialog stating the 90-day purge (move the policy sentence there).
- Tells removed: heading that repeats the page, stray "0", filled filter pill.
- Baseline findings fixed: font-size 4, contrast 1 (artefact), hit-target 7 z20 t2, non-radix 11, shadow-gradient 5 z11 (F1; incl. `div.ls-table-state.ls-cards-one-line` shadow), hover-missing 4, pressed-missing 19, pink-dark 5. wig: chat-requests.tsx:151 forward-only close fires from the row menu with no confirmation; :169 bare-number `resultCount`.
- Transitions: pattern (120 ms route fade).
- Checks: E2 shadow-gradient 0 on the empty state, hit-target 0; visual: empty state 1440 light + dark (no pink pill), seeded list state with status badges icon + word.

### staff/employees

**Critique**

- Four stacked tables (Quản lý, Nhân viên, CTV, Học viên), each with its own h2, header row, "Hiển thị" line and its own pager/page-size select: four list surfaces on one page instead of one `DataTable` with a classification facet (FR "one table surface", B12/B24) (sheets: light, dark, plus the 200 % zoom/text columns).
- Names are underlined burgundy text links 19 px tall (C29; E2 hit-target 47) and burgundy on every row is accent as decoration (A3, D5); in dark they turn pink `#e08a9a` (B22).
- Status = coloured outline pill word only ("Đang làm việc" green, "Chờ thiết lập" orange), no icon (C5); the "Trưởng nhóm · Lucy Spa Đà Nẵng - 04…" badge is a middle-dot meta string inside a blue pill and is clipped (tell; E2 clipped 2); "+1"/"+3" chips after branch names are unexplained counters.
- 1024 shows only Mã / Họ tên / Trạng thái while 1280 adds Chi nhánh, Chức danh, Cấp quản lý: columns silently dropped rather than a scroll container.
- 200 % text (1280): the table is cut at the right edge after "Chi nhánh" ("Lucy Spa Đ…"), status and `⋮` are unreachable with no scroll sign (C16, F2.6); 200 % zoom keeps 3 columns and a 44 px pager that wraps.
- Primary "+ Thêm nhân sự" uses the "+" glyph (tell) and navigates via `Button onClick`.
  **Plan**
- Pattern: PATTERN-LIST.
- Changes: one `DataTable` (20/page) with a "Phân loại" facet (Quản lý / Nhân viên / CTV / Học viên, multi-select) beside Chi nhánh and Trạng thái; classification becomes a column. Name cell = ink row link + code below in muted tabular nums; "Trưởng nhóm" becomes a plain text role in the Cấp quản lý column, branch overflow "+1" becomes "và 1 chi nhánh khác" tooltip. Long names wrap (C15), never truncate (data, not renamed). Primary = `ButtonLink` "Thêm nhân sự".
- Tells removed: four stacked tables, "+" glyph, middle-dot badge, burgundy underlined name links.
- Baseline findings fixed: clipped-text 2 z1, font-size 6 (h2 list-section titles 18), contrast 1 (artefact), hit-target 47 z56 t39, non-radix 30 z26, shadow-gradient 8 z14 (per-table wraps), hover-missing 6 (pager first/prev), pressed-missing 75, pink-dark 7 (links, pager current). wig: employees.tsx:78 create via `Button onClick`, :93 placeholder repeats label, :307 row menu `navigate()` instead of `href`; rbp: link.tsx forced prefetch on row links (shell block).
- Transitions: pattern (120 ms route fade).
- Checks: E2 hit-target 0, clipped-text 0, pressed-missing 0 on `ls-page-btn`, pink-dark 0; visual 1440 light + dark one table, one pager; 200 % text table scrolls inside its container with status and `⋮` reachable.

### staff/employee-detail

**Critique**

- Two back affordances: "← Quay lại" above a breadcrumb "Nhân sự › Hoàng Quốc Nguyệt" (C40, B7); the `⋮` overflow floats left of the primary "Sửa hồ sơ" with a gap, and at 200 % zoom the primary wraps under it, leaving `⋮` orphaned mid-row (sheets: light, dark).
- Header meta is an inline label-value chain "Chức danh: [Quản lý] Cấp quản lý: — Trạng thái tài khoản: [Đang làm việc]" with badges between colon labels: a meta string (tell) that wraps badly at 200 % zoom (status badge alone on a new line).
- One column of full-width cards at 1440: no record 8 / summary 4 split, half of each card is empty space (DESIGN 10 detail).
- Login id shown twice (Hồ sơ and Tài khoản đăng nhập cards), and the hint "Dùng để đăng nhập; không thay đổi được." runs on the same line as the value "NV0002" (E2 overlap at 1024, zoom200, text200); same for the account-status badge + hint.
- Card titles in the serif at 18 px (E2 font-size 13); tabs underline burgundy, dark pink text + border on the active tab (B22).
  **Plan**
- Pattern: PATTERN-DETAIL.
- Changes: header = h1 name + code muted + status badge (icon + word) + `⋮` then "Sửa hồ sơ" as the last item; Chức danh / Cấp quản lý move into the summary column as a description list. Two columns from 1024: left Hồ sơ facts, right "Tài khoản đăng nhập" summary (login id once, status, hint as a caption under the value, not inline). Tabs in the URL.
- Tells removed: colon meta chain, duplicated login id, serif card titles.
- Baseline findings fixed: overlap z2 t2 (login id/hint, badge/hint), font-size 13, contrast 1 (artefact), hit-target 14 z20 t3, non-radix 19, shadow-gradient 6 z12 (cards), hover-missing 4, pressed-missing 28, pink-dark 8 (breadcrumb link, active tab). wig: employee-detail.tsx:136 tab and :344 history page in `useState`; :420 active assignment shows "…" as revoked date (use "—"); :553 submit disabled until filled; :572 reason input lacks `name`; employee-lifecycle.tsx:104 `formatDate` by string, :401/:502/:652 disabled submits, :636 password errors not inline; employee-roles.tsx:337, employee-skills.tsx:323 disabled submits.
- Transitions: pattern (120 ms route fade); tab switch instant.
- Checks: E2 overlap 0 (all modes), font-size 0, pink-dark 0; visual 1440 light + dark two columns, one primary; 200 % zoom header actions on one row or `⋮` grouped with the primary.

### staff/employee-new

**Critique**

- Footer "Hủy" is a rose-tinted filled pill next to the solid "Tạo nhân sự": two filled buttons side by side (B11, A4); in dark both are filled (dark burgundy + pink) (sheets: light, dark).
- Fields are full pills (D8 says 8 px for fields); date fields are text inputs with a "dd/mm/yyyy" placeholder; "Ngôn ngữ của nhân sự" is a native select with the system chevron (B9).
- Two back affordances ("← Quay lại" + breadcrumb "Nhân sự › Thêm nhân sự") (C40); the page intro sentence sits inside the card above the first group instead of under the h1.
- At 1440 the form card spans the full content width (≈1100 px) with two narrow field columns: no 720 max width (DESIGN 10 form); the footer sits outside the card at the trailing edge, detached from the fields.
- Long form with no unsaved-changes guard; all errors go to one Notice at the bottom (wig).
- 200 % zoom/text: single column holds, labels wrap ("Ngôn ngữ của nhân sự *" breaks before the asterisk), radio descriptions readable.
  **Plan**
- Pattern: PATTERN-FORM (long form = page).
- Changes: one column max 720, groups "Thông tin cá nhân", "Phân loại và ngày bắt đầu", "Chi nhánh", "Tài khoản đăng nhập" separated by heading + 32 px (no card per group); intro sentence becomes the `PageHeader` description; date fields = kit `DateInput`; language = kit select; classification radios keep their descriptions (kit radio group with `role="radiogroup"` + label). Footer sticky: "Hủy" (secondary outline, a link) then "Tạo nhân sự". Breadcrumb only.
- Tells removed: tinted Cancel pill, pill fields, intro paragraph inside the card.
- Baseline findings fixed: font-size 11, contrast 1 (artefact), hit-target 13 z20 t3, non-radix 18 z17, shadow-gradient 5 z11 (card), hover-missing 9 (inputs), pressed-missing 29, pink-dark 6 (breadcrumb, primary). wig: employee-create.tsx:79 forbidden message without next step, :89 Cancel via `onClick`, :121 no unsaved guard, :202 and :250 code/email lack `spellCheck={false}`, :399 errors in one Notice, first invalid field not focused, :214 inputs lack `name`; rbp: employee-create.ts:141 `dates.sort().at(-1)`.
- Transitions: pattern (120 ms route fade).
- Checks: E2 hover-missing 0 on inputs, pressed-missing 0, font-size 0, pink-dark 0; visual 1440 light + dark one filled button, 720 column; 200 % text labels wrap by word, asterisk stays with its label.

### staff/teams

**Critique**

- Name column = burgundy underlined links ("Nhóm 1", 19 px tall; E2 hit-target 13) and pink in dark (A3, C29, B22); no row `⋮` menu, unlike every other list (FR fixed action places) (sheets: light, dark).
- Branch column wraps every branch name to two lines ("Lucy Spa Đà Nẵng - 04 / Nguyễn Quang Bích"), so rows are uneven and the long team name wraps under it; "Chưa có trưởng nhóm" is an empty value written as a sentence in ink, same weight as a real name.
- "3 kết quả" beside refresh duplicates "Hiển thị 1-3 trong 3" (Owner count rule).
- 200 % text: names break per syllable ("Nhóm / 1", "Nhóm chă…" truncated) and the branch column truncates to "Lucy Spa Đà Nẵng -…" (C15/C16; E2 clipped t1); 200 % zoom drops Chi nhánh and Trưởng nhóm silently.
- Primary "+ Tạo nhóm" with "+" glyph (tell).
  **Plan**
- Pattern: PATTERN-LIST.
- Changes: add the row `⋮` (Chi tiết as `href`, Đổi trưởng nhóm, Sửa); empty team leader = muted "—" with the "Chưa có" meaning in the column header tooltip; Thành viên numeric right-aligned nowrap; name column min width so names wrap by word; drop "3 kết quả". Create stays a dialog (short form).
- Tells removed: "+" glyph, duplicate count, burgundy underlined name links.
- Baseline findings fixed: font-size 2, contrast 1 (artefact), hit-target 14 z23 t3, non-radix 17 z16, shadow-gradient 5 z11, hover-missing 4, pressed-missing 26, pink-dark 6, clipped-text t1. wig: teams.tsx:272-587 inputs lack `name` (create/edit dialogs).
- Transitions: pattern (120 ms route fade).
- Checks: E2 hit-target 0, clipped-text 0 at 200 % text, pink-dark 0; visual 1440 light + dark equal row heights except wrapped names; 200 % text names wrap by word.

### staff/team-detail

**Critique**

- Header has two filled buttons side by side: "Đổi trưởng nhóm" (rose tint) + "Sửa nhóm" (solid) plus a detached `⋮` (B11, A4, C4); dark: dark-burgundy fill + pink fill (B22) (sheets: light, dark).
- Tab label "Thành viên (3)" carries a count (Owner rule); the second tab "Thêm thành viên" is an action dressed as a tab.
- Members table toolbar ends with an unexplained "✓" icon button after "3 kết quả" and refresh; checkboxes on rows with no visible bulk bar; "Trạng thái" is plain text here while the employees list uses badges (inconsistent), and "Nhóm hiện tại" repeats "Nhóm 1" on every row.
- 200 % text: member names break per syllable down a narrow column ("Vũ / Thị / Khôi / (NV0 / 003)") (C15/C16) while Trạng thái/Loại việc làm keep their width.
- Summary card (Chi nhánh, Mã, Trưởng nhóm, Thành viên) is fine as a description list but spans the full width with two sparse columns.
  **Plan**
- Pattern: PATTERN-DETAIL.
- Changes: header primary "Sửa nhóm"; "Đổi trưởng nhóm" moves into `⋮` (or a secondary outline in the summary card header next to "Trưởng nhóm"). Summary right column (4) from 1024, members table left (8). Tabs "Thành viên" / "Thêm thành viên" become one members table with a toolbar action "Thêm thành viên" (opens the picker dialog); bulk-selection bar appears on the toolbar line only when rows are checked; the "✓" control removed or named. Status as badge icon + word; drop "Nhóm hiện tại" on this page. Name column min width, code on a second muted line.
- Tells removed: two filled buttons, count in tab, unlabeled icon control.
- Baseline findings fixed: font-size 9, contrast 1 (artefact), hit-target 12 z20 t3, non-radix 21, shadow-gradient 6 z12, hover-missing 7 (incl. inputs), pressed-missing 29, pink-dark 8 (breadcrumb, active tab). wig: teams.tsx:669 tab in `useState`, :711-715 member filters and paging in `useState`, :1085 textarea lacks `name`.
- Transitions: pattern (120 ms route fade).
- Checks: E2 pressed-missing 0, pink-dark 0, font-size 0; visual 1440 light + dark one filled button; 200 % text names wrap by word, no per-syllable breaks.

### staff/roles

**Critique**

- h1 description is four lines at 1440 (definition of a role, scope, and what a role is not): page-level documentation in the header (C41; copy flag) (sheets: light, dark).
- "Nhóm quản lý" blue info pill appended to the role name inline: a badge as decoration next to the primary cell; at 200 % text it overlaps the wrapped name (E2 overlap t2).
- Every row "Đang dùng" green outline pill without icon (C5) and sort arrows "↑" printed on every header at rest (noise); "6 kết quả" beside refresh duplicates the "Hiển thị" line.
- 200 % text: names truncate ("Lễ tân tiếp đón khách…", "Quản lý khu vực…") (C15; E2 clipped t4) and the status column is cut at the right edge.
- Codes (KTV, RECEPTION, BRANCH_MANAGER) in ink at body weight compete with the names; dark: primary pink, current pill pink (B22).
  **Plan**
- Pattern: PATTERN-LIST.
- Changes: description cut to one line (flag copy: "Vai trò là một nhóm quyền gán cho nhân sự."), the rest moves to the create/edit dialog help; "Nhóm quản lý" becomes a "Loại" column (text) or a facet; codes muted, tabular, `translate="no"`; sort icon only on the sorted column and on hover/focus; name wraps.
- Tells removed: inline decorative badge, permanent sort arrows, duplicate count.
- Baseline findings fixed: font-size 2, contrast 1 (artefact), hit-target 6 z20 t3, non-radix 21 z20, shadow-gradient 5 z11, hover-missing 8 (`ls-th-sort`), pressed-missing 22, pink-dark 5, overlap t2, clipped-text t4. wig: roles.tsx:223 placeholder repeats label, :466 role code lacks `spellCheck={false}`/`name`, :478-518 inputs lack `name`.
- Transitions: pattern (120 ms route fade).
- Checks: E2 overlap 0, clipped-text 0 at 200 % text, hover-missing 0 on sort headers; visual 1440 light + dark; 200 % text all columns reachable.

### staff/skills

**Critique**

- Clean single table, but every one of the 20 rows shows the same green "Đang hoạt động" pill (no icon, C5): 20 identical badges are noise; status only needs to stand out when it is not the default (sheets: light, dark).
- 1024 drops "Tên tiếng Anh"; 200 % text cuts the table at the right edge mid-word ("Relaxation r…", "Wellness ha…"), status and `⋮` unreachable, no scroll sign (C16, F2.6).
- Pager = « ‹ 1 2 › » circles + "20 dòng mỗi trang" native-looking select; current page solid burgundy (light) / pink (dark, B22); at 200 % zoom the pager wraps to its own line under the "Hiển thị" text.
- Sort arrows on every header at rest; "25 kết quả" duplicates "Hiển thị 1-20 trong 25"; primary "+ Thêm kỹ năng" "+" glyph.
  **Plan**
- Pattern: PATTERN-LIST.
- Changes: status badge with icon; default "Đang hoạt động" shown as a muted dot + word, "Ngừng" as the warning tone (keeps C5, removes the wall of green); English name column muted, shown from 1280 and inside the scroll container below; drop the extra count. Create/edit stays a dialog.
- Tells removed: identical badge wall, "+" glyph, duplicate count, permanent sort arrows.
- Baseline findings fixed: font-size 2, contrast 1 (artefact), hit-target 11 z20 t3, non-radix 24 z23, shadow-gradient 5 z11, hover-missing 10 (`ls-th-sort`, pager), pressed-missing 29, pink-dark 6 (pager current). wig: skills.tsx:170 placeholder repeats label, :274 code lacks `spellCheck={false}`/`autoCapitalize="none"`, :274-363 inputs lack `name`.
- Transitions: pattern (120 ms route fade).
- Checks: E2 hover-missing 0, pink-dark 0 (pager), hit-target 0; visual 1440 light + dark; 200 % text: scroll container with visible edge, status reachable.

### staff/organization

**Critique**

- A permanent blue info Notice (three lines) sits between the header and the tabs explaining ownership and appointment rules: documentation as page chrome, it pushes the data down on every visit (C41; copy flag) (sheets: light, dark).
- Tabs carry counts "Vùng (3)", "Khu vực (4)", "Chi nhánh (4)", "Bổ nhiệm quản lý (1)" (Owner rule); the header primary "+ Tạo vùng" only fits the first tab (the primary changes meaning per tab).
- 200 % zoom: the status badge is cut at the right edge ("Đang hoạt độn") and the last tab is clipped; 200 % text: status reduced to "Đa", `⋮` gone (C16).
- Status pills word-only (C5); "3 kết quả" duplicate count; dark: Notice is blue text on navy fill, active tab pink (B22).
  **Plan**
- Pattern: PATTERN-LIST (tabbed list).
- Changes: Notice text moves into the description (one line) + a help link/"Tìm hiểu" popover; tabs without counts, tab in the URL; the create action becomes per tab in the toolbar line ("Tạo vùng" / "Tạo khu vực" / "Tạo chi nhánh" / "Bổ nhiệm") with the header carrying no primary, or the header primary follows the active tab label (pick one, recommend toolbar). Tab bar scrolls horizontally with a fade edge under 768 css.
- Tells removed: counts in tabs, explainer notice block, duplicate count, "+" glyph.
- Baseline findings fixed: font-size 2, contrast 1 (artefact), hit-target 14 z20 t3, non-radix 22, shadow-gradient 5 z11, hover-missing 7 (`ls-th-sort`), pressed-missing 30, pink-dark 7 (active tab). wig: organization.tsx:162 placeholder repeats label, :433 `startedAt.slice(0, 10)` UTC date; organization-dialogs.tsx:47-275 inputs lack `name`, :89/:210 codes lack `spellCheck={false}`, :599 employee search error shown as "not found", :602 placeholder lacks "…".
- Transitions: pattern (120 ms route fade).
- Checks: E2 pink-dark 0, hover-missing 0; visual 1440 light + dark; 200 % zoom and text: status column and tabs fully visible.

### staff/branches

**Critique**

- Already broken at 1024 light: the table is wider than its card, the status badge is cut ("Đang hoạt độn") and the `⋮` menus are off the edge with no scroll sign (C16, F2.6); 200 % zoom shows "Đang h"/"Ngừng", 200 % text drops status entirely (E2 overlap z1 name over `⋮`) (sheets: light, dark).
- Branch names truncate with an ellipsis ("Lucy Spa Đà Nẵng Bãi Biển Mỹ Khê Premium Re…", "…Nguyễn Văn Hưởng, TP. Th…") (C15; E2 clipped 2) as burgundy underlined links 19 px tall (C29, A3), pink in dark (B22).
- Time zone shown as the raw IANA id "Asia/Ho_Chi_Minh" in every row: a developer string, not a label; codes like "TMP_58fc8c19" are seed data (data, not planned).
- No search or filter toolbar at all (fine for 4 rows, but the pattern still wants status facet once branches grow); primary "+ Thêm chi nhánh" "+" glyph.
  **Plan**
- Pattern: PATTERN-LIST.
- Changes: column widths: Mã (nowrap, muted), Tên (flex, wraps), Múi giờ (formatted "Giờ Việt Nam (UTC+7)" with the IANA id in a tooltip / `translate="no"`), Trạng thái (badge icon + word), `⋮` (fixed 48 px); table scrolls inside its container below its min width. Add a status facet + search when count > 20. Create/edit stays a dialog; codes and timezone fields `spellCheck={false}`.
- Tells removed: "+" glyph, raw IANA string, burgundy underlined name links.
- Baseline findings fixed: clipped-text 2, font-size 2, contrast 1 (artefact), hit-target 21 z24 t7, non-radix 20 z19, shadow-gradient 5 z11, hover-missing 4, pressed-missing 31, pink-dark 6, overlap z1. wig: branches.tsx:43-44 page/size in `useState`, :88 row menu `navigate()` (use `href`), :189/:209 code and timezone lack `spellCheck={false}`, :199 inputs lack `name`.
- Transitions: pattern (120 ms route fade).
- Checks: E2 clipped-text 0, overlap 0, hit-target 0, pink-dark 0; visual 1024 light: status and `⋮` fully visible; 200 % zoom/text: trailing columns reachable by the table's own scroll.

### staff/branch-detail

**Critique**

- Two back affordances above the h1: "← Quay lại" and the breadcrumb "Chi nhánh ›" (B7/C40, all modes); status sits on its own
  "Trạng thái: [Đang hoạt động]" line under the header instead of next to the h1 (sheets: light, dark).
- Subtitle "LUCY01 · Asia/Ho_Chi_Minh" is a middle-dot meta string (tell) and shows the raw IANA id to staff; "Múi giờ" fact
  repeats it raw (copy flag: say "Giờ Việt Nam (UTC+7)").
- "Sửa giờ hoạt động" in the card header is a tinted pink fill next to the filled primary "Sửa thông tin" (A4, B11 feel), 1440 light;
  in dark the primary is a pink fill with dark text and the secondary a burgundy tint (B22).
- 1440: two cards stretch full width with ~60 % empty space; no 8/4 record/summary split (D10 detail). Card titles 18 serif.
- Opening hours read row-wise across two columns (Thứ Hai | Thứ Ba ...), Chủ Nhật orphaned alone; a 7-row hours table reads faster.
- 200 % zoom: h1 wraps to two lines (fine) but the `⋮` and primary drop to a separate row with the `⋮` floating left of it.
  **Plan**
- Pattern: PATTERN-DETAIL.
- Changes: header = h1 + status badge inline + "Sửa thông tin" primary + `⋮`; subtitle = code only (tabular, `translate="no"`);
  timezone shown as its label, raw id only in the edit dialog; record column = Chi tiết, summary column (4) = status + hours;
  hours as a 2-column description list Mon→Sun in one column (day | 09:00–21:00), "Sửa giờ hoạt động" = ghost/secondary
  outline in that card header; IANA field `spellCheck={false}` in the dialog.
- Tells removed: middle-dot subtitle, tinted secondary fill, "Trạng thái:" label row.
- Baseline findings fixed: font-size 14, hit-target 17 (z20 t3), non-radix 16 (z15), shadow-gradient 6 (z12), hover 4,
  pressed 28, pink-dark 6 (breadcrumb `a.ls-link "Chi nhánh"` #e08a9a; F1), section.ls-card shadow; wig branch-detail.tsx:262
  (inputs lack name/autoComplete: :262, :272, :359, :366), :272 timezone `spellCheck={false}`.
- Transitions: pattern (120 ms route fade).
- Checks: E2 font-size 0, pink-dark 0, shadow-gradient 0, hover/pressed-missing 0 on page controls; visual 1440 light + dark:
  one filled button, 8/4 split; 200 % zoom: actions stay on the header line or wrap as a group.

### staff/services

**Critique**

- 1024 light/dark: the table is cut at the right edge after "Nhóm" (Giá, Thời lượng, Trạng thái, `⋮` invisible) with no scroll
  sign; same at 200 % zoom and 200 % text (C16, F2.6) (sheets: light, dark).
- Leading column is the ALL-CAPS service code (CAT_DA_SUA_FORM_MONG, truncated "COMBO_CAT_DA_UP_MONG_SO…"); the human name is the
  second column as an underlined burgundy link 19 px tall (C29, E2 hit-target 38). Name should lead.
- Tab labels carry counts "Dịch vụ (114)", "Nhóm dịch vụ (10)" (Owner rule: no counts by headings/tabs) and the toolbar repeats
  "114 kết quả" next to the "Hiển thị 1-20 trong 114" line (count twice).
- Status = coloured outline pill word only ("Đang hoạt động" green, "Ngừng hoạt động" grey) (C5).
- Dark 1280/1440: name links and active tab pink `#e08a9a`, pager current pink fill, primary pink fill (B22).
- Seed rows "Dịch vụ POS EXACT" / P9_EXACT_* are test data in the scratch DB (data, not planned).
  **Plan**
- Pattern: PATTERN-LIST.
- Changes: column order Tên (wraps) · Nhóm · Giá · Thời lượng · Trạng thái · Mã (muted, last, `translate="no"`); drop "114 kết quả"
  from the toolbar; tabs without counts; price ranges "5.000–30.000 ₫/ngón" nowrap tabular; table scrolls in its own container
  at 1024 / 200 %; category Select placeholder becomes a prompt ("Chọn nhóm…") instead of bare "—".
- Tells removed: ALL-CAPS code as lead column, counts in tabs, duplicate count.
- Baseline findings fixed: font-size 3, hit-target 38 (z40 t23; 35 page-specific row links), non-radix 28, shadow-gradient 5
  (z11), hover-missing 10 (`ls-th-sort` Mã/Tên/...), pressed 55, pink-dark 8 (tab + links; F1); wig services.tsx:902 bare "—"
  placeholder, :676 10 inputs lack name; rbp services.tsx:142-143,165-201 `categoryName` find per cell/sort → index map.
- Transitions: pattern (120 ms route fade).
- Checks: E2 hit-target on row links 0, hover-missing `ls-th-sort` 0, pink-dark 0; visual 1024 light: last column + `⋮`
  reachable by the table scroll with a visible edge; 200 % text same; dark 1440 no pink.

### staff/service-detail

**Critique**

- Same header anatomy as branch-detail: "← Quay lại" + breadcrumb, subtitle "CAT_DA_SUA_FORM_MONG · 20.000 ₫" middle-dot meta
  (tell), status on its own "Trạng thái:" line (sheets: light, dark).
- "Thông tin dịch vụ" card is a 2-column grid of 14 facts where 8 values are "—" (descriptions, inclusions, steps, FAQ in VI/EN);
  VI and EN alternate across columns so a reader zig-zags; "Ảnh: Chưa chọn ảnh." is a text fact, no photo slot.
- "Đổi giá" in the price card is a tinted pink fill (A4) beside the filled primary "Sửa dịch vụ"; dark: primary pink, tab
  underline + label pink (B22).
- 1440: single column, price card full width with two facts; no 8/4 summary (price + status belong in the summary column).
- 200 % zoom: the code breaks mid-word "CAT_DA_SUA_FORM_M / ONG" (C15) and labels like "Thời lượng xếp lịch nội bộ (phút)" wrap
  to three lines in a half column.
  **Plan**
- Pattern: PATTERN-DETAIL.
- Changes: Tổng quan tab = record column with two groups "Tiếng Việt" / "Tiếng Anh" (each a one-column description list),
  empty content fields collapsed into one line "Chưa có nội dung: mô tả, các bước, câu hỏi thường gặp" with an "Thêm nội dung"
  link to the edit drawer; summary column = price (Giá, Đơn vị tính giá, "Đổi giá" as outline), duration, status, photo slot
  (8 px media frame, empty state with "Chọn ảnh"); code `overflow-wrap:anywhere` only on the code value, `translate="no"`.
- Tells removed: middle-dot subtitle, tinted secondary, wall of "—" facts.
- Baseline findings fixed: font-size 21 (12 page-specific: card titles 18, values 16), hit-target 19, non-radix 17,
  shadow-gradient 6 (z12), hover 4, pressed 31, pink-dark 8 (breadcrumb, active tab; F1); wig service-detail.tsx:107 tab in
  useState → URL, :604 "Rút khỏi chi nhánh" posts from the row menu with no confirm (add confirmation dialog), :654 skills form
  no unsaved guard, :402 inputs lack name; service-content-fields.tsx:69 FAQ group titles are `<p>`, make them headings.
- Transitions: pattern (120 ms route fade); tab switch instant.
- Checks: E2 font-size 0, pink-dark 0; visual 1440 light + dark: 8/4 split, one filled button; 200 % zoom: no mid-word break
  in prose labels.

### staff/discounts

**Critique**

- Header description is three lines of policy prose under the h1 (copy flag: shorten to one line, move the rule to help);
  at 200 % zoom it pushes the table below the first screen (sheets: light, dark).
- 1024 + 200 % zoom/text: table cut at the right ("Đã d…", "Đang cha"), no scroll edge (C16).
- Program names ellipsised "Ưu đãi khách hàng thân thiết dịp …" in 5 rows: the rows become indistinguishable (C15, E2 clipped 5).
- Meta strings "Theo mã · 9 mã" (middle dot) and "30/09/2026 00:14 → 30/12/2026 00:14" (arrow glyph) in cells (tells).
- Toolbar "14 kết quả" duplicates "Hiển thị 1-14 trong 14"; primary "+ Tạo chương trình" uses a plus glyph label.
- Dark: program links, primary and current pill pink (B22).
  **Plan**
- Pattern: PATTERN-LIST.
- Changes: columns Chương trình (wraps, lead) · Loại (“Tự áp dụng” / “Theo mã (9)”) · Mức giảm · Hiệu lực (two lines start/end,
  en dash, nowrap) · Đã dùng · Trạng thái · Mã chương trình (muted, last); remove toolbar count; "Tạo chương trình" as
  `ButtonLink` with the kit plus icon (not a text glyph).
- Tells removed: middle-dot meta, "→" in the date cell, duplicate count.
- Baseline findings fixed: clipped-text 5, font-size 2, hit-target 23 (z34 t16; row links "Giảm 18%" 19 px), non-radix 22 (z21),
  shadow-gradient 5 (z11), hover 7 (`ls-th-sort`), pressed 38, pink-dark 6 (F1); wig discounts.tsx:146 row menu → href,
  :157 create → ButtonLink, :174 placeholder "…" + example.
- Transitions: pattern (120 ms route fade).
- Checks: E2 clipped-text 0, hit-target 0 on row links, hover-missing 0, pink-dark 0; visual 1024 + 200 % text: all columns
  reachable by the table scroll.

### staff/discount-detail

**Critique**

- One card at 1440 holding seven facts in two columns, ~70 % of the canvas empty; no summary column (sheets: light, dark).
- Primary "+ Tạo phiên bản mới" (plus glyph) is the only header action; editing a running program has no visible way except
  versions (fine), but the `⋮` sits detached left of the primary at 1440 and drops to its own row at 200 % zoom.
- Card title "Đang áp dụng (phiên bản 1)" mixes status and version in a heading; "Hiệu lực 30/09/2026 00:14 → 30/12/2026 00:14"
  uses an arrow glyph and wraps mid-range at 200 % zoom; "Đã dùng 17" has no unit.
- Data note (Owner data, not planned): program named "Giảm 18%" shows "Mức giảm 85.000 ₫".
- Dark: breadcrumb link, active tab "Hiện tại" text + underline pink (B22).
  **Plan**
- Pattern: PATTERN-DETAIL.
- Changes: header h1 + status badge "Đang chạy" (icon + word) + primary "Tạo phiên bản mới" + `⋮`; card title "Phiên bản đang
  áp dụng", version number as a fact; record column = rule facts (Mức giảm, Chi tiêu tối thiểu, Phạm vi, Áp dụng cho, Giới hạn),
  summary column = Hiệu lực (Từ / Đến as two facts), Đã dùng "17 lượt", Mã chương trình; tab in URL; Phiên bản / mã giảm giá
  tables per PATTERN-LIST; voucher codes `translate="no"`.
- Tells removed: plus glyph, "→" range, parenthetical heading.
- Baseline findings fixed: font-size 10, hit-target 10 (tab gap 4: `Hiện tại`/`Phiên bản`), non-radix 17, shadow-gradient 5
  (z11), hover 4, pressed 24, pink-dark 8 (F1); wig discount-detail.tsx:81 ErrorState no retry, :97 tab useState, :208 "Phiên
  bản mới" Button onClick → ButtonLink, :438/:502 pages in useState, :509 code translate, :629 voucher input spellCheck/name;
  rbp discount-targets.tsx:155-171 undebounced catalog scan → `useDeferredValue`, :165 Set lookup.
- Transitions: pattern (120 ms route fade).
- Checks: E2 hit-target tab gap 0, pink-dark 0, font-size 0; visual 1440 light + dark 8/4 split; 200 % zoom dates not split.

### staff/discount-new

**Critique**

- Fields are full pills and native `<select>`s are browser-styled pills with the system chevron (D8 8 px, B9) (sheets: light, dark).
- Validity uses native `datetime-local` showing "mm/dd/yyyy --:-- --" in a Vietnamese UI (US order, AM/PM); at 200 % zoom the
  two date fields shrink until the value clips (C16).
- Footer "Hủy" is a tinted pink fill beside the primary "Tạo chương trình" (A4 secondary filled, B11); dark: Hủy burgundy fill,
  primary pink fill (B22).
- Card holds six serif sub-headings (Chương trình, Mức giảm, Thời gian hiệu lực, ...) plus long grey hints under almost every
  field; the 16 px native checkbox for "Cần mã ưu đãi" is below the 40 px target (C29).
- 1440: form card ~590 px wide, left aligned, footer buttons outside the card at its right edge (fine) but the page reads empty.
  **Plan**
- Pattern: PATTERN-FORM (long form, own page).
- Changes: kit DateTimeField (dd/mm/yyyy HH:mm, 24 h, branch zone "Giờ Việt Nam (UTC+7)" as the group hint once); money and
  minimum spend as `MoneyInput` (₫ suffix, grouping); "Cần mã ưu đãi" as a kit Switch/checkbox row with a 40 px label target;
  hints cut to one line where a field is self-explanatory (copy flag); code field `spellCheck={false}`, uppercase hint kept;
  inline errors at the field + focus first invalid (not one Notice at the bottom); Cancel = link-styled secondary outline.
- Tells removed: tinted Cancel fill, serif sub-headings (compact heading step), pill fields.
- Baseline findings fixed: font-size 8, hit-target 9, non-radix 16 (z15), shadow-gradient 5 (z11), hover 5 (input), pressed 23,
  pink-dark 6 (F1); wig discount-new.tsx:41 validation Notice at bottom, :69 forbidden copy without next step, :81 Cancel via
  onClick → link; discount-form.tsx:79 code spellCheck, :152/:165 money TextInput → MoneyInput, :100 inputs lack name.
- Transitions: pattern (120 ms route fade).
- Checks: E2 hover-missing on inputs 0, pressed-missing on footer 0, font-size 0; visual 1440 light + dark: one filled button;
  200 % zoom: date values fully visible; dates in dd/mm/yyyy.

### staff/discount-version-new

**Critique**

- Same form as discount-new with the same defects: pill fields, browser-styled selects (B9), tinted "Hủy" fill beside the primary
  (A4/B11), dark pink primary (B22) (sheets: light, dark).
- Dates prefilled as "09/30/2026 12:14 AM" (US order, 12 h) in a VI UI; at 200 % zoom they clip to "09/30/2026 1" (C16).
- Amount prefilled "85000" with no grouping or ₫ (plain TextInput); labels carry "(₫)" / "(đ)" units in parentheses.
- Lead note "Phiên bản cũ không bị sửa…" is plain grey text at the top of the card, not a Notice; primary is "Lưu" while the
  page is "Tạo phiên bản mới" (verb mismatch; discount-new says "Tạo chương trình").
- Subtitle "Giảm 18%" under the h1 repeats the breadcrumb.
  **Plan**
- Pattern: PATTERN-FORM (shares discount-form.tsx with discount-new; fix once).
- Changes: as discount-new (DateTimeField 24 h dd/mm, MoneyInput); primary label "Tạo phiên bản"; lead note = kit info Notice
  (icon + one sentence); drop the subtitle (breadcrumb carries the parent); unsaved guard kept.
- Tells removed: tinted Cancel, pill fields, unit-in-parentheses labels (unit moves into the field suffix).
- Baseline findings fixed: font-size 7, hit-target 9, non-radix 16 (z15), shadow-gradient 5 (z11), hover 4, pressed 23,
  pink-dark 6 (F1); wig discount-version.tsx:40 ErrorState no retry, :64 validation Notice at bottom, :113 Cancel onClick → link;
  discount-form.tsx:152/:165 MoneyInput.
- Transitions: pattern (120 ms route fade).
- Checks: same as discount-new; plus visual: prefilled amount shows "85.000 ₫", dates "30/09/2026 00:14".

### staff/loyalty

**Critique**

- 13 tabs in one row (Khách hàng, Giới thiệu, Ngoại lệ, Combo, Combo đã bán, Lịch sử dùng combo, Cấp quà tặng, Danh mục quà,
  Quà sinh nhật, Kích hoạt…) are cut at the right edge at 1024, 1280 and 1440 ("C", "Qu", "Kích hoạ") with no scroll sign
  (B10/C59) (sheets: light, dark).
- Header description two lines of policy prose (copy flag).
- "Tìm khách" lookup is a form in a card: labels "Tìm theo" / "Số điện thoại" above toolbar controls (FR rule), browser-styled
  native select (B9), "Tra cứu" primary rendered faded (disabled until typed; E2 hover-missing on it) — looks broken, not
  inviting.
- The page below the lookup is empty: no empty state telling staff what they will see (C33).
- Dark: active tab text + underline pink, "Tra cứu" pink-tinted (B22).
  **Plan**
- Pattern: PATTERN-REPORT (lookup) with a section switch.
- Changes: split the 13 tabs into a short primary tab set (Khách hàng, Giới thiệu, Combo, Quà tặng, Ngoại lệ, Kích hoạt) with
  the combo/gift sub-views as a segmented control inside each tab, or a scrolling tab row with edge fade + scroll buttons per
  F2.4 (decision for the Owner; list both); lookup = one toolbar line: segmented "SĐT / Email" + search field + "Tra cứu"
  primary always enabled (validate on submit), no labels above; below it an EmptyState "Nhập số điện thoại hoặc email để xem
  điểm của khách". Lookup input `name`, `spellCheck={false}` in email mode.
- Tells removed: clipped tab row, disabled-looking primary, labels above toolbar controls.
- Baseline findings fixed: font-size 3, hit-target 18 (tab gaps 4 px between `ls-tab`), non-radix 16, shadow-gradient 5 (z11),
  hover 5 (`ls-btn-primary "Tra cứu"`), pressed 32, pink-dark 7 (tab; F1); wig loyalty.tsx:247 input spellCheck/name;
  loyalty-adjust-dialog.tsx:55 generic validation copy; loyalty-* tabs paging in useState (combos :44, rewards-catalog :50,
  birthday :56) → URL.
- Transitions: pattern (120 ms route fade).
- Checks: E2 hit-target tab gap 0, hover-missing 0, pink-dark 0; visual 1024/1280/1440 light: every tab reachable and the
  overflow visible; dark 1440 no pink.

### staff/products

**Critique**

- Header has three actions: "Trang mỹ phẩm" and "Cài đặt" as tinted pink fills plus the filled "Thêm sản phẩm" (A4, B11, C4);
  at 1024 they wrap onto a row of their own under the h1 (sheets: light, dark).
- 12 rows read "Kem chống nắng phổ rộng SPF50…" truncated identically: the variants that differ only after the cut are
  indistinguishable (C15, E2 clipped 11). Names are underlined burgundy 19 px links (C29).
- 1024 and 200 % zoom/text: table cut at the right ("Đang b…", "Chăm…"), no scroll edge (C16); E2 overlap z10 (name link under
  the `⋮` button at 200 % zoom).
- Thumbnail column mixes a small icon placeholder and a flat grey square for missing photos (two empty-photo styles, R17
  structure); "61 kết quả" duplicates the "Hiển thị" line; tabs Sản phẩm / Thương hiệu / Danh mục fine.
- Dark: names, active tab and current page pink; primary pink fill (B22).
  **Plan**
- Pattern: PATTERN-LIST.
- Changes: header = primary "Thêm sản phẩm" (`ButtonLink`) only; "Trang mỹ phẩm" (public shop link) and "Cài đặt" (dialog) move
  into a header `⋮` overflow; name column wraps to two lines with a 40 px square thumbnail (8 px radius, one empty-photo glyph
  style); columns Tên · Thương hiệu · Danh mục · Giá bán (nowrap, range "231.200–392.000 ₫") · Biến thể · Trạng thái; toolbar
  count removed.
- Tells removed: three-button header with tinted fills, duplicate count, mixed placeholders.
- Baseline findings fixed: clipped-text 11, font-size 2, hit-target 39 (z40 t23), non-radix 27 (z26), shadow-gradient 5 (z11),
  hover 11 (`ls-th-sort`), pressed 57, pink-dark 8 (F1), overlap z10; wig products.tsx:230 placeholder, :317 Add → ButtonLink;
  products-taxonomy.tsx:226 inputs name, :190 no focus on invalid, :79 codes translate="no", :80 raw counts → Intl.
- Transitions: pattern (120 ms route fade).
- Checks: E2 clipped-text 0, overlap 0 at zoom200, hit-target 0 on row links, hover-missing 0, pink-dark 0; visual 1024 light:
  header one row, one filled button; 200 % text all columns reachable.

### staff/product-detail

**Critique**

- No primary in the header (h1 only); instead four tinted pink fills down the page: "Chỉnh sửa", "Thêm biến thể", filter "Mã SKU",
  "Thêm ảnh" (A4 secondary filled, every 1440 light) (sheets: light, dark).
- Everything stacks in one column at 1440: Thông tin card, Biến thể table, Lịch sử giá (filter + tabs + table), Hình ảnh
  (empty, a bordered box inside the section: B12); no 8/4 split, no tabs for sections (DESIGN 10 detail).
- Thông tin card: "Mô tả tiếng Việt —" / "Mô tả tiếng Anh —" empty facts; status "Đang bán" green outline pill, variant "Đặt
  trước" blue outline + "Đang dùng" green outline, all colour-only (C5).
- 200 % zoom: variant table loses "Đặt trước", "Trạng thái" and `⋮`; history loses "Thời điểm" (C16).
- Section headings "Biến thể", "Hình ảnh" sit on the canvas with tinted buttons at their right while "Thông tin" is a card:
  two section styles on one page. Dark: breadcrumb, tab pink (B22).
  **Plan**
- Pattern: PATTERN-DETAIL.
- Changes: header h1 + status badge + primary "Chỉnh sửa" (opens the existing edit drawer) + `⋮` (settings, public page drawer);
  tabs Tổng quan · Biến thể · Giá và khuyến mãi · Hình ảnh (URL state); Tổng quan = record facts (8) + summary (4: status,
  first sold, featured, photo); Biến thể tab = DataTable with "Thêm biến thể" in the toolbar; history tab keeps its SKU filter
  in the toolbar; images tab = square 8 px thumbnails grid + EmptyState with "Thêm ảnh"; history anchor gets
  `scroll-margin-top` and no smooth scroll under reduced motion.
- Tells removed: four tinted fills, stacked section kit, nested empty box.
- Baseline findings fixed: font-size 15 (12 page-specific), hit-target 18, non-radix 23 (z22), shadow-gradient 7 (z13), hover 4,
  pressed 30, pink-dark 8 (F1); wig product-detail.tsx:90 smooth scroll ignores reduced motion, :167 scroll-margin-top;
  product-history.tsx:60 tabs/pages useState; product-variants.tsx:489 money via NumberInput → MoneyInput, :409 15 inputs lack
  name; product-images.tsx:162 alt fallback; product-settings-dialog.tsx:154 lead-max error; product-page-drawer.tsx:171 names.
- Transitions: pattern (120 ms route fade); tab switch instant.
- Checks: E2 font-size 0, pink-dark 0, double-border 0; visual 1440 light + dark: one filled button, 8/4 split; 200 % zoom:
  variant table scrolls in its container with all columns reachable.

### staff/product-new

**Critique**

- A six-field form (two names, brand, category, two descriptions, one checkbox) gets its own page with a card (sheets: light, dark);
  DESIGN 10: short/medium form = dialog/drawer.
- Browser-styled native selects "Chọn..." (three dots, not "…"; B9); textareas show the resize handle; fields pill-rounded (D8).
- Footer "Hủy" tinted fill next to "Tạo sản phẩm" (A4/B11); dark: both pink/burgundy filled (B22).
- Lead text in the card explains the next step (variants after creation) in two lines of grey (fine content, too faint, B1).
- 16 px checkbox "Sản phẩm nổi bật" under the 40 px target (C29); 200 % zoom fields fine, footer intact.
  **Plan**
- Pattern: PATTERN-FORM, as a Drawer from products ("Thêm sản phẩm" opens it; on success navigate to the new product-detail);
  keep `/products/new` as a deep link rendering the same form in a page for bookmarks (Owner decision: drawer vs page).
- Changes: kit Select (styled, "Chọn thương hiệu…"); textareas auto-grow without handle; featured = kit Switch row with 40 px
  target; lead text = drawer description in 14 muted; unsaved guard; focus first invalid field.
- Tells removed: tinted Cancel, "..." placeholder, pill fields.
- Baseline findings fixed: font-size 3, hit-target 17, non-radix 16 (z15), shadow-gradient 5 (z11), hover 5 (input), pressed 29,
  pink-dark 6 (F1); wig product-create.tsx:105 no unsaved guard / Cancel discards silently, :120 no focus on invalid;
  product-fields.tsx:45 inputs lack name (:45, :56, :99, :109).
- Transitions: pattern (120 ms route fade); drawer per kit (≤ 200 ms compact).
- Checks: E2 hover-missing on inputs 0, pressed-missing 0, pink-dark 0; visual 1440 light + dark: one filled button, Cancel then
  primary; select styled in both modes.

### staff/product-campaigns

**Critique**

- Small list (1 row) rendered right: one table, one primary "+ Tạo chiến dịch" at the trailing edge; but the count is said twice ("1 kết quả" on the toolbar and "Hiển thị 1-1 trong 1" under the table) (sheets: light, dark)
- Copy bug: search placeholder "Tìm theo tên hoặc địa chỉ" (address) on a campaign list (copied from branches); flag, i18n/campaigns.ts:28 also has no example/"…"
- Status "Đang chạy" = green outline pill, word only, no icon (C5); campaign name = 19 px underlined burgundy text link (C29, E2 hit-target)
- 200 % zoom: "Thời gian" and "Nhóm" columns dropped silently; 200 % text: the date column is cut mid-value ("16/10/2") at the right edge with no scroll sign (C16)
- Dark 1024-1440: primary is a pink fill with dark text, campaign link pink, filter pill tinted burgundy (B22, A4)
- Description sentence wraps to two lines beside the primary at 1024 (long subtitle, copy flag only)
  **Plan**
- Pattern: PATTERN-LIST
- Changes: drop the toolbar "1 kết quả" (count lives only in the "Hiển thị" line); date range column formatted as one short range ("14–16/10/2026") with nowrap; at narrow widths the table scrolls in its container instead of dropping "Thời gian"/"Nhóm"; flag the placeholder copy ("Tìm theo tên chiến dịch…").
- Tells removed: "+" glyph prefix on the primary (icon from the kit set only, or none), duplicate count.
- Baseline findings fixed: hit-target 18 (z21 t4; campaign name link 19 px), hover-missing 4, pressed-missing 28, pink-dark 6 (link "Ngày hội làm đẹp mùa thu"), non-radix 18, shadow-gradient 5 (table wrap) via F1; campaigns.tsx:146 row-menu open via `navigate()` -> `href`; campaigns.tsx:171 placeholder; campaigns.tsx:287 inputs lack `name` (create dialog).
- Transitions: pattern (120 ms route fade)
- Checks: E2 hit-target on row links 0, pink-dark 0, shadow-gradient 0; visual 1440 light + dark one primary, one count line; 200 % text and zoom: all 5 columns reachable by the table's own scroll.

### staff/product-campaign-detail

**Critique**

- Two back affordances: "← Quay lại" above a breadcrumb "Chiến dịch khuyến mãi › Ngày hội…" (B7/C40, page-specific double) (sheets: light, dark)
- Header meta is a middle-dot string "Đang chạy · 01:14 14/10/2026 đến 03:14 16/10/2026" (tell); the status is plain text, not a badge (C5); the only header action "Kết thúc chiến dịch" is a destructive outline button standing where the primary goes (C4, confirmations rule)
- "Sản phẩm" tab stacks a stat card ("Tình trạng sản phẩm", label/value grid with a 10 px underlined "1" link, E2 hit-target "Xem 1" w=10), a "Nhóm giá" table and a product table with its own toolbar: three surfaces, two counts ("4 kết quả" + "Hiển thị 1-4 trong 4")
- Product names truncated with "…" and overlapping the next cell at 1024 (E2 overlap 3 t4: `ls-cell-title` over "Nhóm 1"/"259.000 ₫"); "Lưu ý" cut to "Có l" at 1024 light
- 200 % zoom: product table shows only Sản phẩm + Giá niêm yết, "Giá chiến c…" sliced at the edge; 200 % text: SKU/Nhóm sliced (C16)
- Dark: breadcrumb link, active tab text + underline and the outline button are pink (B22); stat card is a raised shadowed box on the dark canvas
- Tab labels sentence case and short (good); headings "Nhóm giá"/"Sản phẩm của chiến dịch" carry no count (good)
  **Plan**
- Pattern: PATTERN-DETAIL
- Changes: header = h1 + status badge ("Đang chạy", icon + word) + date range on one muted line (no middle dot); "Kết thúc chiến dịch" moves to the header `⋮` with the existing confirmation dialog; primary = the main edit action of the active tab (or none). Stats become a 4-up Stat row (label above value) with "1" as a 40 px link "Xem 1 sản phẩm"; "Nhóm giá" table and product table on the same canvas (no card around the stats). Product name wraps to two lines (C15); price columns nowrap tabular; table scrolls in its container at 200 %.
- Tells removed: middle-dot meta string, double back control, stat card kit, duplicate count.
- Baseline findings fixed: overlap 3 (t4), clipped-text 1, hit-target 20 (z21; "Xem 1" 10 px), font-size 11 (card titles 18), pressed-missing 32, hover-missing 4, pink-dark 8 (breadcrumb, tab), non-radix 25, shadow-gradient 7 (stat card) via F1; campaign-detail.tsx:148 smooth scroll ignores reduced motion; campaign-items.tsx:121,190 `formatVnd` + placeholder; campaign-groups.tsx:205,270,284; campaign-info.tsx:149 and campaign-display.tsx:178 inputs lack `name`; campaign-picker.tsx:71,265 placeholders.
- Transitions: pattern (120 ms route fade); scroll-to-section instant under reduced motion.
- Checks: E2 overlap 0, clipped-text 0, hit-target 0, pink-dark 0; visual 1024 + 1440 light/dark: one status badge, no destructive button in the primary slot; 200 % text: product table scrolls, names wrap.

### staff/product-rewrites

**Critique**

- Empty page: "Lần chạy" is a shadowed card holding a single sentence, then "Bản nháp nội dung" heading, a lone "Trạng thái" filter, a bare "0" next to refresh, and an empty box "Chưa có bản nháp nào." (sheets: light, dark)
- Empty state has no next step (C33): it does not point to "Chạy viết lại"; the bare "0" is a count without a unit (wig ai-drafts.tsx:339) floating at the trailing edge
- Toolbar has no search (a list of drafts per product needs one once filled); filter is a tinted burgundy pill (A3 accent on a non-selected control)
- Description is two lines of instructions under the h1 (copy flag: long subtitle)
- Dark 1024-1440: primary "Chạy viết lại" pink fill, filter pill burgundy tint (B22); the run card is a raised box (D7 no shadow)
- 200 % text: primary drops under the description, fine; no clipping
  **Plan**
- Pattern: PATTERN-LIST
- Changes: "Lần chạy" becomes a one-line inline status above the toolbar (kit `Notice` neutral, no card) or a Stat line; the list keeps search + "Trạng thái" facet; empty state = kit `EmptyState` ("Chưa có bản nháp", one sentence, button "Chạy viết lại" as the step, header primary stays the single primary so the empty-state step is a link to it, not a second filled button); remove the bare "0".
- Tells removed: single-sentence card, bare count, accent-tinted filter pill.
- Baseline findings fixed: font-size 5, hit-target 17 (z20), pressed-missing 27, hover-missing 4, pink-dark 5, non-radix 12, shadow-gradient 6 (run card "Lần chạy") via F1; ai-drafts.tsx:273 `formatVnd`, :339 bare `resultCount`; ai-runs.tsx:96,110,303 (shared pending spinner, `name`).
- Transitions: pattern (120 ms route fade)
- Checks: E2 shadow-gradient 0, pink-dark 0; visual empty state at 1440 light + dark shows title + next step; seeded state (needs a draft record) shows DataTable with 20/page.

### staff/product-text-cleanup

**Critique**

- The page is a five-line paragraph under the h1 (straight quotes "Đánh giá", process explained in prose) followed by a bordered empty box "Không còn lời đánh giá nào…" (sheets: light, dark)
- Empty state is a success state ("nothing left to clean") but reads like an error box: no icon, no title, no next step (C33)
- No list skeleton is visible (no table header, no count): staff cannot tell what the page shows when it has rows
- 200 % text: the paragraph runs to 6 lines and pushes content below the fold; 200 % zoom same (C41 short titles/descriptions)
- Dark: description and box fine; box border warm brown, not neutral (F1)
  **Plan**
- Pattern: PATTERN-LIST
- Changes: description cut to one line (copy flag; no `<details>` per FR, so the process explanation moves into the empty-state body and the row action's confirmation dialog); empty state = kit `EmptyState` with a check icon, title "Không còn lời đánh giá cần dọn", one sentence; when rows exist, DataTable with product name (wraps) + action in the row `⋮`. Typographic quotes “Đánh giá” (copy).
- Tells removed: prose block under the title, bordered empty box.
- Baseline findings fixed: font-size 3, hit-target 17 (z20), pressed-missing 27, hover-missing 4, pink-dark 5, non-radix 10, shadow-gradient 4 via F1; product-text-cleanup.tsx:82 paging in `useState`; :288 load error without retry.
- Transitions: pattern (120 ms route fade)
- Checks: E2 font-size 0, shadow-gradient 0; visual 1440 light + dark empty state (icon + title + sentence); 200 % text description ≤ 2 lines.

### staff/online-sales

**Critique**

- A long settings form inside two cards: "Công tắc bán online" card holds a status pill "Đang bật", a tinted filled "Tắt bán online" button and a green success Notice box inside the card (B12 nested box), then one huge card with six groups (sheets: light, dark, full: none needed)
- Footer "Hoàn tác" (tinted fill) + "Lưu thay đổi" (washed pink, reads disabled) = two filled buttons side by side (B11, A4); footer is not sticky on a ~2,000 px form
- Native select "Chi nhánh xuất hàng" clipped "Lucy Spa Đà Nẵng - 04 Nguyễn Quar" at 1440 and "Lucy Spa Đà Nẵng - (" at 200 % text (B9, C15)
- Default-policy previews are sunken pink boxes inside the card with their own cut-off text; at 1024 the English draft text overlaps the footer buttons (E2 overlap: "You can cancel an order…" over "Hoàn tác"/"Lưu thay đổi"); the vi page shows English policy text side by side (CMS default data, flag only)
- Switch "Thu phí giao hàng" track is a bordered element inside the bordered card (E2 double-border); switch has no hover (E2 hover-missing)
- Fields span half the 1440 content width (no 720 max), hints under every field in 12 px muted (B1)
- Dark: "Lưu thay đổi" pink fill, "Tắt bán online" burgundy tint, select native dark chrome (B22, B9)
  **Plan**
- Pattern: PATTERN-FORM
- Changes: page = form max 720; the on/off switch is the page's header control: status badge "Đang bật" (icon + word) + secondary "Tắt bán online" in the PageHeader, with confirmation; success Notice removed (the badge says it). Groups (Xuất hàng, Thanh toán, Giỏ hàng, Hẹn giao hàng, Phí giao hàng, Chính sách) separated by heading + 32 px, no card per group; default-policy drafts shown as plain muted text under the textarea (no sunken box, no internal scroll) or in a "Xem bản nháp mặc định" dialog; footer sticky: "Hoàn tác" secondary outline then "Lưu thay đổi" primary (enabled, validates on submit). Select styled per F2.3, wraps the branch name.
- Tells removed: two filled buttons side by side, nested Notice in a card, sunken text boxes.
- Baseline findings fixed: overlap 2, double-border 1 (switch track in card), font-size 10, hit-target 17 (z20), hover-missing 7 (switch, "Hoàn tác"), pressed-missing 30, pink-dark 5, non-radix 23, shadow-gradient 6 via F1; online-sales.tsx:210 inputs lack `name`, :346/:362 MoneyInput separator hardcoded; rbp online-sales.tsx:85-87 mirror-state effect.
- Transitions: pattern (120 ms route fade)
- Checks: E2 overlap 0, double-border 0, hover-missing 0 on switch/footer; visual 1024 + 1440 light/dark: one filled button, sticky footer, select not clipped; 200 % text: branch name wraps.

### staff/shipping-carriers

**Critique**

- Empty list: a bordered box "Chưa có đơn vị vận chuyển. Hãy thêm đơn vị đầu tiên để có thể gửi hàng." with no icon, no title, and the step lives only in the header button (C33) (sheets: light, dark)
- Header primary "+ Thêm đơn vị" with "+" glyph; description runs 2-3 lines next to it at 1024 and at 200 % zoom the primary drops below the description
- No table header shown in the empty state, so staff do not see what the list will hold
- Dark: primary pink fill (B22); empty box border warm brown (F1)
  **Plan**
- Pattern: PATTERN-LIST
- Changes: empty state = kit `EmptyState` (truck icon, "Chưa có đơn vị vận chuyển", one sentence, step = link to the header primary); filled state = DataTable (name, tracking-link template, status badge, `⋮`); add/edit stay a dialog (short form).
- Tells removed: "+" glyph, bordered empty box.
- Baseline findings fixed: font-size 3, hit-target 17 (z20), pressed-missing 27, hover-missing 4, pink-dark 5, non-radix 10, shadow-gradient 5 (`ls-table-state` box) via F1; shipping-carriers.tsx:327,347 inputs lack `name`, tracking-URL field no `type="url"`/`spellCheck={false}`; :114 paging via `useClientPaging`; rbp shipping-carriers.tsx:76-78 mirror effect.
- Transitions: pattern (120 ms route fade)
- Checks: E2 shadow-gradient 0, pink-dark 0; visual empty state 1440 light + dark; a seeded carrier row to verify the table.

### staff/inventory

**Critique**

- Header has no primary: the only header button is "Cài đặt" as a tinted pink pill (A4 secondary filled); "Thêm phiếu nhập" lives elsewhere (wig inventory.tsx:134) (sheets: light, dark)
- Product names truncated with "…" in 12 rows ("Kem chống nắng phổ rộng SPF50…", E2 clipped-text 12) and are 19 px underlined burgundy links (C29, hit-target 40)
- At 1024 the table loses the trailing columns: "Hạn gần nh…" and the date "12/11/202" are cut and Tình trạng is off-screen with no scroll sign; 200 % zoom cuts the status to "Còn hà…"; 200 % text shows only Mặt hàng + Mã SKU (C16); E2 overlap z10 (name over the `⋮` button)
- Stock status = coloured outline pills only ("Còn hàng" green, "Hết hàng" red, "Sắp hết hàng" orange), no icon (C5)
- Count shown twice ("62 kết quả" + "Hiển thị 1-20 trong 62"); thumbnail column mixes the image-icon placeholder and grey stand-ins at 24 px (framing ok, judge only size: 8 px radius per D8)
- Dark: product links pink, active tab "Tồn kho" pink + underline, current page pink (B22)
  **Plan**
- Pattern: PATTERN-LIST (tabs Tồn kho / Phiếu nhập / Kiểm kê / Nhà cung cấp kept, URL state)
- Changes: header primary depends on the tab ("Tạo phiếu nhập" on Phiếu nhập, none on Tồn kho) as `ButtonLink`; "Cài đặt" becomes a secondary outline or moves to the header `⋮`; name wraps to two lines with variant on the second muted line; quantities tabular nowrap; table scroll container at 1024 and 200 %; status badge icon + word; drop the toolbar count.
- Tells removed: tinted secondary, duplicate count, colour-only status.
- Baseline findings fixed: clipped-text 12, hit-target 40 (t23), overlap z10, hover-missing 11 (`ls-th-sort` headers), pressed-missing 58, pink-dark 8 (tab, link), non-radix 31, shadow-gradient 5 via F1; inventory.tsx:134 `Button onClick` -> `ButtonLink`; inventory-stock.tsx:230 row menu `href`, :252 placeholder, :211/:522 Intl formatting, :448 paging state; inventory-suppliers.tsx:154,267,301.
- Transitions: pattern (120 ms route fade); tab switch instant.
- Checks: E2 clipped-text 0, hit-target 0 on row links, overlap zoom200 0, hover-missing 0; visual 1024 light: status column visible or scrollable with an edge; dark 1440 no pink.

### staff/inventory-item

**Critique**

- Double back: "← Quay lại" + breadcrumb "Kho hàng › Dầu dưỡng tóc" (the crumb label also drops "(100 ml)" from the h1) (sheets: light, dark)
- One column at 1440: the "Thông tin tồn kho" card spans the full width with two far-apart value columns, then "Lô hàng" and "Lịch sử nhập xuất" tables stacked, each with "Hiển thị 1-1 trong 1" (DESIGN 10 detail wants 8/4 from 1024)
- Status "Sắp hết hàng" is an orange outline pill inside the fact grid, not next to the h1 (C5, detail anatomy)
- 200 % zoom: both tables keep only 3 columns; 200 % text: the lot code is cut at the edge ("Q-MUZTM7IF-…") (C16)
- Dark: primary "Điều chỉnh tồn kho" pink fill, breadcrumb pink (B22); fact card is a raised box
- Card title "Thông tin tồn kho" 18 px serif (E2 font-size 13)
  **Plan**
- Pattern: PATTERN-DETAIL
- Changes: h1 + status badge (icon + word) + primary "Điều chỉnh tồn kho" (dialog); record column (8): Lô hàng and Lịch sử tables (history 20/page); summary column (4): description list (Chi nhánh, SKU, Tồn kho, Có thể bán, Đã hết hạn, Ngưỡng, Hạn gần nhất, Cảnh báo) on one Card; quantities tabular. Breadcrumb = parent only.
- Tells removed: double back control, full-width two-column fact card, pager controls under single-page tables (the "Hiển thị x–y trong n" line stays, FR rule).
- Baseline findings fixed: font-size 13, hit-target 17 (z20), pressed-missing 28, hover-missing 4, pink-dark 6 (breadcrumb), non-radix 22, shadow-gradient 7 via F1; inventory-stock.tsx:448,528 lots/history paging in `useState`; :522 `signed()` ASCII hyphen; :680,706 inputs lack `name` (adjust dialog).
- Transitions: pattern (120 ms route fade)
- Checks: E2 font-size 0, pink-dark 0, shadow-gradient 0; visual 1440 light + dark two columns 8/4; 200 % text lot code wraps or scrolls in the table.

### staff/inventory-receipt

**Critique**

- No header action and no status in the header: "Đã nhập kho" sits as a green outline pill in the fact grid (C5, detail anatomy) (sheets: light, dark, full: dark-1024)
- Double back ("← Quay lại" + breadcrumb "Kho hàng › PN000021")
- Middle-dot meta in values: "Nguyễn Thị Lucy · 03:13 14/10/2026" for Người tạo / Người xác nhận (tell)
- Line table truncates the item name "Sữa tắm hương hoa (không ảnh) (…" with plenty of room at 1440; at dark 1024 the "Giá nhập" column is off the right edge; at 200 % zoom the Mặt hàng column is dropped entirely (only Dòng, Mã SKU, Số lượng) (C15, C16)
- Dark canvas and card are warm brown (#1c1414-like), not the neutral #000/#1c1c1e (F1); breadcrumb pink
  **Plan**
- Pattern: PATTERN-DETAIL
- Changes: header = h1 "PN000021" + status badge "Đã nhập kho" (icon + word); no primary for a confirmed receipt (draft: "Xác nhận nhập kho" primary, "Sửa" secondary as link); people + time as two lines (name, then muted time) instead of "A · B"; lines table: Mặt hàng wraps (min 240 px), money/qty tabular nowrap, scroll container at 1024/200 %; summary column holds the description list, record column the lines table with a total row.
- Tells removed: middle-dot meta, double back.
- Baseline findings fixed: font-size 10, hit-target 17 (z20), pressed-missing 28, hover-missing 4, pink-dark 6, non-radix 21, shadow-gradient 6 via F1; inventory-receipts.tsx:153,185 Intl formatting, :361 "Sửa" via `onClick` -> link, :217 row menu `href`.
- Transitions: pattern (120 ms route fade)
- Checks: E2 pink-dark 0, shadow-gradient 0; visual 1024 dark: all line columns reachable; 200 % zoom: Mặt hàng visible; status badge in header at 1440 light.

### staff/inventory-receipt-edit

**Critique**

- The captured receipt is confirmed, so the edit route renders only a blue info Notice "Chỉ sửa được phiếu nháp." under the h1 "Sửa phiếu nhập": a dead end with no link back to the receipt and no next step (C33) (sheets: light, dark)
- Three back paths at once: "← Quay lại", breadcrumb "Kho hàng › PN000021 › Sửa phiếu nhập" (B7/C40)
- The edit form itself was not captured (no draft receipt seeded): its layout is assumed identical to inventory-receipt-new and must be verified once a draft exists
- Dark: Notice is a navy box with a bright border on the warm canvas; breadcrumb links pink (B22)
  **Plan**
- Pattern: PATTERN-FORM (same component as inventory-receipt-new)
- Changes: a confirmed receipt never offers "Sửa" (detail hides it), and a direct visit redirects to the receipt or shows kit `EmptyState` "Phiếu đã xác nhận, không sửa được" with the step "Xem phiếu PN000021" (link); the draft edit form follows the inventory-receipt-new plan.
- Tells removed: double back, bare Notice page.
- Baseline findings fixed: font-size 2, hit-target 17 (z20), pressed-missing 29, hover-missing 4, pink-dark 6, non-radix 10, shadow-gradient 4 via F1; inventory-receipts.tsx:656 no unsaved guard, :697 first invalid field not focused, :742 inputs lack `name`, :907 Cancel via `onClick`; rbp inventory-receipts.tsx:679-688 options rebuilt per keystroke.
- Transitions: pattern (120 ms route fade)
- Checks: visual confirmed-receipt state has a next step; seed a draft receipt and re-capture the form (light + dark 1440, 200 % text) before Step 2 sign-off.

### staff/inventory-receipt-new

**Critique**

- Footer "Hủy" (tinted pink fill) + "Lưu nháp" (solid) = two filled buttons side by side (B11, A4); "+ Thêm dòng" is another tinted filled pill in the card header (sheets: light, dark)
- Two shadowed cards ("Thông tin" + "Hàng nhập"), each line rendered as a full field block "Dòng 1" with a 16 px trash icon (decorative numbering, C29 target); a 30-line receipt becomes a very long page (wig :799 not virtualized)
- Fields are full pills (D8 wants 8 px); disabled branch field clipped "Lucy Spa Đà Nẵng - 04 Ngu…" at 1440 and 200 % text (C15); native select "Không chọn" unstyled (B9, dark shows native chrome)
- Form spans the full content width at 1440 (no 720 max); date fields show the browser "dd/mm/yyyy" placeholder
- Dark: "Lưu nháp" pink fill, "Hủy"/"Thêm dòng" burgundy tint (B22)
  **Plan**
- Pattern: PATTERN-FORM
- Changes: header fields (Chi nhánh read-only as text, Nhà cung cấp select, Ngày nhập, Ghi chú) in one group max 720; "Hàng nhập" = an editable line table (Mặt hàng combobox, Số lượng, Mã lô, Hạn dùng, Giá nhập, row delete icon button 40 px) with "Thêm dòng" as a secondary outline under the table (wider than 720 allowed for the table only); running total row; footer sticky: "Hủy" secondary link then "Lưu nháp" primary; `useUnsavedChangesGuard`; delete a filled line = undo toast.
- Tells removed: "Dòng 1" numbering blocks, two filled footer buttons, "+" glyph pills, card per group.
- Baseline findings fixed: font-size 4, hit-target 17 (z20; trash icon), pressed-missing 28, hover-missing 4, pink-dark 6, non-radix 19, shadow-gradient 6 (two cards) via F1; inventory-receipts.tsx:656 unsaved guard, :697 focus first invalid, :742-887 inputs lack `name`, :799 per-line field blocks, :810 delete without undo, :828 placeholder "…", :907 Cancel `onClick`; rbp :679-688 options memo, :684 Set lookup.
- Transitions: pattern (120 ms route fade); added row appears without animation.
- Checks: E2 hit-target 0, pressed-missing 0 on footer, shadow-gradient 0; visual 1440 light + dark one filled button, line table; 200 % text branch name wraps, table scrolls in its container.

## Cross-page patterns

1. **Filled secondary buttons everywhere (A4, B11, C4).** Tinted-pink pills used as secondary: Cancel ("Hủy") in every form
   footer next to the solid primary (employee-new, discount-new/version-new, product-new, inventory-receipt-new, online-sales),
   header extras ("Đánh dấu tất cả đã đọc", "Sửa giờ hoạt động", "Đổi giá", "Cài đặt", "Tắt bán online", four on product-detail),
   one per dashboard widget (about 15 on one view) and in account card headers. Fixed once by F1.4/F2.1 (secondary = outline),
   then per page: one primary per view, other actions in `⋮`. product-detail has no primary at all.
2. **Tables clipped at the trailing edge with no scroll sign (C16).** At 1024 (branches, attendance, leave, services, discounts,
   products) and at 200 % zoom/text (most lists, inventory-receipt line table loses its name column) status chips and the row
   `⋮` become unreachable. One kit fix (F2.6: own scroll container with a visible edge, no silent column dropping) plus per-page
   name columns that wrap (C15) instead of `ls-cell-truncate` ellipses (12 identical "Kem chống nắng…" rows on products).
3. **List anatomy drift.** Row links are 19 px underlined burgundy text (C29, A3; pink in dark, B22); counts said twice ("n kết
   quả" or a bare "0" in the toolbar plus "Hiển thị x–y trong n") and in tab labels ("Dịch vụ (114)", "Vùng (3)", "Thành viên (3)");
   employees stacks four tables with four pagers; h2s that repeat the h1 ("Danh sách yêu cầu", "Các tháng"); "+" glyph in primary
   labels; create buttons and row-menu "Chi tiết" navigate by `onClick`/`navigate()` instead of links (wig-admin-a summary).
4. **Status by colour alone (C5).** Every list and detail header shows status as a coloured outline pill with a word and no icon;
   on detail pages it sits in the facts grid or on a "Trạng thái:" line instead of beside the h1.
5. **Detail pages: two back controls and no 8/4 layout.** "← Quay lại" plus breadcrumb on every detail/form page (B7/C40, F2.11);
   one column at 1440 with no record/summary split; middle-dot meta subtitles ("LUCY01 · Asia/Ho_Chi_Minh", "Đang chạy · …").
6. **Fields and filters.** Pill-shaped fields (D8 wants 8 px), unstyled native selects (B9), two bare date inputs instead of the
   kit date range, US date entry "mm/dd/yyyy" / "12:14 AM" on the vi locale (discount forms), money as plain "85000" (wig:
   `MoneyInput` missing in advances, collaborator-schedule, discount-form, product-variants), submit disabled until complete.
7. **Empty states with no next step (C33).** A bordered sunken box with one sentence on income, my-payslips, my-services,
   collaborator-schedule, chat-requests, shipping-carriers, product-rewrites, product-text-cleanup; inventory-receipt-edit on a
   confirmed receipt is a dead end. Kit `EmptyState` with the one next-step button.
8. **Dashboard is a card kit, not a work surface.** Identical widget cards with serif 32 px numbers, a filled pill each, a gradient
   area chart (pink in dark), a 60-button "Lối tắt" wall duplicating the sidebar, and the recovery-email task placed first.
9. **Copy to flag (not data changes):** long h1 descriptions "<chi nhánh>: <mục đích>" on every page (shell); product-campaigns
   search placeholder "Tìm theo tên hoặc địa chỉ" copied from branches; dashboard compare label "Không"; English policy text in the
   vi online-sales preview (CMS data, Owner's); program "Giảm 18%" showing "Mức giảm 85.000 ₫" (Owner data).
10. **Owner decisions raised by the plan (pending, not decided here):** product-new as a drawer vs its own page; how to split the
    13-tab loyalty row (overflow menu vs grouped sections); dashboard "Lối tắt" removed or reduced to pinned shortcuts.
