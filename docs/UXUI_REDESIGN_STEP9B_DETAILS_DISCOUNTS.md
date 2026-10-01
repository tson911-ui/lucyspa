# UX/UI Step 9b: Service detail, Branch detail, Discounts (list, detail, form)

Status: local, not committed, not deployed. Plan: UXUI_REDESIGN_STEP7_5_PLAN.md section 8 (9b). Base: a9887ba (8c committed).

## What changed

- **Service detail**: breadcrumbs, `⋮` (Deactivate/Activate, reason required via the existing `StatusConfirm`, now exported) + primary "Sửa dịch vụ"; status badge; 3 `Tabs`. Overview = master data and price as `DescriptionList` cards (price card has its own "Đổi giá"); Branches = `DataTable` with a `⋮` Offer/Withdraw per branch; Skills = `CheckField` group + `FormActions`. Edit = `FormDrawer` (8 fields), price change = `FormDialog` (price fields + required reason).
- **Branch detail**: breadcrumbs, `⋮` (status, ConfirmDialog with required reason) + primary "Sửa thông tin" (FormDialog: name, timezone). Details and business hours are read-only cards; hours edit ("Sửa giờ hoạt động") = `FormDrawer`, one group per weekday (closed + opens/closes). `editableHours`/`hoursChanged` unchanged.
- **Discounts list**: client `DataTable` (20/page, sort name/window/status/used) + `ListToolbar` (search code/names, status filter, reload), state in the URL; name link + `⋮` Details. "Tạo chương trình" opens its own page.
- **Discount create** = `/discounts/new` (long form, `Page variant form`): 5 `FormSection`s (program, discount, validity, scope with category/service pickers, limits), Cancel then Create, unsaved-changes guard, toast then the program page.
- **Discount detail**: breadcrumbs, `⋮` (Pause/Resume, End early), primary "Tạo phiên bản mới" (own page `/discounts/[id]/versions/new`, Owner decision: 10 fields in 5 sections with two pickers, near-identical to create, so rule 9 long form); Tabs Current / Versions (DataTable) / Voucher codes (DataTable, `⋮` switch, "Tạo mã" dialog; only for code programs). End early = `ConfirmDialog` with required reason (danger text, never solid inline).
- Removed: `Section` + `wf-form`/`wf-row`/`wf-fieldset`/`wf-checklist` markup, raw tables (4), native fieldsets (4), raw checkboxes (4), the inline create card and the "new version" inline form.
- New: `lib/workforce/discounts-list.ts`, `discount-new.tsx`, route `discounts/new`; dictionary keys (vi + en) for services, branches, discounts.

## Not changed

No API, DB, contract, permission or `packages/ui` change; same endpoints, payloads and permission checks (MANAGE_SERVICES / MANAGE_SERVICE_PRICES / MANAGE_BRANCHES / MANAGE_DISCOUNTS / CREATE_VOUCHERS). `next-env.d.ts` untouched.

## Tests run

- web targeted: discounts-list (new, 3), discounts screens (new, 4), screens, discounts, pricing, durations, catalog-delete, ui-ratchet: 46/46. typecheck, eslint, prettier clean.
- Ratchet lowered: raw tables 14 -> 10, `wf-*` uses 439 -> 397, fieldsets 11 -> 7, checkboxes 8 -> 4.
- Not run (Step 14): `pnpm check`, integration, smoke.

## UX gate

- Rendered discounts, discount detail, discount new, service detail, branch detail at 360/768/1440 light + 1440 dark, plus the edit drawer, price dialog, branches tab, edit-branch dialog, hours drawer and version drawer. Tokens only, one h1, one primary action last, single-border tables, pager footer, no horizontal scroll. Fixed from review: hours table overflowed the drawer (now one group per weekday); the "needs code" checkbox sat beside the code field (now its own row).
- DOM audit vs baseline: service-detail 135 -> 14, branch-detail 89 -> 14, discount-detail 78 -> 14, discounts 56 -> 36; discount-new (new page) 4. Global compare: no rule above baseline except `icon-text-misaligned` +9 total, the accepted icon-only phone "Bộ lọc" false positive (now also on discounts). Remaining hits are the shared kit items in plan section 11.
- Reference comparison (8 questions): gutter 16 / header 24, title 24/600, action at the trailing edge, one-row toolbar, single-border table, one pager row, create in dialog/drawer/page by size, nothing touches another surface: yes.
- Open observation: the scratch branch stores hours "00:00-24:00"; a native time input cannot show 24:00 (closes field empty). Same as before this Step; real data is 09:00-21:00.

## Open questions

- Owner's "chưa ổn lắm" notes on the 7.5 deploy are still pending.
- Owner approved 9b: discount create = page; new version also moved to a page (see above).
