# Step 6, area "admin-a": evidence (session 10)

Worker: admin-a (with three forks of the same worker for disjoint file sets: people, self-service and sign-in, services and
discounts; their sections are merged below). Plan: `docs/redesign-s10/plans/fd-plan-admin-a.md` (PATTERN-* blocks and the page
sections of this area). Owner answer 5 binds: loyalty groups its tabs into at most six, the dashboard keeps and gets a real
"Lối tắt" block, **every other big layout change in the plan is dropped** (four employee tables into one, 8/4 detail splits,
team-detail tab merge, organization per-tab create, leave select into tabs, recovery-email card leaving the dashboard, advances
create into a Drawer, service-detail VI/EN regrouping, income period stepper); each is listed per page as "dropped per answer 5".

Skills: frontend-design, web-design-guidelines (rules fetched fresh from the vercel-labs `command.md` URL with WebFetch on
2026-10-16), react-best-practices (rules applied: rerender-derived-state-no-effect, rerender-no-inline-components, js-index-maps,
js-tosorted-immutable (not used: `toSorted` is not in the web lib target, `[...x].sort()` instead), rendering-conditional-render,
bundle-barrel-imports (no new heavy import)), react-view-transitions (`references/implementation.md` read) loaded at the start.
Conflict noted once (same as the pos worker): the plan puts a status badge "beside the h1" on detail pages; the Owner rule
"headings are text only" wins, so a record status uses the kit `PageHeader` `status` slot (under the h1).

View-transition decision (every page of this area): staff 120 ms route fade only (kit `--ls-dur-route`); no ViewTransition, no
GSAP, no shared-element morph on any admin page; tables, totals and typing never animate. No motion was added; the only new
transitions are the hover/pressed colour and `scale(var(--ls-press-scale))` on the dashboard shortcut rows (150 ms, kit tokens,
zeroed by reduced motion / `ls-fx=off` in base.css).

Kit additions used (lead, 2026-10-16): `PageHeader status`, table cells no longer clamp (`.ls-cell-wrap`, `.ls-cell-title`,
`.ls-card-title-clamp` wrap, no title tooltips), `TextInput` derives `name` / `autoComplete="off"` / `spellCheck` (closes most
baseline "inputs lack `name`" lines without page code).

## Shared work

- `packages/ui/src/s10-admin-a.css` (classes used only by this area's files; tokens only, no hex, no px/rem literal, no shadow, no
  gradient, no `transition: all`): `.ls-loyalty-sections`, `.ls-loyalty-lookup`, `.ls-aa-wrap`, `.ls-dash-*` (dashboard),
  `.ls-inbox-*` (notification inbox), plus the forks' `ls-ppl-*`, `ls-self-*`, `ls-cat-*` sections. Nothing removed from
  pages-v2/site/components/staff.css.
- Owner answer 7 / C58b: every `truncate: true` name/title column in this area's screens is `wrap: true` (the kit no longer clamps);
  names inside the kit's nowrap `.ls-cell-main` / `.ls-cell-sub` get `.ls-aa-wrap` (loyalty tables, advances, leave reason, roles, employee roles/skills, CTV schedule); `CardHeader clamp` removed from every
  dashboard widget (widget-frame.tsx: 4 places). Numeric columns keep `numeric: true` (right-aligned, nowrap, tabular in the kit).
- Console errors `HTTP 404 /api/v1/inventory/branches/variants/<id>`: not from this area. The only caller is
  `apps/web/src/components/workforce/screens/inventory-stock.tsx:345` (admin-c), which builds
  `/api/v1/inventory/branches/${branch}/variants/${variantId}` with an empty `branch` (the double slash collapses to the 404 path).
  Reported to admin-c through this note; not changed here.

## staff/loyalty (and loyalty-member)

- Pattern: compact list/report (PATTERN-REPORT lookup) with a section switch.
- Owner answer 5, grouping: `apps/web/src/lib/workforce/loyalty-list.ts:24-60` `LOYALTY_GROUPS` (6 groups by task: Khách hàng
  [customers], Quà tặng [rewardDesk, rewardCatalog], Combo [combos, comboSold, comboUsage], Giới thiệu và sinh nhật [referrals,
  birthday], Ngoại lệ [exceptions], Kích hoạt [goLive]), `loyaltyGroupOf`, `loyaltyGroups` (a group shows only when one of its
  sections is allowed; an unknown or forbidden `?tab=` opens the first allowed section). `?tab=` keeps the section id, so every
  existing link (`?tab=comboSold`, `?tab=rewardCatalog`, ...) opens the same screen: no redirect needed. `loyalty-list.ts` is
  imported only by loyalty screens and their tests (grep). Screen: `components/workforce/screens/loyalty.tsx:74-130` six kit `Tabs`
  (labels short, sentence case), a kit `SegmentedControl` under the tab bar for a group with more than one section
  (`.ls-loyalty-sections`, max width = large field), `LoyaltySection` (module-level component, :133) renders the section. Every
  existing screen stays reachable; no panel changed.
