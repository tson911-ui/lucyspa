# UX/UI Redesign Step 4: Data components (table, pagination, toolbar, tabs, URL state)

Status: CLOSED / OWNER APPROVED. Not deployed. Owner answer applied: `DataTable` takes optional `sortLabels` and shows a phone-only "Sort by" select (column x direction) whenever a column is sortable and the labels are passed (Skills today; Employees has no sortable column). Contract: `UXUI_REDESIGN_DESIGN.md` 9.4, 10, 11, 12, 13.

## What changed

- `packages/ui` (framework-only, text via props, styles appended to `components.css`, tokens only):
  - `DataTable`: typed columns (`header`, `cell`, `align`, `sortable` + `sortValue`, `hideBelow` md/lg, `mobileTitle`, `actions`), sticky header, `aria-sort`, 5 skeleton rows, `error` / `empty` slots, `selectedKey`. `mode="client"` sorts and pages a loaded array; `mode="server"` shows the given page with `paging.total` and reports sort via `onSortChange`. Below 640 px the same markup is a stacked card list (labels from `data-label`, title first, actions last).
  - `Pagination` (numbered, first/prev/next/last, "Showing 21-40 of 133", 10/20/50 select; page buttons only when more than one page, count line always), `CursorPagination` ("Load more" or previous/next), `ListToolbar` (role=search, live result count, Reset, filters move into a `Drawer` sheet on phone), `FilterChips`, `DescriptionList`, `Tabs` (roving focus, automatic activation, controlled or uncontrolled).
  - DOM-free cores: `paging-core` (paging, sorting, tab keys), `url-state-core`; hooks `useUrlState` (query string via History API, no `next/*`) and `useMediaQuery`.
- Pilot screens: **Employees** (four server-paged tables, `useUrlState` for `q`, `branch`, `status`, `pageSize`, one page key per group; toolbar with chips) and **Skills** (client mode: search, status filter, sort, paging, all in the URL). Name cell links to the record. Page header, add-employee button and skill edit/create forms are unchanged (Steps 8-10).
- Web glue: `lib/workforce/list-view.ts` (dictionary to component labels), `skills-list.ts`; `common.list` strings VI/EN; `skills.search/noMatch`. Removed `employees.directory.pagination/previous/next/pageNumber` and `FIRST_PAGES/withGroupPage` (replaced by the shared pager and URL state).

## Migrations / permissions / API

None. No change to `apps/api`, `packages/database`, `packages/contracts`, permissions or navigation. `directoryPage` gained an optional `pageSize` (API `limit` max is 100).

## Tests run

- `@lucy-spa/ui`: 91 pass (29 new): paging math, sort (Vietnamese collation, empty last, stable), tab keys, URL state parse/serialize/reset; SSR markup and ARIA per component with the longest VI label; **jsdom** interaction (tab arrows, pager clicks, sort toggle, `useUrlState` push/replace/Back, phone filter sheet, chips); CSS rules (wrap, 44 px targets, card list, tablet hiding).
- `apps/web` unit: 191 pass (`employee-directory.test.tsx` adapted: URL-state independence instead of `withGroupPage`, new pager class, count line kept). Typecheck ui + web, eslint 0 warnings, boundaries, prettier: clean on touched paths (`docs/PHASE4_HOTFIX_PAYOS_WEBHOOK_SIGNATURE.md` fails prettier; not touched, known).
- Visual: static markup + tokens screenshotted in Edge at 360 (card list), 768 (hidden columns), 1440 dark. Not verified against the running app (needs API/DB).

## Other changes to know about

- `jsdom` + `@types/jsdom` added as `packages/ui` devDependencies (approved in Step 3); `pnpm-lock.yaml` +333 lines; test helper `src/dom-harness.ts`.
- Employees no longer has a Search submit button: search applies as you type (300 ms) or on Enter.

## Open questions

- Employees shows a row count per table, not one combined live result count (four independent server totals).
- `Card`, `CardHeader`, `Avatar`, `Stat` (9.4) are not in this Step's index; they land with Step 5/7. Row-actions `...` menu and Edit/Deactivate rules arrive when screens migrate (Steps 8-10).
