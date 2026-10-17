# Step 7 final code audit: KIT (packages/ui) and shared app chrome

Read-only audit, 2026-10-16. **Current code = the working tree** (HEAD a520a50 plus the uncommitted Steps 4-6: 24 modified kit files,
`header-fit.tsx` and seven `s10-*.css` sheets untracked). Line numbers are the working tree.

- Rules: web-design-guidelines `command.md` fetched fresh 2026-10-16 (191 lines, raw.githubusercontent.com/vercel-labs/web-interface-guidelines/main),
  sentence case instead of Title Case (project rule); vercel-react-best-practices (SKILL.md + AGENTS.md + rule files); vercel-react-view-transitions
  `references/implementation.md` Step 1 audit + `css-recipes.md`; DESIGN.md section 17 (G1-G8).
- Scope: every non-test `.ts`/`.tsx` in `packages/ui/src`; the CSS files named in the brief for the CSS-applicable rules; the lead's app files
  (`[locale]/layout.tsx`, `app/globals.css`, `components/navigation/page-back.tsx`, `components/workforce/{shell,link,language-switch,ui,auth-actions}.tsx`
  and `data.ts` (no `data.tsx` exists), `components/public/{site-chrome,site-chrome-client,site-page-frame,page-transition,site-scroll-manager,site-session}.tsx`,
  `lib/navigation/back.ts`). **Added to scope** (live, imported by `[locale]/layout.tsx:25-31`): `header-fit.tsx` and `s10-{public,member,account,pos,admin-a,admin-b,admin-c}.css`
  (CSS-rule greps only). `customer.css`/`customer-pages.css` still exist and are imported (layout.tsx:17-18); covered by the baseline.
- Method: every baseline entry re-located by selector/identifier (not by line); CLOSED only where the current code was opened. Partial fixes
  count as OPEN (Step 3 rule). No OUT OF SCOPE status this time: the whole kit is in scope. NEW = not in any baseline.
- Baselines: `wig-ui.md` (65), `rbp-ui.md` (49), `step3-reaudit.md` (its 3 NEW + its in-scope items), and the entries of other Step 1 audits that
  sit in the lead's app files (wig-customer, wig-admin-a, rbp-customer, rbp-staff: 13). `vt-audit.md` VT1-VT6 in the VT section.

## Summary

| Baseline                              | Entries | Closed              | Open                          |
| ------------------------------------- | ------- | ------------------- | ----------------------------- |
| wig-ui                                | 65      | 14                  | 51                            |
| rbp-ui                                | 49      | 8                   | 41                            |
| step3-reaudit NEW (in scope)          | 3       | 3                   | 0                             |
| other Step 1 audits, lead's app files | 13      | 3                   | 10                            |
| **Total**                             | **130** | **28**              | **102**                       |
| vt-audit VT1-VT6                      | 6       | 3 fixed + 3 were OK | 0 (2 drifted, see VT section) |

NEW open findings: **WIG 9**, **RBP 6** (plus 4 uncounted notes). The kit-wide "checked and clean" paragraph of wig-ui still holds (no
`transition: all`; reduced-motion kill base.css:86-95 + tokens.css:307/:1309 + base.css:97-109 for `ls-fx=off`/reduced mark; keyframes
transform/opacity only; one `:focus-visible` ring base.css:76; `color-scheme` tokens.css:5/:342/:409; select colours now explicit
foundation-v2.css:271-280; IconButton requires `label`; no autoFocus/onPaste/user-scalable). Every new `outline: none/0` in the s10 sheets has a
replacement ring (s10-member.css:138 -> :148; s10-public.css:310 -> :314; s10-pos.css:71 is `:focus:not(:focus-visible)`; s10-public.css:173 is hover only).

## CLOSED (28)

wig-ui (14)

- wig-ui:39 touch-action - `touch-action: manipulation` on controls, foundation-v2.css:11-14 (body `data-ui="v2"`, layout.tsx:126).
- wig-ui:40 tap highlight - `-webkit-tap-highlight-color: transparent`, foundation-v2.css:7-9.
- wig-ui:49 / :54 popover + listbox overscroll - `[data-ui='v2'] :is(.ls-popover, .ls-bell-list, .ls-listbox, ...) { overscroll-behavior: contain }`, components-v2.css:233-235, now global.
- wig-ui:55, :57, :63, :65, :66, :67 heading `text-wrap: balance` (form-section, dialog, list-section, card, kpi-label, page titles) - all are h1-h3, covered by `:where([data-ui='v2']) :is(h1..h6)`, base.css:39-44.
- wig-ui:60 `.ls-th-sort` hover - foundation-v2.css:478-481 (fine pointer), pressed :474.
- wig-ui:62 `.ls-page-btn` tabular-nums - components-v2.css:1016-1023, now global.
- wig-ui:129 toast live region - `aria-live="polite"` on the persistent region, toast.tsx:76.
- wig-ui:209 theme-color vs cookie theme - `theme-core.ts` deleted; theme follows the device; `themeColor` per `prefers-color-scheme`, layout.tsx:79-83.

rbp-ui (8)

- rbp-ui:149 reveal layout reads - `Reveal` is a plain server-safe `<div>`, reveal.tsx:9-19.
- rbp-ui:154 `column.cell(row)` twice - the mobileTitle tooltip (`nodeText`) is removed, data-table.tsx:303-306/:337-347.
- rbp-ui:165, :166, :170, :174, :178, :183 theme files - `use-theme.ts`, `theme-cycle.tsx`, `theme-toggle.tsx`, `theme-core.ts`, `theme-script.tsx` deleted; no importer left (grep).