- Lookup (`loyalty.tsx:180-305`): "Tìm theo" select -> kit `SegmentedControl` "Số điện thoại | Email" (one control fewer, no
  native select, B9); "Tra cứu" always enabled, validate on submit: an empty field shows "Nhập số điện thoại hoặc email của khách."
  at the field and takes focus (wig Forms); input `name` + `spellCheck={false}` (wig loyalty.tsx:247 closed); the success notice
  no longer joins phone/email with " · " (contacts in parentheses, :195, :294); an `EmptyState` (heading + sentence) under the
  lookup until the first search (C33).
- No access: `EmptyState` with heading + sentence (`loyalty.tsx:68`).
- Section tables (`loyalty-combos.tsx`, `loyalty-combo-sold.tsx`, `loyalty-combo-usage.tsx`, `loyalty-customer.tsx`,
  `loyalty-exceptions.tsx`, `loyalty-referrals.tsx`, `loyalty-rewards.tsx`, `loyalty-rewards-catalog.tsx`,
  `loyalty-rewards-dialogs.tsx`, `loyalty-birthday.tsx`, `referral-card.tsx`): 21 name/title columns `truncate` -> `wrap`;
  combo-sold `Clamped` helper (`ls-cell-title` + `title=` tooltip) removed, buyer and combo names wrap (`.ls-aa-wrap`), date and
  branch are two muted lines instead of "date · branch" (loyalty-combo-sold.tsx:~95-101).
- Middle-dot tells removed: loyalty-customer.tsx:209 header intro (phone, email), :166 source "HD001 (#2)"; loyalty-rewards.tsx
  found notice; loyalty-rewards-dialogs.tsx item option "name (kind)", use option "date, branch, person", history "by" column = two
  lines (person, branch muted), issued "date (×n)"; loyalty-rewards-catalog-form.tsx variant option "name, label (SKU)";
  referral-card.tsx referrer "(phone)".
- Empty states with a heading, one sentence and at most one action (C33): exceptions, referrals (filtered: "Xem tất cả" clears the
  status), combo sold (filtered: same), combo usage, customer ledger (filtered: clears the wallet), rewards desk list, three "no
  branch" states (loyalty-customer, loyalty-referrals, loyalty-rewards). Profile sub-lists (combos, gifts, referral history,
  birthday history, frozen combos) keep their one sentence under their own section heading (secondary tables on a detail page).
- One primary per view: rewards desk "Tìm khách" turns secondary once a member is found, so "Cấp quà" is the only primary
  (loyalty-rewards.tsx, "Tìm khách" also always enabled with an inline required error, `name` added: wig loyalty-rewards.tsx:229
  closed).
- Headings text only: the tier badge left the wallet card header (beside the title) and sits under the balance, kit `Badge` with
  the `award` icon (none for "Chưa có hạng") (loyalty-customer.tsx WalletCard).
- Adjust dialog: specific inline errors "Nhập số điểm là số nguyên từ 1 đến 1.000.000." / "Nhập lý do điều chỉnh." instead of the
  generic validation text (wig loyalty-adjust-dialog.tsx:55 closed). Birthday form: the three "combine" checkboxes are one
  `role="group"` named by their label and described by the hint (wig loyalty-birthday-form.tsx:205 closed).
- Tells removed: clipped 13-tab row (B10/C59), labels above the lookup's choice, disabled-looking primary, middle-dot meta strings,
  badge beside a heading.
- B/C items: B9, B10, B11, C5, C15, C33, C58b, C59.
- Baseline findings closed: wig loyalty.tsx:247, loyalty-rewards.tsx:229, loyalty-adjust-dialog.tsx:55, :130 (kit name),
  loyalty-birthday-form.tsx:127 (kit name), :205, loyalty-combos-form.tsx:117 (kit name), loyalty-rewards-catalog-form.tsx:180 (kit
  name), loyalty-rewards-dialogs.tsx:140 (kit name); fd-plan loyalty "13 tabs cut at 1024-1440", "Tra cứu faded".
- Not done (and why): paging of the nested lists (combos :44, rewards-catalog :50, birthday :56, frozen :238, profile combo/gift
  pages) stays in component state: the page has one `?page=` for the open section, and moving the nested pagers into the URL is a
  state-model change beyond restyle. Row-menu "open customer" items keep `navigate()`; the customer name in the row is the real
  link; kit request filed (RowActions needs `LinkComponent`). `MoneyInput` unit/separator props are kit (wig loyalty-birthday-form
  :150, loyalty-combos-form :178).
