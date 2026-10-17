# Step 6, area "admin-b": evidence (session 10)

Worker: admin-b. Plan: `docs/redesign-s10/plans/fd-plan-admin-b.md` (PATTERN-LIST / -DETAIL / -FORM / -REPORT, then the pages). Owner
answer 5 binds: restyle only. Every layout move in the plan is **dropped** and listed per page. Owner answer 7: names wrap, never cut.

Skills loaded at the start: frontend-design, web-design-guidelines (WebFetch of the vercel-labs `command.md` returned only a summary,
so the full rule list was taken from the cached copy `.local/s10/wig-command.md`, as the contract allows), react-best-practices (rules
applied: js-cache-function-results, rerender-no-inline-components, rendering-conditional-render, rerender-derived-state-no-effect,
bundle-barrel-imports), react-view-transitions (`references/implementation.md` read).

View-transition decision (all pages): staff 120 ms route fade only (kit `--ls-dur-route`); no ViewTransition, no GSAP, no shared-element
morph; no count-up, totals and charts are never animated. No motion was added. Pattern: compact (DESIGN 10) everywhere, no R13-R17.

Baseline E2 (`.local/s10/e2/s10f-all/staff/*.json`, post-foundation) was re-read first: most plan items (table shadows, notice borders,
tab gaps and pressed state, truncation) were already closed by the foundation (foundation-v2.css:348, :392, :416, :502-535, :638) and are
not repeated below. The page-specific E2 items left were: "Hỏi" hover/pressed (reports), `span.ls-chart-swatch` non-radix (kit),
text200 axis overlap (kit), `.ls-media-title` (kit, admin-c page), `.ls-switch` and row checkbox hover (kit): see kit requests.

B/C items addressed (all groups): B6/C18 (equal KPI rows, no orphan), B11 (one filled button per view), B12/C19 (no boxes on boxes),
B18 and C5 (status icon + word via kit Badge), B24 (dead AI UI), C15/C58b (names wrap, numeric columns nowrap/tabular via kit), C33
(empty states with title and action), C40 (status in the header slot, no second back), C4 (one primary).

Answer-5 judgment calls (revert-ready): refunds totals line became a KPI row; import-detail "Hủy lần nhập" moved from the card menu to
the header; audit-log "Tải thêm dòng cũ hơn" shows on the table's last page only.

Files outside the strict list: `apps/web/src/lib/workforce/imports.test.ts` (pins i18n output); shared with admin-a:
`i18n/payroll.ts` (slip label, run strings only) and `payroll-slip.tsx` (PayslipDocument, PayslipScreen, MyPayslipScreen only).

## Shared work

- `packages/ui/src/s10-admin-b.css` (tokens only, no hex, no px spacing, no shadow, no transition): `.ls-adminb-note` (+ `data-tone`
  warning/success/danger: prose and status lines with an icon instead of tinted boxes, FR1/B12), `.ls-adminb-sub` (second muted line,
  replaces " · "), `.ls-adminb-code` (tabular, nowrap), `.ls-adminb-heading` (17/600 sub-heading), `.ls-adminb-kpis(-frame)` (KPI row whose
  column count follows the card count: 3, 4, 5 = 3+2 / 5, 6; no orphan card, two cards not stretched to half the page; container
  queries), `.ls-adminb-statement` (rule above the profit total), `.ls-adminb-wrap`, `.ls-adminb-muted`, `.ls-adminb-issue` (words +
  warning icon), `.ls-adminb-check`, `.ls-adminb-form` (max 720), `.ls-adminb-slip-brand`, `.ls-adminb-file`. Nothing removed from shared
  sheets.
- New `screens/reports-format.ts`: `shareText` (Intl percent, one decimal), `vndText` / `signedVndText` / `minusVndText` (true minus "−",
  "+" via one helper), cached per locale.
- `truncate: true` → `wrap: true` on every column of the area (31 files); raw `ls-cell-truncate` spans with `title=` tooltips replaced by
  `.ls-adminb-wrap` (supplier-imports.tsx:111, supplier-import-all.tsx:214/:448, supplier-import-changes.tsx:91).