step3-reaudit NEW (3)

- `[locale]/layout.tsx:114` stray `suppressHydrationWarning` - removed (layout.tsx:119-124).
- `form.tsx:155/:210/:361` name from a generated id - `callerName()` drops `useId` tokens, form.tsx:148-150, used at :162, :217, :464.
- `lib/navigation/back.ts:68` `hasParent` rebuilds keys - `TAB_PREFIXES` hoisted (back.ts:64), path joined once (:71).

Other Step 1 audits, lead's app files (3)

- wig-customer:37 layout touch-action/tap highlight - foundation-v2.css:7-14 (same fix as wig-ui:39/:40).
- rbp-customer:93 font preloads - `site-fonts.ts` deleted, Playfair `preload: false` (layout.tsx:56); only Be Vietnam Pro preloads.
- rbp-staff:89 `link.tsx` forced full prefetch - `prefetch ?? (mayPrefetch() ? null : false)`: Next default (`auto`), link.tsx:23.

## OPEN baseline (102)

wig-ui (51), most important first

- base.css (no line) [Touch] no `overscroll-behavior: none` on `html` inside `@media (pointer: fine)` (wig-ui:41).
- tokens.css:138-140 [Safe areas] no `--ls-safe-top`; sticky `.ls-topbar` (shell.css:12) / `.ls-site-header` clear no top inset (wig-ui:45).
- components.css:631-640 [Safe areas] `.ls-toast-region` bottom without `--ls-safe-bottom` (wig-ui:52).
- components.css:1252-1261 [Safe areas] phone sticky `.ls-form-actions` without `--ls-safe-bottom` (wig-ui:56).
- components.css:1406-1415 [Safe areas] side drawers clear no inset (wig-ui:58).
- shell.css:12-13 [Focus] OPEN (partial): top `scroll-padding-top` fixed (foundation-v2.css:17-19), no `scroll-padding-bottom` for the phone sticky form footer (wig-ui:91).
- form.tsx:127 [A11y] inline `.ls-error` not announced (wig-ui:133).
- date-range-picker.tsx:140-150 [A11y] `role="dialog"` popover without a name (wig-ui:146).
- choice-card.tsx:65 [A11y] `extra` inside the `<label>` (wig-ui:150).
- kpi-card.tsx:51 [A11y] info IconButton has no tap action (wig-ui:154).
- feedback.tsx:67, :84 [A11y] `dismissLabel` optional on an icon-only close (wig-ui:158).
- form-overlay.tsx:69-79 (+ overlay.tsx:75) [Touch] first field focused on touch too (wig-ui:142).
- components.css:607-613 + feedback.tsx:254 [Animation] progress fill transitions `width` (wig-ui:51, :159).
- shell.css:142-150, :201-206, :275-286 [Animation] sidebar slot `width`, sidebar pill `width`, nav collapse `grid-template-rows` (wig-ui:93, :95, :96).
- components.css:771-775, shell.css:948-956 [Animation] `outline-offset` transitions (low) (wig-ui:53, :98).
- site.css:1603-1622 [Animation] dead `.ls-nav-pill` with a `width` transition: delete (wig-ui:104).
- shell.css:166-177 [Touch] `.ls-nav` no `overscroll-behavior: contain` (wig-ui:94).
- components.css:3731-3736 [Touch] dragged sortable item: no `user-select: none`/`inert` (wig-ui:64).
- components.css:1633-1636 [Focus] `.ls-media-tile:focus-within` rings on mouse click; use `:has(:focus-visible)` (wig-ui:59).
- shell.css:116-118, :871-873, site.css:20-22, :1356-1358 [Focus] `:focus { outline: none }` on programmatic targets (low) (wig-ui:92, :97, :102, :103).
- site.css:3056, season-art.css:326, season-preview.css:60 [Hover] `.ls-prod-thumb`, `.ls-art-fx-switch`, `.ls-season-card` no hover (wig-ui:105, :117, :125).
- components.css:590 [Typography] `.ls-empty-title` is a `<p>`: the heading balance does not reach it (wig-ui:50).
- components.css:2927-2932 [Typography] `.ls-pagination-summary` not tabular (wig-ui:61).
- confirm-dialog.tsx:173-179 [Forms] type-to-confirm field lacks `spellCheck={false}`/`autoCapitalize="off"` (wig-ui:138).
- form.tsx:252 [Forms] `dd/mm/yyyy` placeholder without "…" (low) (wig-ui:134).
- popover.tsx:50-64, :151 [Performance] probe + `getBoundingClientRect` per scroll, no rAF (wig-ui:163).
- pagination.tsx:73, form-core.ts:20-22, image-core.ts:35-43 [Locale] raw numbers / regex grouping / `toFixed` instead of `Intl.NumberFormat` (wig-ui:197, :201, :205).
- app-shell.tsx:219 [Anti-pattern] tablet scrim `<div onClick>` (low) (wig-ui:167).
- data-table.tsx:157 [Navigation] uncontrolled sort only in `useState` (low) (wig-ui:213).
- image-uploader.tsx:249; media-grid.tsx:39, :52, :97, :147, :232; season-scene.tsx:208, :245, :463; season-slot-row.tsx:35; season-site-fx.tsx:224 [Images] 11 images without `width`/`height` (wig-ui:171-193).

rbp-ui (41), most important first