- web-design-guidelines re-run (loyalty.tsx, loyalty-list.ts, loyalty-combo-sold.tsx, loyalty-combo-usage.tsx, loyalty-customer.tsx,
  loyalty-exceptions.tsx, loyalty-referrals.tsx, loyalty-rewards.tsx, loyalty-rewards-dialogs.tsx, loyalty-rewards-catalog-form.tsx,
  loyalty-adjust-dialog.tsx, loyalty-birthday-form.tsx, referral-card.tsx): found 2 (loyalty.tsx lookup submit had no focus on the
  empty field -> `inputRef.focus()`; loyalty-rewards.tsx field had no `name` in this markup -> `name="reward-phone"`), fixed; final 0.
- react-best-practices re-run (same files): found 1 (loyalty.tsx a 10-way `.filter` list rebuilt per render with inline panels ->
  module-level `LoyaltySection` switch, rerender-no-inline-components), fixed; final 0.
- View transitions: staff 120 ms route fade only; tab and segment switches are instant.
- Dropped per answer 5: none (the grouping is the answer-5 change); the plan's "scrolling tab row" alternative not used.

## staff/dashboard

- Pattern: dashboard (DESIGN 10): unchanged widget grid, customize mode unchanged.
- "Lối tắt" (Owner answer 5, kept and made a real shortcuts block): `components/workforce/dashboard/personal-widgets.tsx:200-255`
  `SHORTCUT_ORDER` (most used tasks first: Bán hàng, Bảng lịch hẹn, Khách vãng lai, Dịch vụ của tôi, Chấm công, Nghỉ phép, Điểm
  thưởng, Đơn đặt trước, Đơn online, Sổ quỹ, Kho, Doanh thu, Lịch CTV, Thu nhập, Phiếu lương, Tài khoản), `shortcutsFor` (only the
  pages `navigationFor` gives this account, i.e. permission-filtered exactly like the sidebar, at most 8, Map lookup). Each is a
  40 px link row with its sidebar icon, 8 px apart, grey hover and pressed (`.ls-dash-shortcuts`, `.ls-dash-shortcut`), replacing ~60
  outline pills that duplicated the sidebar.
- Widget actions: the footer link of every widget is a quiet `.ls-link` text link with a 40 px target (`widget-frame.tsx:78-84`,
  `.ls-dash-open`) instead of one outline button per card (C4); the card is a flex column and the footer is pinned to its end, so the
  actions of a row line up (E2 grid alignment, `[data-ui='v2'] .ls-widget`).
- Titles: `CardHeader clamp` removed from the four widget states (widget-frame.tsx), titles wrap in full (E2 clipped-text 3 at 1280,
  t10 at 200 % text).
- Notifications widget: unread = dot + 600 weight + "Mới" for screen readers only, no blue "Mới" pill per line (C5); each message
  is a 40 px ink link row with hover underline and pressed tint (`.ls-dash-note*`).
- Middle-dot tells: booking widgets "09:00 · Lan" -> time (tabular) then name; in-service "guest · service" -> name with the service
  on a muted second line; refunds and revenue notes joined with ", " (report-widgets.tsx:89, revenue-widget.tsx:73).
- Chart: `area` removed from the revenue `LineChart` (DESIGN 10: no gradient fills, flat 2 px line); compare label "Không" ->
  "Không so sánh" / "None" -> "No comparison" (i18n/workforce.ts:327, :3148).
- rbp: the branch scope is derived in render (`dashboard.tsx:75-78`) instead of a `useEffect` that set state after mount
  (rerender-derived-state-no-effect; rbp-staff dashboard.tsx:74-79 closed).
- Baseline findings closed: wig widget-frame.tsx:35 ("Đang tải tiện ích…" / "Loading widget…"), money-widgets.tsx:98,
  report-widgets.tsx:122, revenue-widget.tsx:71 (`formatVnd` is `Intl.NumberFormat` now, lib/workforce/format.ts:18-25).
- Not done (and why): the layout is still read from localStorage after mount (rbp dashboard.tsx:58-61): reading it in a lazy
  initializer would differ between the server render and the first client render (hydration mismatch); kept. Branch scope and the
  revenue compare mode stay in component state (wig dashboard.tsx:56, revenue-widget.tsx:30): URL state for the dashboard is a new
  behaviour, not a restyle. "Đặt lại mặc định" has no confirm (wig dashboard.tsx:129): kept as is (no workflow change).
- Dropped per answer 5: recovery-email card leaving the dashboard; Stat widgets per container query; the 12-col span rework.
- web-design-guidelines re-run (personal-widgets.tsx, widget-frame.tsx, booking-widgets.tsx, report-widgets.tsx,
  revenue-widget.tsx, dashboard.tsx): found 0 new; final 0.
- react-best-practices re-run: found 1 (dashboard.tsx effect-driven branch state), fixed; final 0.
- View transitions: 120 ms route fade only; no widget stagger; Stat shows the final value.

## staff/notifications (and the shared inbox, components/notifications/inbox.tsx)

