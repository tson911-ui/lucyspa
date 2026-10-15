# React best practices audit: staff app (workforce)

Skill: vercel-react-best-practices (AGENTS.md read in full). Scope: `apps/web/src/app/[locale]/workforce/**` and
`apps/web/src/components/workforce/**`, plus the `lib/workforce` and `i18n` helpers they call on the hot path. Tests skipped,
`packages/ui` left to the other agent. Read-only: no source file changed. Every finding below was opened and read.

Method: all 94 route/layout/loading/template files read (each page is a 6-line wrapper around one client screen; no server
fetches anywhere). POS files read in full: `pos*.tsx`, `walk-in*.tsx`, `booking-board*.tsx`, `cash*.tsx`. The rest of
`components/workforce` (about 67k lines) audited by grep per rule signature, then opening every hit.
Build evidence: `.next` from 2026-10-16 01:24 (Turbopack), route JS measured from `page_client-reference-manifest.js`.

## Summary by rule

| Rule id                          | Count  | Notes                                                                                        |
| -------------------------------- | ------ | -------------------------------------------------------------------------------------------- |
| async-parallel                   | 6      | session bootstrap, child fetches after parent, sequential POSTs/reloads                      |
| async-suspense-boundaries        | 1      | client session guard blocks the whole staff subtree                                          |
| bundle-conditional               | 1      | both locales of every dictionary shipped (measured)                                          |
| bundle-preload                   | 2      | forced full-route prefetch on row links; dashboard widget chunks start late                  |
| bundle-dynamic-imports           | 1      | POS board sale dialogs                                                                       |
| bundle-barrel-imports            | 0      | `@lucy-spa/ui` is `transpilePackages` + `sideEffects: css`, tree-shaken; not filed           |
| client-swr-dedup                 | 4      | `useResource` has no cache; `/branches` and names refetched per screen                       |
| client-event-listeners           | 1      | duplicate focus/visibility listeners                                                         |
| client-passive-event-listeners   | 0      | no scroll/touch/wheel listeners in staff code                                                |
| rerender-defer-reads             | 1      | `usePathname` read only inside a mount effect                                                |
| rerender-memo                    | 10     | zero `memo()` in components/workforce, React Compiler off                                    |
| rerender-derived-state-no-effect | 8      | first-branch effects, mirror-state effects                                                   |
| rerender-move-effect-to-event    | 2      | resets done in effects instead of handlers                                                   |
| rerender-dependencies            | 6      | polling effects depend on a new object every render                                          |
| rerender-functional-setstate     | 2      | `setX({ ...x, field })` in form dialogs                                                      |
| rerender-lazy-state-init         | 1      | `useRef(crypto.randomUUID())` in 10 files                                                    |
| rerender-use-deferred-value      | 1      | discount product search over thousands of rows per keystroke                                 |
| rerender-no-inline-components    | 0      | no component defined inside a component                                                      |
| rendering-hydration-no-flicker   | 1      | dashboard layout read after mount                                                            |
| rendering-content-visibility     | 1      | booking-board queue cards                                                                    |
| rendering-usetransition-loading  | 1      | POS product search (mutation submits not filed)                                              |
| rendering-conditional-render     | 0      | every `&&` left side is boolean or node; ternaries everywhere                                |
| js-cache-function-results        | 7      | `new Intl.DateTimeFormat` per call (117 call sites), `matchMedia` per link                   |
| js-index-maps                    | 6      | `.find`/`.filter` inside loops                                                               |
| js-combine-iterations            | 1      | supplier import category counts                                                              |
| js-set-map-lookups               | 2      | `.includes`/`.some` membership in large lists                                                |
| js-min-max-loop                  | 1      | sort to take the last date                                                                   |
| js-tosorted-immutable            | 0      | every `.sort` runs on a spread/filter/map copy; no prop or state mutated                     |
| js-hoist-regexp                  | 0      | no `new RegExp` in staff code; literals only, `normalizeSearch` regexes already module-level |
| js-cache-storage                 | 0      | only `dashboard.tsx` touches localStorage, once per mount                                    |
| **Total**                        | **67** |                                                                                              |

