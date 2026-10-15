# React best-practices audit: packages/ui/src (read-only)

Skill: vercel-react-best-practices (SKILL.md + AGENTS.md, all 8 sections applied). Scope: every non-test `*.ts`/`*.tsx` in
`packages/ui/src` (114 files). Bundle claims are checked against the existing production build (`apps/web/.next`, BUILD_ID
2026-10-16 01:24): the chunk files and the 120 per-route `*_client-reference-manifest.js` files.

## Summary

| rule id                                        | count              |
| ---------------------------------------------- | ------------------ |
| bundle-conditional                             | 2                  |
| bundle-barrel-imports                          | 1 (mitigated, LOW) |
| rendering-hydration-no-flicker                 | 5                  |
| client-event-listeners                         | 7                  |
| js-batch-dom-css (layout thrashing)            | 4                  |
| js-cache-function-results                      | 8                  |
| js-cache-storage                               | 1                  |
| js-hoist-regexp                                | 2                  |
| js-request-idle-callback                       | 1                  |
| rerender-memo                                  | 6                  |
| rerender-dependencies                          | 1                  |
| rerender-derived-state-no-effect               | 3                  |
| rerender-use-ref-transient-values              | 1                  |
| rerender-move-effect-to-event                  | 1                  |
| advanced-event-handler-refs                    | 1                  |
| rendering-activity                             | 1                  |
| rendering-hoist-jsx                            | 2                  |
| rendering-svg-precision                        | 1                  |
| 'use client' placement (task item, no rule id) | 1                  |
| **total**                                      | **49**             |

No findings for: async-_, server-_ (the kit has no data fetching or server actions), client-swr-dedup,
client-passive-event-listeners (every `scroll` listener that matters is passive or is a non-cancelable `scroll`; React's root
touch listeners are passive), client-localstorage-schema (storage reads are wrapped in try/catch and minimal), rendering-conditional-render
(every conditional uses a ternary), rendering-script-defer-async (the only script is the intended inline pre-paint theme script),
rerender-no-inline-components (none; `PlainLink` and `women()`/`national()` factories are module level), context value churn
(toast memoizes its API; Card, heading-level and SelectIconScope pass primitives).

## Top 10 by impact

1. `packages/ui/src/season-site-fx.tsx:13-17` - every season kit's full art (header rails, corners, scenes, plus `season-scene.tsx`
   for a 6-line `safeImageUrl`) is statically imported by the client particle layer. Build: chunk `3_8okod76evoq.js` = 123 KB raw /
   29 KB gzip, listed in 31 public/member route manifests, loaded on every customer page whenever a season with particles is on;
   only one 10-line `Particle` glyph and `motion` flag are used. (HIGH)
2. `packages/ui/src/app-shell.tsx:99` and `:227-235` - sidebar collapsed state and open groups are read from localStorage in
   post-hydration effects: every full load of every staff page draws the expanded sidebar / default groups, then jumps. (MEDIUM)
3. `packages/ui/src/contact-fab.tsx:99-181` - on every public page: `findScroller()` (querySelector + getComputedStyle) per scroll
   event, a second scroll subscription that runs a rAF `sync` (querySelector + setProperty, getComputedStyle when a bar exists) per
   scroll frame, and a subtree MutationObserver on the whole `.ls-site`. (MEDIUM)
4. `packages/ui/src/motion-gate.tsx:21-39` - `data-ls-motion="reduced"` is set only after hydration. CSS covers
   `prefers-reduced-motion` itself (tokens.css:307/1262), but data-saver, low-memory and `ls-fx=off` visitors get the brand-band
   marquee, hero motion and view transitions until JS runs; the `ls-fx` cookie is readable by the existing pre-paint script. (MEDIUM)
5. `packages/ui/src/sortable.tsx:3-21` - `@dnd-kit/*` is imported statically; the staff dashboard (`workforce/(app)` page) loads
   chunk `39xvz6fsj6o4j.js` (16 KB gzip) on every visit although `disabled` (not editing) never uses it. (MEDIUM-LOW)