- season-site-fx.tsx:13-17 [bundle-conditional] full season art statically imported by the particle layer (HIGH) (rbp-ui:89).
- app-shell.tsx:102, :252-261 [rendering-hydration-no-flicker] sidebar collapsed state and open groups applied after hydration (rbp-ui:96, :97).
- contact-fab.tsx:106, :125/:172, :163-173 [js-batch-dom-css / client-event-listeners] style reads per scroll, two scroll subscriptions, subtree MutationObserver (rbp-ui:104-106).
- motion-gate.tsx:20-39 [rendering-hydration-no-flicker] OPEN (partial): `ls-fx=off` is now server-set (layout.tsx:115, :123; base.css:97-109); data saver / low memory still marked after hydration (rbp-ui:110).
- sortable.tsx:3-21 [bundle-conditional] `@dnd-kit/*` static (rbp-ui:118).
- popover.tsx:50-64/:125-151, :98/:140, :179 [js-batch-dom-css, rerender-use-ref-transient-values, advanced-event-handler-refs] (rbp-ui:122-124).
- charts.tsx:89-121, :397, :298, :141-145; chart-core.ts:129 [rerender-memo, js-cache-function-results, rendering-hoist-jsx] (rbp-ui:128-131, :136).
- date-range-picker.tsx:238/:291/:326, :189/:330-331; date-range-core.ts:174/:186/:196 [js-cache-function-results, rerender-memo] (rbp-ui:140, :141, :145).
- data-table.tsx:171-180, :289-313, :178 [rerender-dependencies, rerender-memo, js-cache-function-results] (rbp-ui:153, :155, :156).
- use-media-query.ts:14-19 [client-event-listeners] new `subscribe` per render (rbp-ui:161).
- season-site-fx.tsx:41/:137-153, :204-241, :130-135 [js-request-idle-callback, rerender-memo, client-event-listeners] (rbp-ui:90-92).
- app-shell.tsx:106, :270-272, :98-99 [rerender-derived-state-no-effect, rerender-move-effect-to-event, rerender-memo] (rbp-ui:98-100; :99 now also runs `currentContext(groups)` per render).
- form.tsx:263-264, :892-893, :582/:707; form-core.ts:47-51 [rerender-derived-state-no-effect x2, rerender-memo, js-cache-function-results] (rbp-ui:200-202, :206).
- season-fx-core.ts:13 [js-hoist-regexp]; season-particles.tsx:62, :102-107; tabs.tsx:103-114 [rendering-activity]; sliding-pill.ts:78-82; brand-icons.tsx:8-19 [svg-precision] (rbp-ui:187-218).
- index.tsx:1-390 [bundle-barrel-imports] mitigated, LOW (rbp-ui:85).
- feedback.tsx:1, card.tsx:1, kpi-card.tsx:1, image-frame.tsx:1, button.tsx:1 ['use client' placement] (rbp-ui:222).

Other Step 1 audits, lead's app files (10)

- `[locale]/layout.tsx:111-112` [rbp async-parallel] `await fetchActiveSeason()` then `await cookies()` (rbp-customer:90).
- site-page-frame.tsx:19-23 [rbp async-suspense-boundaries] the frame awaits three reads before any HTML (rbp-customer:108).
- workforce/ui.tsx:196-222 + data.ts:16-21 [rbp client-swr-dedup] `useResource` no cache/dedupe (rbp-staff:92).
- workforce/data.ts:31-51 [rbp client-swr-dedup] `useEmployeeNames` up to 5 serial pages per mount (rbp-staff:93).
- workforce/link.tsx:12-13, :23 [rbp js-cache-function-results] `mayPrefetch()` (matchMedia) per link render (rbp-staff:90).
- workforce/shell.tsx:32, :51 [rbp rerender-memo] `navigationFor`/`sidebarGroups` per render (rbp-staff:94).
- workforce/shell.tsx:146-147 [rbp client-event-listeners] second global focus/visibilitychange pair (rbp-staff:95).
- workforce/language-switch.tsx:25-33 [WIG Locale] language names/codes without `translate="no"` (wig-admin-a:47).
- workforce/shell.tsx:34-37 [WIG Copy] OPEN (partial): vi fixed ('Chủ spa', workforce.ts:2786), en 'Spa Owner' still Title Case (workforce.ts:5739) (wig-admin-a:69).
- workforce/shell.tsx:67 user menu [WIG Copy] 'My Account' / 'My Income' Title Case (workforce.ts:3136-3137) (wig-admin-a:70).

## NEW open findings

WIG (9), most important first