## POS vs admin

| Area                                                                                                      | Findings | Notes                                             |
| --------------------------------------------------------------------------------------------------------- | -------- | ------------------------------------------------- |
| Shared layer (session, shell, link, i18n, format, `useResource`)                                          | 13       | hits every staff page; the counter pays all of it |
| POS / counter (`pos*`, `walk-in*`, `booking-board*`, `cash*`, `lib/workforce/pos.ts`, `booking-board.ts`) | 30       |                                                   |
| Admin (dashboard, AI, website, supplier import, discounts, inventory, services, reports)                  | 24       |                                                   |

Typing and scanning at the counter are mostly safe today: `SearchInput` debounces 300 ms, the POS product Combobox searches the
server 250 ms after the last key, and no raw-keystroke filter of a large list exists on a POS screen. What lags is the
re-render fan-out: no component in `components/workforce` is memoized and the React Compiler is not enabled
(`apps/web/next.config.ts`, `apps/web/package.json`), so a total, a dialog opening or a 30 s poll re-renders the whole screen.

## Top 15 by impact

1. `apps/web/src/app/[locale]/workforce/(app)/layout.tsx:1` + `components/workforce/session.tsx:150-214` [async-suspense-boundaries] The `'use client'` guard resolves the session in an effect and renders nothing of the screen until it answers, so on a cold POS load the chain is JS, `/auth/context`, `/auth/me`, screen mount, `/branches`, a branch-picking render, `/pos/.../board`: 4 serial API round trips; until the session answers the user sees only the guard's own skeleton (`session.tsx:178-184`) and nothing of the screen starts loading.
2. `apps/web/src/lib/workforce/workflows.ts:168-173` (called from `session.tsx:152`) [async-parallel] `api.context()` then `/auth/me` run in sequence; a GET does not wait for the CSRF context (`lib/api/client.ts:134,153,220` vs `:276-279`), so both can start together (caveat: an anonymous 401 from `/auth/me` reaches `onUnauthenticated` and must not trigger the redirect).
3. `apps/web/src/i18n/workforce.ts:17,2831,5651` via `app/[locale]/workforce/layout.tsx:3` and `components/workforce/session.tsx:17` [bundle-conditional] vi and en ship together: chunk `0d28i3tkoiu7y.js` is 240 KB / 71 KB gz, 46 % of the 154 KB gz of route JS the POS page loads. Same shape in every feature dictionary (`comboDictionary`, `productSaleDictionary`, `organizationDictionary`, ...: 991 KB of i18n source).
4. `apps/web/src/lib/workforce/format.ts:27-60`, `lib/workforce/pos.ts:50`, `lib/workforce/booking-board.ts:39` [js-cache-function-results] A new `Intl.DateTimeFormat` (with time zone) per call; 117 call sites; the POS board formats every row and the booking board 3-5 times per booking row, on every render and every 30 s refresh.
5. `components/workforce/screens/pos-invoice.tsx:100-776` [rerender-memo] One component owns `invoice`, `overlay`, `working`, `feedback`; each `command()` causes at least 3 full renders of every card, all column builders (`lineColumnsOf` :327, `comboColumnsOf` :362) and 4+ DataTables. With no `memo()` anywhere and the compiler off, the totals do re-render the whole tree.
6. `components/workforce/link.tsx:22-24` [bundle-preload] `prefetch` is forced to `true`, which in Next 16 fetches the full route per distinct href when it enters the viewport; with `(app)/loading.tsx` present, `auto` already gives instant loading states. 24 per-row links (`pos.tsx:190` alone = 20 `/pos/[id]` prefetches per board page).
7. `components/workforce/screens/walk-in.tsx:224,365-380,401-407` [rerender-memo] Every keystroke in a guest name or phone re-renders the intake form, rebuilds `serviceById` and re-maps the whole service list into options once per service line.
8. `components/workforce/session.tsx:147,210-214` [rerender-defer-reads] `usePathname()` is read only inside the mount effect, so the guard re-renders on every navigation, and its inline `AccountContext` value `{ account, signOut }` then re-renders every `useAccount` consumer (shell and screen).
9. `components/workforce/screens/booking-board.tsx:248,303-345` [rerender-memo] A new `time` closure and inline handlers each render: any overlay, message or busy change, and every 30 s poll, rebuilds all four sections and their column arrays.
10. `components/workforce/ui.tsx:175-200` + `components/workforce/data.ts:15-21` [client-swr-dedup] `useResource` has no cache or dedupe; `useBranches` runs in 18 screens and refetches `/branches` on every page mount (the template remounts pages), twice on the attendance page. The dashboard's `SharedResources` store already solves this but only on the dashboard.
11. `components/workforce/screens/pos-invoice.tsx:589-590` + `screens/pay-invoice-cards.tsx:47-49,227-229` [async-parallel] Tips and earnings start only after the invoice arrives and the cards mount, though they need only `id`: one extra round trip on every paid invoice.
12. `components/workforce/screens/dashboard.tsx:58-61` [rendering-hydration-no-flicker] The saved layout is read in an effect, so the staff landing page first mounts the default widgets (lazy chunks and fetches start) and then swaps; the dashboard is never server-rendered (it sits behind the client guard), so a lazy `useState` initializer is safe.
13. `components/workforce/screens/ai-drafts.tsx:121-125`, `ai-seo.tsx:116-120`, `ai-seo.tsx:392-396`, `ai-settings.tsx:89-93`, `ai-draft-detail.tsx:99-103` [rerender-dependencies] Polling intervals depend on the `useResource` result object, which is new every render, so the interval is torn down and restarted on each render (`supplier-source-scan.tsx:65-69` does it right with `const { reload } = loaded`).
14. `components/workforce/screens/discount-targets.tsx:155-171` [rerender-use-deferred-value] Combobox `onQueryChange` is not debounced; each keystroke scans a catalog of "thousands of products", running `normalizeSearch` (NFD) on every label and `form.productIds.includes` per row until 30 matches.
15. `components/workforce/screens/pos-dialogs.tsx:487-490,580` [async-parallel] The PayOS dialog fetches the tip offer only when opened and disables the submit button until it answers; the cashier waits a round trip at payment time. Start it when the invoice turns PENDING_PAYMENT or on hover/focus of the button.