6. `packages/ui/src/popover.tsx:123-156` - while open, every scroll (capture, any scroller) and resize runs `update()`: anchor
   `getBoundingClientRect`, `offsetWidth/Height`, a probe element appended/measured/removed (`containingOrigin`, :50-64), then
   `setStyle` (a React render) - unthrottled, per event. (MEDIUM-LOW)
7. `packages/ui/src/charts.tsx:97-103` + `packages/ui/src/chart-core.ts:129` - each pointer move to a new index re-renders the whole
   SVG (grid, ticks, paths, markers, texture defs); BarChart also re-runs `formatX` per category per render (`:393`), and `formatX`
   constructs a new `Intl.DateTimeFormat` per call (NumberFormat is cached at :41-50, DateTimeFormat is not). (MEDIUM-LOW)
8. `packages/ui/src/date-range-picker.tsx:287-341` + `packages/ui/src/date-range-core.ts:174,186,196` - each render builds ~60-80
   `Intl.DateTimeFormat` objects (`formatDay(..., 'long')` per day button, `formatWeekday` x7 per month, `formatMonth`), and the
   panel re-renders on every day hover (`:330-331`). (MEDIUM-LOW)
9. `packages/ui/src/reveal.tsx:45-54` - when GSAP resolves, each Reveal's continuation reads layout (`belowTheFold`:
   getComputedStyle + 2 x getBoundingClientRect) then writes `dataset.reveal`; N reveals on a page = N forced reflows in one
   task. (MEDIUM-LOW)
10. `packages/ui/src/data-table.tsx:171-180` - `sortByKey`/`ordered` memos depend on `columns` identity; 126 callers build
    `columns` inline per render (grep: 126 in-component definitions; opened: `apps/web/src/components/customer/screens/bookings.tsx:140`, `invoices.tsx:89`, `loyalty.tsx:281`), so client-mode tables re-sort
    the whole loaded list on every parent render. (LOW-MEDIUM)

## Barrel verdict (bundle-barrel-imports)

`packages/ui/src/index.tsx:42-407` re-exports ~120 modules (charts, dnd-kit, season art, GSAP wrapper). Mitigated in production:
`packages/ui/package.json:24-26` declares `sideEffects: ["**/*.css"]`, the package is ESM source, and `apps/web/next.config.ts:17`
has `transpilePackages: ['@lucy-spa/ui']`. Verified in the build: the chart/d3 chunk `065vltn0b-zej.js` (15 KB gz) is only in the 9
`workforce/(app)/reports/*` manifests; the dnd chunk only in `workforce/(app)` (dashboard) and `workforce/(app)/website`; the GSAP
chunk `2dzam5fz7e2_9.js` (27 KB gz) is in no route manifest (dynamic import only). Residual cost is dev/HMR and server compile
(the whole barrel graph, incl. ~176 KB of season-art source, is parsed per importing module). `optimizePackageImports` is
experimental per `node_modules/next/dist/docs/.../optimizePackageImports.md`; untested for a workspace package. (LOW)

## Findings by file

### packages/ui/src/index.tsx

- packages/ui/src/index.tsx:42-407 - [bundle-barrel-imports] see verdict above; production tree-shaking works, dev/compile pays for the whole graph (LOW)

### packages/ui/src/season-site-fx.tsx