- Pattern: PATTERN-LIST (inbox, no primary).
- No status column: the blue "Chưa đọc"/"Đã đọc" pill on every row is gone; unread = 8 px dot + 600 weight, "Chưa đọc" /
  "Đã lưu trữ" for screen readers only (`inbox.tsx:174-200`, `.ls-inbox-message`, `.ls-inbox-dot`) (C5, A3, member request).
- The message wraps in full: no clamp (kit), no `title` tooltip duplicate; the link's accessible name is "open-label: message,
  state" (`aria-label`), visible text unchanged; ink link with hover underline (A3).
- Source code `translate="no"`; the branch line has no `ls-cell-title` / tooltip (wraps).
- Filter labels without counts: "Tất cả (36)" -> "Tất cả", "Vận hành (4)" -> "Vận hành" (Owner count rule).
- Empty state: kit `EmptyState` with a heading ("Chưa có thông báo" / "Không có thông báo phù hợp"), one sentence and, when
  filtered or archived, one secondary action "Xem tất cả thông báo" that clears the filters (inbox.tsx:376-392). Customer page keeps
  working (same component; the member worker's `ls-mem-inbox` overrides do not target the removed column, and their status-pill and
  empty-state workaround can now be retired).
- Not done (and why): the double paging (DataTable pager + cursor "Tải thêm") stays: one paging model means a server paging change.
  Row-menu items unchanged.
- web-design-guidelines re-run (inbox.tsx, notifications.ts): found 0 after the change; final 0. react-best-practices: 0.
- B/C items: C5, C15, C33, A3, R26.

## People pages (fork): employees, employee-detail, employee-new, teams, team-detail, roles, skills, organization, branches, branch-detail

Shared: every name/title/branch column wraps with no `title` tooltip; codes muted with `translate="no"` (`.ls-ppl-code`); " · " and
" — " joins replaced by commas/parentheses (incl. `lib/workforce/employee-appointments.ts` label, used only by
management-levels.tsx and its test, grep); the kit `TextInput` now names every input (closes the "inputs lack `name`" lines);
row-menu "Chi tiết" keeps `navigate()` (name cell is the real link; kit request). Pattern: compact list / detail / form.

- **employees** (list): create = real link styled as the primary with the kit plus icon (employees.tsx:77-82, wig :78 closed);
  example placeholder "Ví dụ: NV0012 hoặc Lan…" (wig :93 closed); name, title, level wrap; kit `EmptyState` with a heading
  (:327-334). Dropped per answer 5: the four group tables into one table with a facet.
- **employee-detail**: kit `PageHeader` with the account status in the `status` slot (employee-detail.tsx:175-205); the
  "Chức danh: [badge] Cấp quản lý: … Trạng thái tài khoản: [badge]" chain is a label-above-value `DescriptionList` (`.ls-ppl-meta`);
  login id shown once, its hint and the status help as captions on their own line (employee-lifecycle.tsx:84-93, :590-600; E2
  overlap); an active assignment shows "—" (wig :420); assign-branch, promote, end and password dialogs validate on submit with
  inline errors (wig :553, :572, lifecycle :401, :502, :636, :652); roles and skills tabs: name + muted code line, validate on
  submit (wig roles :337, :392, skills :323, :349). Dropped per answer 5: the 8/4 split. Not done: tab and history page in state
  (rendered directly by tests; URL state is a behaviour change); the Skills tab `ListSection` "Kỹ năng" keeps its heading because it
  holds the section's action.
- **employee-new** (form): Cancel is a real link before the primary (`cancelHref`), `useUnsavedChangesGuard` with a module-level
  `isDirty`, inline field errors + focus on the first invalid field, `spellCheck={false}` on code and email (wig :89, :121, :202,
  :250, :399 closed). Not done: the forbidden message (:79) has no next step.
- **teams / team-detail**: name and inactive badge stacked (no overlap at 200 % text); leader column wraps, "no leader" muted;
  toolbar count removed; example placeholders; `EmptyState` with a heading; create dialog validates on submit. team-detail: inactive
  status in the `PageHeader status` slot instead of a separate Notice; "Thành viên (3)" -> "Thành viên"; member status is a `Badge`;
  one primary ("Sửa nhóm"), "Đổi trưởng nhóm" secondary. Dropped per answer 5: merging the members/add tabs into the toolbar. Not
  done: tab and member filters in state (wig :669, :711).
- **roles / skills**: "Nhóm quản lý" is a muted second line, not a pill beside the name (E2 overlap t2); active = quiet neutral badge
  with a check icon, inactive = warning (no wall of green); count removed; example placeholders; code fields `spellCheck` +
  `autoCapitalize="none"` (wig roles :223, :466, skills :170, :274 closed). Not done: the four-line roles intro (pinned by
  role-admin.test; copy flag for the Owner); the skills empty state has no heading yet.
