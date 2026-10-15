# Step 3 re-audit: session 10 foundation commit (6d90871)

Read-only re-audit of the 46 non-test `*.ts`/`*.tsx`/`*.css` files that `git diff --name-only 8001336..6d90871` lists and that still
exist. Rules: web-design-guidelines (`.local/s10/wig-command.md`, sentence case instead of Title Case) and vercel-react-best-practices
(`.claude/skills/react-best-practices/SKILL.md` + `rules/*.md`). Baselines: `docs/redesign-s10/audit/wig-*.md`, `rbp-*.md` (written on
the pre-commit tree: they still cite `theme-core.ts`, `use-theme.ts`, which this commit deletes).

- Current code = the commit's post-image: `git diff --name-only 6d90871..HEAD` lists only `.gitignore` and `scripts/*`, and the working
  tree changes are `CLAUDE.md`, `DESIGN.md`, `LUCYSPA_HANDOFF.md` and docs. Line numbers below are the current files.
- CLOSED is claimed only where the current code was opened (file read, grep or the diff post-image of that hunk).
- Status words: CLOSED (problem gone), OPEN (the commit touched that code or the file's relevant part and the problem remains or was only
  moved), OUT OF SCOPE (the commit did not touch that part: still open), NEW (introduced by the commit).
- Counting unit: one baseline entry, deduplicated by (file, issue). `i18n/workforce.ts` and `lib/workforce/format.ts` are reported by
  several audits (wig-admin-a, wig-admin-b, wig-pos), and rbp "Top N" lists repeat the by-file entries; those repeats are listed but not
  counted twice.
- Bundle claims are by import-graph inspection, not re-measured against a new build.

## Summary

| Skill                       | Baseline findings in these files | Closed | Still open (OPEN + OUT OF SCOPE) | New     |
| --------------------------- | -------------------------------- | ------ | -------------------------------- | ------- |
| web-design-guidelines       | 61                               | 8      | 53 (2 OPEN, 51 OUT OF SCOPE)     | 2 (LOW) |
| vercel-react-best-practices | 32                               | 6      | 26 (6 OPEN, 20 OUT OF SCOPE)     | 1 (LOW) |

Partly closed and counted as open: `shell.css:13` (top half fixed, bottom half open), `lib/workforce/format.ts` Intl cache (`todayIn`
still per call), the rbp Intl group (`inbox.tsx` part closed, `lib/notifications.ts` part open), `notification-bell.tsx:11` is counted
CLOSED (the staff dictionary is gone from the bell; the optional `next/dynamic` half was not done).

Resolved by deletion, outside this file list (not counted above): wig-ui `theme-core.ts:47` (its `(site)/layout.tsx` twin is counted
CLOSED below), rbp-ui `use-theme.ts:14-23`, `use-theme.ts:25`, `theme-cycle.tsx:36-47`, `theme-toggle.tsx:37`, `theme-core.ts:16`,
`theme-script.tsx:22` (7 findings): the theme toggle, cycle, cookie and pre-paint script are removed; the page follows the device.

### NEW findings

- apps/web/src/app/[locale]/layout.tsx:114 - [WIG Hydration Safety] NEW - `suppressHydrationWarning` on `<html>` lost its reason: the
  pre-paint `ThemeInitScript` that set `data-theme` before hydration is removed; every remaining `<html>` writer (MotionGate,
  site-session.tsx:56, admin-season-chip.tsx:44, season-preview-stage.tsx:56) runs in an effect after hydration. Drop it or say why it stays (LOW)
- packages/ui/src/form.tsx:155 (+ :210 NumberInput, :361 Textarea) - [WIG Forms] NEW - `name={rest.name ?? rest.id}`: inside `Field`
  without an explicit id the id is `useId()` (form.tsx:81-82), so the name is a generated token, not a meaningful name. The baseline
  "inputs lack name" entries in admin/POS forms are therefore only nominally met where callers pass no id (LOW)
- apps/web/src/lib/navigation/back.ts:68 - [RBP js-cache-function-results] NEW - `hasParent` rebuilds `Object.keys(TAB_PARENTS)` and
  `rest.join('/')` inside `.some` on every `PageBack` render (every staff and member page); hoist the keys, join once (LOW)