- packages/ui/src/season-site-fx.tsx:13-17 - [bundle-conditional] static imports of `season-art-celebration`, `-christmas`, `-tet`, `season-kits` (all 7 other kits) and `season-scene` pull the full art set into the client chunk (123 KB raw / 29 KB gz, chunk `3_8okod76evoq.js`, which also contains `ls-art-tint-image`/`ls-art-lantern` from season-scene). Fix: a per-kit `() => import(...)` map of particle glyphs only, and move `safeImageUrl` to a tiny pure module (HIGH)
- packages/ui/src/season-site-fx.tsx:137-182 + :41-85 - [js-request-idle-callback] `collectKeepouts` walks every text node with `getClientRects` and every control with `getBoundingClientRect`; it runs after paint and again 150 ms after any resize, font load or page mutation; schedule it with `requestIdleCallback` (MEDIUM-LOW)
- packages/ui/src/season-site-fx.tsx:207-241 - [rerender-memo] the whole particle list (up to 120 spans + SVG glyphs) re-renders on each geometry/mask change; the list only depends on `count`/`kit`/`sprite`, memoize it apart from the layer style (LOW)
- packages/ui/src/season-site-fx.tsx:130-135 - [client-event-listeners] one `visibilitychange` listener per instance (same pattern as season-particles); share one store (LOW)

### packages/ui/src/app-shell.tsx

- packages/ui/src/app-shell.tsx:99 - [rendering-hydration-no-flicker] `useEffect(() => setCollapsed(readSidebarCollapsed()), [])`: a collapsed sidebar renders expanded on every full load, then collapses (content width jumps). Use a cookie read on the server, or an inline script setting `data-rail` before paint (MEDIUM)
- packages/ui/src/app-shell.tsx:227-235 - [rendering-hydration-no-flicker] stored open groups applied after hydration: groups open/close (and the sliding pill moves) after first paint (MEDIUM-LOW)
- packages/ui/src/app-shell.tsx:103 - [rerender-derived-state-no-effect] `useEffect(() => setOpen(false), [phone, tablet])` resets state from a derived value in an effect (extra render; runs on mount) (LOW)
- packages/ui/src/app-shell.tsx:245-247 - [rerender-move-effect-to-event] storage write as an effect on `stored`; the only user change is `toggle` (:249), write there (LOW)
- packages/ui/src/app-shell.tsx:96 - [rerender-memo] `arrangeNav(nav)` and the `navigation` element/SidebarNav re-render on every shell state change (menu open, media change) (LOW)

### packages/ui/src/contact-fab.tsx

- packages/ui/src/contact-fab.tsx:105-106 - [js-batch-dom-css] `scrollPosition(findScroller())` per scroll event: querySelector + `getComputedStyle` (style recalc) on every scroll of every public page; cache the scroller from `onPageScroll` (MEDIUM)
- packages/ui/src/contact-fab.tsx:163-173 - [client-event-listeners] a second page-scroll subscription (`onPageScroll(schedule)`) plus `resize`, and a `MutationObserver` over the whole `.ls-site` subtree (`childList, subtree`), each scheduling `sync` (querySelector, setProperty, getComputedStyle/getBoundingClientRect when a bar exists) per frame, even on pages that never have `.ls-action-bar` (MEDIUM)
- packages/ui/src/contact-fab.tsx:125 + :172 - [client-event-listeners] two `onPageScroll` registrations (4 listeners) in one component; merge (LOW)

### packages/ui/src/motion-gate.tsx

- packages/ui/src/motion-gate.tsx:21-39 - [rendering-hydration-no-flicker] the `reduced` mark lands after hydration; for data-saver, low-memory and `ls-fx=off` visitors the CSS keyed on `html[data-ls-motion='reduced']` (pages-v2.css:256-283, site.css:191-194/1583-1588/1697) does not apply at first paint. Set it in the inline pre-paint script (cookie + `navigator.connection.saveData` + `deviceMemory`) (MEDIUM)

### packages/ui/src/motion.ts

- ✓ pass: GSAP + ScrollTrigger load by one `import()` after rAF+timeout (:111-120), memoized (:132-144); `gsap.context(...).revert()` on cleanup and on motion-off (:196-215); one shared, ref-counted MutationObserver (:79-98); no per-frame React state (CountUp writes `textContent`). Minor: `makeKit.read` (:152) calls `getComputedStyle` per token call (3 per Reveal enter) (LOW, not counted)

