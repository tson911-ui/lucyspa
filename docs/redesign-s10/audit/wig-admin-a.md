# Web Interface Guidelines audit: admin screens A-L + shell + dashboard

Scope: `apps/web/src/components/workforce/screens/[a-l]*.tsx` (POS files booking-board*, cash*, customer-brief and inventory-counts excluded),
`apps/web/src/components/workforce/dashboard/**`, `apps/web/src/components/workforce/*.tsx`, and the copy they use in `apps/web/src/i18n/`.
Project exception applied: Title Case rule inverted (flag copy that is NOT sentence case). Read-only audit; kit internals not audited.

## Summary

| Rule section               |                                 Count |
| -------------------------- | ------------------------------------: |
| Accessibility              |                                     3 |
| Focus States               |                                     0 |
| Forms                      |                                    85 |
| Animation                  |                                     1 |
| Typography                 |                                     5 |
| Content Handling           |                                     1 |
| Images                     |                                     0 |
| Performance                |                                     1 |
| Navigation & State         |                                    42 |
| Touch & Interaction        |                                     0 |
| Safe Areas & Layout        |                                     0 |
| Dark Mode & Theming        |                                     0 |
| Locale & i18n              |                                    33 |
| Hydration Safety           |                                     0 |
| Hover & Interactive States |                                     0 |
| Content & Copy             |                                    27 |
| Anti-patterns              | 0 (covered under their rule sections) |
| **Total**                  |                               **198** |

Of the 85 Forms findings, 34 are the per-file "inputs lack `name` / `autoComplete`" lines (one line per file); 14 are search/example placeholders without "…".

Systemic notes (each is also listed per file below):

- No input in scope (except the login form) has a `name`; non-auth inputs mostly lack `autoComplete="off"` (kit `TextInput`/`NumberInput`/`Textarea` add neither).
- Money and dates go through hand-rolled helpers, not `Intl`: `formatVnd` (lib/workforce/format.ts:7, regex grouping + "₫"), `signedVnd` (lib/workforce/cash.ts:69), `formatDate` (format.ts:19, builds `dd/mm/yyyy` / `yyyy-mm-dd` by string), `MoneyInput separator={locale === 'vi' ? '.' : ','}`. `formatTime`/`formatDateTime`/`formatPoints`/`formatDay` already use `Intl` and are fine.
- Search placeholders repeat the field label and never end with "…".
- Row-menu "open/details" items navigate with `onSelect: () => navigate(...)` instead of `href`, and several primary "create/new" buttons navigate with `onClick`; neither supports Cmd/Ctrl/middle-click. `RowActions` already accepts `href` (ai-drafts.tsx:291) and the kit has `ButtonLink`.
- Many dialogs disable submit until required fields are filled (`submitDisabled`) instead of keeping it enabled and showing inline errors.
- Checked and clean via grep across all 79 files: no `transition: all`, no `outline: none`, no `onPaste`, no `autoFocus`, no `<img>`, no `div`/`span` click handlers, no `"..."`, no layout reads in render, no `suppressHydrationWarning`; every `IconButton` has a `label`; every list has an empty state; destructive commands (cancel, revoke, end, delete, terminate, write-off, deactivate) go through `ConfirmDialog` or a reason dialog (except the ones flagged); every `FormDialog`/`FormDrawer` with typed input passes `dirty` (except the ones flagged).

## apps/web/src/components/workforce/auth-actions.tsx

✓ pass

## apps/web/src/components/workforce/language-switch.tsx

apps/web/src/components/workforce/language-switch.tsx:16 - [Locale & i18n] language names "Tiếng Việt" / "English" lack `translate="no"` (browser translation renames the switch)

## apps/web/src/components/workforce/link.tsx

✓ pass

## apps/web/src/components/workforce/reauth-dialog.tsx

apps/web/src/components/workforce/reauth-dialog.tsx:81 - [Forms] submit disabled until a password is typed; keep it enabled and show an inline "required" error
apps/web/src/components/workforce/reauth-dialog.tsx:88 - [Forms] password input lacks `name`

## apps/web/src/components/workforce/recovery-email.tsx

apps/web/src/components/workforce/recovery-email.tsx:72 - [Forms] `verify` silently returns when the code fails `OTP_PATTERN`: no inline error, no focus
apps/web/src/components/workforce/recovery-email.tsx:135 - [Forms] code input lacks `name`

## apps/web/src/components/workforce/session.tsx

✓ pass

## apps/web/src/components/workforce/shell.tsx

apps/web/src/components/workforce/shell.tsx:36 - [Content & Copy] owner subtitle is `t.employees.titles.OWNER` = 'Chủ Spa' (i18n/workforce.ts:2657), not sentence case; the same role is 'Chủ spa' at i18n/workforce.ts:143
apps/web/src/components/workforce/shell.tsx:75 - [Content & Copy] user-menu entries 'My Account' / 'My Income' (i18n/workforce.ts:3003-3004) are Title Case; sibling 'My payslips' is sentence case

## apps/web/src/components/workforce/ui.tsx

✓ pass

## apps/web/src/components/workforce/dashboard/booking-widgets.tsx

✓ pass

## apps/web/src/components/workforce/dashboard/data.tsx

✓ pass

## apps/web/src/components/workforce/dashboard/invoice-widgets.tsx

✓ pass