1. apps/web/src/components/public/site-chrome-client.tsx:94-102 [Accessibility] customer language link shows "EN" but its name is `switchLanguage` = "English" (site.ts:351): the visible text is not in the accessible name (label in name) — use `${name} (EN)` as the staff `LanguageSwitch short` does (language-switch.tsx:30), and add `translate="no"`.
2. packages/ui/src/form.tsx:345-349, :360, :371-381 [Forms] `DateTimeInput` keeps a stale value: clearing the date with a time present, or the time with a date present, reports nothing, so the old `YYYY-MM-DDTHH:mm` is saved while the time box shows empty (the date box restores the old date on blur, the time box does not) — report '' whenever either part is incomplete or invalid, and restore the time text on blur like `DateTextInput`.
3. apps/web/src/components/workforce/language-switch.tsx:23 + site-chrome-client.tsx:96 [Navigation & State] switching language rebuilds the URL from `pathname` only, dropping the query (list filters, page, sort, booking step) — append `useSearchParams().toString()`.
4. packages/ui/src/s10-member.css:244-247 [Safe areas & layout] `.ls-mem-aside` is sticky from 1024 px with a compact-header offset; it is not in the large-text exemption (foundation-v2.css:663) nor the `max-height: 560px` block (:238), so at 200 % text a tall aside is cut off below the fold until the column ends — add it to both.
5. packages/ui/src/toast.tsx:125-136 [Accessibility] the C72 undo action lives in a toast at the end of the document for 8 s: a keyboard user has to tab through the whole page to reach it (pause starts only once focused) — keep action toasts until dismissed, or offer a shortcut / move focus intent (e.g. `aria-keyshortcuts` + a key that focuses the newest action).
6. packages/ui/src/toast.tsx:76, :114 [Accessibility] each toast is `role="status"` (an implicit polite live region) inside a region that is already `aria-live="polite"`: nested live regions can announce twice in some screen readers — drop `role="status"` from the item (keep the region), use `role="alert"` only for danger.
7. packages/ui/src/index.tsx:11-31 [Locale & i18n] the "Lucy Spa" wordmark (every header, footer, auth card) has no `translate="no"`; browser translation renames the brand (Step 3 note, now counted).
8. packages/ui/src/form.tsx:366 [Typography/Forms] `DateTimeInput` time placeholder "HH:mm" lacks "…" (low; same pattern as wig-ui:134).
9. packages/ui/src/form.tsx:362-370 [Forms] the time box turns `invalid` (red) at 5 characters with no message or `aria-describedby`; errors must say what to fix inline (low).

RBP (6), most important first