### packages/ui/src/sortable.tsx

- packages/ui/src/sortable.tsx:3-21 - [bundle-conditional] `@dnd-kit/core`/`sortable`/`utilities` statically imported; the `disabled` branch (:185-197) needs none of it, yet the staff dashboard loads chunk `39xvz6fsj6o4j.js` (16 KB gz) every visit. Split the editable collection into its own module and load it with `next/dynamic`/`import()` when editing starts (MEDIUM-LOW)

### packages/ui/src/popover.tsx

- packages/ui/src/popover.tsx:125-151 - [js-batch-dom-css] per scroll/resize event: reads (`getBoundingClientRect`, `offsetWidth/Height`), then `containingOrigin` (:50-64) appends a probe (write), measures it (forced layout), removes it; no rAF coalescing (MEDIUM-LOW)
- packages/ui/src/popover.tsx:140 - [rerender-use-ref-transient-values] position goes through `setStyle` (React render of the panel and its children) on every scroll event; write `top/left` to the panel ref directly (MEDIUM-LOW)
- packages/ui/src/popover.tsx:179 - [advanced-event-handler-refs] effect depends on `onClose`; callers pass inline closures (faceted-filter.tsx:93, multi-value.tsx:49, date-range-picker.tsx:142), so the document `pointerdown`/`keydown` listeners are removed and re-added on every render while open; use `useEffectEvent` (LOW)

### packages/ui/src/charts.tsx

- packages/ui/src/charts.tsx:97-103 - [rerender-memo] pointer move -> `setActive` -> the full SVG re-renders (grid, ticks, all paths, up to 14 markers per series, TextureDefs); geometry is memoized but the static layers are not; memoize the static `<g>` and only re-render crosshair/marker/tooltip (MEDIUM-LOW)
- packages/ui/src/charts.tsx:393 - [js-cache-function-results] `categoryLabels = prepared.xs.map(formatX)` recomputed every render including each pointer move; memoize on `prepared`/locale (LOW-MEDIUM)
- packages/ui/src/charts.tsx:286-298 - [js-cache-function-results] LineChart calls `formatX` per shown label per render (LOW)
- packages/ui/src/charts.tsx:140-165 - [rendering-hoist-jsx] `TextureDefs` rebuilds the `angles` array and six patterns every render; it only depends on `uid` (LOW)
- note: path precision is fine (`barPath` rounds to 2 decimals at chart-geometry.ts:116/275; d3-shape 3.2.0 + d3-path 3.1.0 default to 3 digits)

### packages/ui/src/chart-core.ts

- packages/ui/src/chart-core.ts:129 - [js-cache-function-results] `new Intl.DateTimeFormat(...)` per `formatX` call; cache it like `numberFormat` (:41-50) (MEDIUM-LOW)

### packages/ui/src/date-range-picker.tsx

- packages/ui/src/date-range-picker.tsx:287-341 - [js-cache-function-results] per render: `formatDay(day.date, locale, 'long')` per day button (~60), `formatWeekday` x7 per month, `formatMonth` per month, each building a new `Intl.DateTimeFormat` (MEDIUM-LOW)
- packages/ui/src/date-range-picker.tsx:330-331 - [rerender-memo] `setHover` on every day hover re-renders both months (~84 cells + the formatters above); memoize a day cell component on its `inRange/isEdge/disabled/focused` booleans (MEDIUM-LOW)

### packages/ui/src/date-range-core.ts

- packages/ui/src/date-range-core.ts:174, :186, :196 - [js-cache-function-results] `formatDay`, `formatMonth`, `formatWeekday` construct `Intl.DateTimeFormat` per call; cache per locale+style in a module Map (MEDIUM-LOW)

### packages/ui/src/reveal.tsx