## Findings by file

### Shared layer (both POS and admin)

- `apps/web/src/app/[locale]/workforce/(app)/layout.tsx:1-11` + `apps/web/src/components/workforce/session.tsx:150-214` - [async-suspense-boundaries] Client guard (`RequireWorkforce`) blocks the whole subtree on a session fetch in `useEffect`; screens cannot start their own fetches until it resolves. Resolve the account on the server in `workforce/layout.tsx` (cookies) or start the session promise at provider creation and render the shell while it resolves. (HIGH, every cold load)
- `apps/web/src/lib/workforce/workflows.ts:168-173` (call site `session.tsx:152`) - [async-parallel] `await api.context()` then `await api.get('/api/v1/auth/me')`; start both together (`lib/api/client.ts` waits for `context()` only before POST, upload and download, :134, :153, :220; a GET in `request` :276-279 does not). Keep the anonymous 401 from reaching the redirect handler. (HIGH, +1 RTT every cold load)
- `apps/web/src/i18n/workforce.ts:17,2831,5651` (imported by `app/[locale]/workforce/layout.tsx:3`, `components/workforce/session.tsx:17,92`) - [bundle-conditional] Both locales in one module; measured chunk `0d28i3tkoiu7y.js` 240 KB / 71 KB gz of the POS route's 154 KB gz. Split per locale and load only the active one (or pass only the active dictionary from the server layout). Same pattern in all feature dictionaries (`i18n/combo.ts:426`, `product-sale.ts:241`, `organization.ts:261`, `product-exchanges.ts:357`, ...). (HIGH)
- `apps/web/src/components/workforce/session.tsx:147,156` - [rerender-defer-reads] `usePathname()` only feeds the login redirect inside the mount effect; read `window.location.pathname` there instead so the guard does not re-render on every navigation. (MEDIUM)
- `apps/web/src/components/workforce/session.tsx:210-214` - [rerender-memo] `AccountContext.Provider value={{ account: state.account, signOut }}` is a new object each render; with the item above, every `useAccount` consumer re-renders on every navigation. `useMemo` the value. (MEDIUM)
- `apps/web/src/lib/workforce/format.ts:27-36,38-50,53-60` - [js-cache-function-results] `formatTime`, `formatDateTime`, `todayIn` construct `Intl.DateTimeFormat` per call; cache formatters in a module Map keyed by locale+zone. 117 call sites across staff screens. (MEDIUM)
- `apps/web/src/components/workforce/link.tsx:22-24` - [bundle-preload] `prefetch ?? mayPrefetch()` forces full-route prefetch for every link in view, including 24 per-row table links; use the default (`auto`) or hover/intent for row links, keep `true` for the sidebar. (MEDIUM)
- `apps/web/src/components/workforce/link.tsx:13` - [js-cache-function-results] `mayPrefetch()` calls `readMotionEnvironment()` (a `window.matchMedia` query) on every link render, per row and per sidebar item on each navigation; compute once per page load. (LOW)
- `apps/web/next.config.ts:13-17` + `apps/web/src/components/workforce/**` - [rerender-memo] No `memo()` in any staff component and `reactCompiler` not enabled; enabling the compiler is the single lever that would isolate totals, dialogs and polls across all screens. (MEDIUM)
- `apps/web/src/components/workforce/ui.tsx:175-200` + `components/workforce/data.ts:15-21` - [client-swr-dedup] `useResource` refetches on every mount with no cache or in-flight dedupe; `useBranches` is used by 18 screens and `/branches` is refetched on each page visit. Reuse the dashboard's `SharedResources` (or SWR) app-wide for reference data. (MEDIUM)
- `apps/web/src/components/workforce/data.ts:35-49` - [client-swr-dedup] `useEmployeeNames` walks up to 5 cursor pages serially on every mount of attendance/leave; tables render with the fallback label and names pop in late. Cache across screens. (LOW)
- `apps/web/src/components/workforce/shell.tsx:34,53` - [rerender-memo] `navigationFor(account)` and `sidebarGroups(...)` rebuilt on every shell render (each navigation); memo on `account`/`pathname`. (LOW)
- `apps/web/src/components/workforce/shell.tsx:143-159` + `components/workforce/dashboard/data.tsx:27-39` - [client-event-listeners] Two separate global `focus` + `visibilitychange` listener pairs (session watch, dashboard refresh); one shared subscription would serve both. (LOW)

