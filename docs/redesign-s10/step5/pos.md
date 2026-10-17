# Step 5, area "pos": evidence (session 10)

Worker: pos. Plan: `docs/redesign-s10/plans/fd-plan-pos.md` (all sections except staff/SHELL). Owner answer 5 binds: the POS board
and the booking board keep their structure; restyle only, no workflow change. Every layout move in the plan (POS two panes, invoice
right pane, booking time grid, 8/4 detail columns, walk-in summary aside, cash summary into a tab, payment dialog replacing "Thu tiền
mặt") is **dropped per answer 5** and listed per page below.

Skills: frontend-design, web-design-guidelines (rules fetched fresh from the vercel-labs URL with WebFetch on 2026-10-16; same 17
sections as `.local/s10/wig-command.md`), react-best-practices (rules applied: bundle-dynamic-imports, rerender-derived-state-no-effect,
rerender-memo, js-cache-function-results, rendering-conditional-render), react-view-transitions (`references/implementation.md` read)
loaded at the start. Conflict noted once: the plan puts a status badge "beside the h1" on detail pages; the Owner rule "headings are
text only" wins, so status is a badge in the kit PageHeader `status` slot under the h1 (never in or beside the heading).

View-transition decision (all 14 pages): staff 120 ms route fade only (kit `--ls-dur-route`); no ViewTransition, no GSAP, no
shared-element morph on any POS page; totals, tables, typing, scanning and the countdown are never animated (G5). No motion was added.

Pattern used: compact (DESIGN 10) everywhere: list page (pos board, booking board, reassignment, cash, product-orders, online-orders,
product-returns), detail page (pos-invoice, product-order-detail, online-order-detail, product-return-detail, inventory-count-detail),
form page (walk-in, product-return-new). No R13-R17 customer pattern.

## Shared work (all pages)

- New file `apps/web/src/components/workforce/screens/pos-format.ts`: `listFormat`, `metaLine` (Intl.ListFormat, replaces every
  hand-written " · " meta string), `minutes` (Intl unit "45 phút", replaces "45′"), `percentNumber`, `signedNumber` (Intl signDisplay),
  `sentence`; all cached per locale (js-cache-function-results).
- `packages/ui/src/s10-pos.css` (only classes used by these screens): `.ls-pos-undo` (C72 inline undo), `.ls-pos-name` (wrapping
  name, replaces the kit's nowrap/ellipsis `.ls-cell-title` in POS markup), `.ls-pos-qr` (reserved QR box), `.ls-pos-countdown`,
  `.ls-pos-diff*` (count difference), `.ls-pos-focus-target`, `.ls-pos-brief-heading`, `.ls-pos-figure` (tabular money outside tables).
  Tokens only, no hex, no px spacing, no shadow, no transition. Nothing removed from pages-v2/site/components/staff.css.
- Owner answer 7 / C58b: every `truncate: true` column in the POS screens (40 columns in 14 files) is now `wrap: true`; raw
  `ls-cell-title` spans with `title=` tooltips replaced by `.ls-pos-name` (booking-board-sections.tsx:94, reassignment.tsx:215-216,
  online-orders.tsx:489); `CardHeader clamp` removed (booking-board-sections.tsx queue card, walk-in.tsx:187). Numeric columns stay
  `numeric: true` (right-aligned, nowrap, tabular in the kit). The kit's `.ls-cell-wrap` 2-line clamp is K3 (lead), requested.
- Middle-dot tell removed from every POS dictionary string and JSX join: workforce.ts (visitInfo, bookingBoard.date), product-sale.ts,
  combo.ts (price, comboLabel x2, chosenBadge, takenBadge, cardService, sessionText, intro), combo-sold.ts, product-returns.ts,
  product-refunds.ts, product-exchanges.ts, plus `productTitle` (lib/workforce/product-sale.ts:46-50), `optionLabel` (:73),
  `exchangeOptionLabel` (lib/workforce/product-exchanges.ts:132), `returnProductName` (lib/workforce/product-returns.ts:205). These
  three lib helpers are used only by the POS screens (grep: no caller outside screens/pos*, online-order*, product-*), so they were
  changed here; the variant is now in brackets "Kem dưỡng (50 ml)". "— " fragments joined by an em dash also removed (option labels,
  discount notices).
- Status badges: kit Badge already shows the tone icon (Step 3). Late/overdue badges carry a clock icon + word
  (product-orders.tsx:497, :833; online-orders.tsx:291; booking-board-sections.tsx:302).
- Codes and identifiers `translate="no"` (invoice, visit, order, SKU, voucher, tracking, bank reference).
- Code and bank-reference inputs `spellCheck={false}` (pos-dialogs voucher, product-orders x3, product-refunds x2, product-exchanges x2,
  product-returns invoice code).
- Search placeholders end with "…" and show the pattern (pos, booking board, product-orders, online-orders, product-returns, product
  add, count add item).

## Per page

### pos (board) - compact list page

- Changed: `/` focuses the search from anywhere (pos.tsx:57-81, skip while typing or a dialog is open, `aria-keyshortcuts`); sale dialogs
  `next/dynamic` (pos.tsx:41-46); first branch derived, effect removed (pos.tsx:98); names wrap (pos.tsx:192, :255, :263, :273, sellers
  via Intl list); code `translate="no"` (pos.tsx:185, :239); empty waiting lane = icon + sentence + "Tiếp nhận khách" secondary link
  when the person may manage bookings (pos.tsx:406); placeholder (pos.tsx:350).
- Kept: header one primary "Bán sản phẩm" + secondary "Bán combo" (already one filled); both lists as they were (answer 5).
- Dropped per answer 5: two panes, right invoice pane, pinned totals, status chips instead of the select.
- Baseline closed: wig pos.tsx:292, :191, :53, :258; rbp pos.tsx:34-35, :66-68, :88-92, :133-264, pos.ts:50. pos.tsx:124 is not a finding (see the follow-up).

### pos-invoice - compact detail page

- Changed: C72 undo for a removed product line (pos-invoice.tsx:115, :159, :248-270, :568-580; pos-products.tsx `undo` slot): the
  removal's toast carries "Hoàn tác" (kit toast action, 8 s), which re-adds the line (variant, quantity, seller, mode) with the
  existing `product-lines` POST using the latest invoice version; without a toast provider the same undo is an inline line above
  the products. wig pos.tsx:258 closed by the row menu router link. Subtitle without middle dots (pos-invoice.tsx:408); duplicate "Hóa đơn đang chờ thanh toán." notice removed
  (badge carries it); the status badge (PageHeader status slot) is inside a persistent `role=status` so a PayOS "paid" is announced (pos-invoice.tsx:470, wig :130).
- PayOS card (pos-payments.tsx): countdown in its own leaf outside any live region, tabular (`PayosCountdown` :426, wig :381/:383, rbp
  :307-311); reserved 240 px QR box (:386, wig :388); localized alt with the amount (:392, wig :391); "Hủy mã QR" = danger outline + icon
  behind a ConfirmDialog with "Giữ mã" (:345, :409; pos-dialogs.tsx:758 `PayosCancelConfirm`, wig :348); "Mở trang thanh toán" new-tab
  cue (:329); held amount tabular (:198, wig :195).
- Discount card (pos-sections.tsx): notices as short sentences, amounts tabular (:161-205, wig :167/:169/:176/:195/:197/:202); percent
  via Intl (:61, wig :65); voucher code `translate="no"` (wig :247); payer menu item one dictionary string (wig :339).
- Kept: card order and buttons ("Thu tiền mặt" primary in the payment card, "Chốt hóa đơn" primary in the header are never shown
  together: draft vs finalized).
- Dropped per answer 5: two panes, pinned totals pane, single "Thanh toán" payment dialog.
- Remaining: none; every item is closed or explained in "Follow-up: open findings closed" below.

### walk-in - compact form page

- Changed: primary "Tiếp nhận khách" stays enabled until the request starts; a refused submit shows the reason and moves focus to it
  (walk-in.tsx:63, :139, :462, :475; wig :129, :438); each person numbered within the kind ("Khách lẻ 2: Lan") for headings and remove
  buttons (:250, :329, :337, :446; wig :300, :308); service options once per render (:242, rbp :377-380) with Intl minutes (wig :379);
  result cards h2 (wig :182), names not clamped (:187); result lines as comma lists (:206).
- Kept: the three add actions (secondary, kit), "Thêm trẻ em" blocked with its visible reason (kit `disabledReason`).
- Dropped per answer 5: summary aside, sticky footer.
- Remaining: none; every item is closed or explained in "Follow-up: open findings closed" below.

### booking-board - compact board (structure kept)

- Changed: the date and refresh time moved out of the toolbar's live region into the subtitle, so the 30 s refresh is not read out
  (booking-board.tsx:261, wig :272); placeholder (:285); service lines one per row with Intl minutes and comma lists, no clamp
  (booking-board-sections.tsx:107, :461, :479, :647, :666; wig :103, :75 family, :454); customer names wrap (:94); staff column visible
  from 1024 (:263, C74); overdue badge clock icon (:302); queue card name not clamped; four empties = icon + sentence, the waiting pool
  with "Tiếp nhận khách" (:210, :378, :594, pool empty); intent dialog text and durations (booking-board-dialogs.tsx:292, :310).
- Dropped per answer 5: the time grid.
- Remaining: none; every item is closed or explained in "Follow-up: open findings closed" below.

### reassignment - compact list page

- Changed: title without "&" ("Đổi kỹ thuật viên khi nghỉ phép", C41); range in the person's date format (reassignment.tsx:278, wig
  :274); service and request wrap (:215-216); empty = icon + sentence with the next step (:346); dialog texts as comma lists
  (reassignment-dialog.tsx:70, :106, :130); code `translate="no"`.
- Remaining: none; every item is closed or explained in "Follow-up: open findings closed" below.

### cash - compact list page with a summary card

- Changed: balances tabular (cash.tsx:334, :340, wig :331); the warning badge is one short word "Lệch lớn" with the sentence as text
  (cash.tsx:361, DESIGN 8.7); row menus named by category, time and amount (cash-book.tsx:281, wig :278); empty actions column removed
  (cash-closing.tsx, wig :210).
- Kept: "Chuyển quỹ" is a secondary in the list toolbar's action slot (a fixed action place), primary "Ghi sổ quỹ" in the header.
- Dropped per answer 5: summary moved into the "Sổ quỹ" tab, segmented tabs (kit).
- Remaining: none; every item is closed or explained in "Follow-up: open findings closed" below.

### product-orders (list) and product-order-detail

- Changed: "Cấp hàng" loses the misleading refresh icon (product-orders.tsx:292); code link `translate="no"` (:453); late badge clock
  (:497, :833); detail title "Đơn đặt trước DT000010" (C41); the "Trễ hẹn" banner removed (the line badge says it once); invoice code is
  a link to the invoice (:969); refund label one string (:988, wig :796 partly); placeholder (:262); variant in brackets.
- Kept: no header primary on the detail (every action is per line; which one is "main" is an Owner question, plan).
- Dropped per answer 5: 8/4 detail columns.
- Remaining: none; every item is closed or explained in "Follow-up: open findings closed" below.

### online-orders (list) and online-order-detail

- Changed: line names wrap, no "1." prefix, SKU `translate="no"` (online-orders.tsx:489; closes E2 clipped-text 8 on
  `span.ls-cell-title`); late badge clock (:291); invoice code links to the invoice (:784); money in the DLs tabular (:692, :794, :798,
  :904-909, wig :775/:680/:885-890); tracking link new-tab cue (:683, wig :664); "Chưa gửi hàng." points to "Gửi hàng"; placeholder.
- Dropped per answer 5: 8/4 detail columns.
- Remaining: none; every item is closed or explained in "Follow-up: open findings closed" below.

### product-returns (list), product-return-detail, product-return-new

- Changed: header "Mở hồ sơ" is a router link styled as the primary (product-returns.tsx:302, wig :300); detail title "Hồ sơ trả hàng
  TH000055" (:890, C41); "Mở bởi / Xử lý bởi" and history without middle dots (:1028, :1034); product + SKU (`translate="no"`); new: IME
  guard on Enter (:561, wig :556) and the found invoice in a persistent `role=status` (:580, wig :575) as a comma list; refunds and
  exchanges sections: tabular money (product-refunds.tsx:97-99, product-exchanges.tsx:193), comma lists, no stray separator when there
  is no bank reference (wig refunds :433, exchanges :762).
- Kept: "Tìm hóa đơn" secondary (no new filled button, plan item pending Owner).
- Remaining: none; every item is closed or explained in "Follow-up: open findings closed" below.

### inventory-count-detail - compact detail with an editable sheet

- Changed: title "Kiểm kê KK000001" (inventory-counts.tsx:419, C41); difference = signed tabular number with an arrow icon and status
  colour, no circled pill (:384-390); one filled button at a time: "Lưu số đếm" is primary while counts are unsaved, "Duyệt kiểm kê"
  primary otherwise (:439, :516; pending Owner, plan); removed line has an inline "Hoàn tác" (:309, :529, wig :383); page kept across
  saves (CountScreen holds it, :270, wig :584); leave guard while unsaved (:321, wig :300); SKU `translate="no"`; creator/approver lines
  without middle dots; placeholder "…" (inventory.ts).
- Remaining: none; every item is closed or explained in "Follow-up: open findings closed" below.

### customer-brief (POS drawer)

- Section headings use the compact heading role (`.ls-pos-brief-heading`, wig :67); lists via Intl (wig :103, :110); talking points in
  an `aria-live` region (wig :136); no hard-coded full stop (wig :141).

## web-design-guidelines re-run (files changed in this Step)

Scanned every added line of the diff (`git diff -U0`, about 920 added lines in the POS screens and libs) against the fetched rules and the anti-pattern list (middle dots, primes, `title=` tooltips as the only text, `target=_blank` without a cue, unlabeled icon buttons, `&&` renders, hand-made formats); the files' remaining baseline findings were checked against the audit lines. Found while editing and fixed: pos-payments.tsx (prop type for the
async cancel), customer-brief.tsx (a bad join from a scripted edit), booking-board-sections.tsx (missing key field, used `sequence`),
product-returns.tsx (double brackets "(50 ml) (KEM-50)" -> "(50 ml), KEM-50"). New findings introduced: 0. Final open list: empty (see the follow-up; the items explained there are not findings, with the reason).

