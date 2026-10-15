# React best practices audit: customer site (read-only)

Skill: vercel-react-best-practices (SKILL.md + AGENTS.md, all 70 rules). Scope: `apps/web/src/app/[locale]/(site)/**`,
`app/[locale]/layout.tsx`, `components/{customer,public,shop,navigation,notifications,season}/**`, the `lib/**` modules they
import, `next.config.ts`. `apps/web/src/app/layout.tsx` does not exist (the `[locale]` layout is the root). `packages/ui` is
covered by the kit audit (rbp-ui.md). Test files skipped. Bundle claims are measured against the existing production build
`apps/web/.next` (BUILD_ID 2026-10-16 01:24, Next 16.3.5 / Turbopack): client reference manifests, chunk files and
`server/next-font-manifest.json`. Sizes: raw / gzip.

## Summary

| Rule id                            | Count                          |     | Rule id                              | Count                    |
| ---------------------------------- | ------------------------------ | --- | ------------------------------------ | ------------------------ |
| async-cheap-condition-before-await | 0                              |     | client-swr-dedup                     | 5                        |
| async-defer-await                  | 0                              |     | client-event-listeners               | 1                        |
| async-parallel                     | 5                              |     | client-passive-event-listeners       | 0 (kit, see rbp-ui)      |
| async-dependencies                 | 1                              |     | client-localstorage-schema           | 0                        |
| async-api-routes                   | 0 (no route handlers in scope) |     | rerender-memo                        | 2                        |
| async-suspense-boundaries          | 2                              |     | rerender-derived-state-no-effect     | 4                        |
| bundle-barrel-imports              | 4                              |     | rerender-functional-setstate         | 2                        |
| bundle-analyzable-paths            | 0                              |     | rerender-lazy-state-init             | 1                        |
| bundle-dynamic-imports             | 2                              |     | rerender-move-effect-to-event        | 1                        |
| bundle-defer-third-party           | 0                              |     | rerender-no-inline-components        | 0                        |
| bundle-conditional                 | 3                              |     | other rerender-* (8 rules)           | 0                        |
| bundle-preload                     | 0                              |     | rendering-resource-hints             | 2                        |
| server-auth-actions                | 0 (no server actions)          |     | rendering-content-visibility         | 1                        |
| server-cache-react                 | 1                              |     | rendering-conditional-render         | 0 (ternaries throughout) |
| server-cache-lru                   | 1                              |     | rendering-hydration-no-flicker       | 0                        |
| server-dedup-props                 | 1                              |     | other rendering-* (7 rules)          | 0                        |
| server-serialization               | 1                              |     | js-cache-function-results            | 2                        |
| server-no-shared-module-state      | 0                              |     | js-set-map-lookups                   | 2                        |
| server-hoist-static-io             | 0                              |     | js-index-maps                        | 1                        |
| server-parallel-fetching           | 0                              |     | js-combine-iterations                | 1                        |
| server-parallel-nested-fetching    | 0                              |     | js-hoist-regexp                      | 1                        |
| server-after-nonblocking           | 0                              |     | other js-* (9 rules), advanced-* (4) | 0                        |

Total: 47 findings.

### Top 10 by impact

1. **Staff dictionary on every customer page** (bundle-dynamic-imports + bundle-barrel-imports). The header bell
   (`notification-bell.tsx:11`) imports `useUnreadCount` from `notifications/inbox.tsx`, which imports `i18n/workforce` (273 KB
   source, vi+en) and staff modules; `lib/notifications.ts:7` imports `fill` from the same dictionary. Chunk
   `0d28i3tkoiu7y.js` = 246 KB / 73 KB gz, of which the workforce dictionary is ~205 KB / ~68 KB gz; it is referenced by all 24
   `(site)` route manifests (home included) and loads for anonymous visitors, for a component that returns null for them.
2. **18 font files preloaded, 8 used** (rendering-resource-hints). Every customer route preloads 18 woff2 / 317 KB; inside the
   `data-ui="v2"` frame only Be Vietnam Pro renders (8 files / 73 KB). Fraunces (4 / 107 KB) and Nunito Sans (2 / 41 KB) are
   staff-only faces; Playfair (4 / 96 KB) is used only by the season greeting (`season-art.css:382`).
