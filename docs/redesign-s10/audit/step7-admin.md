# Step 7 final code audit: ADMIN area (session 10)

Scope: `apps/web/src/components/workforce/**` minus the POS files, `components/season/**`, the matching `app/[locale]/workforce/**`
and `season-preview/**` routes, `lib/workforce/**` (minus product-sale, product-returns, product-exchanges, pos and the POS-only
helpers), the dictionaries of these screens, `packages/ui/src/s10-admin-{a,b,c}.css`. 160 components, 95 route files.

Rules: web-design-guidelines fetched fresh with WebFetch on **2026-10-16** (the tool returns a summary; its 17 sections match the
full list cached in `.local/s10/wig-command.md`, which was applied). "Title Case" replaced by Vietnamese sentence case.
react-best-practices (`AGENTS.md` + rules applied: rerender-derived-state-no-effect, rerender-memo, rerender-lazy-state-init,
js-cache-function-results, js-index-maps, js-min-max-loop, bundle-preload, rerender-defer-reads), react-view-transitions
(`references/implementation.md` audit step), frontend-design (tells, empty states, copy) loaded at the start.

Method: three forks started in parallel and were cut off by the service limit mid-work; their edits (read back from their
transcripts) were checked, completed or corrected, and the rest was done sequentially. Fresh pass = rule-signature greps over every
file in scope (`submitDisabled`, navigation in handlers, busy labels, generic errors, URL state, hand dates, `toLocaleString`, middle
dots, arrows, `...`, truncation, smooth scroll, `autoFocus`, read-only fields, raw elements, click handlers on non-buttons, live
regions, mirror effects, `new Intl` per call, inline components, `target="_blank"`, motion APIs, route files), then every hit read.

## Baseline (wig-admin-a.md 198 + wig-admin-b.md 188 findings, rbp-staff.md admin + shared entries)

Closed before Step 7 (verified in code; Step 6 follow-ups in `step6/admin-{a,b,c}.md`): URL state for lists, tabs, drawers and pagers
(`useUrlState`, `useUrlPaging`, `payroll-url-list.ts`, `urlPaging`); row menus with `href` via `RowActions LinkComponent`; create
buttons as `ButtonLink LinkComponent={AdminButtonLink}`; per-field errors with focus in discounts, services, payroll, pay, website;
empty states with heading + action; Intl money/date (`format.ts` formatVnd = Intl on BigInt, formatDate = Intl in UTC, MoneyInput
`locale`); search placeholders with an example and "…"; curly quotes; dirty guards; confirmations; no truncation (kit + `wrap`).

Closed in Step 7 (baseline lines that were still open in code):

- Forms "inputs lack `name`" (34 per-file lines in wig-admin-a, the matching ones in wig-admin-b): the kit derives a name only from a
  caller id, so 133 Field-wired controls still had none (31 files). Each now has a name from the state it edits (`code`, `nameVi`,
  `reason`, `currentPassword`, `{key}` …). Remaining unnamed: 2 hidden `type="file"` inputs (no form submission).
- Forms "submit disabled until filled": add-service, assistant-box (fork B), reauth-dialog (fork A), organization-dialogs ×5 (fork A
  - finished), teams leader/edit (fork A) and bulk move, branch-detail edit, roles drawer: button enabled, errors at the fields, first
    invalid field focused.
- Content & Copy "busy label reuses Đang lưu…": 20 confirm/form dialogs now name the action (new `common.activating/deactivating/
removing/deleting/ending/rejecting/creating`, `aiSeo.regenerating`, `ai-drafts` cancelling/starting/approving, cleanup `cleaning`).
- Content & Copy generic `errors.validation`: referral-dialogs (3) say what to enter.
- Content & Copy errors with no next step: 7 no-access messages (fork B), assistant load error gets a retry (fork B).
- Accessibility: assistant answer in a persistent `aria-live` region (fork B).
- Navigation: ai-seo draft rows are real links (fork B), supplier-import buttons are router links (fork B).
- Locale: pay-codes dates were the UTC day of an instant (`createdAt.slice(0, 10)`), now the shop's day (`zonedLocal`); counts in
  product-text-cleanup and ai-runs through Intl (`formatCount`); ai-draft-detail lists through `Intl.ListFormat` (fork C).
- Typography: no-break space before MB/px, curly apostrophes and quotes in workforce/products/online-sales/reward/payroll/reports-c/
  supplier dictionaries; `members’`.
- Tells: middle-dot scope label ("Tổ chức · {vùng}") in employee-roles.ts -> "Vùng: {tên}" / "Khu vực: {tên}"; title and chip
  truncation removed (supplier-sources, supplier-source-test, discount-targets; Owner answer 7).

rbp baseline: closed in Step 7: session.tsx rerender-defer-reads + memoized `AccountContext` value (fork A); dashboard widget chunks
preloaded with the layout, branch widgets show their skeleton while branches load (bundle-preload, derived state; fork A);
`useRef(randomUUID())` in add-service and loyalty-adjust-dialog (fork A); employee-create.ts min-max loop (fork A); format.ts
formatter cache incl. `todayIn` (fork B); ai-seo form adjusted in render, not an effect (fork B); media-library alt-text mirror effect;
products.ts children grouped once (js-index-maps). Closed earlier and verified: polling deps (ai-drafts, ai-seo, ai-settings,
ai-draft-detail use the stable `reload`), mirror/reset effects (ai-settings, shipping-carriers, supplier-sources, online-sales,
ai-draft-detail, website forms), my-services/dashboard branch derived, attendance one branch fetch, ai-seo parallel reload,
supplier-import-all one pass, discount-targets deferred query + Set, inventory-receipts memo + Set, services Map, pay/payroll-command
lazy ids, link.tsx prefetch default + cached `mayPrefetch`.

