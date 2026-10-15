# WIG audit: POS / counter screens

Scope: the pos*, walk-in*, booking-board*, reassignment*, cash*, product-orders, online-order*, product-returns/refunds/exchanges,
inventory-counts, customer-brief and referral-* screens in apps/web/src/components/workforce/screens/, plus their 13 route files
and the copy in apps/web/src/i18n. Rules: .local/s10/wig-command.md, with sentence case in place of Title Case (no Title Case
violations were found). Every finding was checked against the source line. "(+N more: …)" means the same issue appears at the
lines listed. Rendered DataTables and `DescriptionList layout="totals"` get tabular-nums from the kit, so they are not flagged.

| Rule section       | Findings |
| ------------------ | -------- |
| Locale & i18n      | 39       |
| Forms              | 39       |
| Navigation & State | 29       |
| Typography         | 30       |
| Accessibility      | 16       |
| Content & Copy     | 11       |
| Content Handling   | 10       |
| Hydration Safety   | 4        |
| Images             | 2        |
| Focus States       | 1        |
| Anti-patterns      | 1        |
| **Total**          | **182**  |

Sections with no findings: Animation (no transition:all, no animated typing, scanning or totals), Performance (count sheet paged at
20, no layout reads in render), Touch & Interaction (no autoFocus, no gesture-only action), Safe Areas & Layout, Dark Mode & Theming
(no native select styling in scope), Hover & Interactive States (all controls are kit Buttons/Links).

POS keyboard-first check: Escape closes every kit Dialog/FormDialog/ConfirmDialog (pass). Enter picks the highlighted Combobox option,
then a second Enter submits Add product (pass). There is no `/` shortcut and no shortcut to open Add product: no keydown handler in
any pos*.tsx (see pos.tsx:292, pos-products.tsx:224).

## apps/web/src/components/workforce/screens/pos.tsx

apps/web/src/components/workforce/screens/pos.tsx:53 - [Navigation & State] branch/date/status/search filters and both pagers held in useState only; not in URL (no deep link, lost on reload/back)
apps/web/src/components/workforce/screens/pos.tsx:258 - [Navigation & State] row "view" navigates with router.push in a menu onSelect; Cmd/Ctrl+click and middle-click lost → use a Link (row link)
apps/web/src/components/workforce/screens/pos.tsx:292 - [Accessibility] POS keyboard-first: no `/` shortcut to focus the board search (no keydown handler in any pos*.tsx)
apps/web/src/components/workforce/screens/pos.tsx:191 - [Locale & i18n] invoice code (identifier) not wrapped in translate="no" (same pattern for codes in pos-invoice.tsx:403, pos-pre-orders.tsx:338)
apps/web/src/components/workforce/screens/pos.tsx:124 - [Hydration Safety] todayIn(zone) reads the clock during render (low risk: only reached after client fetch)

## apps/web/src/components/workforce/screens/pos-combo-sale.tsx

apps/web/src/components/workforce/screens/pos-combo-sale.tsx:161 - [Forms] phone/email lookup TextInput lacks spellCheck={false} (email mode)

## apps/web/src/components/workforce/screens/pos-combo-use.tsx

✓ pass

## apps/web/src/components/workforce/screens/pos-dialogs.tsx

apps/web/src/components/workforce/screens/pos-dialogs.tsx:214 - [Forms] voucher code TextInput lacks spellCheck={false}
apps/web/src/components/workforce/screens/pos-dialogs.tsx:312 - [Forms] payer phone/email lookup TextInput lacks spellCheck={false} (email mode)
apps/web/src/components/workforce/screens/pos-dialogs.tsx:288 - [Forms] submit disabled on a form value (same payer chosen) instead of staying enabled and explaining inline
apps/web/src/components/workforce/screens/pos-dialogs.tsx:725 - [Locale & i18n] two dictionary sentences joined by template concatenation; translators cannot reorder → one dictionary string per case

## apps/web/src/components/workforce/screens/pos-invoice.tsx

apps/web/src/components/workforce/screens/pos-invoice.tsx:130 - [Accessibility] PayOS PENDING→PAID arrives by a silent 5 s poll; no persistent aria-live region or toast announces it (only a newly mounted Notice at :464, which screen readers often miss)
apps/web/src/components/workforce/screens/pos-invoice.tsx:335 - [Navigation & State] clear combo use on a line runs immediately; no confirm/undo

## apps/web/src/components/workforce/screens/pos-payments.tsx