### POS / counter

`apps/web/src/components/workforce/screens/pos.tsx`

- `pos.tsx:66-68` - [rerender-derived-state-no-effect] First branch chosen in an effect: one extra render and the board fetch starts a commit later; derive `branchId || allowed[0]?.id`. (LOW-MEDIUM)
- `pos.tsx:88-92` - [rerender-move-effect-to-event] Board/paging resets run in the load effect on every branch/date change; do them in the `onChange` handlers. (LOW)
- `pos.tsx:133-264` - [rerender-memo] Invoice filter and both column arrays rebuilt every render (every 30 s poll, every `opening` change), each row formatting through `boardStamp`. (LOW-MEDIUM)
- `pos.tsx:34-35,395-408` - [bundle-dynamic-imports] `ComboSaleDialog` and `ProductSaleDialog` are static imports used only after a click; `next/dynamic` them. (LOW)

`apps/web/src/lib/workforce/pos.ts`

- `pos.ts:50-54` - [js-cache-function-results] `boardStamp` builds an `Intl.DateTimeFormat` per row per render. (MEDIUM on the board)

`apps/web/src/lib/workforce/booking-board.ts`

- `booking-board.ts:39-44` - [js-cache-function-results] `branchTime` builds an `Intl.DateTimeFormat` per call; the board calls it 3-5 times per booking row, per queue entry, every render. (MEDIUM on the board)