- **organization**: tab counts removed; the blue explainer Notice became the `PageHeader` description; all name/area/scope columns
  wrap; level as plain text; start date from the Vietnam-time `formatDate(todayIn(...))` (organization.tsx:450, wig :433); example
  placeholders (wig :162); dialogs: code `spellCheck={false}`, the employee search shows a network error instead of "not found",
  example placeholder (wig organization-dialogs :89, :210, :599, :602). Dropped per answer 5: per-tab create in the toolbar.
- **branches / branch-detail**: time zone shown as "Giờ Việt Nam (UTC+7)" (`timezoneLabel`, any other zone keeps its id with
  `translate="no"`); name wraps; create dialog code/time-zone `spellCheck={false}` (wig branches :189, :209). branch-detail: kit
  `PageHeader` with code-only description and the status slot (no "Trạng thái:" line), hours in one column Monday to Sunday,
  tabular (`.ls-ppl-hours`), time-zone field `spellCheck={false}` (wig :272). Dropped per answer 5: the 8/4 split. Not done:
  branches page/size in state (wig :43); branches empty state heading.
- management-levels: plain text lines, no info pill, no tooltip, no " · ".
- Tells removed: "+" text glyph, middle-dot and em-dash meta strings, counts in tabs, colon meta chain, badge beside a name,
  explainer notice block, raw IANA string, burgundy underlined name links (kit).
- B/C items: C4, C5, C15, C16 (wrap), C29, C33, C40, C58b, B9, B11.
- web-design-guidelines re-run: about 30 found and fixed; final open items are the ones listed under "Not done" (row-menu `href`
  needs the kit, URL state, two empty states, one forbidden copy). react-best-practices re-run: 0.
- View transitions: staff 120 ms route fade only.
- Copy also changed: "Chủ Spa" -> "Chủ spa" (employees.titles.OWNER, shared), em-dash clauses in employee-new and roles strings.
- Test files changed: employee-create.test.tsx, workforce-access.test.tsx (one ReauthDialog render had been switched to `cancelHref`
  by mistake: restored to `onCancel`, tsc caught it), employee-detail.test.tsx, employee-roles.test.tsx (role name is no longer
  `<strong>`), employee-skills.test.tsx, employee-appointments.test.ts, employee-directory.test.tsx (create is a link now),
  organization.test.tsx.
- Process note: the fork made one scripted read-modify-write on `i18n/workforce.ts` (six em-dash strings) instead of the Edit tool;
  the dashboard strings written earlier are intact (checked). Other workers should re-check their own recent `workforce.ts` edits.

## Self-service and sign-in pages (fork): staff-login, staff-forgot, account, advances, attendance, leave, income, my-payslips, my-services, collaborator-schedule, chat-requests

- **staff-login** (PATTERN-AUTH): id/email `spellCheck={false}` + `autoCapitalize="none"` (login.tsx:116, wig :110); "Quên mật khẩu?"
  moved out of the label row into its own 40 px link row under the password field (:137, C29: it sat 7 px from the eye toggle);
  unused `serif` wordmark prop removed. Not done: h1 18 px comes from kit `shell.css:919` (kit request).
- **staff-forgot** (PATTERN-AUTH): code, length and mismatch errors at their own field via the kit `Field error`
  (forgot-password.tsx:186-240), the field with the problem takes focus (:91), email and code `name` + `spellCheck={false}` (:167,
  :198) (wig :152, :174, :213 closed); intro left-aligned with the form (:158); "Quay lại đăng nhập" = 40 px link row with a leading
  chevron (:259).
- **account**: "Chức danh" as plain text (no blue badge, A3/C5) (my-account.tsx:116); login id and branch codes `translate="no"`;
  the schedule shows an error with retry instead of loading forever (:715-723, wig :710); branch column wraps;
  recovery-email.tsx:72-82, :141-147 malformed code = inline error + focus, `name` + `spellCheck` (wig :72, :135). Dropped per
  answer 5: security-card regrouping, 960 px column. Open: "Trạng thái tài khoản" value flagged for the Owner; raw shift time.
- **advances**: the "Các khoản tạm ứng" h2 removed (advances.tsx:239); employee = name + muted code line, wraps (:128-141); amount
  `MoneyInput` (:380, wig :372); request day in the Vietnam zone (:168, wig :162); one-line intro, the policy moved into the create
  dialog description. Dropped per answer 5: create stays a dialog. Open: filter/pager URL state, `signedVnd` (lib/workforce/cash.ts,
  POS-owned), generic validation copy.
- **attendance**: "Chấm công chi nhánh" h2 left out when the branch list is the only section (:358); no card-header clamp; employee
  and branch wrap; check-in/out busy state per branch (:163, :180, wig :152/:167); correction submit stays enabled with an inline
  reason error + focus (:450-520, wig :447). Dropped per answer 5: date-range picker. Open: string `formatDate`, `useBranches` twice.