- Middle-dot tell removed from every string and JSX join of the area (pay-salaries, pay-tour, pay-codes, pay-commission, pay-invoice-cards,
  payroll-run, payroll-slip, payroll-dialogs, import-detail, imports, import-zip, audit-log, ai-seo, ai-settings, supplier-import-review,
  website-popups, website-seasons, website-slides, season-select, reports-refunds); `metaLine` (pos-format.ts) for fact lines.
- Codes and identifiers `translate="no"` (SKU, lot, order, invoice, discount and staff codes, employee codes, phone, URLs, event code,
  request id). Curly quotes and "…" in the area's dictionaries (imports.ts, reports.ts, ai-settings.ts, supplier-imports.ts,
  supplier-sources.ts). Meaningful `name` on 96 form controls (Textarea also `autoComplete="off"`); MoneyInput `locale` instead of a
  hardcoded separator (pay-salaries, pay-tour, pay-commission, ai-settings).
- Status badges: kit Badge shows the tone icon; neutral statuses got an icon (cash "Chưa chốt" clock, payroll "Đã chốt" check, online
  order cancelled x-circle, supplier source "Đang tắt" pause).

## Reports (revenue, sales, customers, staff, stock, cash, pay, profit, refunds, reviews): PATTERN-REPORT

- assistant-box.tsx:73-84: when AI is off the card is the title and one status line (no question box, no disabled "Hỏi"): closes the E2
  "Hỏi" hover/pressed items on 9 reports and the dead-UI critique. When AI is on the card is unchanged.
- reports-kit.tsx: `ReportNote` (muted line with icon, info/warning), `KpiRow` (count-driven grid), report table empty state = icon +
  "Chưa có số liệu" + the sentence (C33), print period as dd/mm/yyyy – dd/mm/yyyy (wig :226), truncated count grouped (wig :344).
- Prose notices → `ReportNote`: revenue definition, customers branchless/top note, staff permission note, stock no-cost note, cash bank
  note, pay labour note, profit disclaimer + salary months + coverage (warning), reviews privacy note.
- revenue: flat line (no `area` fill), 6 KPI cards in one KpiRow, share via Intl (wig :515), print period (wig :254), counts grouped (wig
  :420). sales: codes translate="no" (wig :227/:498/:504/:549), KPI cards no longer half-width. profit: statement as a fixed DataTable
  without pager, true minus (−), rule above "Lãi tạm tính", SKU translate="no" (wig :136). cash: signed amounts via `signedVndText` (wig
  :103). refunds: the " · " totals line became 3 KPI cards, "Danh sách" h2 removed, date tabular (wig :197), codes translate="no".
  reviews: employee code translate="no" (wig :123). stock: blank branch → "—" (wig :199), days grouped (wig :330), SKU/lot translate="no"
  (wig :203/:368).
- Dropped per answer 5: AI card into a header drawer, KPI rows added to table-only reports (staff, stock), short staff headers, sticky
  first columns, charts per tab, tabs above the toolbar reordering.
- Chart swatch colours come from the kit chart palette (`--ls-chart-N`, components.css:4169): kit request filed.

## Import (import, import-detail): PATTERN-LIST / -DETAIL

- imports.tsx: one primary (ZIP is secondary; while empty the empty state carries "Tải tệp lên" and the header shows none), empty state
  icon + title + sentence + action, row menu "Mở" is a router link (wig :132), created-at tabular, dropzone line without " · " (wig :203).
- import-detail.tsx: status badge in the PageHeader `status` slot, "Hủy lần nhập" danger outline before the primary (card `⋮` removed),
  uploader/time as separate dl rows, lot via Intl list, SKU translate="no", search placeholder with example and "…" (wig :487), textarea
  name (wig :350). Dropped: summary as a trailing column, rows drawer clamp.

## Supplier imports (supplier-imports, supplier-imports-all, supplier-sources): PATTERN-LIST

- supplier-imports.tsx: names wrap, SKU translate="no" (wig :130), "Cần xử lý" as words + warning icon (one status badge per row),
  description one sentence. The `?review=` link keeps tab, filters and page (`serializeUrlState`, wig :115).
- supplier-import-all.tsx: info box → four muted lines, category count pills removed (counts in the "Nhóm" filter choices), blocked table
  under h2 "Chưa nhập được", progress announced in a status region (wig :288), error state with PageHeader/h1 (wig :67), search placeholder
  (wig :366), SKU translate="no" (wig :221). Dropped: header checkbox bulk bar.