Notes (no counted rule): `packages/ui/src/form.tsx:211-216` `inputMode` now falls back to `numeric` for integer steps, which has no minus
key on iOS; no current caller has a negative `min` (grep), so latent only. `packages/ui/src/motion.ts:233-236,298` a route change reverts
every live context, including any owned by chrome that survives navigation; today only `step-slide.ts` uses the wrapper, so no visible
effect. `packages/ui/src/motion.ts:183-226` the test-probe Proxy and `describe()` ship in the client chunk (tiny). `packages/ui/src/shell.css:616,830,860`
three orphaned comments left by the theme-toggle and auth-pattern removals. Pre-existing on a rewritten element, not in the baseline:
`packages/ui/src/index.tsx:12-29` the "Lucy Spa" wordmark has no `translate="no"` (WIG Locale & i18n; wig-customer flagged the same at
home-content.tsx:93).

## apps/web/src/app/[locale]/(site)/layout.tsx

- apps/web/src/app/[locale]/(site)/layout.tsx:8 - [WIG Dark Mode & Theming] CLOSED - wig-customer:41. The in-page ThemeCycle that let `data-theme`
  disagree with the device is removed (site-chrome-client.tsx), the `viewport` export is gone from this file, and the root layout now
  declares `colorScheme: 'light dark'` + `themeColor` per `prefers-color-scheme` (apps/web/src/app/[locale]/layout.tsx:71-74), which now
  always matches the page (white / black base).
- rbp-customer: ✓ pass in baseline; diff only removes the viewport export. No new finding.

## apps/web/src/app/[locale]/layout.tsx

- apps/web/src/app/[locale]/layout.tsx:29 - [WIG Touch & Interaction] CLOSED - wig-customer:37. `touch-action: manipulation` and
  `-webkit-tap-highlight-color: transparent` now exist (packages/ui/src/foundation-v2.css:7-14), imported here (:23), and `<body data-ui="v2">` (:120) puts every page under the selector.
- apps/web/src/app/[locale]/layout.tsx:32-48,105 - [RBP rendering-resource-hints] CLOSED - rbp-customer:93. `siteFontClass` is gone
  (`components/public/site-fonts.ts` deleted, no importer left), so Fraunces and Nunito Sans are no longer loaded or preloaded; Playfair
  has `preload: false` (:48). Only Be Vietnam Pro preloads.
- apps/web/src/app/[locale]/layout.tsx:103-104 - [RBP async-parallel] OUT OF SCOPE - rbp-customer:90. `await fetchActiveSeason(locale)`
  then `await cookies()`, still sequential.
- apps/web/src/app/[locale]/layout.tsx:114 - [WIG Hydration Safety] NEW - see the NEW list.

## apps/web/src/components/customer/account-frame.tsx

- ✓ pass - diff adds `menuRoot` to PageBack only. No baseline finding, no new one.

## apps/web/src/components/customer/screens/book.tsx

Diff: only the two `PageBack` lines (:294, :405) gain `menuRoot`; no line shift.

- apps/web/src/components/customer/screens/book.tsx:120 - [WIG Navigation & State] OUT OF SCOPE - wizard step in `useState`.
- apps/web/src/components/customer/screens/book.tsx:394 - [WIG Forms] OUT OF SCOPE - `disabled={!nav.canContinue}` with no reason.
- apps/web/src/components/customer/screens/book.tsx:118 - [WIG Forms] OUT OF SCOPE - no unsaved-changes guard on the 4-step flow.
- apps/web/src/components/customer/screens/book.tsx:472 - [WIG Forms] OUT OF SCOPE - search placeholder = label, no "…".
- apps/web/src/components/customer/screens/book.tsx:728 - [WIG Locale & i18n] OUT OF SCOPE - slot times printed raw (also :747).
- apps/web/src/components/customer/screens/book.tsx:896 - [WIG Navigation & State] OUT OF SCOPE - "Bỏ" removes a guest with no confirm/undo.
- apps/web/src/components/customer/screens/book.tsx:153-156 - [RBP rerender-derived-state-no-effect] OUT OF SCOPE (also :146-152, :192-213).
- apps/web/src/components/customer/screens/book.tsx:487-493 - [RBP rerender-memo] OUT OF SCOPE - `groupByCategory(services.filter(...))` per render.
- apps/web/src/components/customer/screens/book.tsx:478-491 - [RBP js-combine-iterations] OUT OF SCOPE - `matchesQuery` twice per service.
- apps/web/src/components/customer/screens/book.tsx:499 - [RBP js-set-map-lookups] OUT OF SCOPE - `serviceIds.includes` per card.