- packages/ui/src/reveal.tsx:53-54 - [js-batch-dom-css] inside the GSAP continuation each instance reads layout (`belowTheFold`: getComputedStyle + 2 x getBoundingClientRect, :33-43) then writes `element.dataset.reveal = 'hidden'`; all Reveals resolve in the same task, so the page reflows once per Reveal; batch the reads (or let one shared pass decide all elements) (MEDIUM-LOW)

### packages/ui/src/data-table.tsx

- packages/ui/src/data-table.tsx:171-180 - [rerender-dependencies] `sortByKey` and `ordered` depend on `columns` identity; a grep finds 126 in-component `const columns = [` definitions in apps/web/src (1 `useMemo`); the three seen in context (apps/web/src/components/customer/screens/bookings.tsx:140, invoices.tsx:89, loyalty.tsx:281) rebuild the array inside the component on every render, and bookings.tsx:139 pages in the client, so `mode="client"` sorts the whole list every render; key on a column-key/sortValue signature or keep sortValues in a ref (LOW-MEDIUM)
- packages/ui/src/data-table.tsx:307 + :339 - [js-cache-function-results] `column.cell(row)` runs twice for a `mobileTitle` column (once for `title`, once in `renderCell`) (LOW)
- packages/ui/src/data-table.tsx:289-313 - [rerender-memo] rows are inline JSX; a `selectedKey` or parent change re-renders every row and every cell renderer; a memoized row is worth it only with stable `columns` (LOW)
- packages/ui/src/data-table.tsx:178 - [js-cache-function-results] server mode copies `rows` (`[...rows]`) on every change; use `rows` directly (LOW)
- note: rendering-content-visibility does not apply: unpaged lists are capped at `MAX_UNPAGED_ROWS = 20` (:88, :185-192); rows are keyed by `rowKey` (:290-293)

### packages/ui/src/use-media-query.ts

- packages/ui/src/use-media-query.ts:14-19 - [client-event-listeners] `subscribe` is a new function each render, so React unsubscribes and resubscribes (new `matchMedia` + `addEventListener`) on every render of every caller (AppShell x2, DateRangePicker x2, ListToolbar on each search keystroke, SeasonParticles x2, Slider, Sortable, FormDrawer); `getSnapshot` also creates a MediaQueryList per call. Cache one MediaQueryList per query in a module Map and memoize `subscribe` per query (LOW-MEDIUM)

### packages/ui/src/use-theme.ts

- packages/ui/src/use-theme.ts:14-23 + :39-40 - [client-event-listeners] each subscription creates its own MutationObserver on `<html>`, and `useTheme` subscribes twice, so every ThemeToggle/ThemeCycle holds 2 observers; motion.ts:79-98 already shows the shared ref-counted pattern (LOW)
- packages/ui/src/use-theme.ts:25 - [js-cache-storage] `readPreference` parses `document.cookie` on every getSnapshot (each render and each mutation) (LOW)

### packages/ui/src/theme-cycle.tsx

- packages/ui/src/theme-cycle.tsx:36-47 - [rendering-hydration-no-flicker] the server snapshot is `auto`, so the public header's theme button shows the clock icon, then flips to sun/moon after hydration for every visitor who chose Light/Dark; drive the icon from an attribute the pre-paint script sets (e.g. `data-theme-pref` on `<html>`) and CSS (LOW-MEDIUM)

### packages/ui/src/theme-toggle.tsx

- packages/ui/src/theme-toggle.tsx:37 - [rendering-hydration-no-flicker] same `auto` server snapshot: the checked radio moves after hydration (staff menu, mostly inside a closed popover) (LOW)

### packages/ui/src/theme-core.ts

- packages/ui/src/theme-core.ts:16 - [js-hoist-regexp] `new RegExp(...)` built on every `parseThemeCookie` call (called from getSnapshot); hoist to module scope (LOW)
- ✓ pre-paint `themeInitScript` (:72) is the correct rendering-hydration-no-flicker pattern

### packages/ui/src/theme-script.tsx

