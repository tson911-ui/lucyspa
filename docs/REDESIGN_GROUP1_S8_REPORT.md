# Redesign group 1, session 8 report (policy pages, C18 closing gate, C19 deploy guide). Local only: not pushed, not deployed.

Commits (oldest first): plan decisions `7fb04fb`; policy pages, table in page text, footer column, import command `809b17a`; contact pills `9b64526`; policy page polish `12a477c`; dead CSS removed `063962a`;
loading card and campaign frame `1727c1b`; footer column `c667c73`; 200 % text `007bec3`, `9a50a68`, `12bab9b`; bundle `ad62c11`; header grid, audit, docs `f3fcfcb`; variant choices (last code commit, see `git log`).

## Migrations in group 1 (all three; nothing new this session)

1. `20261214000000_redesign_service_content_photos` (C11b: 7 nullable service columns, 3 photo keys, 3 indexes).
2. `20261215000000_customer_email_change_guard` (7b: one trigger function relaxed so a customer may change their own email; Owner accepted 2026-10-15).
3. `20261215000001_website_info_pages` (7b: table `website_pages`, enum, one published terms and one privacy page).

No permission is new (82). Deploy guide: `docs/DEPLOY_REDESIGN_GROUP1.md` (134 to 137 migrations, API restart, web reload, then the policy import; the commit to install is filled in at push time).

## What changed

- **Owner decisions** (2026-10-15) recorded in the plan; birthday editing for staff goes to group 3.
- **Policy pages:** `docs/policies.md` (untracked until now, kept out of Prettier) holds the Owner's 8 pages, wording untouched. The two pipe tables needed a **markup extension** (`| a | b |` table block in `parseRichText`, `InfoTable` in `packages/ui`, stacked rows under 640 px, editor message and help). Footer "Chính sách" column lists all 8 pages (order: by title, no sort field), the legal line is "Điều khoản sử dụng · Chính sách bảo mật" under fixed role labels (the privacy page's own title is the longer "Chính sách bảo mật thông tin cá nhân").
- **Import command** `pnpm --filter @lucy-spa/api run pages:import-policies` (`apps/api/src/website/policy-pages.*`): dry run by default, `--apply` creates the missing pages through the admin `createPage` path as the Owner user (or `--as=<email>`; permission checked from the authority graph), skips existing addresses, reports a taken terms/privacy role as `blocked` instead of failing, one transaction. Run twice on both scratch databases (8 created, then 8 skipped); the scratch sample pages of 7b were removed first (they used the Owner's slugs).
- **Contact pills** are one navigation landmark "Liên hệ nhanh" (the audit's orphan-action hit).
- **C18:** dead direction C CSS removed by measurement (`site.css` 4,790 to 3,517 lines, `customer.css` 105 to 24, `customer-pages.css` 90 to 41, `customer-tokens.css` and its test deleted, unused `PriceList` removed). A rule went only if no source uses its class, or deleting it changed no computed value on 275 DOM snapshots (all interactive states simulated), and it holds no transition, animation or safe-area value. About 20 unit tests that asserted removed legacy rules were deleted or pointed at the current ones.
- **200 % text** (new check): 41 of 46 pages were wider than the screen or printed words over each other at 360 px; fixed (header, sign-in card, product cards, tables as cards, tiers, booking choices, product variants, cart lines, product facts, status badges). Left: the phone bar of a service overlaps the page by design.
- **Bundle:** the home first load had grown to 360.3 KB gzip after 7b (the popup's link check pulled the page-text parser into the shared chunk). The link rule has its own contracts module and contracts is `sideEffects: false`: **348.6 KB** (session 7: 344.8; budget line 345.4; +3.2 KB, listed as a decision below).

## Checks (run)

`pnpm format:check`, `pnpm lint`, `pnpm test` (all packages, servers stopped): see the chat message for the results. Targeted: contracts parser and policy file tests (14 + footer/table web tests), scratch integration `policy-pages` (dry run, apply, second run, edited page kept, terms role taken, no permission, no user) rolled back.
Gates on the final build: keyboard / focus / labels on 46 pages (Tab through each, real key events; first stop is the skip link, every stop named, no trap). The first pass flagged 91 items, all checker artefacts, each verified: picture links that are `aria-hidden` with `tabindex=-1`, a scroll row still smooth-scrolling when read, and field rings read mid-transition (reading the computed style of the focused field on login, forgot, cart quantity and checkout shows a 2 px accent outline). The second pass on the flagged pages leaves only that field-ring reading; `uxui-touch-check` light, dark and auto pass; `uxui-tabbar-check` 242 checks, 0 failed (one earlier run failed the keyboard case twice; three reruns and the final full run passed, a flake of the check); 200 % and 130 % text 0 overflow, the one overlap reported is the phone service bar over the page.
Copy: no "khám" outside the allowed footer label "Khám phá" and rule comments; the policies file has none. Season layer and theme toggle: the Tết season home was captured in light, dark, 360 and 1440 and reviewed; theme cycle passes the touch gate in all three modes.

## DOM audit

- **Customer, 42 pages vs the C1 baseline:** no count rises after the final fixes (three orphan-action hits on the accordion trigger were an audit false positive, the audit now allows `.ls-accordion-heading`; three clipped header cells came from `overflow-wrap: anywhere` and are fixed). `off-grid-spacing` 56 to 0 and `surface-style-mix` 3 to 0 on the pages measured.
- **Staff, 26 baseline pages vs the baseline:** one rise, **dashboard `list-height-uneven` 4 to 7** (same as 7b). Proven not to come from group 1 or 7b: the same audit on a build of the commit before 7b (`f2f3e67`, same scratch data) gives the identical 12 dashboard findings. Cause: widgets added after the baseline (Phase 7 and 8 money, report and revenue widgets, `ls-widget-list` rows that wrap) and more quick links for the owner. Not fixed here (staff screens are group 3); decision below.

## UX gate

1. Before/after pairs: `.local/uxui-screens/group1-session8/` (273 sheets: 42 pages and the new ones at 360 / 768 / 1440 light, 1440 and 360 dark; before = the C1 baseline, left; after = final build, right), plus `text-zoom/` (130 % and 200 % at 360 px, all pages), `loading/` (the three skeletons).
2. Opened and checked by me: every page at 360 light, 768 light, 1440 light and dark, 360 dark (single sheets or montages), the policy pages and contact at 360 and 1440, the Tết season, hero states and popup, the 200 % montages (before and after the fixes), the three skeletons. Not opened one by one: the 768 dark and 130 % sheets of every page (measured by the zoom check instead).
3. Fixed after review: footer policy column width, a loading card collapsed to a strip, a campaign hero picture shrinking to a strip, empty cart centred in the form column, header gaps off the 4 px grid, all the 200 % findings above.
4. Not done: the policy pages have no English text (the Owner wrote VI only; English visitors see the Vietnamese text, marked `lang="vi"`).

## Needs your decision

1. **Dashboard baseline:** accept 7 as the new `list-height-uneven` baseline for the dashboard, or fix the wrapped widget rows in group 3.
2. **Home first load 348.6 KB** vs the budget line 345.4 (+3.2 KB since session 7): accept, or I look for more.
3. **Footer policy order** is by title (terms last); a fixed order needs a sort field (a migration), not built.
4. **Legal line labels** are fixed ("Điều khoản sử dụng", "Chính sách bảo mật") rather than the page titles; say if you prefer the titles.
5. Production state is not assumed: the guide checks 134 migrations and 82 permissions before it does anything.
6. The temporary folder `D:\lucy-spa-pre7b` (a pre-7b build used for the dashboard proof) could not be removed by me; delete it by hand.
