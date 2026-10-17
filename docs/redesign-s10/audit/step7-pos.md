# Step 7 final code audit: POS area (session 10, 2026-10-16)

Scope: every file named in the Step 7 task (screens pos*, walk-in*, booking-board*, reassignment*, cash*, product-orders,
online-order(s)*, product-returns/refunds/exchanges, inventory-counts, customer-brief; their routes; lib/workforce
product-sale, product-returns, product-exchanges, pos; the nine dictionaries; `packages/ui/src/s10-pos.css`). Owner answer 5 held: no layout,
structure or workflow change. Skills: web-design-guidelines, react-best-practices (AGENTS rules applied: rerender-lazy-state-init,
js-cache-function-results, js-index-maps, rerender-memo, bundle-dynamic-imports, rerender-derived-state-no-effect), react-view-transitions
(`references/implementation.md` audit step), frontend-design. Loaded at the start.

Rules: fetched fresh with WebFetch from `raw.githubusercontent.com/vercel-labs/web-interface-guidelines/main/command.md` on
**2026-10-16**: 16 sections + anti-patterns (17), same bullets as `.local/s10/wig-command.md`. "Title Case" does not apply (Vietnamese).

How: four parallel workers began the per-group reads and fixes and were cut off by a service limit; the lead then checked every
in-scope file against the rules: grep passes for the mechanical rules over all 46 source files (joins, middle dots, primes, `title=` tooltips,
`target=_blank`, onSelect navigation, `useRef(randomUUID)`, `new Intl` in render, clock reads, closure-spread setState, `&&` renders,
`<img>` size, div/span onClick, IconButton labels, autoFocus, raw tables, placeholders, straight quotes, unit spaces, "khám", hex/px
in s10-pos.css), plus reading of every baseline site and of the code each worker changed. Everything compiles and passes the tests.

## Baseline (wig-pos.md, 182 findings; rbp-staff.md POS entries, 30): status in the current source

Closed, with current evidence (line numbers as of this audit):

- pos.tsx: URL state `useUrlState` :113; row "Xem" router link `LinkComponent={RouterMenuLink}` :542; `/` shortcut `keyShortcut="/"`
  :249 + listener :80 (skips IME); codes `translate="no"`; sale dialogs `next/dynamic` :42-45 (rbp). :124/`todayIn` :215 is not a
  finding: `todayIn` now uses a cached formatter and runs only after the client fetch.
- pos-combo-sale / pos-dialogs / pos-products: `spellCheck={false}` on code, voucher and lookup inputs (pos-dialogs :225, :339;
  pos-products :662); missing seller shows "—" (pos-products :179); payer submit enabled with inline reasons.
- pos-invoice: status in a persistent `role="status"` :553; undo toast for a removed line, a cleared combo use and a removed voucher
  (`offerUndo` :318, :375, :388); `/` opens Add product (:177).
- pos-payments: pages in the URL :52; held amount tabular :216; countdown leaf outside a live region `PayosCountdown` :442; reserved
  QR box `.ls-pos-qr` :402 with `width/height` 240 and a localized alt with the amount :408; cancel behind `PayosCancelConfirm` :425;
  new-tab cue on the payment page link; sentences built whole (:300-311).
- pos-pre-orders: revoke and make-again confirms (`ConfirmDialog` :390); reserved QR :185 (img 240x240); expiry from clock state
  :227; real empty text :385. `window.location` :142 is not a finding (dialog mounts after a click, client only).
- pos-sections: Intl percent `percentText` :75; tabular figures :164-200; codes `translate="no"` :256; whole-sentence notices; payer
  menu item one template :348.
- pos-tip-step: one name map, no empty legend :46-47; grouping and separator from cached Intl (`groupedNumber`, `groupSeparator`) (rbp :35).
- walk-in / walk-in-lookup: result cards h2 (`headingLevel={2}`); numbered person names in headings and remove labels; undo for a
  removed person or service; branch-change confirm (`ConfirmDialog` :595); submit enabled until the request (only `!options`), refusal
  focused (`ls-pos-focus-target`); Intl minutes and time ranges; lookup inline error + `spellCheck`.
- booking-board: URL state :69; poll pauses when hidden or a menu/dialog is open :97; failed staff options said :381; clock out of the
  live region; memoised sections with one clock object :146-151. Sections: pages in the URL (`useUrlPage`), Intl lists (`metaLine`),
  queue skeleton :612, `content-visibility` cards. Dialogs: line without staff says so :196; staff map :292; named submit labels.
  booking-board.tsx:222-226 sequential posts: not a finding (stopping at the first refusal is the behaviour staff see).
- reassignment: URL state :57; dates via `formatDate` :316; refused reassign keeps the dialog; disabled "Đổi" says why :294; cached
  stamp formatter :210. reassignment.tsx:349 CursorPagination: not a finding (server cursor vs client pages of what is loaded). The
  range "a – b" joins two Intl-formatted dates with an en dash: not a finding (Intl `formatRange` prints "1/10/2026" in vi-VN and US
  order in en-CA, unlike every other date in the app; tried and reverted).
- cash / cash-book / cash-closing / cash-reconcile: per-field problems (`cash.problems`), MoneyInput `locale`, branch zone (no
  hard-coded zone), tabular balances `.ls-pos-figure`, row menus named by entry, visible time (no tooltip), `signedMoney`, polite live
  difference block, URL state and backwards-period error on reconcile, lazy request id (rbp), cached `todayIn`.
