# UX/UI Redesign Step 7: Dashboard

Status: CLOSED / OWNER APPROVED (open questions 1-3 accepted as proposed). Not deployed. Contract: `UXUI_REDESIGN_DESIGN.md` 4.3, 12.5, 14.1-14.3, 15, 21.

## What changed

- **`packages/ui`**: shared `Card` / `CardHeader` (one surface for cards; `ChartFrame` and `KpiCard` share its CSS rule) and `Stat` (label + value + optional change, no surface; `DeltaLine` is shared with `KpiCard`). `Avatar` was not needed and is not built. `SortableGrid`/`List` got `variant="bare"` (content is already a Card; dashed outline only while editing) and `itemClassName` (column span). Widget grid CSS: 1 column phone, 6 from 640 px, 12 from 1280 px (not 1024: the sidebar leaves ~720 px there, too narrow for 12 columns).
- **Dashboard** (`screens/dashboard.tsx`, `components/workforce/dashboard/`, `lib/workforce/dashboard/`): greeting + recovery email fixed at the top, branch selector, **Customize** (drag/touch/keyboard, Move earlier/later, S/M/L-style size control, hide, add back, Reset), 11 widgets of 14.3, each in its own error boundary + Suspense, lazy-loaded (`registry.ts`; the metadata is `widgets.ts`). States per widget: skeleton reserving height, empty, error with retry, compact "no access" (403 or missing permission at the selected branch).
- **Equal-length comparison**: `previousWindow()` restates the kit's shifted range as exactly as many days as the current window (also across a leap day for "same period last year"); `loadPreviousBoard()` requests one board for that window and refuses a response that does not cover exactly those days. Both series therefore always have the same point count.
- **Data**: one request per key however many widgets read it (`shared-data.ts`: the three booking widgets share the "today" board, awaiting + paid share the POS board). Refresh on focus and every 5 minutes, passive (no session extension).
- **Layout persistence**: `localStorage` `ls-dashboard:{accountId}`, `{version, order, hidden, sizes}`; unknown ids ignored, new/newly permitted widgets appended, corrupt or blocked storage falls back to defaults. Saved on every change (Done only leaves edit mode).
- i18n vi/en for all new text. The old "Management" link grid and its dictionary keys were removed (the sidebar covers it; `quickLinks` widget lists the same `navigationFor` items).

## Migrations / permissions / API

None. No change to `apps/api`, `packages/database`, `packages/contracts`, permission rules or routes. Widgets only use existing endpoints (today board, POS board, payment anomalies, leave, attendance, notifications).

## Tests run

- `@lucy-spa/ui`: 199/199 (4 new: Card, Stat, bare grid). `apps/web` targeted: dashboard lib (26: layout per permission set, persistence round trip, unknown ids, equal-length comparison incl. leap day, summaries, shared store dedupe/refresh) + dashboard screen render (5) + screens, nav-groups, permissions, access suites: 57/57.
- Typecheck ui + web, eslint 0 warnings, prettier, boundaries: clean.

## UX gate

Screens (local harness, scripted API): owner and employee dashboards at 360, 768, 1440 light + 1440 dark; customize mode; comparison on. Images `.local/uxui-screens/7-*`.
Found and fixed: header controls stacked awkwardly (now one row, end-aligned); stat labels repeated the widget title (distinct labels); quick links ragged (full-width, start-aligned); notification rows blank in the harness (fixture used a non-registry type). Automatic audit clean at every width.
Left: stretched cards in a row leave white space under shorter content; customize mode shows the handle/move row and the size/hide row separately. Not verified on a real touch device.

## Open questions

- 12.5 mentions a branch/**date** selector; only the branch is built (the "today" endpoint has no date). "All my branches" for count widgets (14.3) is not built either: one branch at a time. OK for now?
- The POS board caps invoices at 200 per window; a full page shows a warning that totals may be low. A dedicated aggregate belongs to Phase 8.
- Grid breakpoint for 12 columns is 1280 px (see above), not 1024 px.