## apps/web/src/components/navigation/page-back.tsx

- ✓ pass - no baseline finding. The back link is now icon only with `aria-label={label}` + `title` (:61-73, WIG icon-button rule met);
  `RouteHistoryTracker` dispatches `ls:route` after the first path (:13-19). The per-render cost of the new `hasParent` call is reported
  at its definition (lib/navigation/back.ts:68).

## apps/web/src/components/notifications/inbox.tsx

- apps/web/src/components/notifications/inbox.tsx:271 - [WIG Navigation & State] OUT OF SCOPE - wig-customer:452 (was :327). Filters in `useState`, not the URL.
- apps/web/src/components/notifications/inbox.tsx:339-341 - [WIG Navigation & State] OUT OF SCOPE - wig-customer:453 (was :396). Archive is immediate, no unarchive (menu :111-115).
- apps/web/src/components/notifications/inbox.tsx:174 - [WIG Content & Copy] OUT OF SCOPE - wig-customer:454 (was :230). Staff wording `t.open` fallback.
- apps/web/src/components/notifications/inbox.tsx:24 - [RBP bundle-barrel-imports] OPEN - rbp-customer:215. Still imports `fill, getWorkforceDictionary` from `i18n/workforce`; impact reduced: the header bell no longer imports this module (it now imports `./unread`), so the dictionary is off every public page, but the member inbox screen (customer/screens/notifications.tsx) still loads it.
- apps/web/src/components/notifications/unread.ts:19-57 - [RBP client-swr-dedup] OPEN - rbp-customer:217 (was inbox.tsx:52-90). `useUnreadCount` moved verbatim: still one fetch, one 30 s interval and one listener per instance, polling in hidden tabs.
- apps/web/src/components/notifications/unread.ts:59-86 - [RBP js-cache-function-results] CLOSED - rbp-customer:221 and the inbox part of the Intl group (rbp-customer:165). `timestampParts` now reads formatters from a module `Map` keyed by tag, zone and style; no `Intl.` constructor is left in inbox.tsx.
- apps/web/src/components/notifications/inbox.tsx:415, :436 - [RBP rerender-functional-setstate] OUT OF SCOPE - rbp-customer:223 (was :470-475, :491-497). `setFilters({ ...filters, ... })`.

## apps/web/src/components/notifications/unread.ts

- New file (split from inbox.tsx); its findings are listed under inbox.tsx above. `'use client'`, type-only contract imports, no new finding.

## apps/web/src/components/public/chat-contact.tsx

- apps/web/src/components/public/chat-contact.tsx:10-11 - [RBP bundle-dynamic-imports] CLOSED - rbp-customer:228 (was :6). `ChatPanel` is `next/dynamic(..., { ssr: false })`, mounted only when opened. The optional bundle-preload half (preload `loadChat` on hover/focus of the chat item) is not done. The doc comment at :14-15 is now true.
- WIG: ✓ pass in baseline and after.

## apps/web/src/components/public/notification-bell.tsx

- apps/web/src/components/public/notification-bell.tsx:11 - [RBP bundle-dynamic-imports] CLOSED - rbp-customer:202. Imports `./notifications/unread` instead of the staff inbox. Its remaining imports reach `i18n/notifications`, `i18n/site`, `lib/notifications` (now `fill` from `i18n/fill`, :7) and `lib/workforce/permissions` (type-only imports, :1), so `i18n/workforce` is no longer in the bell's graph. Not done: `next/dynamic` for `SignedInBell` (optional half).
- apps/web/src/components/public/notification-bell.tsx:68-88 - [RBP rerender-move-effect-to-event] OUT OF SCOPE - rbp-customer:209.

## apps/web/src/components/public/product-card.tsx

- ✓ pass - out-of-stock badge `neutral` to `warning`: the kit now adds the warning icon, so status is not colour alone. No finding.

## apps/web/src/components/public/services-list.tsx

Diff: card-level `Reveal` removed, Book button `secondary` to `primary`. Group bands still wrap in `Reveal` (:141), now a plain div.