## apps/web/src/components/workforce/dashboard/money-widgets.tsx

apps/web/src/components/workforce/dashboard/money-widgets.tsx:98 - [Locale & i18n] `formatVnd` hand-rolls grouping + "₫" instead of `Intl.NumberFormat`

## apps/web/src/components/workforce/dashboard/personal-widgets.tsx

✓ pass

## apps/web/src/components/workforce/dashboard/registry.ts

✓ pass

## apps/web/src/components/workforce/dashboard/report-widgets.tsx

apps/web/src/components/workforce/dashboard/report-widgets.tsx:122 - [Locale & i18n] `formatVnd` instead of `Intl.NumberFormat`

## apps/web/src/components/workforce/dashboard/revenue-widget.tsx

apps/web/src/components/workforce/dashboard/revenue-widget.tsx:30 - [Navigation & State] compare mode (`none`/`previous`) kept in `useState`; not restored on reload/back
apps/web/src/components/workforce/dashboard/revenue-widget.tsx:71 - [Locale & i18n] `formatVnd` instead of `Intl.NumberFormat`

## apps/web/src/components/workforce/dashboard/widget-frame.tsx

apps/web/src/components/workforce/dashboard/widget-frame.tsx:35 - [Typography] loading label `t.dashboard.widgetLoading` = 'Đang tải tiện ích' / 'Loading widget' (i18n/workforce.ts:259, :3071) lacks "…"

## apps/web/src/components/workforce/dashboard/widget-host.tsx

✓ pass

## apps/web/src/components/workforce/screens/add-service.tsx

apps/web/src/components/workforce/screens/add-service.tsx:154 - [Forms] submit disabled until participant and service are chosen; keep enabled, show inline required errors

## apps/web/src/components/workforce/screens/advances.tsx