3. **Member area client waterfall** (async-parallel, async-dependencies, client-swr-dedup). A direct load runs: hydrate →
   session (`/context` then `/auth/me`, sequential, and read twice: SiteSessionProvider and RequireCustomer) → page data →
   (loyalty) 5 more section reads / (invoice) review prompt. Three to four sequential round trips before content.
4. **No client data cache** (client-swr-dedup). `useFetch` refetches and shows a skeleton on every navigation
   (`/me/bookings`, `/me/loyalty`, `/me/invoices` each read by two screens); unread count polled twice on `/account`; cart
   count read twice on narrow phones; login page reads the session a third time.
5. **Whole site frame and home page wait for every read** (async-suspense-boundaries). `SitePageFrame` awaits 3 reads and
   `HomePage` awaits 6 before any HTML; warm `ttlMemo` hides it, a cold or failing API costs up to 3 s
   (`PUBLIC_FETCH_TIMEOUT_MS`) of TTFB, and the hero (LCP) only needs `site`.
6. **Chat panel shipped on every page** (bundle-dynamic-imports). `chat-contact.tsx:6` imports `ChatPanel` statically; its
   code is in chunk `0iews9ibphpx5.js` (38 KB / 12 KB gz, shared) on the home page even when the Owner's chat is off.
7. **Service list is one client component** (server-serialization, rendering-content-visibility). The whole catalog
   (descriptions, `seoDescription`, `englishApproved`, images) is serialized and every card hydrated for one search box; no
   `content-visibility` anywhere in the CSS.
8. **`/products` metadata waterfall** (async-parallel, js-set-map-lookups). `public-metadata.ts:228` awaits
   `fetchPublicProductCodes()` after the `Promise.all`, and `parseProductCodes` is O(n·m) (`codes.includes` in a filter), run on
   every products-page request.
9. **Conditional code loaded unconditionally** (bundle-conditional). Public `not-found.tsx` (an entry on every public page)
   ships the product-orders dictionary (chunk `21dkpcxi186qb.js` 24.6 KB / 7.7 KB gz); `PromoDialog` ships on home (chunk
   `0hhw52k761jx5.js` 19.5 KB / 7.3 KB gz) for a popup most visits never see; season FX client code is in the shared chunks with
   no season active.
10. **Per-call `Intl` formatters and per-second whole-screen renders** (js-cache-function-results, rerender-memo). Money/date
    helpers build a new `Intl.NumberFormat`/`DateTimeFormat` per call (3+ per product card, per table row); the online order page
    re-renders its entire tree every second while awaiting payment.

Checked and clean: gsap only via dynamic `import('gsap')` (`packages/ui/src/motion.ts:114`), and no gsap, d3 or dnd-kit code in
any home-page chunk (gsap only in `2dzam5fz7e2_9.js`); `lazy-product-row.tsx` is the model pattern (next/dynamic + observer + idle
fallback); `ttl-memo.ts` module state is the rule's allowed "shared cache, keyed correctly"; `fetchPublicTicket` is correctly
never memoized; every `.sort` in scope runs on a fresh array; no `&&` with numeric left side; no component defined inside a
component.

## Findings by file

### next.config.ts

- next.config.ts:13-16 - [bundle-barrel-imports] No `experimental.optimizePackageImports: ['@lucy-spa/ui']`; the kit entry
  `packages/ui/src/index.tsx` (407 lines) re-exports charts (d3), dnd-kit, DataTable, MediaGrid, ImageUploader. Production
  tree-shakes them (verified: none in customer chunks), so the cost is dev boot / HMR / build time only. (LOW)

### apps/web/src/app/[locale]/layout.tsx

- apps/web/src/app/[locale]/layout.tsx:95-96 - [async-parallel] `await fetchActiveSeason(locale)` then `await cookies()`; start
  both and await together. Note: this root layout blocks the document head for every page on the season read (1.5 s timeout,
  failures memoized only 5 s); inherent while the `<html>` attributes need it. (LOW)