- apps/web/src/components/public/services-list.tsx:99 - [WIG Navigation & State] OUT OF SCOPE - wig-customer:299 (was :104). Search in `useState` only.
- apps/web/src/components/public/services-list.tsx:120 - [WIG Forms] OUT OF SCOPE - wig-customer:300 (was :125). Placeholder = label.
- apps/web/src/components/public/services-list.tsx:134-160 - [WIG Performance] OUT OF SCOPE - wig-customer:301 (was :139). Every card rendered, no `content-visibility`.
- apps/web/src/components/public/services-list.tsx:1, :95-112 - [RBP server-serialization] OUT OF SCOPE - rbp-customer:252. Still `'use client'` over the whole catalog.
- apps/web/src/components/public/services-list.tsx:134-160 - [RBP rendering-content-visibility] OUT OF SCOPE - rbp-customer:256. No `content-visibility` anywhere in the CSS (grep).

## apps/web/src/components/public/site-chrome-client.tsx

- ✓ pass - diff removes `ThemeCycle`. No baseline finding, no new one.

## apps/web/src/components/public/site-chrome.tsx

- ✓ pass - diff removes the footer CTA link and the `buttonClass` import. No finding.

## apps/web/src/components/public/site-page-frame.tsx

- apps/web/src/components/public/site-page-frame.tsx:19-23 - [RBP async-suspense-boundaries] OUT OF SCOPE - rbp-customer:108. The frame still awaits three reads before any HTML.
- WIG: ✓ pass; diff only drops `siteFontClass`.

## apps/web/src/components/season/season-preview-stage.tsx

- ✓ pass - preview now forces the theme through `data-preview-theme` on `<html>` (:39-81) and restores it on unmount. No finding.

## apps/web/src/components/workforce/auth-actions.tsx

- ✓ pass - now returns `<LanguageSwitch />` only. No finding.

## apps/web/src/components/workforce/shell.tsx

- apps/web/src/components/workforce/shell.tsx:34 - [WIG Content & Copy] OUT OF SCOPE - wig-admin-a:69 (was :36). Owner subtitle 'Chủ Spa' (i18n/workforce.ts:2653).
- apps/web/src/components/workforce/shell.tsx:72 - [WIG Content & Copy] OUT OF SCOPE - wig-admin-a:70 (was :75). 'My Account' / 'My Income' (i18n/workforce.ts:4439, :4577).
- apps/web/src/components/workforce/shell.tsx:32, :51 - [RBP rerender-memo] OUT OF SCOPE - rbp-staff:94 (was :34, :53).
- apps/web/src/components/workforce/shell.tsx:141-154 - [RBP client-event-listeners] OUT OF SCOPE - rbp-staff:95 (was :143-159).

## apps/web/src/i18n/fill.ts

- ✓ pass - new 6-line module (moved from workforce.ts). No finding.

## apps/web/src/i18n/site.ts

Diff: removes the `header.theme` strings (vi and en); later lines shift by 8 (vi) and 15 (en).

- apps/web/src/i18n/site.ts:373 - [WIG Forms] OUT OF SCOPE - wig-customer:474 (was :381; en :630). Chat placeholder, no "…".
- apps/web/src/i18n/site.ts:476 - [WIG Typography] OUT OF SCOPE - wig-customer:475 (was :484; en :732). Straight quotes `"{query}"`.
- apps/web/src/i18n/site.ts:737 - [WIG Content & Copy] OUT OF SCOPE - wig-customer:476 (was :752; also :801). "See the shop other services."
- apps/web/src/i18n/site.ts:636 - [WIG Content & Copy] OUT OF SCOPE - wig-customer:477 (was :651). "Leave a phone number, we call you back".

## apps/web/src/i18n/workforce.ts

Diff: removes 4 theme strings in vi (:205-208) and en (:3017-3020) and moves `fill` to `i18n/fill.ts` (re-exported at the end). Line rule:
baseline lines below 205 unchanged, 209-3016 minus 4, above 3020 minus 8 (spot-checked at 11 lines). Every entry below is untouched copy.