apps/web/src/components/workforce/screens/pos-payments.tsx:348 - [Navigation & State] PayOS "cancel code" button cancels at once (customer may be mid-transfer); needs ConfirmDialog (handler pos-invoice.tsx:499)
apps/web/src/components/workforce/screens/pos-payments.tsx:381 - [Accessibility] 1 s countdown re-renders inside Notice role=status → screen readers announce every tick; keep the ticking text outside the live region (announce only expiry)
apps/web/src/components/workforce/screens/pos-payments.tsx:383 - [Typography] ticking countdown digits lack tabular-nums (width jitter every second)
apps/web/src/components/workforce/screens/pos-payments.tsx:391 - [Accessibility] QR alt is a hardcoded English literal "PayOS QR"; not localized and does not say what it pays (pos-pre-orders.tsx:184 uses d.qrAlt correctly)
apps/web/src/components/workforce/screens/pos-payments.tsx:388 - [Images] no reserved 240×240 box while the QR data URL is generated → layout shift when it appears
apps/web/src/components/workforce/screens/pos-payments.tsx:195 - [Typography] held PayOS amount (money the cashier compares) rendered in Notice text without tabular-nums
apps/web/src/components/workforce/screens/pos-payments.tsx:284 - [Locale & i18n] sentence built by concatenating reference + late + final fragments
apps/web/src/components/workforce/screens/pos-payments.tsx:40 - [Navigation & State] payments/anomalies/notes pagination in useState only

## apps/web/src/components/workforce/screens/pos-pre-orders.tsx