- apps/web/src/app/[locale]/layout.tsx:32-48,105 (+ components/public/site-fonts.ts:7-22, site-page-frame.tsx:38) -
  [rendering-resource-hints] next/font preloads 18 woff2 / 317 KB on every customer route (`next-font-manifest.json`): Be
  Vietnam Pro 8 / 73 KB, Playfair 4 / 96 KB, Fraunces 4 / 107 KB, Nunito Sans 2 / 41 KB. In `[data-ui='v2']`
  (`tokens.css:~731`) `--ls-font-sans` and `--ls-font-display` both resolve to Be Vietnam Pro, so Fraunces/Nunito (staff faces,
  `staff.css:25`) never render on the customer site and Playfair only in the season greeting (`season-art.css:382`). 244 KB of
  preloads compete with the hero image. Set `preload: false` on the three, or load `site-fonts` only in the workforce layout.
  (HIGH)
- `ThemeInitScript` pre-paint script: ✓ pass (rendering-hydration-no-flicker).

### apps/web/src/app/[locale]/(site)/layout.tsx

- ✓ pass (rendered in parallel with the page segment per Next 16 docs `06-fetching-data.md:460`).

### apps/web/src/components/public/site-page-frame.tsx

- components/public/site-page-frame.tsx:20-24 - [async-suspense-boundaries] The frame (header, tab bar, footer and the page
  slot) awaits `loadSiteDecor`, `fetchPublicSite`, `fetchHasPublicProducts` before any HTML. The footer (`site`) and the contact
  button could stream in a Suspense boundary; only the header needs `decor`/`hasProducts`. Near free while `ttlMemo` is warm, up
  to 3 s TTFB on a cold or failing API. Note: `hasProducts` is derived from a full first catalog page
  (`lib/public-site.ts:152-158`), acceptable because the list page shares that memo entry. (MEDIUM)

### apps/web/src/app/[locale]/(site)/(public)/(home)/page.tsx

- (home)/page.tsx:23 - [async-suspense-boundaries] `loadHomeData` waits for all 6 reads (site, services, slides, campaigns,
  online-sales, products) before the hero renders; the hero/LCP needs only `site`. Stream the bands below the fold
  (services, products, campaigns) in Suspense with the existing skeleton shapes. (MEDIUM)

### apps/web/src/app/[locale]/(site)/(public)/not-found.tsx

- (public)/not-found.tsx:7 - [bundle-conditional] Imports `productOrdersDictionary` (27 KB source, vi+en) for the ticket branch;
  the not-found boundary is an entry chunk of every public page (home manifest `entryJSFiles`), chunk `21dkpcxi186qb.js`
  24.6 KB / 7.7 KB gz. Move the four ticket strings to `i18n/site` or a tiny module. (MEDIUM-LOW)

### Other route files in (site)

- (public)/[...rest]/page.tsx, contact/page.tsx, products/(list)/page.tsx (fetches in `Promise.all` ✓), products/[code]/page.tsx
  (`Promise.all` ✓), services/(list)/page.tsx, services/[code]/page.tsx, ticket/[token]/page.tsx (uncached by design ✓),
  (home)/loading.tsx, products/(list)/loading.tsx, services/(list)/loading.tsx, error.tsx, (shop)/layout.tsx, cart/page.tsx,
  checkout/page.tsx, account/layout.tsx, account/(app)/layout.tsx and the 13 thin account page wrappers: ✓ pass (the member
  area being client-rendered is reported under session.tsx).

### apps/web/src/lib/public-metadata.ts

- lib/public-metadata.ts:228 - [async-parallel] `english: (await fetchPublicProductCodes()).english.length > 0` runs after the
  `Promise.all` at 203-216: one more sequential API round trip (cold memo) on every `/products` metadata. Add it to the
  `Promise.all`. (MEDIUM)
- Other generators use `Promise.all` ✓.

### apps/web/src/lib/public-site.ts