- apps/web/src/i18n/workforce.ts:89 - [WIG Content & Copy] OUT OF SCOPE - wig-admin-a:475; repeated wig-pos:295 (en :2897). `errors.validation` names no field or fix.
- apps/web/src/i18n/workforce.ts:92 - [WIG Content & Copy] OUT OF SCOPE - wig-admin-a:476. `errors.forbidden` has no next step.
- apps/web/src/i18n/workforce.ts:255 - [WIG Typography] OUT OF SCOPE - wig-admin-a:477; repeated wig-admin-b:464 (en :3063). 'Đang tải tiện ích' lacks "…".
- apps/web/src/i18n/workforce.ts:2653 - [WIG Content & Copy] OUT OF SCOPE - wig-admin-a:478 with wig-admin-b:469 (:1646, also :4460, :5473). 'Chủ Spa' / 'Spa Owner' not sentence case.
- apps/web/src/i18n/workforce.ts:4439 - [WIG Content & Copy] OUT OF SCOPE - wig-admin-a:479 and wig-admin-b:468 (were :3003/:3004/:4447/:4585, now :2999, :3000, :4439, :4577). 'My Account' / 'My Income'.
- apps/web/src/i18n/workforce.ts:688 - [WIG Typography] OUT OF SCOPE - wig-admin-b:462 (also :902, :3493, :3714; :906 also). "https://zalo.me/...." uses "...".
- apps/web/src/i18n/workforce.ts:607 - [WIG Typography] OUT OF SCOPE - wig-admin-b:463 (en :3411). 'Đang tải lên' lacks "…".
- apps/web/src/i18n/workforce.ts:1125 - [WIG Typography] OUT OF SCOPE - wig-admin-b:465 (also :2444, :3937, :5266). Straight quotes.
- apps/web/src/i18n/workforce.ts:98 - [WIG Typography] OUT OF SCOPE - wig-admin-b:466 (also :99, :586, :590, :691, :1247, :1369, :1376, :2906, :2907, :3390, :3394). "10 MB" with a normal space.
- apps/web/src/i18n/workforce.ts:484 - [WIG Forms] OUT OF SCOPE - wig-admin-b:467 (also :42, :580, :592, :1302, :1461, :1860, :2148, :2217, :2347, :2541, :2599; en :2852, :3292, :3384, :3396, :4116, :4274, :4674, :4971, :5040, :5170, :5363, :5421). Search placeholders lack "…".
- apps/web/src/i18n/workforce.ts:1860 - [WIG Typography] OUT OF SCOPE - wig-pos:290 (en :4674); overlaps the :484 list.
- apps/web/src/i18n/workforce.ts:2268 - [WIG Typography] OUT OF SCOPE - wig-pos:291 (en :5091). 'Tìm mã hoặc khách' lacks "…" and an example.
- apps/web/src/i18n/workforce.ts:1948 - [WIG Typography] OUT OF SCOPE - wig-pos:292 (also :1969, :1978, :2444; en :4783, :4792, :5266). Straight quotes.
- apps/web/src/i18n/workforce.ts:2510 - [WIG Content & Copy] OUT OF SCOPE - wig-pos:293 (en :5332). INVOICE_CANCEL_NOT_ALLOWED gives no reason.
- apps/web/src/i18n/workforce.ts:2015 - [WIG Content & Copy] OUT OF SCOPE - wig-pos:294 (en :4831). WALKIN_NOT_ASSIGNABLE no next step.
- apps/web/src/i18n/workforce.ts:1903 - [WIG Content & Copy] OUT OF SCOPE - wig-pos:296 (en :4717). Generic 'Xác nhận' submit label.
- Cross-referenced from other files, same strings: widget-frame.tsx:35 (:255), discount-new.tsx:69 (:92), discount-targets.tsx:212 (:2148), website-shop-info.tsx:421 (:894, :3702), products.ts:444 (:4946, :5059 "two decimals"): all unchanged.
- apps/web/src/i18n/workforce.ts:17, :2827, :5647 - [RBP bundle-conditional] OPEN - rbp-staff:85 (Top 15 #3). vi and en still in one module; the commit edited both halves and moved `fill` out (which fixes the customer bell, see lib/notifications.ts), but the staff routes still ship both locales.

## apps/web/src/lib/navigation/back.ts

- apps/web/src/lib/navigation/back.ts:68 - [RBP js-cache-function-results] NEW - see the NEW list. WIG: no UI.

## apps/web/src/lib/notifications.ts

- apps/web/src/lib/notifications.ts:7 - [RBP bundle-barrel-imports] CLOSED - rbp-customer:172. `import { fill } from '../i18n/fill'`.
- apps/web/src/lib/notifications.ts:118, :163 - [RBP js-cache-function-results] OUT OF SCOPE - rbp-customer:165 (Intl group, this file's part). A new `Intl.DateTimeFormat` / `Intl.NumberFormat` per call.

## apps/web/src/lib/workforce/format.ts

- apps/web/src/lib/workforce/format.ts:18-26 - [WIG Locale & i18n] CLOSED - wig-admin-b:26 = wig-pos:284. `formatVnd` groups with a cached `Intl.NumberFormat` over `BigInt(value)` (the "₫" sign is still appended by hand, the grouping is Intl).
- apps/web/src/lib/workforce/format.ts:25 - [WIG Typography] CLOSED - wig-pos:285. Amount and "₫" joined by ` `.
- apps/web/src/lib/workforce/format.ts:33-50 - [WIG Locale & i18n] CLOSED - wig-admin-b:27 = wig-pos:286. `formatDate` uses a cached `Intl.DateTimeFormat` (vi-VN / en-CA, UTC on the calendar day).
- apps/web/src/lib/workforce/format.ts:86-87 - [RBP js-cache-function-results] OPEN (partial) - rbp-staff:88 (Top 15 #4). `formatTime` (:52-65) and `formatDateTime` (:67-83) now read a module `Map` cache: closed. `todayIn` still builds an `Intl.DateTimeFormat` per call (as do `zonedInstant` :114 and `zonedLocal` :135, not in the baseline).

## packages/ui/src/app-shell.tsx

Diff: the top bar becomes `<HeaderBar>`, the shell gets `data-density="compact"`; the cited hooks are untouched (line shift +1).

- packages/ui/src/app-shell.tsx:204 - [WIG Anti-patterns] OUT OF SCOPE - wig-ui:167 (was :194). Tablet scrim `<div onClick>` (low).
- packages/ui/src/app-shell.tsx:100 - [RBP rendering-hydration-no-flicker] OUT OF SCOPE - rbp-ui (was :99). Collapsed state read after hydration.
- packages/ui/src/app-shell.tsx:237-246 - [RBP rendering-hydration-no-flicker] OUT OF SCOPE - rbp-ui (was :227-235). Stored open groups after hydration.
- packages/ui/src/app-shell.tsx:104 - [RBP rerender-derived-state-no-effect] OUT OF SCOPE - rbp-ui (was :103).
- packages/ui/src/app-shell.tsx:255-257 - [RBP rerender-move-effect-to-event] OUT OF SCOPE - rbp-ui (was :245-247).
- packages/ui/src/app-shell.tsx:97 - [RBP rerender-memo] OUT OF SCOPE - rbp-ui (was :96). `arrangeNav(nav)` per render.

## packages/ui/src/auth-layout.tsx

- ✓ pass - diff stops rendering `BotanicalPattern` and adds `data-density="compact"`. Baseline pass for both skills; no new finding.

## packages/ui/src/base.css

- packages/ui/src/base.css:9 - [WIG Touch & Interaction] CLOSED - wig-ui:39. `touch-action: manipulation` on `a, button, input, select, textarea, label, summary, [role=button], [role=tab]` under `[data-ui='v2']` (packages/ui/src/foundation-v2.css:11-14); `<body data-ui="v2">` covers every page.
- packages/ui/src/base.css:9 - [WIG Touch & Interaction] CLOSED - wig-ui:40. `-webkit-tap-highlight-color: transparent` on `html` (packages/ui/src/foundation-v2.css:7-9).
- packages/ui/src/base.css:9 - [WIG Touch & Interaction] OPEN - wig-ui:41. Still no `overscroll-behavior: none` on `html` inside `@media (pointer: fine)` (grep: none in the kit); the commit added the other two touch rules but not this one.
- New block :96-109 (the `ls-fx=off` / `data-ls-motion=reduced` kill): ✓, honours the off switch from the first paint.

## packages/ui/src/chrome-v2.css

- ✓ pass - diff only removes the `.ls-theme-cycle` selectors.

## packages/ui/src/components-v2.css

- ✓ pass - diff: secondary hover lift/zoom/arrow removed, colour-step hover (fine pointer) and `:active` pressed steps for every variant (:112-172), danger menu item tint. Hover and pressed states are stronger than rest; no `transition: all`; the press `scale` is a transform.

## packages/ui/src/count-up.tsx

- ✓ pass - now a server-safe, effect-free component (no `'use client'`). Baseline pass; no new finding.

## packages/ui/src/feedback.tsx

Diff: `Badge` only (status tones get a default icon, size 16; `icon={false}` hides it).

- packages/ui/src/feedback.tsx:84 - [WIG Accessibility] OUT OF SCOPE - wig-ui:158 (was :78). `Notice` dismiss button: `dismissLabel` optional (:67).
- packages/ui/src/feedback.tsx:254 - [WIG Animation] OUT OF SCOPE - wig-ui:159 (was :248). `ProgressBar` inline `width`.
- packages/ui/src/feedback.tsx:1 - [RBP 'use client' placement] OPEN - rbp-ui ('use client' item). Still a client module for stateless Badge, Skeleton, EmptyState; the commit edited `Badge` and left the directive.

## packages/ui/src/form.tsx

- packages/ui/src/form.tsx:125 - [WIG Accessibility] OUT OF SCOPE - wig-ui:133. Inline `.ls-error` has no `role`/`aria-live`.
- packages/ui/src/form.tsx:245 - [WIG Forms] OUT OF SCOPE - wig-ui:134 (was :230). `'dd/mm/yyyy'` placeholder lacks "…".
- packages/ui/src/form.tsx:256-258 - [RBP rerender-derived-state-no-effect] OUT OF SCOPE - rbp-ui (was :241-243). DateTextInput.
- packages/ui/src/form.tsx:786-788 - [RBP rerender-derived-state-no-effect] OUT OF SCOPE - rbp-ui (was :770-772). SearchInput.
- packages/ui/src/form.tsx:604 - [RBP rerender-memo] OUT OF SCOPE - rbp-ui (was :576-594). Combobox hover re-renders the list.
- packages/ui/src/form.tsx:155, :210, :361 - [WIG Forms] NEW - see the NEW list (`name` from a generated id).
- Positive: `TextInput`/`NumberInput` now default `autoComplete="off"` on work fields and `spellCheck={false}` on email/url/password/tel (:146-157, :211); every customer `TextInput` passes its own `autoComplete` (checked), so personal-data autofill is unaffected.

## packages/ui/src/foundation-v2.css

- New file. ✓ pass. Checked: no `transition`/animation of layout properties, hover only under `(hover: hover) and (pointer: fine)`, `:active` steps for links, nav, chips, tabs, menu items, rows (:61-173); `scroll-padding-top` for the staff bar (:17-19); select colours set for Windows dark (:272-280); wide tables scroll in place with `overscroll-behavior-x: contain` (:284-289); truncation replaced by `overflow-wrap: break-word` (:348-355). It closes base.css:9 (two entries) and half of shell.css:13.

## packages/ui/src/header-bar.tsx

- New file. ✓ pass - server-safe (no hooks), one `<header>`, slots only. No finding.

## packages/ui/src/index.tsx

- packages/ui/src/index.tsx (barrel, ~385 lines) - [RBP bundle-barrel-imports] OPEN - rbp-ui (LOW, mitigated). The commit removed the theme exports but the barrel still re-exports charts, dnd-kit and season art; production tree-shaking unchanged.
- WIG: baseline pass. Pre-existing, touched, not in baseline: :12-29 wordmark without `translate="no"` (see Notes).

## packages/ui/src/motion.ts

- ✓ pass (rbp-ui baseline pass; the minor `makeKit.read` getComputedStyle note stands). New code: compact-scope clamp via a Proxy (:183-226) and a route-change kill (:229-236, :298-302). No counted finding; see Notes.

## packages/ui/src/pages-v2.css

- ✓ pass - diff: `.ls-svc-card` gets `grid-template-rows: auto 1fr auto`. The baseline note (thumb hover) is counted under site.css:3056.

## packages/ui/src/reveal.tsx

- packages/ui/src/reveal.tsx:1-19 - [RBP js-batch-dom-css] CLOSED - rbp-ui (was :53-54, Top 10 #9). `Reveal` is now a plain server-safe `<div>`: no effect, no layout read, no `dataset` write, no GSAP.

## packages/ui/src/route-enter.tsx

- ✓ pass - diff is the doc comment; the 120 ms opacity fade is in shell.css (:132-138) with `--ls-dur-route` zeroed under reduced motion (tokens.css).

## packages/ui/src/season-css.ts

- ✓ pass - dark selectors move from `data-theme` to `data-preview-theme`; generator only.

## packages/ui/src/season.css

- ✓ pass - generated output of season-css.ts (the `data-theme` blocks removed, `data-preview-theme` selectors added).

## packages/ui/src/shell.css

Diff: theme-toggle and auth-pattern rules removed, route enter is a fade, group dividers are borders. None of the cited rules changed.

- packages/ui/src/shell.css:13 - [WIG Focus States] OPEN (partial) - wig-ui:91. Top half CLOSED: `scroll-padding-top: calc(var(--ls-topbar-h) + var(--ls-space-4))` for staff pages (packages/ui/src/foundation-v2.css:17-19). Bottom half open: no `scroll-padding-bottom` for the phone sticky form footer (components.css:1254).
- packages/ui/src/shell.css:116 - [WIG Focus States] OUT OF SCOPE - wig-ui:92. `.ls-content:focus { outline: none }` (low).
- packages/ui/src/shell.css:142-149 - [WIG Animation] OUT OF SCOPE - wig-ui:93 (was :144). `.ls-sidebar-slot` transitions `width`.
- packages/ui/src/shell.css:166 - [WIG Touch & Interaction] OUT OF SCOPE - wig-ui:94 (was :170). `.ls-nav` has no `overscroll-behavior: contain`.
- packages/ui/src/shell.css:201-206 - [WIG Animation] OUT OF SCOPE - wig-ui:95 (was :197). Sidebar pill transitions `width`.
- packages/ui/src/shell.css:275-286 - [WIG Animation] OUT OF SCOPE - wig-ui:96 (was :274). `.ls-nav-collapse` animates `grid-template-rows`.
- packages/ui/src/shell.css:871 - [WIG Focus States] OUT OF SCOPE - wig-ui:97 (was :958). `.ls-auth-main:focus { outline: none }` (low).
- packages/ui/src/shell.css:948-955 - [WIG Animation] OUT OF SCOPE - wig-ui:98 (was :1039). Sign-in inputs transition `outline-offset` (low).

## packages/ui/src/site-header.tsx

- ✓ pass - now renders `<HeaderBar>`; still an IntersectionObserver sentinel, no scroll listener. No finding.

## packages/ui/src/site.css

Diff: theme-cycle selectors removed, wordmark size tokens. None of the cited rules changed.

- packages/ui/src/site.css:20 - [WIG Focus States] OUT OF SCOPE - wig-ui:102. `.ls-site-main:focus { outline: none }` (low).
- packages/ui/src/site.css:1356 - [WIG Focus States] OUT OF SCOPE - wig-ui:103 (was :1357). `.ls-booking-step-title:focus` (low).
- packages/ui/src/site.css:1603-1622 - [WIG Animation] OUT OF SCOPE - wig-ui:104 (was :1620). `.ls-nav-pill` transitions `width`.
- packages/ui/src/site.css:3056 - [WIG Hover & Interactive States] OUT OF SCOPE - wig-ui:105 (was :3060). `.ls-prod-thumb` has no `:hover` (nor pages-v2.css:1606).

## packages/ui/src/staff.css

- ✓ pass - diff: the staff wordmark size is a type token.

## packages/ui/src/toast.tsx

- packages/ui/src/toast.tsx:72 - [WIG Accessibility] CLOSED - wig-ui:129 (was :71). The persistent region has `aria-live="polite"`. The optional `role="alert"` for danger toasts was not added.
- RBP: baseline pass; no new finding.

## packages/ui/src/tokens.css

- packages/ui/src/tokens.css:137-139 - [WIG Safe Areas & Layout] OUT OF SCOPE - wig-ui:45 (was :138). Still no `--ls-safe-top` (grep: no `safe-area-inset-top` in the kit).
- Diff otherwise: `color-scheme: light dark` on `:root` (:5) and `dark` in the dark blocks; `data-theme` selectors become `data-preview-theme`; neutral hover tokens; the compact type scale. ✓ no new finding.