- **leave**: "Duyệt đơn nghỉ phép" h2 only when the viewer also has their own list (:464); employee wraps; decision reason on a
  muted second line, no middle dot (:375); request and reject dialogs never disable submit, inline errors + focus (wig :226, :524).
  Dropped per answer 5: select into tabs, detail drawer. Open: status filter URL state, `useEmployeeNames` serial pages (data.ts).
- **income**: kit `EmptyState` with a heading and sentence for the owner and for an employee with no income (my-income.tsx:169,
  :174); "(3 lượt)" instead of "· 3 lượt"; branch columns wrap; an unknown source shows its code, not an empty `<li>` (wig :249).
  Dropped per answer 5: the period stepper. Open: period in the URL.
- **my-payslips**: "Các tháng" h2 removed, "0 kết quả" hidden when empty (payroll-slip.tsx:240, only `MyPayslipsScreen` touched);
  `EmptyState` "Chưa có phiếu lương" + sentence (:257). Not done: "LUCY SPA · …" at :84 is in `PayslipDocument` (admin-b).
- **my-services**: selected branch derived in render (my-services.tsx:49, rbp :57-59 closed); intro hidden when the user cannot use
  the page; empty states with heading + next step (:247, :272); no card-header clamp; "BẮT ĐẦU / KẾT THÚC" -> "Bắt đầu / Kết thúc"
  (ALL-CAPS tell); middle dots -> commas.
- **collaborator-schedule**: `EmptyState` "Chưa có lịch làm CTV" with a secondary "Xếp lịch CTV" (optional `onCreate` on
  `ScheduleTable`, only with MANAGE_WORK_SCHEDULE) (:195); name without tooltip, code `translate="no"` (:219); branch wraps; agreed
  pay `MoneyInput` (:542, wig :518); one-line intro. Dropped per answer 5: date-range picker. Open: range/branch URL state, drawer
  validation Notice.
- **chat-requests**: "Danh sách yêu cầu" h2 removed (:169); bare "0" -> "n kết quả", hidden at 0; `ls-cards-one-line` removed
  (truncated on phones); `EmptyState` with heading, filtered view gets "Xem tất cả yêu cầu" (:204); closing from the row menu asks
  for confirmation and states the 90-day purge (:229, wig :151), the sentence left the intro. Open: facet option counts.
- B/C items: C4, C5, C15, C29, C33, C40, C58b, B9.
- web-design-guidelines re-run: 14 found and fixed (5 inline errors, 4 disabled submits, 3 spellCheck/name, 1 UTC day, 1 empty
  list item); final open items as listed. react-best-practices re-run: 1 found and fixed (my-services derived branch); 0 left.
- View transitions: staff 120 ms route fade only. Test changed: screens.test.tsx (Owner attendance: no h2, branch toolbar
  present).

## Services and discounts pages (fork): services, service-detail, discounts, discount-detail, discount-new, discount-version-new

- **services** (list): category names from a Map built once (services.tsx:143, js-index-maps; rbp :142-143, :165-201 closed); name
  leads and wraps (:160-176), category wraps (:178), code moved last, muted, `translate="no"` (:210-219, pure reorder);
  "Ví dụ: sơn gel…" (:383); `EmptyState` with heading, "no match" resets filters (:431-449, :479-485); tab labels without counts
  (:533, :538); status-confirm facts Name + Code (:636); code inputs `spellCheck={false}` (:716, :932); "Chọn nhóm…" instead of "—"
  (:943, wig :902). Open: duplicate toolbar count (kit), three disabled submits (ServiceCreate, CategoryEdit, EligibleSkills: need
  inline errors from shared field parts).
- **service-detail**: kit `PageHeader` with code-only description and the status slot, no "Trạng thái:" row (:139-170); tab in the
  URL via `useUrlState` (:115, wig :107); branch names wrap (:594); "Tắt tại chi nhánh" from the row menu asks for confirmation
  (:597-625, :656-683, wig :604); service-content-fields.tsx:70 FAQ group title is an `h4` (wig :69); add-service "Chọn dịch vụ…".
  Dropped per answer 5: 8/4 split, VI/EN fact groups, collapsed empty-content line, photo slot. Open: skills-form unsaved guard.
- **discounts** (list): name leads and wraps (:74-100); "Theo mã (9 mã)" (no middle dot); validity two lines "A" / "đến B"
  instead of "A → B" (:118-128); code last, muted, `translate="no"` (:148-156); create is a real link styled as the primary
  (:174-180, wig :157); "Ví dụ: GIAM10…" (:194, wig :174); `EmptyState` with heading, "no match" resets (:229-250).