- lib/public-site.ts:57-66 (callers: site-page-frame.tsx:22, public-site.ts:195, public-metadata.ts:78/164/203/240,
  contact/page.tsx:21, products/[code]/page.tsx:29) - [server-cache-react] `fetchPublicSite` runs 3 times per request (metadata,
  frame, page). `ttlMemo` dedups the network, but `parsePublicSite` re-validates the whole body each time (same for
  services/products). Wrap the exported fetchers in `React.cache`. (LOW)
- `read()` memo policy (searches and campaign views not memoized) ✓.

### apps/web/src/lib/ttl-memo.ts

- lib/ttl-memo.ts:35 - [server-cache-lru] At 200 entries the whole map is cleared (`entries.clear()`), so the 201st key evicts
  the season, shop profile and catalog for every visitor at once (a burst of cold reads). Evict the oldest entry instead
  (Map insertion order) or use `lru-cache`. In-flight dedup (`flights`) ✓. (LOW)

### apps/web/src/lib/public-products-core.ts

- lib/public-products-core.ts:491 - [js-set-map-lookups] `english.filter(... codes.includes(code))` is O(n·m) over every product
  code; called on each `/products` metadata (via public-metadata.ts:228) and the sitemap. Use a `Set`. (LOW-MEDIUM)
- lib/public-products-core.ts:470,499 - see the Intl finding under lib/customer/invoice.ts.

### apps/web/src/lib/customer/invoice.ts (Intl group)

- lib/customer/invoice.ts:7,12; lib/customer/booking.ts:144,150,162; lib/customer/booking-view.ts:153;
  lib/customer/loyalty.ts:25,35; lib/public-products-core.ts:470,499; lib/notifications.ts:118,163; lib/shop/online.ts:352;
  components/notifications/inbox.tsx:176-177; components/public/ticket-view.tsx:23 - [js-cache-function-results] Each call
  builds a new `Intl.NumberFormat` / `Intl.DateTimeFormat` (a costly constructor). They run per row and per card: `moneyText`
  2-3 times per product card (20 per list page, server), `formatVnd`/`formatDateTime` per table cell, two per notification row.
  Cache one formatter per locale (and option set) in a module-level Map. (MEDIUM-LOW)

### apps/web/src/lib/notifications.ts

- lib/notifications.ts:7 - [bundle-barrel-imports] `import { fill } from '../i18n/workforce'`: one 6-line helper pulls the
  whole staff dictionary module; this module is imported by the public header bell. Import `fill` from `lib/fill.ts` (identical).
  Part of top finding 1. (HIGH)

### apps/web/src/lib/search-core.ts

- lib/search-core.ts:16-21 - [js-cache-function-results] `matchesQuery` folds (`normalize('NFD')` + 4 regex passes) the full text
  on every call; `services-list.tsx:105-116` re-folds every service name+description per query, `book.tsx:478-491` every service
  label on every render. Pre-fold the texts once (useMemo) and fold only the query. (LOW-MEDIUM)

### apps/web/src/lib/site-nav.ts

- lib/site-nav.ts:195 - [js-hoist-regexp] `new RegExp(...)` per call; `otherLocalePath` runs on every header render
  (`site-chrome-client.tsx:97`) and pathname change. Two locales: hoist two regexes or use `startsWith` + `slice`. (LOW)

### apps/web/src/lib/customer/auth.ts

- lib/customer/auth.ts:25-38 - [async-dependencies] `loadCustomerSession` awaits `api.context()` and only then
  `GET /auth/me`; every session read is two sequential round trips. `/auth/me` already answers 401 for an anonymous visitor
  (handled at 35), so both can start together. (MEDIUM-LOW)

### lib modules grep-skimmed, no finding (not a full pass)

- lib/shop/online.ts (except :352), lib/customer/booking.ts (except Intl lines), lib/customer/booking-view.ts (groupByCategory
  sorts its own arrays ✓), lib/seo-core.ts, lib/popup-core.ts, lib/slider-core.ts, lib/season-core.ts, lib/hours.ts,
  lib/public-site-core.ts (read 480-643: ✓), lib/public-ticket.ts (read: ✓), lib/public-site-client.ts (read: `Promise.all` ✓),
  lib/season-server.ts (read: ✓).

