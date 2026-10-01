# UX/UI Step 9a: Services

Status: local, not committed, not deployed. Plan: UXUI_REDESIGN_STEP7_5_PLAN.md section 8 (9a). Owner's "chưa ổn lắm" on the 7.5 deploy check has no specifics yet; they are to be sent later and are not covered here.

## What changed

- Services screen rebuilt on the kit: header primary action follows the tab ("Thêm dịch vụ" on Services, "Thêm nhóm dịch vụ" on Categories), then `Tabs` with counts (tab in the URL, `?tab=categories`).
- Services tab: `ListToolbar` (search code/VI/EN name without accents, Category and Status filters, reload) + `DataTable` client mode, 20/page, sort code/name/category/price (price numeric, nowrap). Category is a column (no grouping). Name = link to detail. Columns hide by width (category < 1024, estimate < 1280), so the `⋮` stays visible at 768.
- Row `⋮`: Details, Deactivate/Activate (reason required, `ConfirmDialog`), then Delete in danger text (10.5: only where the API deletes; needs MANAGE_SERVICES + MANAGE_SERVICE_PRICES as before).
- Categories tab: `DataTable` (own page keys), `⋮` = Edit, Deactivate/Activate (reason), Delete. Create = `FormDialog`, edit = `FormDialog` (the old inline edit and its reason field are gone; reason now lives in the status confirmation).
- Create service = `FormDrawer` (11 fields). Price and duration blocks are now kit fields (`PriceFields`/`DurationFields` render their own `FormGrid`; still used by Service detail). Price fields turn red only after something was typed. When no category exists the header action is replaced by the existing "create a category first" notice.
- Removed `ConfirmDeleteDialog` (legacy `wf-dialog`); delete uses `ConfirmDialog` with `deleteConfirmation()` texts. New `lib/workforce/services-list.ts` (URL state, filter, sort) and dictionary keys (vi + en).

## Not changed

No API, DB, contract or permission change; all calls, payloads and permission checks are as before. Service detail (9b) untouched apart from the shared fields above. `next-env.d.ts` untouched.

## Tests run

- web: services-list (new), catalog-delete, pricing, durations, screens, ui-ratchet: 23/23. typecheck, eslint, prettier clean. Ratchet lowered: raw tables 23 -> 21, `wf-*` uses 698 -> 664, `<details>` 20 -> 17.
- Not run (reserved for Step 14): `pnpm check`, integration, smoke. No `packages/ui` change.

## UX gate

- Rendered Services (360/768/1440 light, 1440 dark), Categories tab, the create drawer and the category dialog (light/dark where relevant). Spacing on tokens, one h1 + one primary action last, toolbar = one row of equal controls, one single-border table, pager footer, footer Cancel then Save, no horizontal page scroll.
- DOM audit vs baseline (services): 128 -> 36 hits, `unpaged-list`, `orphan-action`, `nested-border-box`, `border-collision` 0. Global compare: no rule above baseline except `icon-text-misaligned` 2 -> 5: the icon-only phone "Bộ lọc" button (text deliberately visually hidden below 480 px; same hit on Skills; known false positive noted in the Step 7 audit). `wrapped-label` on `th` ("Mã", "Tên", ...) is the same sort-header hit as on Skills.
- Reference comparison (shadcn-admin list): gutter and header 24 ok, actions right, toolbar one row, single-border table (48 px rows), one pager row, create in drawer/dialog.
- Environment note: the web build bakes in `API_UPSTREAM_ORIGIN`; the audit build needs `API_UPSTREAM_ORIGIN=http://127.0.0.1:3101 pnpm --filter @lucy-spa/web build` (without it every page shows the "system not responding" error).

## Owner decisions (9a approved)

- Creating and deleting a service keeps requiring both MANAGE_SERVICES and MANAGE_SERVICE_PRICES (unchanged).
- `icon-text-misaligned` 2 -> 5 is accepted as an audit false positive (icon-only phone "Bộ lọc" button, label visually hidden below 480 px).

## Open questions

- Success text is still a page `Notice` until the toast provider is mounted in Step 8a.
- Owner's "chưa ổn lắm" notes on the 7.5 deploy are still pending.