- **discount-detail**: `ErrorState` with retry (:88-104, wig :81); tab in the URL (:119, wig :97); `PageHeader` status slot with
  status/kind badges, "Tạo phiên bản mới" a real link styled as the primary (:216-251, wig :208); card title "Phiên bản đang áp
  dụng", version as a fact, validity as two facts (no "→"), limits joined with ", ", "17 lượt" (:437-462); history validity two
  lines (:488-495); voucher codes `translate="no"` (:551, wig :509); `EmptyState` (:604); voucher input `name` + `spellCheck`
  (:677, wig :629). Dropped per answer 5: 8/4 split. Open: versions/vouchers paging in state.
- **discount-new / discount-version-new** (form): Cancel a real link before the primary (discount-new.tsx:90,
  discount-version.tsx:133; wig :81, :113); retry on load error (discount-version.tsx:54, wig :40); subtitle that repeated the
  breadcrumb removed; lead note as an info `Notice` (:125); primary "Tạo phiên bản" (:139); fixed amount and minimum spend are kit
  `MoneyInput` with the ₫ suffix, the form state keeps the same digit string through `digits()` (discount-form.tsx:29, :169, :185;
  wig :152, :165), "(₫)" left the labels, code `spellCheck={false}` (:96, wig :79); discount-targets.tsx "Tên (CODE)", product search
  `useDeferredValue` + a Set for chosen ids (:157-165, rbp :155-171 closed). Open: per-field inline errors need
  `lib/workforce/discounts.ts` to return one problem per field (not in this area's list); native `datetime-local` shows US order on
  vi (kit request for a DateTimeInput); en "1 uses".
- Tells removed: ALL-CAPS code as the lead column, counts in tabs, middle dots, "→", name tooltips, parenthetical heading, "+" glyph.
- B/C items: C4, C5, C15, C33, C58b, B9, B11.
- web-design-guidelines re-run: services 7 found / 4 fixed (3 open as listed), service-detail 4 fixed (1 open), discounts 3 fixed
  (row-menu `href` = kit), discount-detail 5 fixed, forms 6 fixed (open as listed). react-best-practices: 3 found, 3 fixed, 0 left.
- View transitions: staff 120 ms route fade only.

## Kit requests made (appended to docs/redesign-s10/kit-requests.md)

- `RowActions` has no `LinkComponent` passthrough (row-menu "Chi tiết" / "Mở khách" items stay `navigate()`).
- `ButtonLink` renders a plain `<a>` (full reload): a `LinkComponent` prop; workaround now = `PrefetchLink` + `buttonClass`.
- A `DateTimeInput` (dd/mm/yyyy HH:mm, 24 h) for the discount forms.
- `.ls-auth-card h1` is 18 px (shell.css:919); the staff sign-in title should be the compact title step.
- The workforce `Field` wrapper (ui.tsx:116) has no `error` prop (forgot-password imports the kit `Field`).
- `ListToolbar` result count duplicates the table's "Hiển thị" line (same as the pos request).

All six were then delivered by the lead and are used (see the follow-up below). Added in the follow-up: `useEmployeeNames`
serial pages (components/workforce/data.ts, shared hook) and `ButtonLinkComponent` vs Next `Link` under
`exactOptionalPropertyTypes` (workaround `screens/admin-button-link.tsx`).

## Follow-up (coordinator, 2026-10-16): every "Not done" item above is closed

This section supersedes the "Not done" / "Open" lines in the sections above.

- **URL state** (kit `useUrlState`, module-constant defaults and options, `normalize`, page keys reset when a filter changes,
  `replace` for typing; Back/Forward and a shared link restore the view). Keys per page:
  - notifications (staff and member): `ncat`, `nview`, `npage` (inbox.tsx).
  - loyalty: `tab`, `page`, `status` (existing), nested pagers `cbp` (combos), `rcp` (gift catalog), `bhp` (birthday history),
    `fzp` (frozen combos); loyalty-member profile `wallet`, `page` (existing), `pcp` (combos), `pgp` (gifts). New helper
    `lib/workforce/use-url-paging.ts` (`useUrlPaging`, `useUrlPage`, options cached per key).
  - dashboard: `branch` (branch widgets), `cmp` (revenue compare).
  - employee-detail `tab`, `bhp`; employee skills `shp`; team-detail `mtab`, `mq`, `mst`, `mcl`, `mteam`, `mpage`, `msize`;
    branches `page`, `size`.
  - advances `status`, `page`, `pageSize`; attendance `branch`, `from`, `to`, `page`, `size`, `minePage`, `mineSize`; leave
    `status` (ALL = every status), `page`, `size`, `minePage`, `mineSize`; income `period`, `date`, `detailsPage`, `detailsSize`;
    my-services `branch`; collaborator-schedule `branch`, `from`, `to`, `page`, `size`; my-payslips `page`, `size`; account
    `schedulePage`, `scheduleSize` (helper `lib/workforce/url-paging.ts`).
  - discount-detail `tab`, `vpage`/`vsize` (versions), `cpage`/`csize` (vouchers); services list and service-detail tab already
    in the URL.
  - Kept local on purpose (not open findings): the loyalty and gift-desk lookups and the gift-desk list, because the key is a
    customer's phone number or email, which must not go into the address bar, history or logs (privacy); the pager inside the gift
    history dialog (the dialog itself is not addressable); the discount product search inside the form (a transient query).
- **Notifications, one paging model**: the cursor "Tải thêm" button is gone; the table's 20-row pager is the only control. The next
  server batch (30) loads in the background while fewer rows than the page after the current one are loaded, so "next" exists
  whenever more exists and a shared `?npage=` link loads up to its page (inbox.tsx). `NotificationTable` takes an optional
  `paging` (a standalone table keeps local paging).
- **Discount per-field errors**: `lib/workforce/discounts.ts` `discountFieldProblems(form, 'create' | 'version')` returns every
  problem keyed by field in screen order (`createRequestOf` / `versionRequestOf` unchanged; business rules stay server-side);
  discount-form shows each at its `Field`, the first invalid field takes focus, submit stays enabled; the native `datetime-local`
  is the kit `DateTimeInput` (dd/mm/yyyy + 24 h). Services forms, add-service, service-detail edit/price dialogs: no disabled
  submits, inline required errors and focus; the skills form has the unsaved-changes guard.
- **Empty states with headings**: skills, branches, roles, employee assignments/roles/skills, team members, advances, attendance,
  leave, account schedule, chat-requests no-access, discount-new / discount-version blocked states, employee-new forbidden (with
  a next step "Về danh sách nhân sự").
- **Row menus**: `RowActions LinkComponent={PrefetchLink}` with `href` items in employees, branches, services, discounts,
  loyalty-exceptions, loyalty-referrals, loyalty-combo-sold (no `navigate()` left in a row menu). Self-service row menus only open
  dialogs.
- **Kit props used**: `ButtonLink LinkComponent` (through `AdminButtonLink`) for every create/Cancel/"Mở hồ sơ điểm" link (the
  `PrefetchLink` + `buttonClass` workarounds are gone); `DateTimeInput`; workforce `Field error` / `Empty title, action`;
  `.ls-cell-main` / `.ls-cell-sub` wrap in the kit, so `.ls-aa-wrap` was retired from the markup and from s10-admin-a.css; the
  sign-in h1 and the screen-reader-only toolbar count close those items.
- **Other open items closed**: dashboard layout read with `useSyncExternalStore` (no effect, no hydration mismatch), "Đặt lại mặc
  định" asks first (ConfirmDialog); `MoneyInput` grouping and sign from Intl (`lib/workforce/money-input.ts`) in the birthday and
  combo forms; roles intro is one line (full text moved into the create/edit form); the Skills tab heading no longer repeats its
  tab label ("Kỹ năng hiện có"); advances per-field errors and an Intl money formatter (true minus sign); collaborator-schedule
  drawer errors at the fields; chat-requests status options without counts; account shift times in `<time>`, tabular;
  attendance loads the branch list once; en "1 uses" uses `Intl.PluralRules`.
- **`i18n/workforce.ts` key check**: deep key comparison of the vi/en dictionaries against commit 8001336 and against HEAD: the only
  keys missing vs 8001336 are `nav.appearance`, `nav.themeLight`, `nav.themeDark`, `nav.themeAuto`, already removed in the committed
  foundation (HEAD, A1 no theme control); nothing is missing vs HEAD. No key was dropped by the working-tree edits.
- **Remaining outside this area** (requests filed): `useEmployeeNames` serial pages in components/workforce/data.ts (shared hook);
  `ButtonLinkComponent` typing vs Next `Link`.
- web-design-guidelines re-run on every file changed in the follow-up: final 0 open findings in this area's files.
  react-best-practices re-run: final 0 (no inline components, primitive memo deps, selection and branch derived in render, effect-
  based reset replaced by a `key`).

## Validation (run sequentially)

- Tests: 44 test files that import a changed module plus workflows, permissions, nav-groups, durations, pricing and
  `src/test/ui-ratchet.test.ts`: 288 tests, 288 pass. Pinned assertions updated with the same intent: employee-directory (create is
  a link), employee-roles / employee-skills (role and skill name markup), role-admin (short intro in the header, full intro in the
  form), discounts (forbidden heading, DateTimeInput fields), booking-board-dialogs (add-service submit enabled), payroll (Intl
  money with a no-break space), notifications (no status pill, unread dot), dashboard (no clamp, shortcuts), loyalty (groups, Intl
  money format). The ratchet baseline was not lowered (other workers edit the same counters; the lead can lower it once).
- `pnpm --filter @lucy-spa/web exec tsc --noEmit`: 0 errors.
- `pnpm exec eslint <this area's files>`: 0 problems. `prettier --write` on this area's files: clean.
- Not run here (lead): builds, screenshots, E2 captures.