## react-best-practices re-run (components touched)

Applied: bundle-dynamic-imports (pos.tsx sale dialogs), rerender-derived-state-no-effect (pos.tsx branch), rerender-memo (PayOS
countdown leaf; walk-in service options once per render), js-cache-function-results (pos-format.ts cached Intl). New findings
introduced: 0 (no inline components, no new effect except the `/` listener, stable keys; the toast's undo reads the latest render through a ref, rerender-defer-reads). The baseline items are closed in the follow-up below (one is explained as not a finding).

## Kit changes adopted (lead, after the requests)

- Toast action: C72 undo is now the kit toast with "Hoàn tác" (8 s) on pos-invoice (removed product line, re-added with the existing call and the latest invoice version via `restoreRef`) and on the count sheet (removed draft line). The inline `.ls-pos-undo` line stays only as the fallback when no toast provider is mounted (component tests, screens outside the shell).
- `PageHeader status`: the status badge sits under the h1 (never inside it) on pos-invoice (inside a persistent `role=status`), product-order-detail, online-order-detail, product-return-detail and inventory-count-detail; the status row/first DL fact is gone from those cards.
- `RowActions LinkComponent` (and `ButtonLink LinkComponent`): `screens/pos-links.tsx` gives the staff router link in the kit shapes; "Xem/Mở" row items are real router links on the pos board, product-orders, online-orders, product-returns and the count list (wig pos.tsx:258, product-orders :527, online-orders :331, product-returns :276, inventory-counts :145 closed). The interim `pos-row-menu.tsx` is deleted.
- `SearchInput keyShortcut="/"` replaces the attribute-setting effect (pos.tsx).
- `.ls-cell-wrap`/`.ls-cell-title` no longer clamp (K3); disabled controls are no longer hover/press candidates.

Also: the waiting-pool "Tiếp nhận khách" link is shown only with MANAGE_BOOKINGS at the board's branch (the board itself needs only VIEW_BOOKINGS), like the pos board's. The PayOS cancel ConfirmDialog closes even when the API refuses: by design, `command()` shows the refusal in the page notice next to the payment card (H11), not inside the dialog.

## Tests

Added: `screens/pos-format.test.ts` (Intl lists, minutes, signed numbers, percent, sentence); `lib/workforce/pos.test.tsx` (PayOS QR box reserved, cancel is a danger outline, new-tab cue, countdown not in a live region; `PayosCancelConfirm` renders as an alertdialog with "Giữ mã" and the amount); `lib/workforce/product-sale.test.tsx` (the undo slot renders above the lines table and only when given). Updated copy-pinning assertions (middle dot -> brackets/commas, new titles, the late banner now asserted absent and the badge present). Run after the follow-up (node:test via tsx, sequential): 32 files, 297 tests, 297 pass; ui-ratchet pass; kit components-css pass. `tsc --noEmit` (web): 0 errors. eslint on every touched POS file: clean. prettier: clean.

## Follow-up: open findings closed (coordinator, 2026-10-16: zero open web-design-guidelines / react-best-practices findings)

No workflow or layout change (Owner answer 5): the same screens, sections, buttons and order; only state, wording and behaviour
details. New shared helpers: `screens/pos-url.ts` (`useUrlPage`, `backParam`/`useBackQuery`), `screens/pos-dom.ts`
(`focusFirstInvalid`), `screens/pos-links.tsx` (router link for the kit `LinkComponent` props), more Intl helpers in
`pos-format.ts` (`clockTime`, `clockRange`, `dayMonth`, `percentText`, `signedMoney`).

URL state (wig Navigation & State; Back/Forward and shared links restore the view; 20 rows a page, no page-size select):

- pos.tsx:53 branch, date, status, search and both pagers in the address; the board is keyed by branch and day, so no reset effect
  (rbp :88-92); invoice filter and both column sets memoised (rbp :133-264).
- pos-payments.tsx:40 payments, anomalies and notes pages in the address.
- booking-board.tsx:66 branch and search; booking-board-sections.tsx:66 the three tables' pages.
- reassignment.tsx:42 branch, dates, conflict filter and page.
- cash-reconcile.tsx:47 branch and period.
- product-orders.tsx:353 the "Cần đặt" tab's page and sort, and the detail lines page; online-orders.tsx:429 lines, log and returns.
- product-orders.tsx:931 / online-orders.tsx:721: the list view (tab, search, page) travels with the record link (`?back=`, only
  the known list keys are read back) and the breadcrumb returns to it.

Forms (wig Forms): enabled until the request starts, the reason said inline, focus moved to the first invalid field:
pos-dialogs.tsx:288 (payer already set, empty lookup), walk-in-lookup.tsx:72, :44, booking-board-dialogs.tsx:295 ("Chưa có gì thay
đổi"), reassignment-dialog.tsx:74 (field errors per missing piece), product-returns.tsx:741, :478, product-orders.tsx:651/:1106/
:1289/:1369, product-refunds.tsx:237/:398, product-exchanges.tsx:384/:635/:727, inventory-counts.tsx:486 (a refused save opens the
page of the first wrong row). Dirty guards: product-returns.tsx:519 (leave guard), product-refunds.tsx:263, product-exchanges.tsx:416
(any change counts). Count inputs: NumberInput `inputMode="numeric"` (product-returns.tsx:687, product-refunds.tsx:277 with
min/max/step); inventory-counts.tsx:336 the box names the product, :341 the notice names the wrong rows and each wrong box points
to it. MoneyInput `locale` (cash x5, product-orders.tsx:1176). cash.tsx:178 and the book/closing/reverse fields: a specific
message per field (`cash.problems`), never the generic "Dữ liệu chưa hợp lệ". cash-reconcile.tsx:49 a backwards period is said.

Undo / confirm (wig "destructive needs confirm or undo"): pos-invoice.tsx:335 clearing a combo use and pos-sections.tsx:270 removing a
voucher get the toast "Hoàn tác" (re-applied with the existing calls); walk-in.tsx:309 removing a person or a service gets "Hoàn tác"
(the person returns with their services and guardian links); walk-in.tsx:253 changing branch with guests entered asks first;
pos-pre-orders.tsx:313, :323 revoking or replacing the customer's ticket link asks first ("Giữ liên kết").

Live regions and layout (wig Accessibility / Content): booking-board.tsx:301 a failed background refresh is one quiet line in the
subtitle with the last board kept (no alert every 30 s, nothing pushed down); :99 the passive refresh waits while the tab is hidden
or a menu/dialog is open; :115 a failed staff-options load is said; booking-board-sections.tsx:566 the queue shows a skeleton while
loading; :554 queue cards `content-visibility: auto`; booking-board-dialogs.tsx:192 a line without staff says so; cash-closing.tsx:341
the difference block is always on the form inside a polite live region; cash-book.tsx:265, cash-closing.tsx:175/:207 the time,
reason and closing time are visible text, not only tooltips; reassignment.tsx:169 a refused reassign keeps the dialog, the chosen
replacement and the reason, and shows why; :117 changing the scope keeps the reason and the acknowledgement; :255 the disabled
"Đổi" says why; pos-pre-orders.tsx:181 reserved QR box, :223 the expiry is re-checked every minute from clock state (no clock read in
render), :370 a real empty text.

Locale and copy (wig Locale & i18n, Typography, Content & Copy): Intl time ranges (booking-board-sections.tsx:75, :631,
walk-in.tsx:204), Intl lists (online-orders.tsx:449, address, refunds/exchanges corrections and lots), Intl percent
(pos-sections.tsx:81), Intl sign for money (cash-book.tsx:266), Intl day/month (pos board); one dictionary text per case instead of
glued sentences: pos-dialogs.tsx:725, pos-payments.tsx:284 (separate whole sentences), cash-book.tsx:360, :562, cash-closing.tsx:324,
:350, online-orders.tsx:694, :687, :317, product-orders.tsx:675/:1137/:1316, product-returns.tsx:1378/:1390, product-exchanges.tsx:477,
walk-in.tsx:405 and booking-board-dialogs.tsx:319 ("{name} (chưa chấm công)"). Tabular money: product-orders.tsx:1247,
product-refunds.tsx:94-105/:355, product-exchanges.tsx:105/:166/:193/:207/:211/:480, online-orders.tsx:891 (explicit emphasis).
Dictionaries: curly quotes (workforce.ts, product-refunds.ts, product-exchanges.ts, online-fulfilment.ts), non-breaking space before
"₫" and "MB" (product-orders.ts, online-fulfilment.ts, product-returns.ts), error texts with the next step (workforce.ts
WALKIN_NOT_ASSIGNABLE, INVOICE_CANCEL_NOT_ALLOWED; product-orders.ts noCause, ORDER_CANCEL_CAUSE_INVALID (+online-fulfilment.ts);
product-returns.ts MEDIA_INVALID_IMAGE; product-exchanges.ts PRODUCT_NOT_SELLABLE), named submit labels (booking board "Kết thúc
ngoại lệ"; online settle "Settle the order").

react-best-practices: pos-invoice.tsx:100-776 the cards that only show the server's answer (DiscountCard, SidesCard, ComboUseCard) are
memoised and the 5 s PayOS poll keeps the same invoice object when nothing changed (:129-136); :589-590 the tips and earnings of the
invoice are requested together with the invoice and handed to the pay cards through the context (async-parallel); pos-dialogs.tsx
:142/:161/:448 functional setState, :487-490 the tip offer is prefetched on hover/focus of "Tạo mã QR"; pos-products.tsx:64-98/:459-463
30 s answer cache per branch and search, :67-89 loading derived, :281-283 default seller derived; walk-in.tsx:64-66 the idempotency
key is cleared where edits happen, :69-71 branch derived; booking-board.tsx:74-76 branch derived, :103-119 staff options asked in
parallel, :248/:303-345 sections memoised with stable handlers and one clock object; booking-board-dialogs.tsx:304 staff map;
reassignment.tsx:62-64 branch derived (and a cached date formatter); cash-book.tsx:300, product-orders.tsx:1088,
product-refunds.tsx:225, product-exchanges.tsx:355 lazy request id; cash-book.tsx:376-414, cash.tsx:189-192/:211, cash-closing
functional setState; cash-closing.tsx:231, cash-reconcile.tsx:45 `todayIn` once per zone; booking-board.ts:39 and pos.ts:50 (as used
by these screens) cached Intl formatters in `pos-format.ts` (the shared lib keeps its own callers unchanged).

Not findings (exactly why):

- pos.tsx:124 `todayIn` in render: reached only after the branch list arrives from the API in the browser; the server never renders
  this branch of the component, so server and first client render cannot differ.
- pos-pre-orders.tsx:139 `window.location.origin` in the ticket dialog: the dialog mounts only after a click on the client.
- booking-board.tsx:222-226 the intent changes are posted one after another on purpose: each is its own command with its own
  refusal, and stopping at the first refusal is the behaviour the staff see (parallel posts would change it).
- reassignment.tsx:349 "Xem thêm" fetches the next page of the server's cursor (more lines than the first answer); the DataTable pages
  what is loaded. Two different things, not two pagers of one list.
- product-orders.tsx:796, product-refunds/exchanges detail lines "Nhãn: giá trị": every part is a whole dictionary sentence or a
  label followed by its value; nothing is a fragment glued into another sentence, and no middle dot remains.
- workforce.ts:89 `errors.validation` is a shared common text; no POS field uses it any more.

## Kit requests made (docs/redesign-s10/kit-requests.md, "[pos]")

Toast action (C72), SearchInput `keyShortcut`, PageHeader status slot, Menu `LinkComponent`, toolbar count tabular + duplicate count,
`aria-disabled` hover/pressed, `.ls-cell-wrap` clamp (K3).

## Could not do (and why)

- Tabs/segments/pager hit-target gaps and hover/pressed (E2 on cash, product-orders, online-orders, product-returns, count): kit.
- `secondary-filled` E2 rows on secondary buttons: the A4 tint hover is the kit's (threshold note in e2-thresholds).
- Signed-in staff name at 200 % zoom (C74 in the shell): lead.
- Every "Owner to confirm" plan item kept as is: product-order-detail main action per status, "Cấp hàng" primary vs secondary,
  product-return-new filled "Tìm", inventory count button order (implemented as one-filled-at-a-time, pending).
- Screenshots and E2 re-measure: run by the lead (contract).