apps/web/src/components/workforce/screens/advances.tsx:100 - [Navigation & State] status filter (and the client pager, :101) in `useState`; lost on reload/back, not shareable
apps/web/src/components/workforce/screens/advances.tsx:162 - [Locale & i18n] `requestedAt.slice(0, 10)` takes the UTC day of an instant; requests made 00:00-07:00 Vietnam time show the previous day. Format the instant in the branch zone
apps/web/src/components/workforce/screens/advances.tsx:143 - [Locale & i18n] `signedVnd` hand-rolls grouping (also :155, :273, :290, :363, :497, :523)
apps/web/src/components/workforce/screens/advances.tsx:331 - [Content & Copy] field errors use the generic `t.errors.validation` ("Dữ liệu chưa hợp lệ. Vui lòng kiểm tra lại.") at :331, :446, :510; say what is wrong (e.g. amount above the employee's limit)
apps/web/src/components/workforce/screens/advances.tsx:372 - [Forms] money amount is a plain `TextInput` (no grouping, no unit); use kit `MoneyInput`
apps/web/src/components/workforce/screens/advances.tsx:372 - [Forms] inputs lack `name` (:372, :384, :451); textareas :384, :451 also lack `autoComplete="off"`

## apps/web/src/components/workforce/screens/ai-draft-detail.tsx

apps/web/src/components/workforce/screens/ai-draft-detail.tsx:208 - [Navigation & State] language tab (vi/en) in `useState`, not in the URL
apps/web/src/components/workforce/screens/ai-draft-detail.tsx:373 - [Forms] server field error (`problem`) shown as a page-level Notice, not inline at the failing field; no focus
apps/web/src/components/workforce/screens/ai-draft-detail.tsx:414 - [Accessibility] current (reference) text rendered as `readOnly` `<textarea>`s (:414, :419, :565): announced as edit fields and adds tab stops; render as text
apps/web/src/components/workforce/screens/ai-draft-detail.tsx:584 - [Forms] textareas lack `name` / `autoComplete="off"` (:584, :729)
apps/web/src/components/workforce/screens/ai-draft-detail.tsx:647 - [Content & Copy] apply / reject / rewrite busy labels reuse generic `t.common.saving` (also :719); name the action ("Đang áp dụng…")

## apps/web/src/components/workforce/screens/ai-drafts.tsx

apps/web/src/components/workforce/screens/ai-drafts.tsx:273 - [Locale & i18n] `formatVnd` instead of `Intl.NumberFormat`
apps/web/src/components/workforce/screens/ai-drafts.tsx:339 - [Content & Copy] `resultCount` is the bare `String(data.total)` (no unit, no Intl); other lists use `resultsText`

## apps/web/src/components/workforce/screens/ai-runs.tsx

apps/web/src/components/workforce/screens/ai-runs.tsx:96 - [Locale & i18n] `formatVnd` (also :250)
apps/web/src/components/workforce/screens/ai-runs.tsx:110 - [Forms] one shared `pending` shows a spinner on unlock, pause and resume (:92, :110, :119) at once; only the clicked button should show progress
apps/web/src/components/workforce/screens/ai-runs.tsx:303 - [Forms] `NumberInput` lacks `name` / `autoComplete="off"`

## apps/web/src/components/workforce/screens/ai-seo.tsx

apps/web/src/components/workforce/screens/ai-seo.tsx:114 - [Navigation & State] open draft drawer id in `useState`; drawer not deep-linkable, lost on reload
apps/web/src/components/workforce/screens/ai-seo.tsx:171 - [Locale & i18n] `formatVnd` (also :292)
apps/web/src/components/workforce/screens/ai-seo.tsx:199 - [Content & Copy] bare-number `resultCount`
apps/web/src/components/workforce/screens/ai-seo.tsx:440 - [Forms] textareas lack `name` / `autoComplete="off"` (:440, :644)
apps/web/src/components/workforce/screens/ai-seo.tsx:455 - [Forms] editable draft form lives in a plain `Drawer` (not `FormDrawer`): no dirty guard, closing (Esc, overlay, Close :463) discards edits silently
apps/web/src/components/workforce/screens/ai-seo.tsx:541 - [Content & Copy] `d.loadFailed` ('Không tải được bản nháp này.') with no retry control or next step
apps/web/src/components/workforce/screens/ai-seo.tsx:625 - [Forms] rewrite `FormDialog` has no `dirty`; the typed instruction is dropped on close without asking

## apps/web/src/components/workforce/screens/ai-settings.tsx

apps/web/src/components/workforce/screens/ai-settings.tsx:333 - [Forms] inputs lack `name` (:333, :357, :370, :394, :462, :525); number inputs and the textarea also lack `autoComplete="off"`
apps/web/src/components/workforce/screens/ai-settings.tsx:373 - [Locale & i18n] `MoneyInput` separator hardcoded per locale (also :397) instead of `Intl.NumberFormat`

## apps/web/src/components/workforce/screens/assistant-box.tsx

apps/web/src/components/workforce/screens/assistant-box.tsx:80 - [Content & Copy] `text.loadFailed` ('Không kiểm tra được trợ lý.') with no retry or next step
apps/web/src/components/workforce/screens/assistant-box.tsx:92 - [Forms] question textarea lacks `name` / `autoComplete="off"`
apps/web/src/components/workforce/screens/assistant-box.tsx:96 - [Forms] placeholder (i18n/assistant.ts:12, :54) ends with "?" not "…"
apps/web/src/components/workforce/screens/assistant-box.tsx:113 - [Forms] submit disabled until text is typed; keep enabled, explain inline
apps/web/src/components/workforce/screens/assistant-box.tsx:125 - [Accessibility] `aria-live` is on a `<p>` mounted together with its content (inside `{answer ? …}`); the answer is often not announced. Keep a persistent live region and update its text

## apps/web/src/components/workforce/screens/attendance.tsx

apps/web/src/components/workforce/screens/attendance.tsx:147 - [Locale & i18n] `formatDate` builds dates by string (also :229, :276)
apps/web/src/components/workforce/screens/attendance.tsx:152 - [Forms] check-in / check-out buttons (:152, :167) are only `disabled` while posting; no spinner or "…" label
apps/web/src/components/workforce/screens/attendance.tsx:309 - [Navigation & State] branch / from / to filters in `useState`; not in the URL
apps/web/src/components/workforce/screens/attendance.tsx:447 - [Forms] correction submit disabled until a reason is typed
apps/web/src/components/workforce/screens/attendance.tsx:457 - [Forms] inputs lack `name` / `autoComplete="off"` (:457, :468, :479)

## apps/web/src/components/workforce/screens/audit-log.tsx

apps/web/src/components/workforce/screens/audit-log.tsx:58 - [Navigation & State] detail drawer and page / page size (:59) in `useState`; filters are in the URL but the page and the open event are not
apps/web/src/components/workforce/screens/audit-log.tsx:112 - [Forms] placeholder 'Mã việc, ví dụ INVOICE_PAID' (i18n/audit.ts:93) lacks "…"
apps/web/src/components/workforce/screens/audit-log.tsx:204 - [Locale & i18n] action codes, entity ids and request ids (:204, :294, :296, :299) lack `translate="no"`

## apps/web/src/components/workforce/screens/branch-detail.tsx

apps/web/src/components/workforce/screens/branch-detail.tsx:262 - [Forms] inputs lack `name` / `autoComplete="off"` (:262, :272, :359, :366)
apps/web/src/components/workforce/screens/branch-detail.tsx:272 - [Forms] IANA timezone identifier field lacks `spellCheck={false}`

## apps/web/src/components/workforce/screens/branches.tsx

apps/web/src/components/workforce/screens/branches.tsx:43 - [Navigation & State] page and page size (:44) in `useState`
apps/web/src/components/workforce/screens/branches.tsx:88 - [Navigation & State] row-menu "Chi tiết" navigates via `onSelect: navigate()`; give the item an `href`
apps/web/src/components/workforce/screens/branches.tsx:189 - [Forms] branch code (:189) and timezone id (:209) lack `spellCheck={false}`
apps/web/src/components/workforce/screens/branches.tsx:199 - [Forms] inputs lack `name` / `autoComplete="off"` (:189, :199, :209, :219)

## apps/web/src/components/workforce/screens/campaign-detail.tsx

apps/web/src/components/workforce/screens/campaign-detail.tsx:148 - [Animation] `scrollIntoView({ behavior: 'smooth' })` ignores `prefers-reduced-motion`

## apps/web/src/components/workforce/screens/campaign-dialogs.tsx

✓ pass

## apps/web/src/components/workforce/screens/campaign-display.tsx

apps/web/src/components/workforce/screens/campaign-display.tsx:178 - [Forms] inputs lack `name` / `autoComplete="off"` (:178, :185)

## apps/web/src/components/workforce/screens/campaign-groups.tsx

apps/web/src/components/workforce/screens/campaign-groups.tsx:205 - [Locale & i18n] `formatVnd` (also :210)
apps/web/src/components/workforce/screens/campaign-groups.tsx:270 - [Forms] inputs lack `name` (:270, :281); `NumberInput` :270 also lacks `autoComplete="off"`
apps/web/src/components/workforce/screens/campaign-groups.tsx:284 - [Locale & i18n] `MoneyInput` unit '₫' (:283) and separator hardcoded

## apps/web/src/components/workforce/screens/campaign-info.tsx

apps/web/src/components/workforce/screens/campaign-info.tsx:149 - [Forms] inputs lack `name` (:149, :158, :173, :193, :203, :218); all but :173 also lack `autoComplete="off"`

## apps/web/src/components/workforce/screens/campaign-items.tsx

apps/web/src/components/workforce/screens/campaign-items.tsx:121 - [Locale & i18n] `formatVnd` (also :128)
apps/web/src/components/workforce/screens/campaign-items.tsx:190 - [Forms] search placeholder repeats the label (i18n/campaigns.ts:144), no "…"

## apps/web/src/components/workforce/screens/campaign-picker.tsx

apps/web/src/components/workforce/screens/campaign-picker.tsx:71 - [Forms] price-bound `MoneyInput` uses its own label ('Giá từ', i18n/campaigns.ts:180) as placeholder: no example, no "…"
apps/web/src/components/workforce/screens/campaign-picker.tsx:72 - [Locale & i18n] unit '₫' hardcoded, no locale separator
apps/web/src/components/workforce/screens/campaign-picker.tsx:198 - [Locale & i18n] `formatVnd` instead of `Intl.NumberFormat`
apps/web/src/components/workforce/screens/campaign-picker.tsx:265 - [Forms] search placeholder repeats the label, no "…"

## apps/web/src/components/workforce/screens/campaigns.tsx

apps/web/src/components/workforce/screens/campaigns.tsx:146 - [Navigation & State] row-menu "open" navigates via `onSelect: navigate()`; use `href`
apps/web/src/components/workforce/screens/campaigns.tsx:171 - [Forms] search placeholder repeats the label (i18n/campaigns.ts:28), no "…"
apps/web/src/components/workforce/screens/campaigns.tsx:287 - [Forms] inputs lack `name` (:287, :296, :312, :332, :342, :358); all but :312 also lack `autoComplete="off"`

## apps/web/src/components/workforce/screens/chat-requests.tsx

apps/web/src/components/workforce/screens/chat-requests.tsx:151 - [Navigation & State] "Đóng yêu cầu" (forward-only, starts the 90-day phone/note purge) fires straight from the row menu; no confirmation, no undo
apps/web/src/components/workforce/screens/chat-requests.tsx:169 - [Content & Copy] bare-number `resultCount`

## apps/web/src/components/workforce/screens/collaborator-schedule.tsx

apps/web/src/components/workforce/screens/collaborator-schedule.tsx:70 - [Navigation & State] date range and branch filter (:71) in `useState`; not in the URL
apps/web/src/components/workforce/screens/collaborator-schedule.tsx:207 - [Locale & i18n] `formatDate` by string (also :298)
apps/web/src/components/workforce/screens/collaborator-schedule.tsx:405 - [Forms] client validation problem shown as one Notice at the top of the drawer, not inline at the field; no focus
apps/web/src/components/workforce/screens/collaborator-schedule.tsx:518 - [Forms] agreed pay is a plain numeric `TextInput`; use kit `MoneyInput`
apps/web/src/components/workforce/screens/collaborator-schedule.tsx:486 - [Forms] inputs lack `name` / `autoComplete="off"` (:486, :495, :518, :532, :548)

## apps/web/src/components/workforce/screens/dashboard.tsx

apps/web/src/components/workforce/screens/dashboard.tsx:56 - [Navigation & State] branch scope in `useState`; not in the URL, resets on reload
apps/web/src/components/workforce/screens/dashboard.tsx:129 - [Navigation & State] "Đặt lại mặc định" wipes the saved layout immediately; no confirmation or undo

## apps/web/src/components/workforce/screens/discount-detail.tsx

apps/web/src/components/workforce/screens/discount-detail.tsx:81 - [Content & Copy] load failure `ErrorState` has no `onRetry`
apps/web/src/components/workforce/screens/discount-detail.tsx:97 - [Navigation & State] tab in `useState`, not in the URL
apps/web/src/components/workforce/screens/discount-detail.tsx:208 - [Navigation & State] "Phiên bản mới" navigates via `Button onClick`; use `ButtonLink`
apps/web/src/components/workforce/screens/discount-detail.tsx:410 - [Locale & i18n] `formatVnd` (also :460)
apps/web/src/components/workforce/screens/discount-detail.tsx:438 - [Navigation & State] versions / vouchers pages in `useState` (:438, :502)
apps/web/src/components/workforce/screens/discount-detail.tsx:509 - [Locale & i18n] voucher `<code>` lacks `translate="no"`
apps/web/src/components/workforce/screens/discount-detail.tsx:629 - [Forms] voucher code input lacks `spellCheck={false}` and `name`

## apps/web/src/components/workforce/screens/discount-form.tsx

apps/web/src/components/workforce/screens/discount-form.tsx:79 - [Forms] program code input lacks `spellCheck={false}`
apps/web/src/components/workforce/screens/discount-form.tsx:152 - [Forms] money amounts (:152, :165) are plain numeric `TextInput`s; use kit `MoneyInput`
apps/web/src/components/workforce/screens/discount-form.tsx:100 - [Forms] inputs lack `name` (:79, :100, :110, :139, :152, :165, :182, :192, :277, :289); :100, :110, :182, :192 also lack `autoComplete="off"`

## apps/web/src/components/workforce/screens/discount-new.tsx

apps/web/src/components/workforce/screens/discount-new.tsx:41 - [Forms] validation problem shown as one Notice at the bottom of the card (:76); the field is not marked or focused
apps/web/src/components/workforce/screens/discount-new.tsx:69 - [Content & Copy] `t.errors.forbidden` (i18n/workforce.ts:92) states the problem only; say whom to ask
apps/web/src/components/workforce/screens/discount-new.tsx:81 - [Navigation & State] Cancel navigates via `onClick`; use a link

## apps/web/src/components/workforce/screens/discount-targets.tsx

apps/web/src/components/workforce/screens/discount-targets.tsx:181 - [Content & Copy] `catalogFailed` says "Hãy thử lại" but offers no retry control
apps/web/src/components/workforce/screens/discount-targets.tsx:212 - [Forms] product search placeholder 'Tìm sản phẩm' (i18n/workforce.ts:2152): no example, no "…"

## apps/web/src/components/workforce/screens/discount-version.tsx

apps/web/src/components/workforce/screens/discount-version.tsx:40 - [Content & Copy] load failure `ErrorState` has no `onRetry`
apps/web/src/components/workforce/screens/discount-version.tsx:64 - [Forms] validation problem shown as one Notice at the bottom (:108); field not marked or focused
apps/web/src/components/workforce/screens/discount-version.tsx:113 - [Navigation & State] Cancel navigates via `onClick`; use a link

## apps/web/src/components/workforce/screens/discounts.tsx

apps/web/src/components/workforce/screens/discounts.tsx:146 - [Navigation & State] row-menu "Chi tiết" navigates via `onSelect: navigate()`; use `href`
apps/web/src/components/workforce/screens/discounts.tsx:157 - [Navigation & State] "Tạo ưu đãi" navigates via `Button onClick`; use `ButtonLink`
apps/web/src/components/workforce/screens/discounts.tsx:174 - [Forms] search placeholder repeats the label, no "…"

## apps/web/src/components/workforce/screens/employee-create.tsx

apps/web/src/components/workforce/screens/employee-create.tsx:79 - [Content & Copy] `t.errors.forbidden` states the problem only
apps/web/src/components/workforce/screens/employee-create.tsx:89 - [Navigation & State] Cancel navigates via `onClick`; use a link
apps/web/src/components/workforce/screens/employee-create.tsx:121 - [Forms] long page form has no unsaved-changes guard (discount-new.tsx:34 uses `useUnsavedChangesGuard`; this page does not)
apps/web/src/components/workforce/screens/employee-create.tsx:202 - [Forms] employee code (login id) input lacks `spellCheck={false}`
apps/web/src/components/workforce/screens/employee-create.tsx:250 - [Forms] email input lacks `spellCheck={false}`
apps/web/src/components/workforce/screens/employee-create.tsx:399 - [Forms] all problems listed in one Notice at the bottom; fields get `invalid` but no inline message and the first invalid field is not focused
apps/web/src/components/workforce/screens/employee-create.tsx:214 - [Forms] inputs lack `name` (:202, :214, :226, :237, :250, :277, :339, :352, :472, :487); textarea :352 also lacks `autoComplete="off"`

## apps/web/src/components/workforce/screens/employee-detail.tsx

apps/web/src/components/workforce/screens/employee-detail.tsx:136 - [Navigation & State] tab in `useState`, not in the URL
apps/web/src/components/workforce/screens/employee-detail.tsx:344 - [Navigation & State] history page in `useState`
apps/web/src/components/workforce/screens/employee-detail.tsx:420 - [Content Handling] a still-active assignment shows '…' in the "revoked" column (reads as loading); use '—' or a word
apps/web/src/components/workforce/screens/employee-detail.tsx:553 - [Forms] submit disabled until branch and reason are filled
apps/web/src/components/workforce/screens/employee-detail.tsx:572 - [Forms] reason input lacks `name` / `autoComplete="off"`

## apps/web/src/components/workforce/screens/employee-lifecycle.tsx

apps/web/src/components/workforce/screens/employee-lifecycle.tsx:104 - [Locale & i18n] `formatDate` by string (also :273, :300, :306, :319, :389)
apps/web/src/components/workforce/screens/employee-lifecycle.tsx:401 - [Forms] submit disabled until a reason is typed (:401, :502, :652)
apps/web/src/components/workforce/screens/employee-lifecycle.tsx:636 - [Forms] password length / mismatch errors go to the dialog's error summary, not inline under the two password fields
apps/web/src/components/workforce/screens/employee-lifecycle.tsx:159 - [Forms] inputs lack `name` (:159, :169, :181, :203, :426, :435, :516, :525, :661, :676, :689); reason/name inputs also lack `autoComplete="off"`

## apps/web/src/components/workforce/screens/employee-roles.tsx

apps/web/src/components/workforce/screens/employee-roles.tsx:337 - [Forms] submit disabled until scope, role and reason are filled
apps/web/src/components/workforce/screens/employee-roles.tsx:392 - [Forms] reason input lacks `name` / `autoComplete="off"`

## apps/web/src/components/workforce/screens/employee-skills.tsx

apps/web/src/components/workforce/screens/employee-skills.tsx:323 - [Forms] submit disabled until a skill is chosen
apps/web/src/components/workforce/screens/employee-skills.tsx:349 - [Forms] reason input lacks `name` / `autoComplete="off"`

## apps/web/src/components/workforce/screens/employees.tsx

apps/web/src/components/workforce/screens/employees.tsx:78 - [Navigation & State] "Thêm nhân sự" navigates via `Button onClick`; use `ButtonLink`
apps/web/src/components/workforce/screens/employees.tsx:93 - [Forms] search placeholder repeats the label, no "…"
apps/web/src/components/workforce/screens/employees.tsx:307 - [Navigation & State] row-menu "Chi tiết" navigates via `onSelect: navigate()`; use `href`

## apps/web/src/components/workforce/screens/forgot-password.tsx

apps/web/src/components/workforce/screens/forgot-password.tsx:152 - [Forms] email input lacks `spellCheck={false}` and `name`
apps/web/src/components/workforce/screens/forgot-password.tsx:174 - [Forms] code input lacks `name`
apps/web/src/components/workforce/screens/forgot-password.tsx:213 - [Forms] code / length / mismatch errors are Notices below the form (:213-217), not tied to their fields (`aria-describedby`); first invalid field not focused

## apps/web/src/components/workforce/screens/import-detail.tsx

apps/web/src/components/workforce/screens/import-detail.tsx:350 - [Forms] override-reason textarea lacks `name` / `autoComplete="off"`
apps/web/src/components/workforce/screens/import-detail.tsx:382 - [Locale & i18n] `formatVnd` instead of `Intl.NumberFormat`
apps/web/src/components/workforce/screens/import-detail.tsx:487 - [Forms] search placeholder repeats the label, no "…"

## apps/web/src/components/workforce/screens/import-zip.tsx

apps/web/src/components/workforce/screens/import-zip.tsx:46 - [Locale & i18n] decimal separator for `formatBytes` hardcoded per locale instead of `Intl.NumberFormat`

## apps/web/src/components/workforce/screens/imports.tsx

apps/web/src/components/workforce/screens/imports.tsx:69 - [Navigation & State] page in `useState`
apps/web/src/components/workforce/screens/imports.tsx:132 - [Navigation & State] row-menu "open" navigates via `onSelect: navigate()`; use `href`
apps/web/src/components/workforce/screens/imports.tsx:203 - [Locale & i18n] decimal separator for `formatBytes` hardcoded per locale

## apps/web/src/components/workforce/screens/inventory.tsx

apps/web/src/components/workforce/screens/inventory.tsx:134 - [Navigation & State] "Thêm phiếu nhập" navigates via `Button onClick`; use `ButtonLink`

## apps/web/src/components/workforce/screens/inventory-receipts.tsx

apps/web/src/components/workforce/screens/inventory-receipts.tsx:153 - [Locale & i18n] `formatDate` / `formatVnd` (also :185, :385, :523, :533)
apps/web/src/components/workforce/screens/inventory-receipts.tsx:217 - [Navigation & State] row-menu "open" navigates via `onSelect: navigate()`; use `href`
apps/web/src/components/workforce/screens/inventory-receipts.tsx:239 - [Forms] search placeholder repeats the label, no "…"
apps/web/src/components/workforce/screens/inventory-receipts.tsx:361 - [Navigation & State] "Sửa" (:361) and Cancel (:907) navigate via `onClick`; use links
apps/web/src/components/workforce/screens/inventory-receipts.tsx:656 - [Forms] long receipt page form has no unsaved-changes guard
apps/web/src/components/workforce/screens/inventory-receipts.tsx:697 - [Forms] invalid submit marks fields inline but does not focus the first invalid field (lines can be far below)
apps/web/src/components/workforce/screens/inventory-receipts.tsx:742 - [Forms] inputs lack `name` (:742, :761, :774, :845, :860, :871, :887); :742, :774, :845 also lack `autoComplete="off"`
apps/web/src/components/workforce/screens/inventory-receipts.tsx:799 - [Performance] every receipt line renders a full field block; a long receipt (>50 lines) is not virtualized
apps/web/src/components/workforce/screens/inventory-receipts.tsx:810 - [Navigation & State] "Xóa dòng" removes a filled line instantly; no undo
apps/web/src/components/workforce/screens/inventory-receipts.tsx:828 - [Forms] product combobox placeholder 'Gõ tên hoặc mã SKU' (i18n/inventory.ts:193) lacks "…"

## apps/web/src/components/workforce/screens/inventory-stock.tsx

apps/web/src/components/workforce/screens/inventory-stock.tsx:211 - [Locale & i18n] `formatDate` / `formatVnd` (also :417, :457, :497, :658)
apps/web/src/components/workforce/screens/inventory-stock.tsx:230 - [Navigation & State] row-menu "Chi tiết" navigates via `onSelect: navigate()`; use `href`
apps/web/src/components/workforce/screens/inventory-stock.tsx:252 - [Forms] search placeholder repeats the label, no "…"
apps/web/src/components/workforce/screens/inventory-stock.tsx:448 - [Navigation & State] lots / history pages in `useState` (:448, :528)
apps/web/src/components/workforce/screens/inventory-stock.tsx:522 - [Locale & i18n] `signed()` builds '+N' / '-N' with an ASCII hyphen and `String()`; use `Intl.NumberFormat` with `signDisplay`
apps/web/src/components/workforce/screens/inventory-stock.tsx:680 - [Forms] inputs lack `name` / `autoComplete="off"` (:680, :706)

## apps/web/src/components/workforce/screens/inventory-suppliers.tsx

apps/web/src/components/workforce/screens/inventory-suppliers.tsx:154 - [Forms] search placeholder repeats the label (i18n/inventory.ts:304), no "…"
apps/web/src/components/workforce/screens/inventory-suppliers.tsx:267 - [Forms] inputs lack `name` (:267, :278, :289, :301, :313, :324); textarea :324 also lacks `autoComplete="off"`
apps/web/src/components/workforce/screens/inventory-suppliers.tsx:301 - [Forms] email input lacks `spellCheck={false}`

## apps/web/src/components/workforce/screens/leave.tsx

apps/web/src/components/workforce/screens/leave.tsx:165 - [Locale & i18n] `formatDate` by string (also :340, :520)
apps/web/src/components/workforce/screens/leave.tsx:226 - [Forms] submit disabled until dates and reason are filled (also reject :524)
apps/web/src/components/workforce/screens/leave.tsx:248 - [Forms] inputs lack `name` (:248, :272, :283, :544); textareas also lack `autoComplete="off"`
apps/web/src/components/workforce/screens/leave.tsx:403 - [Navigation & State] status filter in `useState`; not in the URL

## apps/web/src/components/workforce/screens/login.tsx

apps/web/src/components/workforce/screens/login.tsx:110 - [Forms] employee id / email input lacks `spellCheck={false}`

## apps/web/src/components/workforce/screens/loyalty.tsx

apps/web/src/components/workforce/screens/loyalty.tsx:247 - [Forms] phone / email lookup input lacks `spellCheck={false}` (email mode) and `name`

## apps/web/src/components/workforce/screens/loyalty-adjust-dialog.tsx

apps/web/src/components/workforce/screens/loyalty-adjust-dialog.tsx:55 - [Content & Copy] amount and reason errors (:55, :56) use the generic `t.errors.validation`; say the allowed range / that a reason is required
apps/web/src/components/workforce/screens/loyalty-adjust-dialog.tsx:130 - [Forms] inputs lack `name` (:130, :142); textarea also lacks `autoComplete="off"`

## apps/web/src/components/workforce/screens/loyalty-birthday.tsx

apps/web/src/components/workforce/screens/loyalty-birthday.tsx:56 - [Navigation & State] history paging in `useState`
apps/web/src/components/workforce/screens/loyalty-birthday.tsx:145 - [Locale & i18n] `formatVnd` instead of `Intl.NumberFormat`

## apps/web/src/components/workforce/screens/loyalty-birthday-form.tsx

apps/web/src/components/workforce/screens/loyalty-birthday-form.tsx:127 - [Forms] inputs lack `name` (:127, :147, :159, :176, :194, :247); number inputs also lack `autoComplete="off"`
apps/web/src/components/workforce/screens/loyalty-birthday-form.tsx:150 - [Locale & i18n] `MoneyInput` unit '₫' and separator hardcoded (:149-150, :161-162)
apps/web/src/components/workforce/screens/loyalty-birthday-form.tsx:205 - [Accessibility] "combine" checkboxes (:207-221) sit under a `<span className="ls-label">` with no `role="group"`/`fieldset` + `aria-labelledby`; the group name is never announced

## apps/web/src/components/workforce/screens/loyalty-combo-sold.tsx

apps/web/src/components/workforce/screens/loyalty-combo-sold.tsx:142 - [Locale & i18n] `formatVnd` instead of `Intl.NumberFormat`
apps/web/src/components/workforce/screens/loyalty-combo-sold.tsx:293 - [Navigation & State] row-menu "open customer" navigates via `navigate()`; use `href`
apps/web/src/components/workforce/screens/loyalty-combo-sold.tsx:323 - [Navigation & State] profile combo / gift pages in `useState` (:323, :368)

## apps/web/src/components/workforce/screens/loyalty-combo-usage.tsx

apps/web/src/components/workforce/screens/loyalty-combo-usage.tsx:238 - [Navigation & State] frozen-combos paging in `useState`

## apps/web/src/components/workforce/screens/loyalty-combos.tsx

apps/web/src/components/workforce/screens/loyalty-combos.tsx:44 - [Navigation & State] paging in `useState`
apps/web/src/components/workforce/screens/loyalty-combos.tsx:80 - [Locale & i18n] `formatVnd` instead of `Intl.NumberFormat`

## apps/web/src/components/workforce/screens/loyalty-combos-form.tsx

apps/web/src/components/workforce/screens/loyalty-combos-form.tsx:117 - [Forms] inputs lack `name` (:117, :128, :139, :157, :175); number inputs also lack `autoComplete="off"`
apps/web/src/components/workforce/screens/loyalty-combos-form.tsx:178 - [Locale & i18n] `MoneyInput` unit '₫' and separator hardcoded

## apps/web/src/components/workforce/screens/loyalty-customer.tsx

✓ pass

## apps/web/src/components/workforce/screens/loyalty-exceptions.tsx

apps/web/src/components/workforce/screens/loyalty-exceptions.tsx:92 - [Navigation & State] row-menu "open" navigates via `onSelect: navigate()`; use `href`

## apps/web/src/components/workforce/screens/loyalty-go-live.tsx

✓ pass

## apps/web/src/components/workforce/screens/loyalty-referrals.tsx

apps/web/src/components/workforce/screens/loyalty-referrals.tsx:128 - [Navigation & State] row-menu "open" navigates via `onSelect: navigate()`; use `href`

## apps/web/src/components/workforce/screens/loyalty-rewards.tsx

apps/web/src/components/workforce/screens/loyalty-rewards.tsx:229 - [Forms] phone lookup input lacks `name`

## apps/web/src/components/workforce/screens/loyalty-rewards-catalog.tsx

apps/web/src/components/workforce/screens/loyalty-rewards-catalog.tsx:50 - [Navigation & State] paging in `useState`

## apps/web/src/components/workforce/screens/loyalty-rewards-catalog-form.tsx

apps/web/src/components/workforce/screens/loyalty-rewards-catalog-form.tsx:180 - [Forms] inputs lack `name` (:180, :191, :224); `NumberInput` :224 also lacks `autoComplete="off"`

## apps/web/src/components/workforce/screens/loyalty-rewards-dialogs.tsx

apps/web/src/components/workforce/screens/loyalty-rewards-dialogs.tsx:140 - [Forms] inputs lack `name` / `autoComplete="off"` (:140, :152, :327)

## apps/web/src/i18n/workforce.ts

apps/web/src/i18n/workforce.ts:89 - [Content & Copy] `errors.validation` "Dữ liệu chưa hợp lệ. Vui lòng kiểm tra lại." is used as a per-field error (advances, loyalty adjust) and names neither the field nor the fix
apps/web/src/i18n/workforce.ts:92 - [Content & Copy] `errors.forbidden` "Bạn không có quyền thực hiện thao tác này." has no next step (ask the Owner / a manager)
apps/web/src/i18n/workforce.ts:259 - [Typography] `dashboard.widgetLoading` 'Đang tải tiện ích' lacks "…" (EN 'Loading widget' at :3071 too)
apps/web/src/i18n/workforce.ts:2657 - [Content & Copy] `titles.OWNER` 'Chủ Spa' is not sentence case ('Chủ spa' at :143)
apps/web/src/i18n/workforce.ts:3003 - [Content & Copy] `nav.myAccount` 'My Account', `nav.myIncome` 'My Income' (:3004) are Title Case; use 'My account', 'My income'

## apps/web/src/i18n/ai-settings.ts

apps/web/src/i18n/ai-settings.ts:116 - [Typography] straight quotes `"chính hãng"` → “chính hãng” (EN :243 too)

## apps/web/src/i18n/imports.ts

apps/web/src/i18n/imports.ts:50 - [Typography] straight quotes `"Giá bán"` → “Giá bán”

## apps/web/src/i18n/ai-seo.ts

apps/web/src/i18n/ai-seo.ts:100 - [Content & Copy] `drawer.loadFailed` 'Không tải được bản nháp này.' gives no next step (EN :231)

## apps/web/src/i18n/assistant.ts

apps/web/src/i18n/assistant.ts:12 - [Typography] placeholder ends with "?" instead of "…" (EN :54)
apps/web/src/i18n/assistant.ts:44 - [Content & Copy] `loadFailed` 'Không kiểm tra được trợ lý.' gives no next step (EN :86)

## apps/web/src/i18n/inventory.ts

apps/web/src/i18n/inventory.ts:14 - [Content & Copy] `invalid` 'Giá trị không hợp lệ.' is a vague field error with no fix (EN :342)

## apps/web/src/i18n/combo.ts

apps/web/src/i18n/combo.ts:50 - [Content & Copy] `form.invalid` 'Giá trị chưa hợp lệ.' is vague, no allowed range (EN :260)

## apps/web/src/i18n/reward.ts

apps/web/src/i18n/reward.ts:67 - [Content & Copy] `invalid` 'Giá trị chưa hợp lệ.' vague, no fix (also :119; EN :257, :309)

## apps/web/src/i18n/birthday.ts

apps/web/src/i18n/birthday.ts:104 - [Content & Copy] `form.invalid` 'Giá trị chưa hợp lệ.' vague, no fix (EN :241)

## apps/web/src/i18n/campaigns.ts

apps/web/src/i18n/campaigns.ts:28 - [Content & Copy] search placeholders (:28, :144, :177, :180-181; EN :342, :460, :493, :496-497) give no example pattern and lack "…"

## apps/web/src/i18n/audit.ts

apps/web/src/i18n/audit.ts:93 - [Content & Copy] action-code placeholder has an example but lacks "…" (EN :132)

## apps/web/src/i18n/ai-drafts.ts

✓ pass

## apps/web/src/i18n/chat-requests.ts

✓ pass

## apps/web/src/i18n/combo-sold.ts

✓ pass

## apps/web/src/i18n/loyalty.ts

✓ pass

## apps/web/src/i18n/organization.ts

✓ pass (Title Case 'Save Team Leader' etc. at :197-199 is only used by teams.tsx, outside this scope)