### apps/web/src/components/public/notification-bell.tsx

- components/public/notification-bell.tsx:11 - [bundle-dynamic-imports] `import { CHANGED, timestampParts, useUnreadCount } from
'../notifications/inbox'` puts the staff inbox module and its imports (inbox.tsx:22-40: `i18n/workforce`,
  `lib/workforce/list-view`, `use-client-paging`, `components/workforce/ui`, `components/workforce/link`) into the site header,
  which every customer route renders (site-page-frame.tsx:25 → site-chrome.tsx:47 → site-chrome-client.tsx:94). Measured: chunk
  `0d28i3tkoiu7y.js` 246 KB / 73 KB gz, ~205 KB / ~68 KB gz of it the workforce dictionary (bytes 5,443-210,078), in all 24 `(site)`
  manifests. Fix: move `useUnreadCount`, `CHANGED`, `timestampParts` to a small module, and load `SignedInBell` with
  `next/dynamic` (members only; the bell returns null for everyone else). (CRITICAL)
- components/public/notification-bell.tsx:68-88 - [rerender-move-effect-to-event] Opening the panel is modelled as `open` state +
  an effect that fetches and moves focus; the fetch belongs in the click handler (the effect also re-fetches if `api` changes).
  (LOW)

### apps/web/src/components/notifications/inbox.tsx

- components/notifications/inbox.tsx:24 - [bundle-barrel-imports] The whole `i18n/workforce` module (vi+en, 5,600 lines) is
  imported for `fill`, `w.common.list.table` and paging labels; same root cause as the bell. (HIGH, part of top finding 1)
- components/notifications/inbox.tsx:52-90 - [client-swr-dedup] Every `useUnreadCount` instance runs its own fetch, 30 s
  interval and window listener; on `/account` the header bell and the overview card (bookings.tsx:261) poll the same endpoint
  twice, and both keep polling in a hidden tab. Share one subscription (module store or SWR) and pause on
  `visibilitychange`. (MEDIUM)
- components/notifications/inbox.tsx:170-179 - [js-cache-function-results] two `Intl.DateTimeFormat` per row per render (see the
  Intl group). (LOW)
- components/notifications/inbox.tsx:470-475,491-497 - [rerender-functional-setstate] `setFilters({ ...filters, ... })` reads the
  render's `filters`; use `setFilters((f) => ({ ...f, ... }))`. (LOW)

### apps/web/src/components/public/chat-contact.tsx

- components/public/chat-contact.tsx:6 - [bundle-dynamic-imports] `ChatPanel` (369 lines + chat-core + its own ApiClient) is a
  static import; only its mounting is deferred, so the comment at 9-10 ("loads and runs none of the chat") is not true for loading.
  Its code (`/api/v1/public/chat/messages`) is in chunk `0iews9ibphpx5.js` (38 KB / 12 KB gz, shared) on the home page, and since
  `contact-widget.tsx:5` imports `ChatContact` statically into the layout, it ships even when the chat is switched off. Use
  `next/dynamic(() => import('./chat-panel'), { ssr: false })` and preload on hover/focus of the chat item (bundle-preload).
  (MEDIUM)

### apps/web/src/components/public/promo-popup.tsx

- components/public/promo-popup.tsx:4 - [bundle-conditional] `PromoDialog` is a static import although the dialog shows only when
  a live popup exists and was not seen this session; home-only chunk `0hhw52k761jx5.js` 19.5 KB / 7.3 KB gz. Import the dialog
  after `loadPublicPopup` finds one. Fetch deferred after paint ✓. (LOW-MEDIUM)

### apps/web/src/components/season/site-frame-view.tsx

- components/season/site-frame-view.tsx:1-10 - [bundle-conditional] `SeasonSiteParticles`, `SeasonFxSwitch` and the season art
  (packages/ui `season-site-fx.tsx`, 245 lines, with the Tết/Christmas/celebration art) are static imports; the home page's client
  manifest lists `season-site-fx.tsx` in the shared chunk set, so the effects code loads with no season active. Size not
  isolated (merged into shared chunks). Dynamic-import the FX layer when `decor.particles` is set. (LOW-MEDIUM)