1. apps/web/src/components/public/site-scroll-manager.tsx:21-23 [js-batch-dom-css / client-event-listeners] every scroll event on every customer page below 1024 px runs `findScroller()` twice (the explicit call plus `scrollPosition()`'s default argument): 2 x `querySelector` + `getComputedStyle` per event, next to ContactFab's own scroll subscription (rbp-ui:104-106) — resolve the scroller once (re-resolve on resize) and call `scrollPosition(scroller)`; share one page-scroll store with ContactFab. (MEDIUM-LOW)
2. packages/ui/src/header-fit.tsx:22-32 [rendering-hydration-no-flicker] sticky vs static is decided in a rAF after hydration: at 200 % browser text size the bar paints sticky and then jumps to static (zoom is already CSS, foundation-v2.css:238) — add `@media (max-height: 35em)` (media-query `em` follows the user's text size) next to the 560 px block so the decision is CSS from the first paint; keep the observer only for the wrapped-nav case. (LOW-MEDIUM)
3. packages/ui/src/chart-parts.tsx:38-57 [client-event-listeners] `useTextScale` adds a `resize` listener and a `MutationObserver` on `<html>` per chart (the dashboard renders many), and HeaderFit already computes the same root size and sets `html[data-text-large]` — one module-level `useSyncExternalStore` store (or read the attribute). (LOW)
4. packages/ui/src/form.tsx:341-344 [rerender-derived-state-no-effect] `DateTimeInput` copies `timePart` into state in an effect (same pattern as rbp-ui:200) — adjust during render with a previous-value ref. (LOW)
5. apps/web/src/app/[locale]/layout.tsx:25-31 [bundle-conditional, CSS analogue] all seven area sheets (s10-public/member/account/pos/admin-a/b/c, about 2,460 lines) load on every route of every area — import each in its area layout (`(site)`, `account`, `workforce`). (LOW)
6. packages/ui/src/motion.ts:183-226 [motion wrapper, G5 enforcement] the compact 200 ms clamp proxies only `to`/`from`/`fromTo`; `gsap.timeline({ defaults })`, `tl.to()`, `gsap.set`, `quickTo` and `stagger` pass unclamped, and no property check enforces "transform/opacity only" — wrap `timeline()` (clamp `defaults` and child vars) and reject non-transform/opacity keys in the probe. Latent: no current caller uses them. (LOW)

Notes (not counted)

- motion.ts:233-236, :299-302 a route change reverts every live context, including chrome that survives navigation (Step 3 note; still only `step-slide.ts` and `home-hero.tsx` use the wrapper, both page-level).
- components.css:247-252 `@keyframes ls-content-in` (a rise) is now unused (route-enter is the 120 ms fade); delete with its stale comment. chart-parts.tsx:147 leaves an orphaned JSDoc ("Legend for two or more series") above `ChartKey`.
- app-shell.tsx:388 `name.trim().split(/\s+/).pop()` per UserMenu render and back.ts:46-47 `rest.join('/')` twice per entry: trivial.
- `scroll-padding-top` (foundation-v2.css:18, chrome-v2.css:49) stays when the header turns static (`data-fit`, 560 px block): focus/anchor scrolls stop one bar-height low (harmless, not covering).

## View-transition audit (implementation.md Step 1) and motion (G1-G8)

VT inventory

- Route VT: `page-transition.tsx:32` `<ViewTransition name="ls-page" update={{'ls-nav':'ls-fade', default:'none'}} default="none">` in the `(site)` layout (persistent parent, so page-level SharedPhoto VTs still fire). Links carry `transitionTypes={NAV_TRANSITION}` (site-chrome.tsx, site-chrome-client.tsx, page-back.tsx:68). Fallback without the API: WAAPI opacity 0.6 -> 1 over `--ls-dur-base`, gated by `motionAllowed` (page-transition.tsx:20-29). OK.
- Shared elements: `shared-photo.tsx:13-17` `share={{'ls-nav':'ls-morph', default:'ls-morph'}} default="none"` (explicit share, so `default="none"` does not kill the morph; untyped back pairs). Pairs: service card (service-card.tsx:50, list only via services-view.tsx:108) -> service detail (services-view.tsx:181); product card (product-card.tsx:65; home row home-product-row.tsx:29, list products-view.tsx:347) -> gallery first slide or empty frame (product-gallery.tsx:67, :90). Names unique per page (one home product row; related cards default `sharePhoto=false`). OK.
- Persistent isolation: tab bar and contact button named, `animation: none`, `z-index: var(--ls-z-chrome)`, old hidden (site.css:1525-1559); live root (old root hidden, new root no animation); `::view-transition { pointer-events: none }` (site.css:1533). Header not named (in flow above the page; backdrop-blur workaround not needed). OK.
- Reduced motion: `prefers-reduced-motion` zeroes `--ls-dur-*` on `:root` (tokens.css:307-316, :1309-1320), and the UA gives `::view-transition-old/new` `animation-duration: inherit` from the group, so page fade and morph are instant; `html[data-ls-motion='reduced']` sets `animation: none` on ls-page and `.ls-morph` (site.css:1582-1589). Gap (LOW): no rule for `html[data-ls-fx='off']` before MotionGate marks the page, and no catch-all `::view-transition-*(*)` recipe — add the css-recipes reduced-motion block for `@media (prefers-reduced-motion: reduce)` and `html[data-ls-fx='off']`.
- Drift (LOW): the VT pseudo-elements originate on `<html>`, so `var(--ls-dur-base)`/`var(--ls-dur-slow)` resolve to the `:root` values (200 / 250 ms, tokens.css:167-168), not the v2 customer values the comments and vt-audit VT2/VT3 cite (240 / 320 ms, tokens.css:721-722, set on `[data-ui='v2']`, never on `html`) — declare VT durations on `:root:has(.ls-site)` or use dedicated tokens.
- Back navigation: `page-back.tsx:58` uses `router.back()` (no transition type), so the `ls-nav` page fade never runs on Back while the untyped morph does; the vt-audit plan ("back chevron uses router.push with type") is not done. Browser back behaves the same. LOW.
- Suspense reveals: `loading.tsx` boundaries snap to content under the live root (vt-audit decision kept). OK.

vt-audit baseline

- VT1 staff route 360 ms rise: FIXED - `RouteEnter` marks only navigations (route-enter.tsx:25-33), `.ls-route-enter[data-enter='route']` = `ls-fade-in` over `--ls-dur-route` 120 ms, opacity only (shell.css:128-138; token tokens.css:1293, 0 under reduced :1318).
- VT2 / VT3 fade and morph durations: were OK; now drifted (see above: 200 / 250 ms in practice).
- VT4 GSAP Reveal on SharedPhoto cards: FIXED - Reveal is a plain div (reveal.tsx:9-19).
- VT5 header backdrop blur: OK (not named).
- VT6 booking stepper: FIXED - step in the URL (`useUrlState`, book.tsx:175) and animated with `useStepSlide` (book.tsx:212).

G-rules (DESIGN.md 17.3)

- G7 GSAP never on a ViewTransition element: HOLDS. Only two `useMotion` callers: `step-slide.ts:28-41` (booking step container) and `home-hero.tsx:47-60` (hero picture); neither target is or contains a `SharedPhoto`; both are inside the layout-level `ls-page` VT, which animates only on `ls-nav` transitions, and `ls:route` kills both tweens on the pathname change before the snapshot settles. The brand-band marquee is CSS (pages-v2.css:227-273), not GSAP.
- Transform/opacity only: HOLDS by convention (step-slide `x`+`opacity`, hero `scale`, `clearProps`); not enforced by the wrapper (RBP NEW 6).
- No literal durations: HOLDS - both callers use `kit.duration('base' | 'hero')`; motion.ts:197 `0.5` is the probe's default label only.
- Killed on unmount and route change: HOLDS - cleanup reverts the context (motion.ts:304-310); `RouteHistoryTracker` dispatches `ls:route` after the first path (page-back.tsx:12-19), one listener reverts every live context (motion.ts:229-236, :299-302); motion turning off reverts too (:285-290).
- 200 ms clamp in compact scope: HOLDS for `to`/`from`/`fromTo` (motion.ts:183-226) and duration tokens (`clampDurationMs`, :246-247); not for timelines/`set`/`quickTo` (RBP NEW 6, latent).
- G6 reduced / data saver / `ls-fx=off`: base.css:86-109 zero every CSS animation and transition; the wrapper never loads GSAP unless `motionState() === 'full'` (motion.ts:281-296). Data saver and low memory still depend on the post-hydration mark (rbp-ui:110 partial).

## Fixes (Step 7)

Kit and lead chrome worker, 2026-10-16. Skills read: web-design-guidelines (fetched fresh; the cached `.local/s10/wig-command.md`
for the full rule list), vercel-react-best-practices (SKILL.md + rule files: rendering-hydration-no-flicker, client-event-listeners,
bundle-conditional, rerender-derived-state-no-effect, js-batch-dom-css), react-view-transitions (SKILL.md, css-recipes reduced-motion,
router.back note), frontend-design. Line numbers below are the working tree after the fixes.

### Priority items (lead brief)

- DateTimeInput stale value (WIG NEW 2) - fixed: form.tsx:333-433. Date and time live in local state; only a whole date with a whole,
  valid time is a value, otherwise `''` is reported (never the old value), external values adjust in render (`seen`, :370). The typed
  time stays; leaving it incomplete marks it invalid and, with the new `timeError` prop, shows and announces the message
  (`aria-describedby`, live region :423). Tests: date-text-input.test.tsx (2 new).
- Customer language link (WIG NEW 1, NEW 3) - fixed: site-chrome-client.tsx:89-124 (name "English (EN)", `translate="no"`, query kept);
  staff switch language-switch.tsx:14-57 (`translate="no"`, query kept). `useSearchParams` sits behind a Suspense whose fallback is the
  same link without the query (prerender-safe, no build needed to prove it).
- season-site-fx static art imports (rbp-ui:89, HIGH) - fixed: season-site-fx.tsx:35-53 `loadParticleArt` (one dynamic import per kit,
  only once a layer is about to draw); `safeImageUrl` moved to season-url.ts (season-scene.tsx re-exports it). Test: season-site-fx.test.tsx.
- Scroll reads per event (RBP NEW 1, rbp-ui:104-106) - fixed: scroller.ts:25-87 one page-scroll store (one passive capture listener, rAF
  per burst, scroller cached until resize or `ls:route`); site-scroll-manager.tsx:23-39 and contact-fab.tsx:105-190 (one subscription,
  the subtree observer only reacts when an action bar comes or goes, the lift is written only when it changes). Tests updated:
  contact-fab-away.test.tsx waits for the frame (same intent).
- App-shell sidebar after hydration (rbp-ui:96, :97) - fixed: the remembered rail and open groups are cookies too (shell-core.ts:90-150,
  `ls_rail`, `ls_nav`), read by the root layout (layout.tsx:145) into `ShellPreferencesProvider` (app-shell.tsx:73-100), so the server
  renders the sidebar as left; no jump, no hydration mismatch. A device with only the old localStorage choice is carried over once.
- Safe areas (wig-ui:45, :52, :56, :58, :91) - fixed: tokens.css:138 `--ls-safe-top`; toast region components.css:641-643; phone form
  footer :1272 + `scroll-padding-bottom` :1280; side drawers :1439-1452 and components-v2.css:919-933 (the v2 drawer padding had also
  dropped the bottom sheet's inset); sticky header tops shell.css:15, :145, site.css:121, foundation-v2.css:18.
- Inline field error and date-range name (wig-ui:133, :146) - fixed: form.tsx:136 persistent polite region (`display: contents`,
  components.css:752, no grid gap); date-range-picker.tsx:155 `label={labels.title}`.
- Header fit first paint (RBP NEW 2) - fixed: foundation-v2.css:241 `@media (max-height: 560px), (max-height: 35em)` (media em follows
  the browser text size: 200 % text is static from the first paint); member aside (WIG NEW 4) s10-member.css:245-253 + foundation-v2.css:666.
- View transitions - fixed: tokens.css:1311-1312 `--ls-dur-vt-fade` 240 ms / `--ls-dur-vt-morph` 320 ms on `:root` (zeroed :1325-1326),
  read by site.css:1560/:1567; reduced-motion and `ls-fx=off` catch-all site.css:1588-1603 (no animation, so the transition ends at
  once); `::view-transition { pointer-events: none }` removed (coordinator item; the UA already sends pointer events to the document
  root while a transition runs, so a click during the 240 ms fade cannot hit a snapshot). Back: page-back.tsx:56-62 keeps `router.back()`
  (it restores filters and scroll, Owner 2026-10-04); a history traversal carries no transition type (the skill says this is expected),
  so the typed page fade does not run on Back or browser Back while the untyped photo morph does; without app history the link pushes
  the parent with the `ls-nav` type.
- motion.ts clamp (RBP NEW 6) - fixed: motion.ts:239-325 `cleanTweenVars` + one proxy for `to/from/fromTo/set`, `timeline` (defaults
  and every child, chained calls stay guarded) and `quickTo`; only transform/opacity keys and tween settings pass (others dropped with
  a dev warning; `quickTo` on another property throws). Test: motion.test.tsx (new).

### Coordinator items

- ListSection `className` - page.tsx:44. ConfirmDialog facts: `value: ReactNode` + `code` flag -> `translate="no"` (confirm-dialog.tsx:16-22,
  :146); type-to-confirm field `spellCheck={false}`, `autoCapitalize="off"`, `translate="no"` (:180-182). Footer hotline `translate="no"`
  site-chrome.tsx:144. Frame streaming: site-page-frame.tsx:22-104 awaits only the season decor (same 60 s cache as the root layout); the
  menu and tab bar paint with every entry and settle "Mỹ phẩm" behind Suspense (site-chrome.tsx:47-75), footer and contact button stream
  behind their own boundaries. loyalty-names.ts (new, cached per language) re-exported by loyalty.ts; bookings.tsx:31 and loyalty.tsx:33
  import-only change. Inbox words: notifications.ts:107-121/:309-323; inbox.tsx:49-86 builds its toolbar and pager labels (no staff
  dictionary, no `useClientPaging`).
- Admin batch: workforce/shell.tsx:35-51 nav, labels memoised; brand link `translate="no"` (:66); SessionWatch uses the shared
  `onPageReturn` signal (data.ts:64-95, shell.tsx:160) instead of its own focus/visibility pair (dashboard/data.tsx:27-39 is an admin file:
  it can switch to `onPageReturn` to make it one pair for the whole area). Field `name` (form.tsx:46-48, :96). Button `reasonVisible={false}`
  keeps the reason as the description only (button.tsx:33, :86). `useResource` opt-in `cacheKey` (ui.tsx:197-252: in-flight dedupe + 30 s
  reuse via lib/customer/fetch-cache, `reload()` always reads again, every `staff:` entry forgotten when the shell unmounts, shell.tsx:51);
  used by `useBranches` and `useEmployeeNames` (data.ts:24, :62, keyed per account). `useEmployeeNames` stays sequential: the directory
  is a cursor list (each page names the next).

### Baseline wig-ui (51)

- Fixed: :41 base.css:16-20; :45 (above); :52, :56, :58, :91 (above); :133, :146 (above); :150 choice-card.tsx:41-90 (name = title, meta,
  price via `aria-labelledby`; the note is the description); :154 kpi-card.tsx:78-110 + tooltip.tsx:26 + components.css:400 (toggletip:
  a press opens it, Escape/blur close, read once by a status); :158 feedback.tsx:55-76 (`dismissLabel` required with `onDismiss`);
  :142 form-overlay.tsx:68-82 (touch focuses the panel; dom-harness.ts answers `(pointer: fine)` on desktop; form-frame.test.tsx new case);
  :51/:159 components.css:605-621 + feedback.tsx:264 (scaleX from `--ls-progress`); :93 shell.css:143-152, :95 :205-210, :96 :280-289
  (no tweened width or grid rows); :53 components.css:784-789 and :98 shell.css:951-956 (no `outline-offset` transition); :104 site.css
  dead `.ls-nav-pill` rules deleted; :94 shell.css:179; :64 components.css:3803 (no selection while dragging); :59 components.css:1669;
  :117 season-art.css:342-351; :125 season-preview.css:79-88 (season-preview.test.tsx allows the hover tokens); :105 closed by
  s10-public.css:538-556; :50 components.css:589; :61 components.css:2964-2971; :138 confirm-dialog.tsx:180; :134 form.tsx:264;
  :163 popover.tsx:123-178 (once per frame, written to the panel, not a render per scroll); :197 pagination.tsx:41-55 (Intl when the labels
  carry `locale`; inbox passes it), :201 form-core.ts:20-25, :205 image-core.ts:34-49; :171-193 the 11 images have width/height
  (image-uploader.tsx:254, media-grid.tsx:41, :72, :120, :178, :272, season-scene.tsx:205, :244, :471, season-slot-row.tsx:40,
  season-site-fx.tsx:268).
- Not a finding: :92, :97, :102, :103 `:focus { outline: none }` on `tabIndex=-1` containers (main, auth main, booking step title): they
  are not controls and only take programmatic focus; `:focus-visible` would draw a ring round the whole page after a keyboard
  navigation. :167 the tablet scrim is a pointer-only backdrop, `aria-hidden`, with the menu button and Escape as its keyboard paths.
  :213 data-table uncontrolled sort: every list that needs a deep link passes `sort`/`onSortChange` (URL state); a local default stays
  local by design. wig-ui:64 `inert` on the dragged item: it would take focus from the keyboard drag (dnd-kit keyboard sensor).

### Baseline rbp-ui (41)

- Fixed: :89 (above); :96, :97 (above); :104-106 (above); :110 data saver / low memory marked before paint: reveal-core.ts:27
  `MOTION_PREPAINT_SCRIPT` in layout.tsx:136 (`suppressHydrationWarning` on `<html>` for that one attribute, layout.tsx:132);
  :118 sortable.tsx:77-140 + sortable-editable.tsx (dnd-kit only when a list can be edited; tests preload); :122-124 popover.tsx (rAF,
  direct writes, `closeRef`); :128-131, :136 charts.tsx:147 (memo TextureDefs), :256-319 / :420-540 (axes, lines, ticks, labels, bars
  memoised; labels formatted once), chart-core.ts:139; :140, :141, :145 date-range-core.ts:166-176, date-range-picker.tsx:245-262 +
  :395-450 (memo day cell, stable handlers); :153 data-table.tsx:171-189 (sort keyed on the sortable keys, getters through a ref),
  :156 (server rows not copied); :161 use-media-query.ts:17-55; :90-92 season-site-fx.tsx:55-64 (idle), :244-276 (memo), visibility
  store season-particles.tsx:52-73; :98 app-shell.tsx:168-174, :99 (write in `toggle`, :357-375), :100 :150-151, :196-208;
  :200-202, :206 form.tsx:276, :972, :581-616/:684, form-core.ts:51-60; :187 season-fx-core.ts:12; season-particles :62 (LANTERN_STAR
  :77) and :102-107; sliding-pill.ts:80-85; brand-icons.tsx (rounded to 2 decimals with an arc-aware parser, checked against the
  originals, 824 characters less); :222 feedback.tsx, image-frame.tsx without 'use client'; ButtonLink/VisuallyHidden moved to
  button-link.tsx (no 'use client').
- Not a finding: :155 a memoised row only helps with stable `columns`; the 126 caller sites rebuild them per render (area files), and
  the sort no longer depends on them. tabs.tsx:103-114 `Activity`: unmounting a hidden tab is the design (no stale fetch running in a
  hidden tab). :85 index.tsx barrel: production tree-shaking works (audit verdict); the heavy parts are now dynamic (season art, dnd-kit).
  :222 card.tsx keeps 'use client' (the nested-card check needs context, which a server component cannot read); kpi-card.tsx keeps it
  (the toggletip has state).

### Other Step 1 items in the lead's files (10)

- Fixed: rbp-customer:90 layout.tsx:119; rbp-customer:108 site-page-frame.tsx (above); rbp-staff:92/:93 (useResource cache; the
  serial pages are the API's cursor design); rbp-staff:90 link.tsx:12-18 (answer cached once per page); rbp-staff:94 shell.tsx:35-48;
  rbp-staff:95 shell.tsx:160 (+ data.ts `onPageReturn`); wig-admin-a:47 language-switch.tsx:30.
- Not in my files: wig-admin-a:69/:70 ('Spa Owner', 'My Account', 'My Income' Title Case) are in i18n/workforce.ts (admin-a / i18n owner).

### NEW findings

- WIG 1-4 fixed (above). WIG 5 toast.tsx:77-96 F8 moves focus to the newest toast's action (the focus pauses its timer),
  `aria-keyshortcuts` on the region and the action. WIG 6 toast.tsx:145 items carry no live role (the region announces), danger is an
  alert. WIG 7 index.tsx:15. WIG 8 form.tsx:407. WIG 9 form.tsx:333-433 (kit side; the screens pass `timeError`, see open list).
- RBP 1-4, 6 fixed (above; RBP 3 chart-parts.tsx:50-91 one shared text-scale store). RBP 5 (area sheets per area layout): needs the
  `(site)`, `account` and `workforce` layouts, which are not my files; note for the lead.
- Notes: `@keyframes ls-content-in` deleted; chart-parts orphan JSDoc deleted; back.ts:46 joins once; form.tsx:159-165 `callerName`
  now also drops React 19's server ids (`_R_57d_` became a field name, found by the online-orders test).

### Final re-audit (web-design-guidelines + react-best-practices on every changed file)

Open, each with a reason (none in the kit or chrome code itself):

- DateTimeInput callers (discount-form.tsx:223/:234, website-slide-drawer.tsx:338/:350, website-popup-form.tsx:438/:455, admin files)
  should pass `timeError` ("Nhập giờ dạng 14:30.") and `aria-describedby={control['aria-describedby']}`; until then the box turns red
  without words.
- `lib/workforce/list-view.ts` `paginationLabels` (not my file) should pass `locale` so staff list counts group (1.234).
- media-library (admin-c) should pass the picture's `width`/`height` to `MediaPreview`.
- dashboard/data.tsx (admin) can use `onPageReturn` (one focus/visibility pair for the area).
- online-orders.test.tsx:503 has an irregular space (eslint `no-irregular-whitespace`) from another worker's edit.

### Validation

- Kit tests `node --import tsx --test "src/**/*.test.ts" "src/**/*.test.tsx"`: 559 pass, 0 fail. Kit `tsc --noEmit`: clean.
- Web `tsc --noEmit`: clean. Web tests, whole suite (`--test-concurrency=2`, includes ui-ratchet.test.ts): 1178 pass, 0 fail.
- eslint on the changed TS/TSX files (about 70): 0 errors in my edits (1 in online-orders.test.tsx:503, not mine). prettier --check:
  clean. `apps/web/next-env.d.ts`: untouched (`git status` clean for it).
- Files outside the brief's list that I touched: online-orders.test.tsx, discounts.test.tsx, staff-freshness.test.ts,
  public-pages.test.tsx (assertions only), bookings.tsx and loyalty.tsx (import only, approved), i18n/loyalty.ts, new
  i18n/loyalty-names.ts, i18n/notifications.ts, notifications/inbox.tsx (approved). `prettier --write` reformatted the whole of the
  shared `docs/redesign-s10/copy-review.md` (table widths only).

### Needs the lead's `next build` and a dev run to confirm (tsc and jsdom tests cannot see these)

- RSC boundaries: feedback.tsx, image-frame.tsx and the new button-link.tsx have no 'use client' (server pages render Badge, Notice,
  EmptyState, ImageFrame, ButtonLink on the server). No server file under `app/` passes a function prop to them (grep); Button, Card
  and FallbackImage keep their own client boundary.
- `[locale]/layout.tsx`: a `<head>` with the inline pre-paint script next to the Metadata API, `suppressHydrationWarning` on `<html>`,
  and the client `ShellPreferencesProvider` round `{children}`; check no hydration warning other than the expected `data-ls-motion`.
- `site-page-frame.tsx` / `site-chrome.tsx`: promises handed to async server components inside Suspense. Trade-off: the menu's
  fallback draws every entry, so a shop with no published product would see "Mỹ phẩm" for a moment on the first load (today every
  shop has products).
- `useSearchParams` behind Suspense in both language switches ("Missing Suspense boundary" is a build-time check).
- sortable.tsx: edit mode renders the plain list until the dnd-kit chunk arrives. Hydration-safe because every editable list is a staff
  screen rendered on the client behind `RequireWorkforce` (never server-rendered in edit mode).
- Caveats: `.ls-field-live` is a live region with `display: contents` (no grid gap, no duplicated text for the tests); older
  Safari/VoiceOver dropped such nodes from the accessibility tree (fixed in current versions); the field error stays reachable through
  `aria-describedby` either way. Popover: the containing-block probe still appends and measures inside `measure`, so the gain is one
  measurement per frame (rAF) and a direct style write instead of a React render per scroll event, not a single layout.
- Tests updated with the same intent: date-text-input, discounts, online-orders (placeholder "…"), staff-freshness (current prefetch
  expression), contact-fab-away (waits a frame), shell (no width/grid-rows tween; cookie provider), motion-pass (vt tokens, catch-all),
  site-frame (wordmark `translate="no"`, ChoiceCard name/description), public-pages (hotline `translate="no"`), card-stat and sortable
  (preload the drag code), season-preview (hover tokens allowed).
- New copy: rows added to `docs/redesign-s10/copy-review.md` (Lead table).
