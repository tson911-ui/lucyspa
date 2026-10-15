# WIG audit: admin screens M-Z + workforce/season-preview routes

Scope: 79 files in apps/web/src/components/workforce/screens/ (m-z, POS files excluded, tests skipped), 95 route files under
apps/web/src/app/[locale]/workforce/** and season-preview/**, and the in-scope i18n copy. Read-only audit, 2026-10-16.
Title Case rule replaced by a sentence-case check (project rule). Kit-internal issues are left to the kit audit (noted at the end).

| Rule section       | Findings |
| ------------------ | -------- |
| Forms              | 77       |
| Navigation & State | 36       |
| Locale & i18n      | 32       |
| Content & Copy     | 17       |
| Typography         | 9        |
| Accessibility      | 8        |
| Content Handling   | 7        |
| Animation          | 1        |
| Performance        | 1        |
| **Total**          | **188**  |

Grep-clean across the whole scope (no findings): `transition: all`, `outline: none`, `onPaste`, `autoFocus`, `<img>` without size,
`<div>/<span>` click handlers, raw `<table>`/`<select>`, `user-scalable`, layout reads in render, `suppressHydrationWarning`.
Every control has a `Field` label or `aria-label`; icon-only actions use `IconButton`; every `FormDialog`/`FormDrawer` that edits passes `dirty`.

## Cross-cutting (shared helpers used by the screens below)

apps/web/src/lib/workforce/format.ts:7 - [Locale & i18n] `formatVnd` groups digits with a regex and a per-locale separator instead of `Intl.NumberFormat` (BigInt is supported); used by most money columns in scope
apps/web/src/lib/workforce/format.ts:19 - [Locale & i18n] `formatDate` builds `dd/mm/yyyy` / `yyyy-mm-dd` by hand, not `Intl.DateTimeFormat` (pay-invoice-cards, pay-commission, reports-pay, reports-cash, ...)
apps/web/src/lib/workforce/discounts.ts:125 - [Locale & i18n] `formatVnInstant` builds `dd/mm/yyyy HH:mm` by hand (website-seasons 199-200, website-slides 60-61, website-popups 96, 160, 161)
apps/web/src/lib/workforce/payroll.ts:26 - [Locale & i18n] `monthLabel` hardcodes `MM/YYYY` for both locales (payroll 64, 177; payroll-run 127; payroll-dialogs 303, 385; payroll-slip 84, 163, 170, 205, 277, 284)
apps/web/src/lib/workforce/reports-b.ts:125 - [Locale & i18n] second `monthLabel` with the same hardcoded `MM/YYYY` (reports-pay 242, 297)
apps/web/src/lib/workforce/use-client-paging.ts:11 - [Navigation & State] `useClientPaging` keeps the page in `useState`, so no list using it has its page in the URL (call sites listed per file)

## apps/web/src/components/workforce/screens/management-levels.tsx

✓ pass

## apps/web/src/components/workforce/screens/media-library.tsx

apps/web/src/components/workforce/screens/media-library.tsx:88 - [Locale & i18n] file-size decimal separator hardcoded per locale (via mediaMeta; 251, 318, 657) → Intl.NumberFormat
apps/web/src/components/workforce/screens/media-library.tsx:287 - [Forms] search placeholder repeats the label, no "…", no example
apps/web/src/components/workforce/screens/media-library.tsx:382 - [Navigation & State] header create actions (382, 394, 402) navigate via Button onClick → ButtonLink (no Cmd/middle-click)
apps/web/src/components/workforce/screens/media-library.tsx:673 - [Forms] TextInputs lack autocomplete/name (673, 683)

## apps/web/src/components/workforce/screens/media-photo-field.tsx

apps/web/src/components/workforce/screens/media-photo-field.tsx:31 - [Accessibility] preview alt is generic "Ảnh đã chọn" / "Chosen photo", not the asset's own description

## apps/web/src/components/workforce/screens/media-picker.tsx

apps/web/src/components/workforce/screens/media-picker.tsx:239 - [Forms] Describe step is a plain Dialog without `<form>` or dirty guard: Enter does not submit, Close drops typed alt text silently
apps/web/src/components/workforce/screens/media-picker.tsx:271 - [Forms] alt-text TextInput lacks autocomplete/name
apps/web/src/components/workforce/screens/media-picker.tsx:138 - [Forms] search placeholder lacks "…"

## apps/web/src/components/workforce/screens/my-account.tsx

apps/web/src/components/workforce/screens/my-account.tsx:324 - [Forms] profile fields lack autocomplete tokens: full name 324 (`name`), birthday 357 (`bday`), address 371 (`street-address`); none of 324/338/357/371/654/681 has `name`
apps/web/src/components/workforce/screens/my-account.tsx:654 - [Forms] new-email input lacks spellCheck={false}
apps/web/src/components/workforce/screens/my-account.tsx:710 - [Content Handling] MySchedule ignores `mine.error`: a failed load shows the loading state forever, no error, no retry
apps/web/src/components/workforce/screens/my-account.tsx:746 - [Locale & i18n] shift time is the raw `${startTime}–${endTime}` string, not Intl time format
apps/web/src/components/workforce/screens/my-account.tsx:132 - [Locale & i18n] login ID (identifier) lacks translate="no"

## apps/web/src/components/workforce/screens/my-income.tsx

apps/web/src/components/workforce/screens/my-income.tsx:35 - [Navigation & State] period + date pickers (35-36) are page useState, not in URL
apps/web/src/components/workforce/screens/my-income.tsx:129 - [Locale & i18n] time column joins raw `startTime–endTime` strings, not Intl time format
apps/web/src/components/workforce/screens/my-income.tsx:249 - [Content Handling] unavailable-sources `<ul>` renders an empty `<li>` for an unknown source key

## apps/web/src/components/workforce/screens/my-services.tsx

apps/web/src/components/workforce/screens/my-services.tsx:46 - [Navigation & State] branch filter is page useState, not in URL

## apps/web/src/components/workforce/screens/notifications.tsx

✓ pass

## apps/web/src/components/workforce/screens/online-sales.tsx

apps/web/src/components/workforce/screens/online-sales.tsx:210 - [Forms] NumberInput, MoneyInput, Textarea lack name; NumberInput/Textarea also autocomplete (210, 343, 359, 384, 400)
apps/web/src/components/workforce/screens/online-sales.tsx:346 - [Locale & i18n] MoneyInput thousands separator hardcoded per locale ('.' / ','), not from Intl (also 362)

## apps/web/src/components/workforce/screens/organization.tsx

apps/web/src/components/workforce/screens/organization.tsx:162 - [Forms] search placeholder repeats the label, no "…"
apps/web/src/components/workforce/screens/organization.tsx:433 - [Locale & i18n] `startedAt.slice(0, 10)` shows a raw UTC ISO date → formatDate/Intl.DateTimeFormat

## apps/web/src/components/workforce/screens/organization-dialogs.tsx

apps/web/src/components/workforce/screens/organization-dialogs.tsx:47 - [Forms] TextInputs lack autocomplete/name (47, 89, 99, 150, 210, 220, 275)
apps/web/src/components/workforce/screens/organization-dialogs.tsx:89 - [Forms] code inputs (89, 210) lack spellCheck={false}
apps/web/src/components/workforce/screens/organization-dialogs.tsx:602 - [Forms] combobox placeholder "Tìm theo tên hoặc mã nhân viên" lacks "…"
apps/web/src/components/workforce/screens/organization-dialogs.tsx:599 - [Content Handling] `employees.error` ignored: a failed search shows "Không tìm thấy nhân sự…" instead of an error

## apps/web/src/components/workforce/screens/pay.tsx

apps/web/src/components/workforce/screens/pay.tsx:43 - [Content & Copy] with no permitted tab the page shows the load error "Không tải được dữ liệu."; real cause is no access, no next step

## apps/web/src/components/workforce/screens/pay-codes.tsx

apps/web/src/components/workforce/screens/pay-codes.tsx:275 - [Forms] reason Textarea lacks autocomplete/name
apps/web/src/components/workforce/screens/pay-codes.tsx:189 - [Forms] search placeholder "Tìm theo tên" lacks "…"

## apps/web/src/components/workforce/screens/pay-command.tsx

✓ pass

## apps/web/src/components/workforce/screens/pay-commission.tsx

apps/web/src/components/workforce/screens/pay-commission.tsx:388 - [Forms] inputs lack name (388, 401, 413, 424); Textarea 424 also lacks autocomplete
apps/web/src/components/workforce/screens/pay-commission.tsx:224 - [Content & Copy] every field error is generic t.errors.validation, no field-specific fix
apps/web/src/components/workforce/screens/pay-commission.tsx:246 - [Content Handling] failed product search swallowed (setFound([])): shows "no product" instead of an error + retry
apps/web/src/components/workforce/screens/pay-commission.tsx:140 - [Navigation & State] page-level rules table pages via useClientPaging, not URL

## apps/web/src/components/workforce/screens/pay-invoice-cards.tsx

apps/web/src/components/workforce/screens/pay-invoice-cards.tsx:196 - [Forms] Textareas lack autocomplete/name (196, 446)
apps/web/src/components/workforce/screens/pay-invoice-cards.tsx:191 - [Content & Copy] inline field error reuses generic t.errors.validation, never says what to fix (also 426, 441)

## apps/web/src/components/workforce/screens/pay-salaries.tsx

apps/web/src/components/workforce/screens/pay-salaries.tsx:224 - [Content & Copy] every invalid field shows generic "Dữ liệu chưa hợp lệ. Vui lòng kiểm tra lại." with no field-specific fix
apps/web/src/components/workforce/screens/pay-salaries.tsx:250 - [Locale & i18n] MoneyInput thousands separator hardcoded ('.' / ','), not from Intl
apps/web/src/components/workforce/screens/pay-salaries.tsx:150 - [Navigation & State] salaries list pages via useClientPaging, not URL
apps/web/src/components/workforce/screens/pay-salaries.tsx:247 - [Forms] MoneyInput 247, DateTextInput 258, Textarea 269 lack name; Textarea also autocomplete

## apps/web/src/components/workforce/screens/pay-tour.tsx

apps/web/src/components/workforce/screens/pay-tour.tsx:150 - [Navigation & State] paging (useClientPaging) not in URL while q/missing are: page lost on reload/Back
apps/web/src/components/workforce/screens/pay-tour.tsx:166 - [Forms] search placeholder "Tìm theo tên" repeats the label, no "…"
apps/web/src/components/workforce/screens/pay-tour.tsx:237 - [Content & Copy] every field error is the generic "Dữ liệu chưa hợp lệ…", never says what to fix
apps/web/src/components/workforce/screens/pay-tour.tsx:261 - [Forms] MoneyInput 261 / Textarea 283 lack name; Textarea also autocomplete
apps/web/src/components/workforce/screens/pay-tour.tsx:264 - [Locale & i18n] MoneyInput thousands separator hardcoded per locale, not from Intl

## apps/web/src/components/workforce/screens/payroll.tsx

apps/web/src/components/workforce/screens/payroll.tsx:55 - [Navigation & State] list pages via useClientPaging, not URL

## apps/web/src/components/workforce/screens/payroll-command.tsx

✓ pass

## apps/web/src/components/workforce/screens/payroll-dialogs.tsx

apps/web/src/components/workforce/screens/payroll-dialogs.tsx:92 - [Forms] controls lack name (92, 187, 199, 264, 511); Textareas 199/264/511 also autocomplete
apps/web/src/components/workforce/screens/payroll-dialogs.tsx:66 - [Forms] failed client check returns without focusing the first invalid field (66, 144, 234, 370, 484)
apps/web/src/components/workforce/screens/payroll-dialogs.tsx:87 - [Content & Copy] field errors are generic t.errors.validation, never say what is wrong (payment-day window, amount format) (87, 139, 259, 404, 506)
apps/web/src/components/workforce/screens/payroll-dialogs.tsx:164 - [Forms] Select placeholder is a bare "…", no meaning (164, 412)
apps/web/src/components/workforce/screens/payroll-dialogs.tsx:293 - [Forms] CloseDialog submit stays enabled while blockers exist and a click does nothing → submitDisabled

## apps/web/src/components/workforce/screens/payroll-run.tsx

apps/web/src/components/workforce/screens/payroll-run.tsx:114 - [Navigation & State] page-level search query is useState, not URL
apps/web/src/components/workforce/screens/payroll-run.tsx:115 - [Navigation & State] list pages via useClientPaging, not URL
apps/web/src/components/workforce/screens/payroll-run.tsx:235 - [Navigation & State] "view slip" row-menu item navigates via navigate() in onSelect, not a link (no Cmd/middle-click)
apps/web/src/components/workforce/screens/payroll-run.tsx:365 - [Forms] search placeholder repeats the label, no "…", no example
apps/web/src/components/workforce/screens/payroll-run.tsx:454 - [Content & Copy] RefreshButton uses try/finally, no catch: failed refresh shows no error (unhandled rejection)
apps/web/src/components/workforce/screens/payroll-run.tsx:156 - [Locale & i18n] employee code lacks translate="no"

## apps/web/src/components/workforce/screens/payroll-slip.tsx

apps/web/src/components/workforce/screens/payroll-slip.tsx:84 - [Locale & i18n] "LUCY SPA" brand in card title lacks translate="no"

## apps/web/src/components/workforce/screens/product-create.tsx

apps/web/src/components/workforce/screens/product-create.tsx:105 - [Forms] long form on its own page without useUnsavedChangesGuard; Cancel (155) leaves without a discard prompt
apps/web/src/components/workforce/screens/product-create.tsx:120 - [Forms] failed submit shows summary Notice (147) but does not focus the first invalid field

## apps/web/src/components/workforce/screens/product-detail.tsx

apps/web/src/components/workforce/screens/product-detail.tsx:90 - [Animation] `scrollIntoView({ behavior: 'smooth' })` ignores prefers-reduced-motion
apps/web/src/components/workforce/screens/product-detail.tsx:167 - [Accessibility] `#product-history` scroll target lacks scroll-margin-top; sticky top bar can cover it

## apps/web/src/components/workforce/screens/product-fields.tsx

apps/web/src/components/workforce/screens/product-fields.tsx:45 - [Forms] TextInputs 45, 56 lack name; Textareas 99, 109 lack autocomplete/name

## apps/web/src/components/workforce/screens/product-history.tsx

apps/web/src/components/workforce/screens/product-history.tsx:60 - [Navigation & State] Prices/Promotions tab (60) and both tables' pages (61) are useState, not URL

## apps/web/src/components/workforce/screens/product-images.tsx

apps/web/src/components/workforce/screens/product-images.tsx:162 - [Accessibility] large preview falls back to alt="" when altVi is missing although the image is the dialog's content → fall back to the tile title

## apps/web/src/components/workforce/screens/product-page-drawer.tsx

apps/web/src/components/workforce/screens/product-page-drawer.tsx:171 - [Forms] 8 inputs lack autocomplete/name (TextInput 171, 180, 213, 222, 235, 244; Textarea 189, 199)

## apps/web/src/components/workforce/screens/product-settings-dialog.tsx

apps/web/src/components/workforce/screens/product-settings-dialog.tsx:144 - [Forms] 4 NumberInputs lack autocomplete/name (144, 156, 176, 195)
apps/web/src/components/workforce/screens/product-settings-dialog.tsx:154 - [Forms] lead-max field never shows its error; lead range error only on lead-min (140), not next to the field at fault

## apps/web/src/components/workforce/screens/product-status.tsx

✓ pass

## apps/web/src/components/workforce/screens/product-text-cleanup.tsx

apps/web/src/components/workforce/screens/product-text-cleanup.tsx:82 - [Navigation & State] page-level list paging is useState, not URL
apps/web/src/components/workforce/screens/product-text-cleanup.tsx:288 - [Content & Copy] detail load error "Không tải được chữ của sản phẩm này." has no retry, no next step

## apps/web/src/components/workforce/screens/product-variants.tsx

apps/web/src/components/workforce/screens/product-variants.tsx:84 - [Navigation & State] variants table pagination is useState on the product page, not URL
apps/web/src/components/workforce/screens/product-variants.tsx:489 - [Locale & i18n] money fields (list price 489, cost 502, new price 633, promo price 714) use NumberInput, not MoneyInput: no locale grouping while typing
apps/web/src/components/workforce/screens/product-variants.tsx:409 - [Forms] 15 inputs lack name (409, 425, 436, 447, 462, 473, 489, 502, 534, 546, 633, 644, 714, 725, 735); all but 409-447 also autocomplete

## apps/web/src/components/workforce/screens/products.tsx

apps/web/src/components/workforce/screens/products.tsx:230 - [Forms] search placeholder repeats the label, no "…", no example
apps/web/src/components/workforce/screens/products.tsx:317 - [Navigation & State] "Add product" navigates via Button onClick → ButtonLink (no Cmd/middle-click)

## apps/web/src/components/workforce/screens/products-taxonomy.tsx

apps/web/src/components/workforce/screens/products-taxonomy.tsx:226 - [Forms] 8 inputs lack name (226, 237, 249, 280, 487, 498, 525, 537); 249, 280, 525, 537 also autocomplete
apps/web/src/components/workforce/screens/products-taxonomy.tsx:190 - [Forms] failed client check returns silently, no focus on first invalid field (also 451)
apps/web/src/components/workforce/screens/products-taxonomy.tsx:80 - [Locale & i18n] productCount / sortOrder printed raw, no Intl (80, 334, 340)
apps/web/src/components/workforce/screens/products-taxonomy.tsx:79 - [Locale & i18n] brand and category codes lack translate="no" (79, 328)

## apps/web/src/components/workforce/screens/reports-cash.tsx

apps/web/src/components/workforce/screens/reports-cash.tsx:103 - [Locale & i18n] signed amount prepends "+" by hand → Intl.NumberFormat signDisplay: 'exceptZero'

## apps/web/src/components/workforce/screens/reports-customers.tsx

✓ pass

## apps/web/src/components/workforce/screens/reports-export.tsx

apps/web/src/components/workforce/screens/reports-export.tsx:88 - [Typography] busy label e.submitting = "Đang tạo file..." / "Preparing the file..." → "…" (i18n/reports.ts:291, 484)

## apps/web/src/components/workforce/screens/reports-kit.tsx

apps/web/src/components/workforce/screens/reports-kit.tsx:226 - [Locale & i18n] print period shows raw ISO dates `${from} → ${to}`
apps/web/src/components/workforce/screens/reports-kit.tsx:344 - [Locale & i18n] truncated-row count uses String(count), no grouping → Intl.NumberFormat
apps/web/src/components/workforce/screens/reports-kit.tsx:317 - [Navigation & State] ReportTable pages in useState: no report table page is in the URL (every reports-* screen)

## apps/web/src/components/workforce/screens/reports-pay.tsx

✓ pass (only the shared monthLabel/formatDate/formatVnd helpers, see Cross-cutting)

## apps/web/src/components/workforce/screens/reports-profit.tsx

apps/web/src/components/workforce/screens/reports-profit.tsx:136 - [Locale & i18n] SKU lacks translate="no"

## apps/web/src/components/workforce/screens/reports-refunds.tsx

apps/web/src/components/workforce/screens/reports-refunds.tsx:197 - [Typography] date column not marked `numeric` → no tabular-nums

## apps/web/src/components/workforce/screens/reports-revenue.tsx

apps/web/src/components/workforce/screens/reports-revenue.tsx:515 - [Locale & i18n] share column built with `toFixed(1)}%` → Intl.NumberFormat style 'percent' (vi needs a decimal comma)
apps/web/src/components/workforce/screens/reports-revenue.tsx:254 - [Locale & i18n] print period shows raw ISO dates (`from → to`); both ternary branches identical
apps/web/src/components/workforce/screens/reports-revenue.tsx:420 - [Locale & i18n] paidInvoices (420) and visits (422) printed raw, no Intl, unlike the other count columns

## apps/web/src/components/workforce/screens/reports-reviews.tsx

apps/web/src/components/workforce/screens/reports-reviews.tsx:123 - [Locale & i18n] employee code lacks translate="no"

## apps/web/src/components/workforce/screens/reports-sales.tsx

apps/web/src/components/workforce/screens/reports-sales.tsx:227 - [Locale & i18n] SKU, order, invoice and staff codes lack translate="no" (227, 498, 504, 549)

## apps/web/src/components/workforce/screens/reports-staff.tsx

✓ pass

## apps/web/src/components/workforce/screens/reports-stock.tsx

apps/web/src/components/workforce/screens/reports-stock.tsx:330 - [Locale & i18n] daysSinceSale printed raw, not formatCount/Intl
apps/web/src/components/workforce/screens/reports-stock.tsx:199 - [Content Handling] missing branch renders '' (blank cell) → "—"
apps/web/src/components/workforce/screens/reports-stock.tsx:203 - [Locale & i18n] SKU (203) and lot code (368) lack translate="no"

## apps/web/src/components/workforce/screens/rich-editor.tsx

apps/web/src/components/workforce/screens/rich-editor.tsx:108 - [Forms] Textarea lacks autocomplete/name

## apps/web/src/components/workforce/screens/roles.tsx

apps/web/src/components/workforce/screens/roles.tsx:223 - [Forms] search placeholder repeats the label, no "…"
apps/web/src/components/workforce/screens/roles.tsx:466 - [Forms] role code input lacks spellCheck={false} and name
apps/web/src/components/workforce/screens/roles.tsx:478 - [Forms] TextInputs lack autocomplete/name (478, 488, 518)

## apps/web/src/components/workforce/screens/season-preview-panel.tsx

✓ pass

## apps/web/src/components/workforce/screens/season-select.tsx

✓ pass

## apps/web/src/components/workforce/screens/service-content-fields.tsx

apps/web/src/components/workforce/screens/service-content-fields.tsx:56 - [Forms] inputs lack autocomplete/name (56, 76, 86)
apps/web/src/components/workforce/screens/service-content-fields.tsx:69 - [Accessibility] FAQ group titles are a styled `<p class="ls-form-section-title">`, not headings

## apps/web/src/components/workforce/screens/service-detail.tsx

apps/web/src/components/workforce/screens/service-detail.tsx:107 - [Navigation & State] Overview/Branches/Skills tab is useState, not URL (not deep-linkable, lost on reload/Back)
apps/web/src/components/workforce/screens/service-detail.tsx:604 - [Navigation & State] "Withdraw from branch" posts immediately from the row menu: no confirmation, no undo
apps/web/src/components/workforce/screens/service-detail.tsx:654 - [Forms] inline eligible-skills form has no unsaved-changes guard; switching tab or leaving drops unsaved ticks
apps/web/src/components/workforce/screens/service-detail.tsx:402 - [Forms] inputs lack autocomplete/name (402, 412, 422, 432, 525)

## apps/web/src/components/workforce/screens/service-durations.tsx

apps/web/src/components/workforce/screens/service-durations.tsx:28 - [Forms] NumberInput lacks autocomplete/name

## apps/web/src/components/workforce/screens/service-price-fields.tsx

apps/web/src/components/workforce/screens/service-price-fields.tsx:40 - [Forms] TextInputs lack autocomplete/name (40, 80)

## apps/web/src/components/workforce/screens/services.tsx

apps/web/src/components/workforce/screens/services.tsx:902 - [Forms] category Select placeholder is a hardcoded bare "—", not a prompt
apps/web/src/components/workforce/screens/services.tsx:676 - [Forms] 10 inputs lack autocomplete/name (TextInput 676, 698, 708, 782, 792, 890, 914, 924; NumberInput 686, 802)

## apps/web/src/components/workforce/screens/shipping-carriers.tsx

apps/web/src/components/workforce/screens/shipping-carriers.tsx:327 - [Forms] TextInputs lack name (327, 347)
apps/web/src/components/workforce/screens/shipping-carriers.tsx:347 - [Forms] tracking-URL template field: no type="url", no spellCheck={false}
apps/web/src/components/workforce/screens/shipping-carriers.tsx:114 - [Navigation & State] page-level carriers table pages via useClientPaging, not URL

## apps/web/src/components/workforce/screens/skills.tsx

apps/web/src/components/workforce/screens/skills.tsx:274 - [Forms] TextInputs lack autocomplete/name (274, 284, 294, 353, 363)
apps/web/src/components/workforce/screens/skills.tsx:274 - [Forms] code field lacks spellCheck={false} / autoCapitalize="none"
apps/web/src/components/workforce/screens/skills.tsx:170 - [Forms] search placeholder repeats the label, no "…", no example

## apps/web/src/components/workforce/screens/supplier-import-all.tsx

apps/web/src/components/workforce/screens/supplier-import-all.tsx:85 - [Navigation & State] search, category/brand filters and page are useState, not URL (85-88)
apps/web/src/components/workforce/screens/supplier-import-all.tsx:366 - [Forms] search placeholder repeats the label, no "…"
apps/web/src/components/workforce/screens/supplier-import-all.tsx:284 - [Navigation & State] bulk import + publish (skips every unticked product) runs without confirmation; with 0 ticked the button stays enabled
apps/web/src/components/workforce/screens/supplier-import-all.tsx:290 - [Content & Copy] primary button label is a status ("Chưa chọn sản phẩm nào"), not an action
apps/web/src/components/workforce/screens/supplier-import-all.tsx:288 - [Accessibility] {done}/{total} progress only in the button label; no aria-live region announces it
apps/web/src/components/workforce/screens/supplier-import-all.tsx:470 - [Performance] blocked-products DataTable has paging off: unbounded rows, no virtualization
apps/web/src/components/workforce/screens/supplier-import-all.tsx:67 - [Accessibility] error state renders without PageHeader: page has no h1
apps/web/src/components/workforce/screens/supplier-import-all.tsx:221 - [Locale & i18n] SKU lacks translate="no" (221, 455)

## apps/web/src/components/workforce/screens/supplier-import-changes.tsx

✓ pass

## apps/web/src/components/workforce/screens/supplier-import-review.tsx

apps/web/src/components/workforce/screens/supplier-import-review.tsx:263 - [Forms] edit form in a plain Drawer with no unsaved guard: Close/Esc discards the draft (`dirty` computed at 140, never used)
apps/web/src/components/workforce/screens/supplier-import-review.tsx:175 - [Forms] save()/approve() (175, 182) return quietly on invalid input; focus does not move to the first error
apps/web/src/components/workforce/screens/supplier-import-review.tsx:447 - [Forms] inputs lack autocomplete/name (447, 462, 478); 493, 580 lack name
apps/web/src/components/workforce/screens/supplier-import-review.tsx:493 - [Forms] SKU input lacks spellCheck={false}

## apps/web/src/components/workforce/screens/supplier-imports.tsx

apps/web/src/components/workforce/screens/supplier-imports.tsx:115 - [Navigation & State] href `?review=${id}` replaces the whole query: Cmd/middle-click opens without tab, filter, page
apps/web/src/components/workforce/screens/supplier-imports.tsx:130 - [Locale & i18n] SKU lacks translate="no"

## apps/web/src/components/workforce/screens/supplier-source-scan.tsx

apps/web/src/components/workforce/screens/supplier-source-scan.tsx:116 - [Locale & i18n] counts printed with String(), no Intl grouping; full scans reach thousands (116, 122, 194-203)
apps/web/src/components/workforce/screens/supplier-source-scan.tsx:210 - [Content & Copy] unknown scan error code shown raw (`known[code] ?? code`), no explanation, no next step

## apps/web/src/components/workforce/screens/supplier-source-test.tsx

✓ pass

## apps/web/src/components/workforce/screens/supplier-sources.tsx

apps/web/src/components/workforce/screens/supplier-sources.tsx:543 - [Forms] source URL fields (543, 640) are type="text" + inputMode="url" → type="url", spellCheck={false}
apps/web/src/components/workforce/screens/supplier-sources.tsx:149 - [Navigation & State] main list pages via useClientPaging, not URL
apps/web/src/components/workforce/screens/supplier-sources.tsx:482 - [Forms] 9 inputs lack name (482, 506, 543, 617, 640, 745, 762, 782, 792); Textarea 792 also autocomplete

## apps/web/src/components/workforce/screens/teams.tsx

apps/web/src/components/workforce/screens/teams.tsx:669 - [Navigation & State] team-detail Members/Add tab is page useState, not URL
apps/web/src/components/workforce/screens/teams.tsx:711 - [Navigation & State] team member filters (q/status/classification/membership) and page/pageSize (714-715) are page useState, not URL
apps/web/src/components/workforce/screens/teams.tsx:272 - [Forms] 7 inputs lack autocomplete/name (TextInput 272, 282, 292, 481, 491, 587; Textarea 1085)

## apps/web/src/components/workforce/screens/use-inventory-command.ts

✓ pass

## apps/web/src/components/workforce/screens/use-product-command.ts

✓ pass

## apps/web/src/components/workforce/screens/website-footer-blocks.tsx

apps/web/src/components/workforce/screens/website-footer-blocks.tsx:308 - [Forms] URL fields are text inputs with only inputMode="url": no type="url", no spellCheck={false} (308, 328, 340, 441, 498)
apps/web/src/components/workforce/screens/website-footer-blocks.tsx:312 - [Forms] placeholder "https://" is not an example pattern and lacks "…" (312, 332, 344)
apps/web/src/components/workforce/screens/website-footer-blocks.tsx:394 - [Forms] no input has a name (308-498); 363, 373, 394, 403, 417, 426 also lack autocomplete
apps/web/src/components/workforce/screens/website-footer-blocks.tsx:150 - [Navigation & State] "Xóa khối" removes the block at once, no confirmation/undo (only way back is the page-wide revert, which loses other edits)
apps/web/src/components/workforce/screens/website-footer-blocks.tsx:238 - [Forms] errors not inline: one generic summary lists every rule, no field gets aria-invalid, nothing to focus

## apps/web/src/components/workforce/screens/website-page-form.tsx

apps/web/src/components/workforce/screens/website-page-form.tsx:222 - [Forms] inputs lack name (222, 231, 248, 311, 324, 337, 351); all but 248 also autocomplete
apps/web/src/components/workforce/screens/website-page-form.tsx:374 - [Forms] Cancel and breadcrumb navigate in-app and drop dirty edits without asking; useUnsavedChangesGuard covers beforeunload only
apps/web/src/components/workforce/screens/website-page-form.tsx:367 - [Accessibility] publish hint not tied to the Switch via aria-describedby

## apps/web/src/components/workforce/screens/website-pages.tsx

apps/web/src/components/workforce/screens/website-pages.tsx:29 - [Navigation & State] list page number is useState, not URL
apps/web/src/components/workforce/screens/website-pages.tsx:135 - [Navigation & State] Unpublish takes a live page off the website straight from the row menu: no confirmation, no undo
apps/web/src/components/workforce/screens/website-pages.tsx:124 - [Navigation & State] "View on website" uses window.open from a menu item, not a link (no Cmd/Ctrl/middle-click)

## apps/web/src/components/workforce/screens/website-popup-form.tsx

apps/web/src/components/workforce/screens/website-popup-form.tsx:291 - [Forms] 9 inputs lack name (291, 300, 313, 327, 364, 373, 382, 422, 438); all but 382 also autocomplete
apps/web/src/components/workforce/screens/website-popup-form.tsx:382 - [Forms] CTA URL field: text input with only inputMode="url", no type="url", no spellCheck={false}
apps/web/src/components/workforce/screens/website-popup-form.tsx:185 - [Forms] useUnsavedChangesGuard covers beforeunload only: Cancel (473) and breadcrumb (106) leave a dirty form without warning
apps/web/src/components/workforce/screens/website-popup-form.tsx:473 - [Navigation & State] Cancel is a Button calling navigate(), not a link

## apps/web/src/components/workforce/screens/website-popups.tsx

apps/web/src/components/workforce/screens/website-popups.tsx:41 - [Navigation & State] table page is useState, not URL
apps/web/src/components/workforce/screens/website-popups.tsx:197 - [Content & Copy] delete confirmation busy label is t.common.saving "Đang lưu…" → "Đang xóa…"

## apps/web/src/components/workforce/screens/website-season-form.tsx

apps/web/src/components/workforce/screens/website-season-form.tsx:341 - [Forms] TextInputs lack autocomplete/name (341, 416, 430)
apps/web/src/components/workforce/screens/website-season-form.tsx:418 - [Forms] greeting placeholders (418, 432) are full sample sentences without "…"
apps/web/src/components/workforce/screens/website-season-form.tsx:547 - [Navigation & State] Cancel (547) and "Create popup for this season" (613) navigate via onClick → ButtonLink
apps/web/src/components/workforce/screens/website-season-form.tsx:601 - [Content Handling] popup/slide load errors ignored: a failed fetch shows "none" as if empty (601-602, 629, 652)

## apps/web/src/components/workforce/screens/website-seasons.tsx

apps/web/src/components/workforce/screens/website-seasons.tsx:51 - [Navigation & State] page, status, year filters (51-53) are page useState, not URL

## apps/web/src/components/workforce/screens/website-shop-info.tsx

apps/web/src/components/workforce/screens/website-shop-info.tsx:175 - [Forms] inputs lack name (175, 189, 202, 212, 255, 271, 283, 298, 313); 175, 189, 202, 212 also autocomplete
apps/web/src/components/workforce/screens/website-shop-info.tsx:283 - [Forms] map + Facebook URL fields: inputMode="url" but no type="url", no spellCheck={false} (also 298)
apps/web/src/components/workforce/screens/website-shop-info.tsx:362 - [Navigation & State] "Edit hours" navigates via Button onClick → ButtonLink
apps/web/src/components/workforce/screens/website-shop-info.tsx:421 - [Typography] busy label text.saving "Đang lưu" / "Saving" lacks "…" (workforce.ts:898, 3710)

## apps/web/src/components/workforce/screens/website-shop-lists.tsx

apps/web/src/components/workforce/screens/website-shop-lists.tsx:138 - [Navigation & State] Delete fact (138), Remove group (226), Delete why-card (623) run at once from the row menu, no confirmation; only way back is reverting the whole page form
apps/web/src/components/workforce/screens/website-shop-lists.tsx:364 - [Forms] dialog validation shows only a summary error (364, 467-473, 679); no inline field error/aria-invalid, first invalid field not focused
apps/web/src/components/workforce/screens/website-shop-lists.tsx:471 - [Content & Copy] "no group chosen" error reuses the placeholder "Chọn nhóm" / "Choose a group" as the message
apps/web/src/components/workforce/screens/website-shop-lists.tsx:363 - [Forms] FactDialog `dirty` ignores an icon-only change, so it is discarded without the guard
apps/web/src/components/workforce/screens/website-shop-lists.tsx:406 - [Forms] 10 inputs lack autocomplete/name (TextInput 406, 418, 573, 582, 715, 727; Textarea 514, 527, 744, 757)

## apps/web/src/components/workforce/screens/website-slide-drawer.tsx

apps/web/src/components/workforce/screens/website-slide-drawer.tsx:212 - [Forms] 11 TextInputs lack name (212-335); all but 270 also autocomplete
apps/web/src/components/workforce/screens/website-slide-drawer.tsx:270 - [Forms] link URL: inputMode="url" but no type="url", no spellCheck={false}
apps/web/src/components/workforce/screens/website-slide-drawer.tsx:166 - [Content Handling] long filename in ls-hint `<p>` has no truncate/break-words; space-less names overflow the drawer
apps/web/src/components/workforce/screens/website-slide-drawer.tsx:352 - [Accessibility] "enabled" hint not tied to the Switch via aria-describedby

## apps/web/src/components/workforce/screens/website-slides.tsx

apps/web/src/components/workforce/screens/website-slides.tsx:47 - [Navigation & State] pagination is page useState, not URL

## apps/web/src/app/[locale]/workforce/** and apps/web/src/app/[locale]/season-preview/page.tsx

✓ pass (90 page.tsx are thin screen wrappers; layout sets noindex metadata; (app)/loading.tsx uses common.loading "Đang tải…";
skip link and `main#main-content` come from the shell; season-preview is noindex and 404s without permission)

## apps/web/src/i18n (copy for the screens above)

apps/web/src/i18n/reports.ts:291 - [Typography] "Đang tạo file..." → "…" (loading label; EN 484 "Preparing the file...")
apps/web/src/i18n/workforce.ts:692 - [Typography] "https://zalo.me/...." → "https://zalo.me/…" (also 910, 3501, 3722)
apps/web/src/i18n/workforce.ts:611 - [Typography] upload status "Đang tải lên" lacks "…" (EN 3419 "Uploading"; media-picker copy at 1310/4128 already has it)
apps/web/src/i18n/workforce.ts:259 - [Typography] "Đang tải tiện ích" lacks "…" (EN 3071 "Loading widget")
apps/web/src/i18n/workforce.ts:1129 - [Typography] straight quotes "Chính sách" → “Chính sách” (also 2448, 3945, 5274; products.ts 226, 227, 578; reports.ts 288, 481; supplier-imports.ts 73, 217, 262, 371, 563; supplier-sources.ts 171, 226, 268, 619; product-text-cleanup.ts 30)
apps/web/src/i18n/workforce.ts:98 - [Typography] "10 MB" / "6000 px" use a normal space → `10&nbsp;MB` (also 99, 590, 594, 695, 1251, 1373, 1380, 2910, 2911, 3398, 3402)
apps/web/src/i18n/workforce.ts:488 - [Forms] search placeholders do not end with "…" (also 42, 584, 596, 1306, 1465, 1864, 2152, 2221, 2351, 2545, 2603; EN 2856, 3300, 3392, 3404, 4124, 4282, 4682, 4979, 5048, 5178, 5371, 5429; pay.ts 51, 136, 294, 381; payroll.ts 157, 416; products.ts 25, 376; supplier-imports.ts 265, 566; organization.ts 37, 81, 84, 88, 96-99, 168, 212)
apps/web/src/i18n/workforce.ts:3003 - [Content & Copy] Title Case "My Account" / "My Income" → "My account" / "My income" (also 3004, 4447, 4585)
apps/web/src/i18n/workforce.ts:1650 - [Content & Copy] "Chủ Spa" / "Spa Owner" not sentence case → "Chủ spa" / "Spa owner" (also 2657, 4468, 5481)
apps/web/src/i18n/organization.ts:159 - [Content & Copy] Title Case "Team Leader", "No Team Leader", "Save Team Leader", "Remove Team Leader" → sentence case (also 160, 197, 198, 258)
apps/web/src/i18n/reports.ts:310 - [Content & Copy] count spelled out "hai file" → "2 file" (EN 504 "Two other files")
apps/web/src/i18n/products.ts:444 - [Content & Copy] "two levels at most" → "2 levels" (also 701; workforce.ts 4954, 5067 "two decimals")

## Kit-side (for the packages/ui audit, not counted above)

- `TextInput`, `NumberInput`, `Textarea` set no default `autoComplete`/`name`; `MoneyInput` and `DateTextInput` set `autoComplete="off"` but no `name`. A kit default would clear most [Forms] autocomplete lines above.
- `NumberInput` hardcodes `inputMode="decimal"`, wrong for whole-number fields (service-durations minutes, stock quantities).
- `useUnsavedChangesGuard` covers `beforeunload` only; in-app navigation (Cancel, breadcrumbs, sidebar) is unguarded on every page form.
- `SearchInput` placeholder doubles as the visible label on list toolbars (placeholder rule conflicts with FR "no labels above toolbar controls").