apps/web/src/components/workforce/screens/pos-pre-orders.tsx:313 - [Navigation & State] revoke ticket link runs immediately (the customer's link dies); no confirm
apps/web/src/components/workforce/screens/pos-pre-orders.tsx:323 - [Navigation & State] "make again" silently invalidates the active link; no confirm
apps/web/src/components/workforce/screens/pos-pre-orders.tsx:370 - [Content Handling] empty state repeats the card title instead of an empty-state message
apps/web/src/components/workforce/screens/pos-pre-orders.tsx:181 - [Images] QR appears async with no reserved space (layout shift)
apps/web/src/components/workforce/screens/pos-pre-orders.tsx:223 - [Hydration Safety] Date.now() during render; expiry never re-evaluated while open (low hydration risk: client-only after fetch)
apps/web/src/components/workforce/screens/pos-pre-orders.tsx:139 - [Hydration Safety] window.location read during render (dialog mounts after click; low risk)

## apps/web/src/components/workforce/screens/pos-products.tsx

apps/web/src/components/workforce/screens/pos-products.tsx:210 - [Navigation & State] "Remove" line (danger) runs immediately; no ConfirmDialog/undo (handler pos-invoice.tsx:538)
apps/web/src/components/workforce/screens/pos-products.tsx:224 - [Accessibility] POS keyboard-first: no shortcut to open "Add product"; must Tab to the card button. In the dialog Enter picks the Combobox option, a second Enter submits (acceptable)
apps/web/src/components/workforce/screens/pos-products.tsx:633 - [Forms] email lookup TextInput lacks spellCheck={false}
apps/web/src/components/workforce/screens/pos-products.tsx:155 - [Content Handling] missing seller renders an empty cell (other cells use "—")

## apps/web/src/components/workforce/screens/pos-sections.tsx

apps/web/src/components/workforce/screens/pos-sections.tsx:65 - [Locale & i18n] hand-rolled decimal separator/percent formatting instead of Intl.NumberFormat style:'percent' (+1 more: line 81)
apps/web/src/components/workforce/screens/pos-sections.tsx:167 - [Typography] discount amounts in Notice text without tabular-nums (+2 more: lines 176, 195)
apps/web/src/components/workforce/screens/pos-sections.tsx:169 - [Locale & i18n] sentence assembled from fragments with hardcoded " · " / " — " (+2 more: lines 178, 197)
apps/web/src/components/workforce/screens/pos-sections.tsx:202 - [Content Handling] null birthday.reason renders '' between separators → "Name · · date"
apps/web/src/components/workforce/screens/pos-sections.tsx:270 - [Navigation & State] remove voucher runs at once; no confirm/undo (handler pos-invoice.tsx:570)
apps/web/src/components/workforce/screens/pos-sections.tsx:339 - [Locale & i18n] hardcoded "label: name" concatenation in a menu item
apps/web/src/components/workforce/screens/pos-sections.tsx:247 - [Locale & i18n] voucher code not translate="no"

## apps/web/src/components/workforce/screens/pos-tip-step.tsx

apps/web/src/components/workforce/screens/pos-tip-step.tsx:45 - [Content Handling] unknown employee gives '' name, so the RadioGroup legend can be empty
apps/web/src/components/workforce/screens/pos-tip-step.tsx:79 - [Locale & i18n] thousands separator hardcoded per locale instead of from Intl

## apps/web/src/components/workforce/screens/walk-in.tsx

apps/web/src/components/workforce/screens/walk-in.tsx:182 - [Accessibility] heading levels skip on the result view: cards use h3 right under the PageHeader h1 (no h2; fragment with no Page/ListSection)
apps/web/src/components/workforce/screens/walk-in.tsx:300 - [Accessibility] guest/child sections titled only by kind ("Khách", "Trẻ em"); with 2+ guests headings and Name/Phone labels are identical, no number; title built by concatenation
apps/web/src/components/workforce/screens/walk-in.tsx:308 - [Accessibility] every remove-person IconButton has the same static aria-label (no name/number) → cannot tell which person it removes (+1 more: remove-service 416)
apps/web/src/components/workforce/screens/walk-in.tsx:309 - [Navigation & State] remove person runs at once, no confirm/undo; drops their services and unlinks children's guardian (+1 more: remove service 417)
apps/web/src/components/workforce/screens/walk-in.tsx:253 - [Navigation & State] changing branch calls reset() and discards every person and service entered, no warning
apps/web/src/components/workforce/screens/walk-in.tsx:129 - [Forms] validation problems (missing name, child without adult) shown as one Notice at the card bottom, not inline on the field; focus not moved
apps/web/src/components/workforce/screens/walk-in.tsx:438 - [Forms] submit disabled until the form has people (validity), not only while the request runs
apps/web/src/components/workforce/screens/walk-in.tsx:379 - [Locale & i18n] duration hand-written as `${n}′` instead of Intl (unit) formatting (+2 more: booking-board-dialogs.tsx:309, booking-board-sections.tsx:448)
apps/web/src/components/workforce/screens/walk-in.tsx:405 - [Locale & i18n] "not checked in" note glued onto staff name by concatenation (+1 more: booking-board-dialogs.tsx:319)

## apps/web/src/components/workforce/screens/walk-in-lookup.tsx

apps/web/src/components/workforce/screens/walk-in-lookup.tsx:96 - [Forms] phone/email lookup TextInput lacks spellCheck={false} (email mode)
apps/web/src/components/workforce/screens/walk-in-lookup.tsx:72 - [Forms] submit disabled when the found member is already in the visit; nothing says why (only the green "found" notice)
apps/web/src/components/workforce/screens/walk-in-lookup.tsx:44 - [Forms] submitting an empty value does nothing; no inline error on the field

## apps/web/src/components/workforce/screens/booking-board.tsx

apps/web/src/components/workforce/screens/booking-board.tsx:272 - [Accessibility] toolbar result line (role=status) holds the clock; the 30 s refresh re-announces the time every minute while real board changes (arrivals, queue) are never announced (kit misuse: slot is for "x–y of n")
apps/web/src/components/workforce/screens/booking-board.tsx:301 - [Accessibility] failed passive refresh inserts a role=alert Notice above all sections (layout shift) and re-announces every 30 s while offline (+1: message Notice at 300 shifts layout too)
apps/web/src/components/workforce/screens/booking-board.tsx:99 - [Focus States] polling never pauses (hidden tab, open row menu, focused Arrive button); when a refresh removes the action or moves the row off-page, focus drops to <body>
apps/web/src/components/workforce/screens/booking-board.tsx:66 - [Navigation & State] search and branch (63) in useState, not URL
apps/web/src/components/workforce/screens/booking-board.tsx:115 - [Content Handling] walk-in options load error swallowed (.catch(() => undefined)); "change staff" menu item silently disappears

## apps/web/src/components/workforce/screens/booking-board-dialogs.tsx

apps/web/src/components/workforce/screens/booking-board-dialogs.tsx:192 - [Content Handling] line with no staff interpolates '' → dialog description reads as a broken sentence
apps/web/src/components/workforce/screens/booking-board-dialogs.tsx:295 - [Forms] IntentDialog submit disabled until something changes (validity, not pending)

## apps/web/src/components/workforce/screens/booking-board-sections.tsx

apps/web/src/components/workforce/screens/booking-board-sections.tsx:66 - [Navigation & State] table paging in useState, not URL; resets on every remount (+2 more: lines 245, 412)
apps/web/src/components/workforce/screens/booking-board-sections.tsx:75 - [Locale & i18n] time ranges concatenated `{a}–{b}` instead of Intl.DateTimeFormat#formatRange (+2 more: line 631, walk-in.tsx:204)
apps/web/src/components/workforce/screens/booking-board-sections.tsx:103 - [Locale & i18n] lists joined with hardcoded ' · ' / '; ' instead of Intl.ListFormat (+1 more: line 454)
apps/web/src/components/workforce/screens/booking-board-sections.tsx:566 - [Content Handling] queue section renders nothing while loading (the 3 DataTables show skeletons) → cards pop in and shift layout

## apps/web/src/components/workforce/screens/reassignment.tsx

apps/web/src/components/workforce/screens/reassignment.tsx:42 - [Navigation & State] branch, from, to, conflictsOnly and paging (41–44, 57) all in useState, not URL
apps/web/src/components/workforce/screens/reassignment.tsx:274 - [Locale & i18n] raw API `from`/`to` date strings shown unformatted (no formatDate/Intl) in the role=status count slot
apps/web/src/components/workforce/screens/reassignment.tsx:169 - [Forms] on a failed reassign load() clears `anchor` (70): dialog closes, chosen replacement and typed reason lost, error shown on the page not in the dialog
apps/web/src/components/workforce/screens/reassignment.tsx:255 - [Content & Copy] after any error every row "inspect" action stays disabled with no reason until a manual reload
apps/web/src/components/workforce/screens/reassignment.tsx:117 - [Forms] changing scope re-runs inspect() and wipes the typed reason and acknowledgement without warning (trigger reassignment-dialog.tsx:90)
apps/web/src/components/workforce/screens/reassignment.tsx:349 - [Navigation & State] kit misuse: CursorPagination "load more" under a DataTable that already pages client-side → two paging controls

## apps/web/src/components/workforce/screens/reassignment-dialog.tsx

apps/web/src/components/workforce/screens/reassignment-dialog.tsx:74 - [Forms] submit disabled until reassignmentBody accepts the input; missing replacement/reason/acknowledgement gets no inline error

## apps/web/src/components/workforce/screens/cash.tsx

apps/web/src/components/workforce/screens/cash.tsx:331 - [Typography] fund balance and opening balance in a plain DescriptionList (no layout="totals") → no tabular-nums; `strong: true` is a no-op outside .ls-dl-totals (kit misuse)
apps/web/src/components/workforce/screens/cash.tsx:185 - [Locale & i18n] ₫ unit and thousands separator hand-picked per locale instead of Intl.NumberFormat (+5 more: cash.tsx:208, cash-book.tsx:400, 506, cash-closing.tsx:313, 333)
apps/web/src/components/workforce/screens/cash.tsx:178 - [Content & Copy] every field error is the generic t.errors.validation ("Dữ liệu chưa hợp lệ…"), not what is wrong or how to fix it (+ cash-book.tsx:346, 452, 571; cash-closing.tsx:249; referral-dialogs.tsx:39, 134)
apps/web/src/components/workforce/screens/cash.tsx:48 - [Locale & i18n] time zone hardcoded 'Asia/Ho_Chi_Minh' instead of the branch zone (same constant: cash-book.tsx:55, cash-closing.tsx:52, cash-reconcile.tsx:25)

## apps/web/src/components/workforce/screens/cash-book.tsx

apps/web/src/components/workforce/screens/cash-book.tsx:112 - [Typography] money-in/out totals of the filter sit in the ListToolbar result line; .ls-toolbar-count has no tabular-nums (kit misuse: role=status slot is for the count)
apps/web/src/components/workforce/screens/cash-book.tsx:265 - [Accessibility] entry time only in a title tooltip on the amount (unreachable by keyboard/touch) (+2 more: cash-closing.tsx:175 difference reason, 207 closed-at time)
apps/web/src/components/workforce/screens/cash-book.tsx:266 - [Locale & i18n] +/− sign added by hand instead of Intl signDisplay
apps/web/src/components/workforce/screens/cash-book.tsx:278 - [Accessibility] row menu named after the category, which repeats across rows → menus indistinguishable
apps/web/src/components/workforce/screens/cash-book.tsx:360 - [Locale & i18n] sentences built by concatenation `${fund.name}. ${description}` (+1 more: line 562)

## apps/web/src/components/workforce/screens/cash-closing.tsx

apps/web/src/components/workforce/screens/cash-closing.tsx:341 - [Accessibility] difference and next-day float recalculate as the cashier types with no aria-live; block appears after the first digit and shifts the layout under the withdrawal field
apps/web/src/components/workforce/screens/cash-closing.tsx:210 - [Content Handling] actions column has a header but every cell is null
apps/web/src/components/workforce/screens/cash-closing.tsx:324 - [Locale & i18n] two sentences glued for the hint (+1 more: line 350 `${label}: ${amount}`)
apps/web/src/components/workforce/screens/cash-closing.tsx:228 - [Hydration Safety] todayIn() during render (low risk: client render after load; same at cash-reconcile.tsx:45)

## apps/web/src/components/workforce/screens/cash-reconcile.tsx

apps/web/src/components/workforce/screens/cash-reconcile.tsx:47 - [Navigation & State] branch/from/to filters (46–48) in useState while the rest of the cash page uses useUrlState
apps/web/src/components/workforce/screens/cash-reconcile.tsx:49 - [Forms] with from > to no request is sent: table blank, no inline error on the dates

## apps/web/src/components/workforce/screens/customer-brief.tsx

apps/web/src/components/workforce/screens/customer-brief.tsx:67 - [Typography] kit misuse: raw unstyled <h3> (browser default size, no text-wrap: balance) instead of a kit section heading (+2 more: lines 120, 133); level itself is correct under the Drawer h2
apps/web/src/components/workforce/screens/customer-brief.tsx:136 - [Accessibility] talking points arrive from a second request; loading line and result swap in as plain <p>/<ul> with no role=status/aria-live
apps/web/src/components/workforce/screens/customer-brief.tsx:103 - [Locale & i18n] lists joined with ', ' instead of Intl.ListFormat (+1 more: line 110)
apps/web/src/components/workforce/screens/customer-brief.tsx:141 - [Locale & i18n] full stop hardcoded after the product name in JSX

## apps/web/src/components/workforce/screens/referral-card.tsx

apps/web/src/components/workforce/screens/referral-card.tsx:134 - [Navigation & State] history paging via useClientPaging (useState), not URL (low impact, short table)
apps/web/src/components/workforce/screens/referral-card.tsx:67 - [Locale & i18n] text built by concatenation `${via} (${name})`

## apps/web/src/components/workforce/screens/referral-dialogs.tsx

apps/web/src/components/workforce/screens/referral-dialogs.tsx:146 - [Navigation & State] ChangeReferrerDialog saves for a typed phone without a lookup step showing who it belongs to (Bind dialog in the same file has one); only the password prompt stands between typing and the change

## apps/web/src/components/workforce/screens/product-orders.tsx

apps/web/src/components/workforce/screens/product-orders.tsx:527 - [Navigation & State] row menu "open" calls navigate() in onSelect; Cmd/Ctrl+click lost (kit Menu items support `href`)
apps/web/src/components/workforce/screens/product-orders.tsx:353 - [Navigation & State] TO_ORDER tab page and sort held in useClientPaging/DataTable state, not URL, while other tabs keep page in URL (+1 more: detail lines table 792)
apps/web/src/components/workforce/screens/product-orders.tsx:931 - [Navigation & State] breadcrumb back to the queue keeps only branch; drops tab, search and page
apps/web/src/components/workforce/screens/product-orders.tsx:711 - [Forms] order-code TextInput (hand over) lacks spellCheck={false}
apps/web/src/components/workforce/screens/product-orders.tsx:1213 - [Forms] bank transfer reference TextInput lacks spellCheck={false} (+1 more: line 1404)
apps/web/src/components/workforce/screens/product-orders.tsx:1176 - [Locale & i18n] MoneyInput has no `separator` → kit default "." also in English (online-order-dialogs.tsx:310 passes the locale separator)
apps/web/src/components/workforce/screens/product-orders.tsx:651 - [Forms] client validation failure does not focus the first invalid field (+3 more: lines 1106, 1289, 1369)
apps/web/src/components/workforce/screens/product-orders.tsx:796 - [Locale & i18n] refund text built by joining translated sentences with ' ', shown at 969 under `${label}: ${title}`
apps/web/src/components/workforce/screens/product-orders.tsx:1247 - [Typography] refund amount in the cancel + refund Notice is formatVnd text without tabular-nums
apps/web/src/components/workforce/screens/product-orders.tsx:675 - [Locale & i18n] display text built by concatenation `${quantity} × ${name}` (+2 more: lines 1137, 1316)
apps/web/src/components/workforce/screens/product-orders.tsx:453 - [Locale & i18n] identifiers without translate="no": order code (+3 more: SKU 596, 996; invoice code 954)

## apps/web/src/components/workforce/screens/online-orders.tsx

apps/web/src/components/workforce/screens/online-orders.tsx:331 - [Navigation & State] row menu "open" calls navigate() in onSelect; Cmd/Ctrl+click lost (kit Menu items support `href`)
apps/web/src/components/workforce/screens/online-orders.tsx:429 - [Navigation & State] detail tables (lines, log, returns) paged in useClientPaging state, not URL (+2 more: lines 430, 431)
apps/web/src/components/workforce/screens/online-orders.tsx:721 - [Navigation & State] breadcrumb back to the queue keeps only branch; drops tab, search and page
apps/web/src/components/workforce/screens/online-orders.tsx:775 - [Typography] order total in DescriptionList columns={2} (not totals layout) → no tabular-nums (+2 more: carrier fee 680; settlement goods/out/back/refund 885–890)
apps/web/src/components/workforce/screens/online-orders.tsx:891 - [Anti-patterns] `strong: true` has no effect outside layout="totals" (CSS only styles .ls-dl-totals .ls-dl-row-strong) → settlement refund not emphasised (kit misuse)
apps/web/src/components/workforce/screens/online-orders.tsx:694 - [Locale & i18n] two translated sentences concatenated with a space; hardcoded punctuation formats at 317, 671, 687
apps/web/src/components/workforce/screens/online-orders.tsx:449 - [Locale & i18n] product-name list joined with hardcoded ', ' → Intl.ListFormat
apps/web/src/components/workforce/screens/online-orders.tsx:238 - [Locale & i18n] identifiers without translate="no": order code (+5 more: tracking code 317, 670; SKU 481; invoice 769; return code 604)
apps/web/src/components/workforce/screens/online-orders.tsx:664 - [Accessibility] external tracking link opens a new tab (target=_blank) with no new-tab cue for screen readers

## apps/web/src/components/workforce/screens/online-order-dialogs.tsx

apps/web/src/components/workforce/screens/online-order-dialogs.tsx:290 - [Forms] tracking-number TextInput lacks spellCheck={false} (+1 more: line 373 correct shipment)
apps/web/src/components/workforce/screens/online-order-dialogs.tsx:877 - [Forms] bank transfer reference TextInput lacks spellCheck={false} (+1 more: line 1039 settle)
apps/web/src/components/workforce/screens/online-order-dialogs.tsx:666 - [Forms] recipient phone has inputMode="tel" but no type="tel" and no autoComplete="tel"/name (autoComplete="off" on a real address-book field; no TextInput in the file has a name)
apps/web/src/components/workforce/screens/online-order-dialogs.tsx:134 - [Forms] client validation failures (bad tracking code, amount, reference, day) never move focus to the first invalid field; kit focusFirstInvalid only runs on server `error`
apps/web/src/components/workforce/screens/online-order-dialogs.tsx:991 - [Locale & i18n] minus sign glued to formatted money by string, not Intl signDisplay (+1 more: line 995)
apps/web/src/components/workforce/screens/online-order-dialogs.tsx:911 - [Typography] refund amount the cashier checks is inside a Notice sentence → no tabular-nums
apps/web/src/components/workforce/screens/online-order-dialogs.tsx:1125 - [Locale & i18n] label built by concatenation with hardcoded punctuation; return code not translate="no" (+2 more: lines 251, 800)

## apps/web/src/components/workforce/screens/product-returns.tsx

apps/web/src/components/workforce/screens/product-returns.tsx:276 - [Navigation & State] row menu "open" navigates via onSelect; Cmd/Ctrl+click lost (the code cell Link covers the row, the menu item does not)
apps/web/src/components/workforce/screens/product-returns.tsx:300 - [Navigation & State] header "add" button navigates in onClick instead of a <Link> (+1 more: Cancel at 732)
apps/web/src/components/workforce/screens/product-returns.tsx:519 - [Forms] long page-level form (lookup, line, reason, quantity, notes) with no beforeunload/router guard; Cancel and breadcrumb drop the draft silently
apps/web/src/components/workforce/screens/product-returns.tsx:550 - [Forms] invoice-code TextInput lacks spellCheck={false}
apps/web/src/components/workforce/screens/product-returns.tsx:556 - [Forms] Enter-to-lookup has no isComposing guard (IME Enter fires a lookup) and find() (440) has no busy/stale-response guard → overlapping lookups, a late answer can overwrite
apps/web/src/components/workforce/screens/product-returns.tsx:575 - [Accessibility] found-invoice summary appears after an async lookup with no role=status/aria-live (only the failure Notice announces)
apps/web/src/components/workforce/screens/product-returns.tsx:478 - [Forms] client validation failure does not focus the first invalid control (page form, no FormDialog)
apps/web/src/components/workforce/screens/product-returns.tsx:687 - [Forms] integer quantity NumberInput keeps kit default inputMode=decimal → add inputMode="numeric"
apps/web/src/components/workforce/screens/product-returns.tsx:741 - [Forms] submit disabled because the form is invalid, not because a request is pending
apps/web/src/components/workforce/screens/product-returns.tsx:597 - [Locale & i18n] hardcoded "name (sku)" concatenation; SKU not translate="no" (+1 more: line 966)
apps/web/src/components/workforce/screens/product-returns.tsx:1378 - [Locale & i18n] hardcoded "file: message" concatenation (+1 more: line 1390)

## apps/web/src/components/workforce/screens/product-refunds.tsx

apps/web/src/components/workforce/screens/product-refunds.tsx:94 - [Typography] paid/refunded money in a DescriptionList without layout="totals" → no tabular-nums for figures the cashier compares (+1 more: line 96)
apps/web/src/components/workforce/screens/product-refunds.tsx:105 - [Typography] refund amount inside a concatenated DL label `${code} · ${money}`, no tabular-nums
apps/web/src/components/workforce/screens/product-refunds.tsx:355 - [Typography] refund amount (the key figure) in a Notice with no tabular-nums
apps/web/src/components/workforce/screens/product-refunds.tsx:356 - [Locale & i18n] two sentences joined by string concatenation
apps/web/src/components/workforce/screens/product-refunds.tsx:162 - [Locale & i18n] hardcoded "label: value · …" punctuation in JSX; bank reference not translate="no" (+4 more: lines 172, 175, 179, 189)
apps/web/src/components/workforce/screens/product-refunds.tsx:168 - [Locale & i18n] list joined with hardcoded ", " → Intl.ListFormat (+1 more: line 188 "; ")
apps/web/src/components/workforce/screens/product-refunds.tsx:237 - [Forms] client validation failure does not focus the first invalid field (+1 more: line 398)
apps/web/src/components/workforce/screens/product-refunds.tsx:263 - [Forms] dirty guard ignores quantity and method changes → closing discards them without asking
apps/web/src/components/workforce/screens/product-refunds.tsx:277 - [Forms] integer quantity NumberInput: default inputMode=decimal, no min/max/step (max only in hint)
apps/web/src/components/workforce/screens/product-refunds.tsx:305 - [Forms] bank transfer reference TextInput lacks spellCheck={false} (+1 more: line 447)
apps/web/src/components/workforce/screens/product-refunds.tsx:433 - [Content Handling] option label ends in a stray " · " when bankReference is null

## apps/web/src/components/workforce/screens/product-exchanges.tsx

apps/web/src/components/workforce/screens/product-exchanges.tsx:105 - [Typography] credit money in a DescriptionList without layout="totals" → no tabular-nums
apps/web/src/components/workforce/screens/product-exchanges.tsx:480 - [Typography] preview figures (credit, gross, payable/refund, block 471–484) are compared by the cashier but the DL has no totals layout → no tabular-nums
apps/web/src/components/workforce/screens/product-exchanges.tsx:477 - [Locale & i18n] hardcoded "(qty × price)" format built by concatenation
apps/web/src/components/workforce/screens/product-exchanges.tsx:193 - [Typography] money in plain <p> without tabular-nums plus hardcoded "label: value ·" punctuation (+3 more: lines 166, 207, 211)
apps/web/src/components/workforce/screens/product-exchanges.tsx:219 - [Locale & i18n] list joined with hardcoded ", " → Intl.ListFormat (+1 more: line 243 "; ")
apps/web/src/components/workforce/screens/product-exchanges.tsx:384 - [Forms] client validation failure does not focus the first invalid field (+2 more: lines 635, 727)
apps/web/src/components/workforce/screens/product-exchanges.tsx:416 - [Forms] dirty guard ignores seller/method/restock changes made without an option or reason
apps/web/src/components/workforce/screens/product-exchanges.tsx:541 - [Forms] bank transfer reference TextInput lacks spellCheck={false} (+1 more: line 776)
apps/web/src/components/workforce/screens/product-exchanges.tsx:762 - [Content Handling] option label ends in a stray " · " when there is no bankReference

## apps/web/src/components/workforce/screens/inventory-counts.tsx

apps/web/src/components/workforce/screens/inventory-counts.tsx:145 - [Navigation & State] row menu "open" navigates via onSelect instead of a link
apps/web/src/components/workforce/screens/inventory-counts.tsx:300 - [Forms] count page tracks dirty (typed counts, removals) but has no beforeunload/router guard; breadcrumb and nav leave silently
apps/web/src/components/workforce/screens/inventory-counts.tsx:336 - [Forms] per-row count NumberInput lacks autoComplete="off" (autofill history on dozens of rows); row label names the SKU only, not the product
apps/web/src/components/workforce/screens/inventory-counts.tsx:341 - [Forms] invalid row sets only aria-invalid: no per-row message/aria-describedby; shared Notice (495) does not say which row/page; first invalid input not focused (may be on another page)
apps/web/src/components/workforce/screens/inventory-counts.tsx:383 - [Navigation & State] remove line drops the row at once with no undo (only a reload restores the draft)
apps/web/src/components/workforce/screens/inventory-counts.tsx:486 - [Forms] Save disabled because values are invalid, not because a request is pending
apps/web/src/components/workforce/screens/inventory-counts.tsx:584 - [Navigation & State] count-lines page in useState only; CountView is keyed by rowVersion (260) so every save remounts it and sends the counter back to page 1

## apps/web/src/lib/workforce/format.ts (shared helper used by every screen in scope; counted once)

apps/web/src/lib/workforce/format.ts:10 - [Locale & i18n] formatVnd hand-rolls grouping per locale instead of Intl.NumberFormat (BigInt-safe with style:'currency', currency:'VND')
apps/web/src/lib/workforce/format.ts:10 - [Typography] amount and "₫" joined by a normal space → can wrap apart in narrow cells/Notices; use U+00A0 (`10&nbsp;MB` rule)
apps/web/src/lib/workforce/format.ts:23 - [Locale & i18n] formatDate hardcodes `dd/mm/yyyy` / `yyyy-mm-dd` instead of Intl.DateTimeFormat

## apps/web/src/i18n/workforce.ts (POS sections only: common, errors, bookingBoard, reassignment, pos, walkIn)

apps/web/src/i18n/workforce.ts:1864 - [Typography] board search placeholder lacks trailing "…" (used as placeholder at booking-board.tsx:283) (+1 more: EN 4682)
apps/web/src/i18n/workforce.ts:2272 - [Typography] POS board search placeholder "Tìm mã hoặc khách" lacks "…" and an example pattern (pos.tsx:296) (+1 more: EN 5099)
apps/web/src/i18n/workforce.ts:1952 - [Typography] straight quotes "…" in copy → curly “…” (+5 more: lines 1973, 1982, 2448; EN 4791, 4800, 5274)
apps/web/src/i18n/workforce.ts:2514 - [Content & Copy] INVOICE_CANCEL_NOT_ALLOWED "Không thể hủy hóa đơn này." gives no reason or next step (+1 more: EN 5340)
apps/web/src/i18n/workforce.ts:2019 - [Content & Copy] WALKIN_NOT_ASSIGNABLE states the problem only, no next step (+1 more: EN 4839)
apps/web/src/i18n/workforce.ts:89 - [Content & Copy] generic `errors.validation` ("Dữ liệu chưa hợp lệ. Vui lòng kiểm tra lại.") is used as the per-field error on cash/referral fields; says neither what is wrong nor how to fix (+1 more: EN 2901; usages listed under cash.tsx:178)
apps/web/src/i18n/workforce.ts:1907 - [Content & Copy] booking-board no-show/advance submit label "Xác nhận" is generic; name the action (e.g. "Đánh dấu không đến") (+1 more: EN 4725 "Confirm")

## apps/web/src/i18n/product-sale.ts

apps/web/src/i18n/product-sale.ts:62 - [Typography] search placeholder "Gõ tên hoặc mã SKU" lacks "…" (product-exchanges.ts:75 has it; inconsistent) (+1 more: EN 180)

## apps/web/src/i18n/product-orders.ts

apps/web/src/i18n/product-orders.ts:150 - [Typography] queue search placeholder lacks "…" (product-orders.tsx:261) (+1 more: EN 463)
apps/web/src/i18n/product-orders.ts:265 - [Typography] "1 ₫" uses a normal space → non-breaking space (+3 more: lines 266, 578, 579)
apps/web/src/i18n/product-orders.ts:278 - [Content & Copy] noCause "Dòng hàng này chưa thể hủy lúc này." no reason or next step (+1 more: EN 592)
apps/web/src/i18n/product-orders.ts:302 - [Content & Copy] ORDER_CANCEL_CAUSE_INVALID says the reason is unusable but not which one to choose (+1 more: EN 618; same string online-fulfilment.ts:397, 828)

## apps/web/src/i18n/online-fulfilment.ts

apps/web/src/i18n/online-fulfilment.ts:15 - [Typography] queue search placeholder lacks "…" (online-orders.tsx:159) (+1 more: EN 451)
apps/web/src/i18n/online-fulfilment.ts:763 - [Content & Copy] settle-failed-delivery submit "Confirm" is vague (VI 330 is "Xác nhận xử lý"); e.g. "Settle and refund"
apps/web/src/i18n/online-fulfilment.ts:87 - [Typography] straight quotes around button names → curly (+3 more: lines 400, 522, 831)
apps/web/src/i18n/online-fulfilment.ts:202 - [Typography] "100.000.000 ₫" / "0 ₫" use a normal space → non-breaking (+6 more: lines 309, 327, 341, 630, 739, 759, 774)

## apps/web/src/i18n/product-returns.ts

apps/web/src/i18n/product-returns.ts:51 - [Typography] list search placeholder lacks "…" (product-returns.tsx:320) (+1 more: EN 272)
apps/web/src/i18n/product-returns.ts:149 - [Typography] "10 MB" with a normal space → `10&nbsp;MB` (+3 more: lines 206, 372, 431)
apps/web/src/i18n/product-returns.ts:208 - [Content & Copy] MEDIA_INVALID_IMAGE "Không đọc được ảnh này." no next step (e.g. choose a JPEG/PNG/WebP file) (+1 more: EN 433)

## apps/web/src/i18n/product-refunds.ts

apps/web/src/i18n/product-refunds.ts:83 - [Typography] straight quotes around "Sửa mã giao dịch" → curly (+1 more: line 104)

## apps/web/src/i18n/product-exchanges.ts

apps/web/src/i18n/product-exchanges.ts:96 - [Typography] straight quotes around button names → curly (+3 more: lines 111, 118, 158)
apps/web/src/i18n/product-exchanges.ts:162 - [Content & Copy] PRODUCT_NOT_SELLABLE "Sản phẩm này hiện không bán được." no reason or next step (+1 more: EN 338)

## apps/web/src/i18n/inventory.ts

apps/web/src/i18n/inventory.ts:193 - [Typography] variant search placeholder "Gõ tên hoặc mã SKU" lacks "…" (inventory-counts.tsx:671) (+1 more: EN 521)

## apps/web/src/i18n/combo.ts

✓ pass

## apps/web/src/i18n/combo-sold.ts

✓ pass

## apps/web/src/app/[locale]/workforce/(app)/pos/page.tsx

✓ pass

## apps/web/src/app/[locale]/workforce/(app)/pos/[id]/page.tsx

✓ pass

## apps/web/src/app/[locale]/workforce/(app)/walk-in/page.tsx

✓ pass

## apps/web/src/app/[locale]/workforce/(app)/booking-board/page.tsx

✓ pass

## apps/web/src/app/[locale]/workforce/(app)/reassignment/page.tsx

✓ pass

## apps/web/src/app/[locale]/workforce/(app)/cash/page.tsx

✓ pass

## apps/web/src/app/[locale]/workforce/(app)/product-orders/page.tsx

✓ pass

## apps/web/src/app/[locale]/workforce/(app)/product-orders/[id]/page.tsx

✓ pass

## apps/web/src/app/[locale]/workforce/(app)/online-orders/page.tsx

✓ pass

## apps/web/src/app/[locale]/workforce/(app)/online-orders/[id]/page.tsx

✓ pass

## apps/web/src/app/[locale]/workforce/(app)/product-returns/page.tsx

✓ pass

## apps/web/src/app/[locale]/workforce/(app)/product-returns/new/page.tsx

✓ pass

## apps/web/src/app/[locale]/workforce/(app)/product-returns/[id]/page.tsx

✓ pass