- components/season/site-frame.tsx, admin-season-chip.tsx (staff dashboard), season-preview-stage.tsx (admin preview;
  `Promise.all` in `loadHomeDataInBrowser` ✓): ✓ pass.

### apps/web/src/components/public/services-list.tsx

- components/public/services-list.tsx:1,90-116 (boundary at services-view.tsx:81) - [server-serialization] The whole service list
  is a client component: every `PublicServiceGroup` with all services (description, `seoDescription`, `englishApproved`, image
  sources) is serialized into the RSC payload and every card hydrates, only to drive one search box. Keep the cards server-rendered
  and pass a small client filter `{ code, foldedText }[]` that hides non-matching cards. (MEDIUM)
- components/public/services-list.tsx:139-161 - [rendering-content-visibility] The full catalog renders as one long page of image
  cards (all groups when no group is chosen) and no CSS in the repo uses `content-visibility`; add
  `content-visibility: auto; contain-intrinsic-size` to `.ls-svc-item` / group bands. (LOW-MEDIUM)

### apps/web/src/components/public/products-view.tsx

- components/public/products-view.tsx:249,326 - [server-dedup-props] `FilterGroups` (passed as `children` into the client
  `ProductsToolbar`) and `FilterChips` render the same category and brand link sets twice per page, so both copies are in the
  RSC payload and the HTML; the sheet only matters below 640 px. (LOW)
- Server component, cards stay server-rendered inside `Reveal` ✓.

### apps/web/src/components/public/sale-countdown.tsx

- components/public/sale-countdown.tsx:21-25 - [client-event-listeners] One `setInterval(1000)` per countdown; a products grid with
  N timed sales runs N timers and N renders per second. Share one module-level ticker (subscribe/unsubscribe). (LOW-MEDIUM)

### apps/web/src/components/public/home-product-row.tsx

- components/public/home-product-row.tsx:27 - [rendering-resource-hints] `priority={index < 2}` gives `loading="eager"` +
  `fetchPriority="high"` (product-image.tsx:39-40) to cards of a row that is itself lazy-mounted below the fold; drop priority
  there. (LOW)

### apps/web/src/components/customer/session.tsx

- components/customer/session.tsx:109-127 - [client-swr-dedup] `RequireCustomer` re-reads the session (2 sequential requests) on
  every mount even when `useSiteSession()` already holds the account (it only uses it for the initial state); on a direct load
  SiteSessionProvider and RequireCustomer read it concurrently: 4 requests for one answer. Reuse the site session's result and
  re-validate only on `SITE_SESSION_CHANGED`. (MEDIUM)