`apps/web/src/components/workforce/screens/pos-invoice.tsx`

- `pos-invoice.tsx:100-776` - [rerender-memo] Whole invoice re-renders on every `overlay`/`working`/`feedback`/`invoice` change; `command()` (:142-177) causes at least 3 renders per action; cards and column builders (:327, :362, :364) are not memoized. Split state per card or enable the compiler. (MEDIUM)
- `pos-invoice.tsx:129-136` - [rerender-memo] While a PayOS payment is pending the 5 s poll always replaces `invoice` with a new object, re-rendering everything even when nothing changed; skip `setInvoice` when `version` is unchanged. (LOW-MEDIUM)
- `pos-invoice.tsx:589-590` + `pay-invoice-cards.tsx:47-49,227-229` - [async-parallel] Tips and earnings fetched only after the invoice loads and the cards mount, though they need only `id`; start them with the invoice fetch. (LOW-MEDIUM)

`apps/web/src/components/workforce/screens/pos-dialogs.tsx`

- `pos-dialogs.tsx:487-490,580` - [async-parallel] Tip offer fetched on dialog open with submit disabled until it answers; prefetch when the invoice is PENDING_PAYMENT. (LOW-MEDIUM)
- `pos-dialogs.tsx:142,161,448` - [rerender-functional-setstate] `setInput({ ...input, ... })` from the closure; use the functional form like :428. (LOW)

`apps/web/src/components/workforce/screens/pos-payments.tsx`

- `pos-payments.tsx:307-311` - [rerender-memo] The 1 s countdown re-renders the whole `PayosPending` card (QR image, buttons, totals); move `now` into a small countdown leaf. (LOW)

`apps/web/src/components/workforce/screens/pos-products.tsx`

- `pos-products.tsx:64-98,459-463` - [client-swr-dedup] Product options refetched on every open of the Add and Edit dialogs; the Edit dialog loads the whole option list only to read `sellers`. (LOW-MEDIUM)
- `pos-products.tsx:67-89` - [rendering-usetransition-loading] Search loading flag handled by hand (`setLoading(true/false)`); a transition gives `isPending` and cancels stale searches. (LOW)
- `pos-products.tsx:281-283` - [rerender-derived-state-no-effect] Default seller copied into state by an effect; derive `sellerId || loaded?.defaultSellerId`. (LOW)

`apps/web/src/components/workforce/screens/pos-tip-step.tsx`

- `pos-tip-step.tsx:35` - [js-cache-function-results] `new Intl.NumberFormat` every render (each tip keystroke); hoist per locale. (LOW)
- `pos-tip-step.tsx:44-45` - [js-index-maps] `served.find` per draft inside `drafts.map`. (LOW)

`apps/web/src/components/workforce/screens/walk-in.tsx`

- `walk-in.tsx:224,377-380,401-407` - [rerender-memo] Each keystroke rebuilds `serviceById` and re-maps the full service list into `Select` options for every service line; memo the options on `options`+`locale`. (MEDIUM)
- `walk-in.tsx:365-366` - [js-index-maps] `lines.filter(participantKey)` inside `people.map`; group lines by participant once. (LOW)
- `walk-in.tsx:64-66` - [rerender-move-effect-to-event] Effect on `[people, lines, branchId]` runs on every keystroke to clear the idempotency key; clear it in the update handlers. (LOW)
- `walk-in.tsx:69-71` - [rerender-derived-state-no-effect] First branch via effect (same as POS). (LOW)

`apps/web/src/components/workforce/screens/booking-board.tsx`

- `booking-board.tsx:74-76` - [rerender-derived-state-no-effect] First branch via effect. (LOW)
- `booking-board.tsx:103-119` - [async-parallel] Walk-in options request waits for the board (`canChange` comes from it) and serves only the intent dialog; start in parallel or on dialog open. (LOW)
- `booking-board.tsx:222-226` - [async-parallel] Intent changes posted one by one in a loop; `Promise.all` (note: stop-on-first-error behaviour would change). (LOW)
- `booking-board.tsx:248,303-345` - [rerender-memo] New `time` closure and inline handlers every render rebuild all four sections and their columns on any state change and every 30 s poll. (MEDIUM-LOW)