- supplier-sources.tsx: permission and test columns as words (icon only when attention is needed), one "Trạng thái" badge, URL fields
  `spellCheck={false}` + names (wig :543/:482), base URL translate="no". `type="url"` not added: FormDialog has no `noValidate`, native
  validation would replace the inline errors.

## Pay and payroll (pay, payroll, payroll-detail, payroll-slip, my-payslip-detail): PATTERN-LIST / -DETAIL

- pay.tsx: no-access text instead of a load error (wig :43). pay-*: tab h2 removed (FR heading repeats its control), employee code on a
  muted second line, reasons on a second line, search placeholders with examples (wig pay-tour :166, pay-codes :189), MoneyInput locale
  (wig pay-salaries :250, pay-tour :264), field names (wig :247/:261/:275/:388).
- payroll.tsx: "Các kỳ lương" h2 removed, description one sentence. payroll-run.tsx: run status in the PageHeader `status` slot (out of the
  dl), "Xem phiếu" is a router link (wig :235), employee code translate="no" (wig :156), search placeholder (wig :365).
- payroll-slip.tsx (PayslipDocument + PayslipScreen + MyPayslipScreen; the my-payslips list in the same file is admin-a's and was not
  touched): status in the PageHeader `status` slot, card title = the employee (no repeat of the h1), "LUCY SPA" + month print only with
  translate="no" (wig :84), employee code row.

## Audit log: PATTERN-LIST

- audit-log.tsx: scope box → muted line, "Việc đã làm" = the area in words (ALL-CAPS event code only in the drawer, translate="no"), one
  paging model (older rows load from the table's last page only), time tabular, entity and request id translate="no", placeholder (wig
  :112), drawer headings 17/600. Page, page size and the open event live in the URL (keys `ap`, `aps`, `ev`; a new filter returns to page 1, wig :58/:59).

## Website (website tabs, page/popup/season forms), seo-drafts, ai-settings, season-preview

- The default tab (media library, media-library.tsx) is an admin-c file and its tiles are kit `media-grid.tsx`: not changed (kit request).
- website-popups/-seasons/-slides, season-select: no " · " labels. website-page-form / -popup-form / -season-form / -slide-drawer: Switch
  hint tied with `aria-describedby` (wig :367, slide :352), field names (wig :222, :291, :341, slide :212), long file names break
  (slide :166), year note as a muted line (season), popup/slide start/end use the kit DateTimeInput (dd/mm/yyyy + 24 h). website-shop-info:
  "Sửa giờ mở cửa" is a router link (wig :362), map/Facebook `type="url"` + spellCheck (wig :283, form has noValidate). Footer blocks,
  slide link: spellCheck only (forms without noValidate).
- ai-seo.tsx: h2 removed, count as "n kết quả" (wig :199), empty state = icon + title + sentence + "Tạo bản nháp" (header primary hidden
  while empty), no title tooltips, notes joined with "; ".
- ai-settings.tsx: warning/info/result boxes inside the cards → status lines with icons, result and check time on two lines, form max 720.
- season-preview-panel.tsx: two info boxes → muted lines. season-preview page: unchanged. The plan item was a new 48 px staff bar above the stage (wordmark, "Xem trước mùa lễ: <tên mùa>", device and light/dark segmented controls, a "Đóng" button); answer 5 drops it as a layout change (a new band on a page that is drawn inside the admin preview frame, whose panel already has the device, theme and "open full page" controls; the stage itself is a customer file).
- Dropped: page-form language switch and icon toolbar (RichEditor is kit), preview panes beside forms, 4-step season index, tile grid
  rebuild.

## Follow-up round (coordinator, after the first hand-back): the open list closed

- URL state: `screens/payroll-url-list.ts` (new, `useUrlList(prefix)`: search + page + size, a new search returns to page 1) for the payroll
  run lines; `useUrlPaging` (lib) for the pay tabs (`sap`, `tup`, `cmp`, `kp`), payroll (`rp`), supplier sources (`ssp`), imports (`p`), report
  tables (`tp`, a second table on one panel `tp2`) and the blocked supplier table (`bp`); supplier-import-all search, category, brand and page
  in one `useUrlState` (`q`, `cat`, `brand`, `p`, `ps`); audit-log page, page size and open event (`ap`, `aps`, `ev`); ai-seo open draft
  (`draft`); website pages, popups, seasons (with status and year) and slides (fork; `pp`, `pop`, `sp`/`sst`/`sy`, `slp`). Lists inside
  drawers, dialogs and the printable payslip (history drawers, ZIP dialog, payroll items drawer, payslip items) keep local paging: the drawer
  itself is not in the URL, so a page key for it would point at nothing.