- components/customer/session.tsx:155-198 - [async-parallel] Children (and their data reads) mount only after the session read
  resolves: on a direct load the page's own request starts after 2 session round trips. Start the screen's reads in parallel
  (render children optimistically while `kind === 'loading'` and let the server's 401 redirect) or prefetch by route. (MEDIUM)
- `CustomerProvider` in both `account/layout.tsx` and `(shop)/layout.tsx`: moving between /account and /cart remounts it (new
  ApiClient and CSRF context). Note only.

### apps/web/src/components/customer/screens/bookings.tsx

- components/customer/screens/bookings.tsx:51-73 - [client-swr-dedup] `useFetch` (also used by invoices, loyalty, profile,
  review-card, cart, checkout, orders) has no cache or dedup: `/me/bookings` is read by the overview and the list,
  `/me/loyalty` by the overview and the loyalty page, `/me/invoices` by the overview and the invoice list, and every navigation
  shows the skeleton again. A small keyed cache (or SWR) with stale-while-revalidate removes the refetch flash. (MEDIUM)
- components/customer/screens/bookings.tsx:34,47 (+ invoices.tsx:24,36; loyalty.tsx:32,46; orders-screens.tsx:34) -
  [bundle-barrel-imports] Member screens import the whole `i18n/workforce` dictionary and `components/workforce/ui` for one caption
  string (`w.common.list.table`) and paging labels; fixing the header (finding 1) alone would still ship ~68 KB gz to every member
  page. Move those strings to `i18n/customer`. (MEDIUM)
- `useUnreadCount` duplicate at :261: counted under inbox.tsx.

### apps/web/src/components/customer/screens/loyalty.tsx

- components/customer/screens/loyalty.tsx:63-92 - [async-parallel] The five `PagedSection` reads (history, combos, combo uses,
  referrals, gifts) start only after `/me/loyalty` resolves: a second round trip after the session waterfall. Render the sections
  (or start their reads) in parallel with the summary; only the `live` notice needs the summary. (MEDIUM)

### apps/web/src/components/customer/screens/invoices.tsx

- components/customer/screens/invoices.tsx:392 - [async-parallel] `ReviewCard` (its own read of
  `/me/reviews/invoices/{id}`) mounts only after the invoice detail resolves; the id is known up front, start it with the detail.
  (LOW)
- components/customer/screens/invoices.tsx:333-336 - [js-index-maps] `invoice.lines.find(...)` per product-order line; build a
  `Map` by sequence (small lists). (LOW)

### apps/web/src/components/customer/screens/book.tsx

- components/customer/screens/book.tsx:153-156 - [rerender-derived-state-no-effect] The only branch is chosen in an effect
  (`setDraft` after render), costing an extra commit and delaying the branch-services read by one render; derive
  `branchId = draft.branchId || onlyBranch?.id`. Same pattern for the link prefills at 146-152, 192-213. (LOW-MEDIUM)
- components/customer/screens/book.tsx:487-493 - [rerender-memo] `groupByCategory(services.filter(matchesQuery))` (a BigInt +
  `localeCompare(…, locale)` sort of every service) runs on every render (each toggle, each guest keystroke); `useMemo` on
  `[branch.data, serviceQuery, locale]` and an `Intl.Collator`. (LOW-MEDIUM)
- components/customer/screens/book.tsx:478-491 - [js-combine-iterations] `matchesQuery` is evaluated twice per service (`some`
  for the notice, then `filter`); filter once and test `length === 0`. (LOW)
- components/customer/screens/book.tsx:499 - [js-set-map-lookups] `draft.serviceIds.includes(service.id)` per choice card;
  a `Set` of chosen ids. (LOW)
- Parallel step loads and `useStepSlide` (kit, gsap dynamic) ✓.

### apps/web/src/components/customer/screens/auth.tsx

- components/customer/screens/auth.tsx:199-209 - [client-swr-dedup] `LoginForm` reads the session a third time on mount (2
  requests) to redirect a signed-in member; `useSiteSession()` already has `signedIn`/`ready`. (LOW)

### apps/web/src/components/shop/orders-screens.tsx

- components/shop/orders-screens.tsx:283-293,317 - [rerender-memo] `useSecondsLeft` ticks every second inside
  `OnlineOrderDetailScreen`, re-rendering the whole screen (timeline, line list, totals, address cards, `Reveal` wrappers) while
  the order awaits payment (up to the payment window). Move the countdown text into its own small component. (MEDIUM-LOW)
- components/shop/orders-screens.tsx:319 - [rerender-derived-state-no-effect] `useEffect(() => setArrival(readArrival()), [])`
  reads the URL after the first render (extra commit, notices appear late); `useSearchParams()` gives it during render. (LOW)

### apps/web/src/components/shop/checkout-screen.tsx

- components/shop/checkout-screen.tsx:83 - [rerender-lazy-state-init] `useRef<string>(newRequestId())` calls
  `newRequestId()` on every render (value discarded); initialize lazily. (LOW)
- components/shop/checkout-screen.tsx:112-123 - [rerender-derived-state-no-effect] The saved addresses are copied into state in
  an effect, so the form first renders empty and re-renders once filled; initialize when the data first arrives during render.
  (LOW)
- components/shop/checkout-screen.tsx:233-235 - [rerender-functional-setstate] `changeDraft` builds `{ ...draft, ...patch }` from
  the render's `draft` (two fast changes can drop one); use the updater form. (LOW)
- Cart, addresses and quote read in parallel ✓.

### apps/web/src/components/shop/quantity-stepper.tsx

- components/shop/quantity-stepper.tsx:29 - [rerender-derived-state-no-effect] `useEffect(() => setDraft(String(value)),
[value])` syncs a prop into state after render (one extra render per change, a frame with the stale value); key the input by
  `value` or adjust during render. (LOW)

### apps/web/src/components/shop/shop-data.ts

- components/shop/shop-data.ts:70-93 (callers cart-link.tsx:21, account-menu.tsx:94) - [client-swr-dedup] On a narrow phone both
  `CartLink` and the account menu call `useCartLineCount`: two `/me/cart` reads and two `CART_CHANGED` listeners. Share it like
  `loadOnlineSales` (module cache + in-flight dedup ✓ at 14-34). (LOW)
- Module-level cache at 14-16 is only filled in the browser (effects), never during SSR ✓.

### Files read, ✓ pass

- components/public/page-transition.tsx ✓ (effect only on pathname change, View Transitions)
- components/public/site-chrome.tsx ✓ (server; note `new Date().getFullYear()` at 165 is server-only)
- components/public/site-chrome-client.tsx ✓ (header root cause reported under notification-bell.tsx)
- components/public/site-session.tsx ✓ (memoized context value; the module-level fallback `ApiClient` at 39 is only used outside a
  provider and never during SSR; member-only entries appear after the read but the tab bar is gated by `data-ls-session`)
- components/public/site-scroll-manager.tsx ✓ (passive scroll handling is inside kit `onPageScroll`: deferred to rbp-ui)
- components/public/site-fonts.ts (finding under [locale]/layout.tsx)
- components/public/contact-widget.tsx ✓ (server)
- components/public/contact-view.tsx ✓ (map iframe `loading="lazy"`, no third-party script)
- components/public/home-content.tsx ✓ (server; waterfall reported at the page)
- components/public/home-sections.tsx ✓
- components/public/home-slider.tsx ✓
- components/public/lazy-product-row.tsx ✓ (model pattern)
- components/public/scroll-row.tsx ✓ (setState only when an edge changes)
- components/public/brand-band.tsx ✓ (server, CSS-only motion)
- components/public/category-tile.tsx ✓ (`loading="lazy"`)
- components/public/photo-slot.tsx ✓
- components/public/shared-photo.tsx ✓
- components/public/product-card.tsx ✓ (server)
- components/public/product-image.tsx ✓
- components/public/product-gallery.tsx ✓
- components/public/product-offer.tsx ✓ (lazy `useState` init ✓)
- components/public/products-controls.tsx ✓
- components/public/sale-price.tsx ✓
- components/public/campaign-views.tsx ✓
- components/public/services-view.tsx ✓ (boundary reported under services-list.tsx)
- components/public/service-book-bar.tsx ✓
- components/public/public-breadcrumbs.tsx ✓
- components/public/info-view.tsx ✓
- components/public/rich-text.tsx ✓ (`inline` is a function returning `<Inlines>`, not a component defined in a component)
- components/public/footer-blocks.tsx ✓
- components/public/ticket-view.tsx ✓ (Intl at :23 counted in the Intl group)
- components/public/unbroken.tsx ✓
- components/public/account-menu.tsx ✓ (`useMediaQuery` boolean subscription ✓; cart double read under shop-data.ts)
- components/navigation/page-back.tsx ✓
- components/customer/account-frame.tsx ✓
- components/customer/shell.tsx ✓
- components/customer/screens/notifications.tsx ✓ (inherits inbox.tsx findings)
- components/customer/screens/profile.tsx ✓
- components/customer/screens/review-card.tsx ✓ (`STAR_CHOICES.map` per render at 109 is trivial)
- components/shop/shop-frame.tsx ✓
- components/shop/cart-screen.tsx ✓ (cart and sales read in parallel)
- components/shop/checkout-address.tsx ✓ (province options memoized)
- components/shop/purchase-block.tsx ✓
- components/shop/cart-link.tsx ✓ (double read under shop-data.ts)
- components/shop/order-fulfilment.tsx ✓
