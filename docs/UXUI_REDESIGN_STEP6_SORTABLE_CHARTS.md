# UX/UI Redesign Step 6: Sortable primitives + chart kit

Status: IMPLEMENTED, awaiting Owner review. Not committed, not deployed. Contract: `UXUI_REDESIGN_DESIGN.md` 2, 6.5, 9.7, 9.8, 14.4, 21.

## What changed (all in `packages/ui`; no screen uses the kit yet, Step 7 does)

- **Dependencies** (approved Q-D1): `@dnd-kit/core`, `@dnd-kit/sortable`, `@dnd-kit/utilities`, `d3-scale`, `d3-shape` (+ `@types/d3-*` dev). `pnpm-lock.yaml` +83 lines.
- **`SortableList` / `SortableGrid`** (+ `sortable-core`): drag by handle (mouse after 6 px, touch after a 250 ms press, keyboard Space / arrows / Space, Escape cancels). Every item also has Move earlier / later buttons (edge buttons are `aria-disabled`, focus is restored after a move). Live-region announcements (lifted / moved / dropped / cancelled), all text via `labels`. Emits `onReorder(ids)` only; `disabled` draws no handles (outside edit mode). Reduced motion turns the item animation off; its 200 ms equals `--ls-dur-base` (tested).
- **Chart kit**: `LineChart` (multi-series, optional area, previous period dashed and neutral), `BarChart` (vertical/horizontal, grouped/stacked, 4 px rounded data end only, 2 px surface gaps), `DonutChart` (pie with `innerRadius=0`, max 6 slices then neutral "Other"), `Sparkline`, `KpiCard` (arrow + signed % + words; blue/orange unless `goodDirection`), `ChartFrame` (title, subtitle, actions, loading/empty/error at fixed height), `ChartLegend`, `ChartTooltip`, `ChartTable`, `ComparisonToggle`. Every chart has "Show as table", a single keyboard tab stop (arrows / Home / End / Escape) with an `aria-live` readout, texture overlays and per-series dashes for forced colors / print. Text uses text tokens, marks use `--ls-chart-*` through `ls-chart-s{slot}`.
- **`DateRangePicker`**: presets (Today, Yesterday, 7/30 days, This/Last month, Custom), keyboard calendar grid (arrows, PageUp/Down, Home/End), max range (default 366), Apply/Cancel. Two months from 1024 px, one month on tablets, full-height sheet on phones. Dates are branch business dates: the caller passes `today`; nothing reads the clock or a time zone. `comparisonRange(range, mode)` gives the previous-period / last-year range.
- Logic is DOM-free and tested: `chart-core` (formats, series preparation, previous aligned by index), `chart-geometry` (d3 geometry), `date-range-core`. New icons `table`, `bar-chart`, `minus`; token `--ls-series`; `Button` now passes `aria-disabled` through.

## Migrations / permissions / API

None. No change to `apps/api`, `packages/database`, `packages/contracts`, permissions or routes. No demo route was added (the review harness is machine-local in `.local/`).

## Tests run

- `@lucy-spa/ui`: 195/195 (73 new): formats (VND, %, minutes, vi/en), series and previous-period alignment, 7th series refused, donut folding, delta words, label thinning; geometry (bar rounding only at the data end, stacked totals, gaps in lines); date arithmetic (leap day, month ends, comparison ranges, calendar keys); **palette validator re-run against `tokens.css`** (light and dark: lightness band, chroma, protan/deutan and normal-vision separation, 3:1 contrast, fixed order, no gold); jsdom: keyboard drag (lift, move, drop, cancel), Move buttons + focus, chart keyboard/tooltip/table twin, KPI, frame states, date picker flows (preset, custom range, max length, roving tab stop, phone sheet).
- Typecheck ui + web, eslint 0 warnings, prettier, boundaries: clean. Web tests not run (no web code touched).

## UX gate

Screens (local harness `.local/uxui-harness/kit-entry.tsx`): all charts, KPI cards, frame states, sortable grid/list at 360, 768, 1440 light and 1440 dark; open states: date picker (360 sheet, 768, 1440 light and dark), chart tooltips, table view.
Found and fixed: cards in a grid stretched their content (`align-content: start`); KPI sparkline squeezed the value (now on the as-of row); table switch wrapped to a stray left edge (now end-aligned); picker day cells were 35 px wide (one month below 1024 px, 7 x control-height minimum), popover clipped its buttons (max height), uneven month rows, phone presets as a 3-column grid.
Automatic audit clean at every width. Left as is: horizontal bar category labels truncate after about 22 characters (full name in `<title>`); forced-colors and print textures are implemented but not verified in a real forced-colors session.
Images: `.local/uxui-screens/` (`6-*`). Not verified on a real touch device (drag needs a phone check).

## Open questions

- `Card`, `Avatar`, `Stat` (9.4) still do not exist; `ChartFrame` and `KpiCard` carry their own surface. Step 7 (dashboard) needs a shared `Card`: build it there?
- The previous period is aligned by index, so a caller must load exactly as many days as the current range (the loader's job in Step 7).