- Field errors that say what to fix: pay.ts `common.fieldErrors` (amount, date window, reason, target, percent, seller) in pay-salaries,
  pay-tour, pay-commission, pay-codes, pay-invoice-cards; payroll.ts `common.fieldErrors` (employee, amount, reason, day, fund) in
  payroll-dialogs, which also focus the first invalid field and name the selects ("Chọn nhân viên…", "Chọn quỹ…"); the website dialogs and the
  footer drawer (fork). The close dialog's submit is disabled while blockers exist (`submitDisabled`).
- Unsaved-changes guards: the website forms (`website-leave.tsx`: Cancel, any same-site link, close and reload), the ai-seo draft drawer and
  the supplier review drawer (kit discard dialog), the ai-seo rewrite dialog (`dirty`).
- Confirmations: unpublish (website-pages), delete fact / remove group / delete why-card (shop-lists), delete footer block, and the bulk
  "Nhập và đăng" run (supplier-import-all; with nothing ticked the button now reads "Bỏ qua {count} sản phẩm").
- "Xem trên website (mở thẻ mới)" is a real link with target=_blank and rel=noopener noreferrer (website-pages).
- Errors shown, never swallowed: payroll refresh (a status line under the summary), commission product search, the ai-seo drawer load
  (ErrorState with retry), the season-form popup/slide lists (ErrorState with retry).
- Popup/slide/season delete busy label "Đang xóa…", shop-info "Đang lưu…", a website time label, curly quotes and placeholders in the website
  blocks of workforce.ts.
- Smaller: the decimal mark for file sizes comes from Intl (imports, import-zip), names on the remaining AI settings controls, the SKU input
  has spellCheck off.

## web-design-guidelines re-run (files changed)

Every finding of wig-admin-a / wig-admin-b on the files touched is fixed (above and in the page sections). Items that are not findings, with
the reason:

- ai-seo.tsx:171/:292 and import-detail.tsx:382 "formatVnd instead of Intl": `formatVnd` is `Intl.NumberFormat` on a BigInt
  (lib/workforce/format.ts:18), so the amount is already Intl-formatted.
- Switching tabs on the website page while shop info has unsaved edits: the tabs are buttons in media-library.tsx (admin-c), outside these
  files; filed in kit-requests.md. Links, close and reload are guarded.
- Final open list: empty.

## react-best-practices re-run (components touched)

- Fixed: polling effects depend on the stable `reload` (ai-seo list and drawer, ai-settings); mirror effects removed (ai-settings,
  supplier-sources: a saved answer overrides the loaded one until the next load, derived in render); form-reset effects in the website forms
  replaced by "adjust state while rendering" (fork); `useState(() => randomUUID())` in pay-command and payroll-command
  (rerender-lazy-state-init); ai-seo reloads in parallel (async-parallel); supplier-import-all counts in one pass, with a category set and
  pre-normalized search text (js-combine-iterations, js-index-maps, js-cache-function-results).
- Not findings, with the reason: supplier-import-review.tsx:101-108 seeds the draft once and then merges the user's edits with each server
  answer (`mergeDraft`), which a `key` remount would throw away; the website forms' remaining effects only move DOM focus after a refusal;
  pay-invoice-cards.tsx async-parallel (tips and earnings start after the invoice) would need the fetch to start in pos-invoice.tsx, a POS file.
- Final: 0.

## Tests and checks (final)

- 20 test files of the area (screens, area lib tests, ui-ratchet): 111/111; website tests (popups, seasons, shop-info-panel, slides, pages,
  media): 65/65 + 8/8. Tests changed for copy only: imports.test.tsx, reports-b.test.tsx, reports-c.test.tsx, lib/workforce/imports.test.ts.
- Kit `components-css.test.ts`: 13/13. `tsc --noEmit` (web): 0 errors in admin-b files. eslint on every changed file: 0. Prettier: clean.