- packages/ui/src/theme-script.tsx:22 - [client-event-listeners] `startThemeSync` adds a second `visibilitychange` listener and boundary timer next to the inline script's own (which are never removed), so both run for the page's life (LOW)

### packages/ui/src/season-fx-core.ts

- packages/ui/src/season-fx-core.ts:13 - [js-hoist-regexp] `parseFxCookie` builds a RegExp per call; it runs in `useSeasonFx` getSnapshot on every render of MotionGate, particles and switches, and in `motionState()` (LOW)

### packages/ui/src/season-particles.tsx

- packages/ui/src/season-particles.tsx:62 - [rendering-hoist-jsx] `starPoints(8, 7, 7.4, 3.1)` (10 sin/cos + toFixed) recomputed per lantern particle per render; the glyph is static per kind, hoist it (LOW)
- packages/ui/src/season-particles.tsx:102-107 - [client-event-listeners] `visibilitychange` listener per SeasonParticles instance (LOW)

### packages/ui/src/tabs.tsx

- packages/ui/src/tabs.tsx:103-113 - [rendering-activity] only the selected panel is mounted; switching tabs unmounts the others (state lost, their effects/fetches re-run on return); `<Activity mode="hidden">` keeps them (LOW-MEDIUM, design choice)

### packages/ui/src/form.tsx

- packages/ui/src/form.tsx:241-243 - [rerender-derived-state-no-effect] DateTextInput copies `value` into `text` in an effect (extra render per external change); adjust during render with a previous-value ref (LOW)
- packages/ui/src/form.tsx:770-772 - [rerender-derived-state-no-effect] SearchInput syncs controlled `value` to `text` in an effect (LOW)
- packages/ui/src/form.tsx:576-594 - [rerender-memo] Combobox: `onMouseEnter` -> `setActive` re-renders the whole option list on every hover; no cap on rendered options (LOW)

### packages/ui/src/form-core.ts

- packages/ui/src/form-core.ts:47-51 - [js-cache-function-results] `filterOptions` NFD-normalizes every option label on every keystroke; normalize once per `options` (LOW)

### packages/ui/src/sliding-pill.ts

- packages/ui/src/sliding-pill.ts:78-82 - [js-batch-dom-css] `setAttribute/removeAttribute('data-under')` on every link, then `offsetLeft/Top/Width/Height` reads: forced style+layout per `place()`, which also runs on pointer hover in `follow` menus (:129-135); read the box first, then write (LOW)

### packages/ui/src/use-url-state.ts

- ✓ pass: stable module-level `subscribe`, state memoized on `search`. The `''` server snapshot is benign in practice: the opened caller (apps/web/src/components/workforce/screens/ai-drafts.tsx:87, :379) is a client-fetch list that shows a skeleton first anyway

### packages/ui/src/brand-icons.tsx

- packages/ui/src/brand-icons.tsx:9-18 - [rendering-svg-precision] Simple Icons paths keep 3-4 decimals on a 24-unit grid drawn at 20-32 px (instagram/zalo especially); 2 decimals is invisible and trims client JS (ContactFab) and every footer's HTML (LOW)

### 'use client' placement (task item)

- packages/ui/src/feedback.tsx:1, packages/ui/src/card.tsx:1, packages/ui/src/kpi-card.tsx:1, packages/ui/src/image-frame.tsx:1, packages/ui/src/button.tsx:128-150 - modules marked client although most exports are stateless: Badge/Skeleton/EmptyState/LoadingState/ProgressBar (feedback), Card/CardHeader (client only for the dev-only nested-card check, card.tsx:24-27), KpiCard, ImageFrame (only `FallbackImage` needs client), ButtonLink/VisuallyHidden. Server pages using them get client references and ship their code; small per component (LOW)

### Clean files (✓ pass)