`apps/web/src/components/workforce/screens/booking-board-sections.tsx`

- `booking-board-sections.tsx:554-575` - [rendering-content-visibility] Queue renders one card per staff member with full lists, unpaginated; `content-visibility: auto` on the cards. (LOW)

`apps/web/src/components/workforce/screens/booking-board-dialogs.tsx`

- `booking-board-dialogs.tsx:304-305` - [js-index-maps] `options.services.find` per waiting line inside `entry.lines.map`. (LOW)

`apps/web/src/components/workforce/screens/cash-book.tsx` (and siblings)

- `cash-book.tsx:300` - [rerender-lazy-state-init] `useRef(globalThis.crypto.randomUUID())` evaluates a UUID every render; same in `loyalty-adjust-dialog.tsx:52`, `online-order-dialogs.tsx:769,936`, `pay-command.tsx:18`, `payroll-command.tsx:19`, `product-exchanges.tsx:355`, `product-orders.tsx:1088`, `product-refunds.tsx:225`, `add-service.tsx:45`. Use `useState(() => ...)`. (LOW)
- `cash-book.tsx:376,391,403,414` + `cash.tsx:189-192,211` - [rerender-functional-setstate] `setDraft({ ...draft, ... })` from the closure in money/text inputs. (LOW)

`apps/web/src/components/workforce/screens/cash-closing.tsx`, `cash-reconcile.tsx`

- `cash-closing.tsx:231`, `cash-reconcile.tsx:45` - [js-cache-function-results] `todayIn(ZONE)` (a new `Intl.DateTimeFormat`) on every render, i.e. per keystroke in the closing form. (LOW)

### Admin

`apps/web/src/components/workforce/screens/dashboard.tsx`

- `dashboard.tsx:58-61` - [rendering-hydration-no-flicker] Saved layout read in an effect after mount; default widgets mount, start lazy chunks and fetches, then swap. Not SSR'd, so read it in a lazy `useState` initializer. (MEDIUM)
- `dashboard.tsx:74-79` - [rerender-derived-state-no-effect] Branch picked in an effect: branch widgets render "no branch" first, then switch. (LOW)

`apps/web/src/components/workforce/dashboard/registry.ts:11-33` + `dashboard/widget-host.tsx:42-47`

- [bundle-preload] Widget chunks start loading only when `WidgetHost` renders, after `/branches` resolves; kick off the imports for the resolved layout at mount. (LOW-MEDIUM)

Polling effects with an object dependency [rerender-dependencies] (each re-creates its interval on every render because the `useResource` result is a new object; destructure `reload` as `supplier-source-scan.tsx:65-69` does):

- `ai-drafts.tsx:121-125` - deps `[working, list, runs]`. (MEDIUM-LOW)
- `ai-seo.tsx:116-120` - deps `[working, list]`. (MEDIUM-LOW)
- `ai-seo.tsx:392-396` - deps `[detail, detailResource]`. (MEDIUM-LOW)
- `ai-settings.tsx:89-93` - deps `[pending, loaded]`. (MEDIUM-LOW)
- `ai-draft-detail.tsx:99-103` - deps `[waiting, loaded]`. (MEDIUM-LOW)

`apps/web/src/components/workforce/screens/attendance.tsx`

- `attendance.tsx:311-318` - [rerender-dependencies] `useResource(..., [api, filters])` keyed on the filter object; use its primitive fields. (LOW)
- `attendance.tsx:76,307` - [client-swr-dedup] `SelfAttendance` and `BranchAttendance` both call `useBranches`, so one page fetches `/branches` twice. (LOW)

Mirror and reset effects [rerender-derived-state-no-effect]:

- Mirror `useEffect(() => { if (loaded.data) setX(loaded.data) }, [loaded.data])`: `ai-settings.tsx:85-87`, `shipping-carriers.tsx:76-78`, `supplier-sources.tsx:106-108`, `online-sales.tsx:85-87`, `ai-draft-detail.tsx:84-86`, `media-library.tsx:601-603`, `ai-seo.tsx:386-390`. One extra render per load; keep the optimistic copy keyed by data instead. (LOW)
- Form reset from loaded data: `website-page-form.tsx:99-106`, `website-popup-form.tsx:159-166,167-179`, `website-season-form.tsx:144-151`, `website-shop-info.tsx:84-91`, `supplier-import-review.tsx:101-108`. Mount the form with a `key` on the loaded version instead. (LOW)
- First branch via effect: `my-services.tsx:57-59`, `reassignment.tsx:62-64`. (LOW)

`apps/web/src/components/workforce/screens/ai-seo.tsx`

- `ai-seo.tsx:404-406` - [async-parallel] `await detailResource.reload()` then `await onChanged()` (a list reload, :263-266); independent, run together. (LOW)

`apps/web/src/components/workforce/screens/supplier-import-all.tsx` (imports of about 2,000 rows)

- `supplier-import-all.tsx:118-124` - [js-combine-iterations] `ticked` filter, then `ticked.filter` once per category, unmemoized, on every checkbox click; count per category in one pass. (MEDIUM-LOW)
- `supplier-import-all.tsx:381-382` - [js-index-maps] `importable.some` per category inside JSX on every render; build the category set once. (LOW)
- `supplier-import-all.tsx:106-115` - [js-cache-function-results] `normalizeSearch` (NFD) of each row's name and SKU on every query; pre-normalize once per data load. (LOW)

`apps/web/src/components/workforce/screens/discount-targets.tsx`

- `discount-targets.tsx:155-171,203-210` - [rerender-use-deferred-value] Per-keystroke (undebounced `onQueryChange`) scan of a catalog of thousands, normalizing each label; defer the query (`useDeferredValue`) and pre-normalize labels. (MEDIUM)
- `discount-targets.tsx:165` - [js-set-map-lookups] `form.productIds.includes` per product in that loop; use a Set. (LOW)

`apps/web/src/components/workforce/screens/inventory-receipts.tsx`

- `inventory-receipts.tsx:679-688,822-824` - [rerender-memo] Options for the full variant catalog rebuilt on every keystroke in any line and handed to every line's Combobox; memo on `variants`+`receipt`+`locale`. (MEDIUM-LOW)
- `inventory-receipts.tsx:684` - [js-set-map-lookups] `variants.variants.some(...)` per receipt line; use a Set of variant ids. (LOW)

`apps/web/src/components/workforce/screens/services.tsx`

- `services.tsx:142-143,165-201` - [js-index-maps] `categoryName` does `allCategories.find` and is called per cell and inside `sortValue` (per comparison while sorting). (LOW)

`apps/web/src/lib/workforce/products.ts`

- `products.ts:404-416` - [js-index-maps] `categories.filter(parentId === root.id)` once per root; group children by parent once. (LOW)

`apps/web/src/lib/workforce/employee-create.ts`

- `employee-create.ts:141` - [js-min-max-loop] `dates.sort().at(-1)` to take the latest date; a single pass is enough. (LOW)

## Checked and clean

- Route files: every `page.tsx` is a server wrapper (awaits only `params`/`searchParams`) around one client screen; no server data
  fetching, so `server-*` rules have no targets. `workforce/layout.tsx` passes only `locale` to the client provider (no
  serialization cost).
- `use-qr-image.ts` already loads `qrcode` with a dynamic `import()`; dashboard widgets are `React.lazy` with per-widget Suspense.
- Dashboard widgets share one keyed, deduplicated store (`dashboard/data.tsx`, `lib/workforce/dashboard/shared-data.ts`).
- No heavy third-party library in the web app (dependencies: next, react, qrcode); `rich-editor.tsx` is a textarea plus preview.