- product-orders / online-orders / online-order-dialogs: router links in row menus; tab/page/sort and detail pages in the URL;
  `?back=` list view on breadcrumbs; `spellCheck` on code and reference inputs; MoneyInput `locale`; `focusFirstInvalid` on refused
  drafts (CommandDialog :137); `signedMoney` instead of a glued minus; tabular refund figures; codes `translate="no"`; tracking link
  new-tab cue; explicit emphasis instead of `strong` outside totals. Recipient phone `type="tel"` with `autoComplete="off"`: not a
  finding (a customer's number typed by staff; the staff member's own autofill would be wrong).
- product-returns / refunds / exchanges: leave guard `useUnsavedChangesGuard` :442; IME guard :576; stale-lookup guard
  (`lookupRun`); found invoice in `role="status"` :595; `inputMode="numeric"` with min/max; submit enabled until the request; dirty
  guards count every change; tabular money; Intl fact lists and codes kept untranslated inside templates (`product-returns-facts.tsx`).
- inventory-counts: leave guard :332; row inputs name the product, `aria-describedby` to the notice, kit `autoComplete="off"`; undo
  for a removed line; page kept across saves.
- customer-brief: compact headings `.ls-pos-brief-heading`; Intl lists; talking points in `aria-live` :138; drawer title one template.
- Dictionaries in scope: placeholders end in "…" with a pattern; curly quotes; non-breaking space before "₫"/"MB"; error texts with
  the next step. Select prompts ("Chọn lý do") are not text placeholders: not findings.

Outside the Step 7 file list (verified, not edited): i18n/workforce.ts items closed (search hints with "…", WALKIN_NOT_ASSIGNABLE and
INVOICE_CANCEL_NOT_ALLOWED with next steps); i18n/inventory.ts:204 "…" closed; lib/workforce/format.ts Intl + no-break space closed;
referral-*.tsx not re-audited (not in scope).

## New findings in this audit, fixed

- online-order-dialogs.tsx:773, :949 [rbp rerender-lazy-state-init] `useRef(randomUUID())` per render -> `useState(() => ...)`.
- lib/workforce/product-sale.ts:76, :151; lib/workforce/product-exchanges.ts:132 [wig Locale] facts/names joined with ", " -> cached Intl.ListFormat.
- lib/workforce/pos.ts:50 [rbp js-cache-function-results] `boardStamp` Intl per call -> cached formatters, Intl day/month.
- customer-brief.tsx:44 [wig Locale] title glued `${title}: ${service}` -> `brief.titleFor` template.
- product-refunds.tsx, product-exchanges.tsx, product-returns.tsx [wig Locale] codes inside dictionary sentences now `translate="no"`
  via `fillNodes`/`Code` (product-returns-facts.tsx); tests updated to expect the wrapped code (same intent).
- cash-book.tsx:107 [wig Typography] money in/out in the toolbar count without tabular figures -> `.ls-pos-cash-book` (display:
  contents) + `.ls-toolbar-count` tabular in s10-pos.css (kit request [audit-pos] added).
- inventory-counts.tsx:482 [wig Forms] "Duyệt kiểm kê" disabled with no reason while counts are unsaved -> `disabledReason` "Hãy lưu
  số đếm trước khi duyệt." (existing text).
- Dictionaries (cash, product-orders, product-returns, product-refunds, product-exchanges, online-fulfilment) [wig Content & Copy]
  errors gained the next step; field errors say what to enter. Rows appended to `docs/redesign-s10/copy/pos.md` (Step 7 section).

## Final open list

Empty. Not findings, with reason: booking-board-sections.tsx:196/:205 and pos-invoice.tsx:1070 build an accessible name "label: code"
and "price (Giá cố định)": a value with its label, same order in both languages; a template would live in i18n/workforce.ts (outside
scope). Kit items stay with the kit owner (already requested as [pos]: toolbar count tabular, aria-disabled hover, tabs/pager gaps).
Owner questions (not audit findings): product-order-detail main action, "Cấp hàng" primary vs secondary, product-return-new filled
"Tìm", count button order.

## react-best-practices

Baseline POS entries: all closed (memoised sections and cards, URL-keyed boards, derived branch, functional setState, lazy request ids,
cached Intl, dynamic sale dialogs, parallel tip/earnings fetch, prefetch of the tip offer, product options cache, staff map). New: the
online-order-dialogs request ids (fixed). Final open: none.

## View transitions and motion

Staff route = `template.tsx` -> kit `RouteEnter`: `.ls-route-enter[data-enter='route']` opacity-only fade over `--ls-dur-route`
(shell.css:132), 120 ms in compact (tokens.css:1293), 0 under reduced motion (:1318); the first load and non-route compact fades do
not animate (shell.css:137). vt-audit VT1 (360 ms rise) is closed by these lines. In scope: no `ViewTransition`, no `useMotion`/GSAP,
no `transition`/`animation` in s10-pos.css; typing, scanning, tables, totals and the PayOS countdown are not animated (G5).

## Tests and checks

- node:test (sequential): 31 test files covering the touched code + `src/test/ui-ratchet.test.ts`: 307 tests, 307 pass.
- `pnpm --filter @lucy-spa/web exec tsc --noEmit`: 0 errors in scope; 2 errors in teams.tsx (`focusFirstInvalidSoon`, another
  worker's file, not touched).
- eslint on the 50 scope files: clean. prettier --check on them and s10-pos.css: clean (4 files reformatted).