- ✓ packages/ui/src/overlay.tsx - closed Dialog/Drawer render nothing; module-level scroll-lock counter; no listeners outside open state
- ✓ packages/ui/src/toast.tsx - provider API memoized (:59-66); ToastItem gets a stable `onDismiss`; children not re-rendered by toasts
- ✓ packages/ui/src/form-overlay.tsx - `initialFocus` memoized once; guard dialog mounted only while asking
- ✓ packages/ui/src/menu.tsx, packages/ui/src/actions.tsx - closed menus render no panel (Popover returns null)
- ✓ packages/ui/src/tooltip.tsx - CSS-only show/hide
- ✓ packages/ui/src/slider.tsx - first slide `eager` + `fetchPriority="high"`, rest lazy, fixed ratios; one timer
- ✓ packages/ui/src/site-header.tsx - IntersectionObserver sentinel instead of a scroll listener
- ✓ packages/ui/src/count-up.tsx, packages/ui/src/step-slide.ts - tweens write the DOM directly; cleanup reverts
- ✓ packages/ui/src/route-enter.tsx, packages/ui/src/route-fade.tsx - no animation on first load; server-safe
- ✓ packages/ui/src/motion-core.ts, packages/ui/src/motion-pause.tsx, packages/ui/src/reveal-core.ts, packages/ui/src/scroller.ts (scroll listeners passive)
- ✓ packages/ui/src/chart-parts.tsx, packages/ui/src/chart-geometry.ts, packages/ui/src/stat.tsx (KpiCard's Sparkline pulls charts.tsx + d3, but the build shows d3 only on the reports routes)
- ✓ packages/ui/src/pagination.tsx, packages/ui/src/list-toolbar.tsx (apart from use-media-query), packages/ui/src/faceted-filter.tsx, packages/ui/src/multi-value.tsx, packages/ui/src/segmented.tsx, packages/ui/src/accordion.tsx (`hidden`, keeps DOM), packages/ui/src/form-frame.tsx
- ✓ packages/ui/src/confirm-dialog.tsx, packages/ui/src/image-uploader.tsx, packages/ui/src/image-fallback.tsx, packages/ui/src/media-grid.tsx (callers page at MEDIA_PAGE_SIZE, so no content-visibility needed), packages/ui/src/promo.tsx
- ✓ packages/ui/src/heading-level.tsx, packages/ui/src/page.tsx, packages/ui/src/layout.tsx, packages/ui/src/site.tsx, packages/ui/src/site-nav.tsx, packages/ui/src/site-link.tsx, packages/ui/src/info-page.tsx, packages/ui/src/info-table.tsx, packages/ui/src/footer-blocks.tsx, packages/ui/src/auth-layout.tsx, packages/ui/src/choice-card.tsx, packages/ui/src/selection-bar.tsx, packages/ui/src/description-list.tsx, packages/ui/src/icon-picker.tsx, packages/ui/src/schedule-strip.tsx, packages/ui/src/spinner.tsx, packages/ui/src/icons.tsx (server-safe, static paths)
- ✓ packages/ui/src/season-live-preview.tsx, packages/ui/src/season-art-kit.tsx (`n()` rounds to 2 decimals), packages/ui/src/season-kits.tsx (itself fine; the cost is who imports it), packages/ui/src/season-scene.tsx (server component; skimmed)
- ✓ pure modules: paging-core.ts (module-level Collator; sortRows copies before sort), url-state-core.ts, image-core.ts, date-text-core.ts, form-core.ts (apart from the note), toast-core.ts, sortable-core.ts, slider-core.ts, confirm-core.ts, menu-core.ts, button-class.ts, cx.ts, shell-core.ts (storage in try/catch)
- skimmed only (grep for hooks, client code, long decimals: none found, server-rendered): season-art-autumn/celebration/christmas/lion/national/shapes/tet/valentine/vulan/women.tsx, season-ornaments.tsx, season-frame.tsx, season-preview.tsx, season-slot-row.tsx, season-css.ts
- not audited: css-rules-test-helper.ts, dom-harness.ts (test helpers)