## New findings (fresh pass) and fixes

- my-services.tsx: two `Intl.DateTimeFormat` per line per render -> `useMemo` per language and zone (js-cache-function-results).
- reports-reviews.tsx, lib loyalty.ts `formatPoints`, lib reports-b.ts `percentFromBp`/`formatCount`: a formatter per cell -> module
  cache; lib inventory.ts `todayInShop`, supplier-sources.ts `shopToday` -> cached `todayIn`.
- inventory-stock.tsx: an item address without its branch showed a one-line notice -> empty state with heading, sentence, "Về tồn kho".
- campaign-detail.tsx: a fork had added `disabledReason` to the header "Đăng chương trình", which drew the blocker text a second time
  next to the notice that already says it: reverted (kit request filed); `blockerText` helper kept for the notice.
- `(app)/template.tsx` comment said "a small rise and fade": corrected to the 120 ms opacity fade.
- teams.tsx: the fork's validation used `focusFirstInvalidSoon` without importing it: import added.

Not findings (one line each): `submitDisabled` kept where nothing can be typed to fix it or nothing changed (edit dialogs `!changed`,
ai-seo/ai-runs/payroll blockers listed in the dialog, empty lot list, loading options, product-page/settings while loading,
employee-lifecycle owner-only and no-op patch); local pagers inside drawers, dialogs, a printable payslip, an embedded leave/CTV table
and the referral history (no address of their own); the gift-desk lookup in state (phone/email must not enter the URL); `readOnly
disabled` locked fields in edit forms (the value in its usual place, skipped by Tab); Select prompts such as "Tất cả chi nhánh" are
option labels, not input placeholders; `toLocaleString(locale)` single calls are Intl; lib `slice(0, 10)` hits are date arithmetic.

## Final open list (with reasons)

- rbp async-parallel `lib/workforce/workflows.ts:168` (session bootstrap `context()` then `/auth/me`): starting both together sends an
  extra `/auth/me` for every anonymous visit and its 401 reaches the client's `onUnauthenticated` handler; needs an API-client option
  to suppress it. Auth behaviour, not UI-only.
- rbp client-swr-dedup `components/workforce/ui.tsx` `useResource` / `data.ts` (no cache across screens) and `useEmployeeNames`
  serial pages: shared data-layer change (filed earlier in kit-requests); not a Step 7 restyle fix.
- rbp bundle-conditional `i18n/workforce.ts` + feature dictionaries ship vi and en together: needs a per-locale split of every
  dictionary and the provider; architecture item for the lead/Owner.
- rbp rerender-memo `next.config.ts` React Compiler off: outside scope.
- rbp client-event-listeners `dashboard/data.tsx:27-39` + `shell.tsx:146-147`: merging the two focus/visibility listeners needs the lead
  file shell.tsx.

Lead files (not edited): `shell.tsx:32,51` navigationFor/sidebarGroups rebuilt every render (rerender-memo, LOW); `shell.tsx:146-147`
listeners (above); `shell.tsx:47` brand link: add `translate="no"` (wig locale). `link.tsx`, `language-switch.tsx`: pass.

Kit requests appended (`kit-requests.md`, [audit-admin]): `Field name` pass-through (controls get no name from a generated id);
`Button disabledReason` without the visible duplicate.

## Motion (view transitions)

Staff route = kit `RouteEnter` (`ls-route-enter[data-enter='route']`, `ls-fade-in`, opacity only, `--ls-dur-route` 120 ms, 0 ms under
reduced motion); first load not animated. Grep over scope: no `gsap`, no `useMotion`, no `ViewTransition`/`startViewTransition`, no
`@keyframes`/`animation:`; the only transition is `.ls-dash-shortcut` background/transform at `--ls-dur-fast` (kit tokens, zeroed by
reduced motion). `requestAnimationFrame` uses are focus moves after a refused submit; `scrollIntoView` in products-links is smooth only
when motion is allowed. No totals, tables or typing animate.

## Copy

Rows appended to `docs/redesign-s10/copy/admin-a.md` (14), `admin-b.md` (15), `admin-c.md` (9), section "Step 7 final audit".

## Tests and checks

- `pnpm --filter @lucy-spa/web exec node --import tsx --test` over the 94 in-scope test files (screens, lib/workforce, dashboard,
  non-POS) + `src/test/ui-ratchet.test.ts`: 621 tests, 621 pass. Updated with the same intent: dashboard.test.tsx (a branch widget
  shows its loading state while branches load and "no branch" once they answer), employee-create.test.tsx (kit placeholder
  "dd/mm/yyyy…").
- `pnpm --filter @lucy-spa/web exec tsc --noEmit`: 0 errors in this scope; one error outside it, `components/customer/screens/
profile.tsx:213 NAV_TRANSITION` (customer worker, edited in parallel).
- `pnpm exec eslint` on the 84 changed files: 0 problems. `prettier --check`: clean. No CRLF.
