# Redesign group 1, session 9 report (color system, brand band, nav hover, contact button, full re-check). Local only: not pushed, not deployed.

Commits (oldest first): colors and secondary hover `2fecc4d`; brand band and migration `c68f77d`; plain nav hover `90ab3fa`; fixed contact button `8320a8e`; review fixes `48eac44`, `3c6dce0`, `1dcc065`, `ea4adab`; kit pause control `f1921a0`; docs after these. Items 2 and 6 were data: no code.

## What changed

1. **Color system** (`DESIGN.md` 6.1, tokens `--ls-{gray,burgundy,danger,success,warning,info}-1..12`, roles point at steps, `tokens-v2.test.ts` pins mapping, ratios, delta E). Light accent text = step 12 `#521b24` (as asked); dark fill `#9b424e` + white text (6.4:1), dark accent text = muted rose `#dcadb0`; danger = its own red (`#d72119` / dark `#fb5a4a` with near-black text), brand vs danger delta E 0.20 (solids), 0.21 / 0.12 (text). Wordmark: light `#782b37`, dark white-grey. Secondary button: no fill on hover, border one step up, lift + zoom, arrow +3 px, 150 ms; reduced motion and `ls-fx=off` keep the border change only (probed with a real pointer). Rule 4 exception recorded in `CLAUDE.md` and `DESIGN.md` 8.1. Single source for groups 2 and 3: stated in `DESIGN.md` 6.1 and 14 (no group 2/3 plan file exists).
2. **Featured row**: not a bug. `lucy_spa_uxaudit_20261001` has 0 featured products, `lucy_spa_polish1_scratch` has 8 (the row shows there, also in session 8 pictures). Seeded 8 on uxaudit too.
3. **Brand band** under the hero: migration `20261215000002_brand_logo_home_band` (brands: `logo_media_id`, `show_on_home` default false, `home_sort_order`), admin brand form (logo, switch, order), public brand fields, white logos on the accent solid, slow seamless loop, pause on focus / finger / mouse-over and a pause button, still row under reduced motion and `ls-fx=off`. Server markup + CSS: home first load 348.1 KB gzip (line 345.4; session 8 was 348.6).
4. **Nav hover**: customer menus and account tabs are plain links; the hovered link fills at once; no sliding highlight (`useSlidingPill` stays for the staff sidebar).
5. **Contact button**: fixed to the viewport corner, safe-area aware, above the tab bar and above a sticky action bar even when the bar leaves the edge; footer keeps 88 px of bottom room; inverse on the sign-in panel.
6. **Footer hours**: scratch data (both scratch databases hold the branch default 00:00 to 24:00). Production, read from the public API on 2026-10-15 09:23 UTC: `09:00 – 21:00`. Scratch set to 09:00 to 21:00.

## Checks (run)

`pnpm lint`, `format:check`, `pnpm test` (all packages, servers stopped): ui 562, web 1144, api 428, worker 24, database 143, server 227, 0 failed. Integration `product-catalog` + `public-products` on polish1: 3 failures (authority, cost and margin, variants) also occur on the code before this session (`dfb3368`), so not from this work; the new brand and public tests pass. Contrast gate (new, 46 pages x light/dark x 1440/360): 0 failures for enabled controls; 18 hits are **disabled** buttons (3.9 light, 4.4 dark, exempt). DOM audit: 0 rises vs C1 (the brand window is allowed in the audit script). 200 % and 130 % text: only the known sticky-bar overlap on the service page (same as session 8). Tab bar 242/0, touch 0 and 0 (tab bar tool now emulates page focus: headless focus loss made its keyboard check flaky). Keyboard / focus / labels: a11y script reports field focus rings as missing because it reads them during the 150 ms transition; measured after it, every field has a 2 px focus ring.

## UX gate

1. Pairs (before = session 8 final, after = now): `.local/uxui-screens/group1-session9/` (324 sheets, 42 pages + new states, 360/768/1440 light, 360/768/1440 dark), contact sheets `montage-*.png`, `hover-states.png`.
2. Opened by me: 17 contact sheets (1440 and 360, light and dark), hover sheet, brand band, login, service phone, admin brand form. Read by two audit agents: web-design-guidelines (14 findings) and frontend-design (25 findings).
3. Fixed after review: danger icon, AA busy button, one wordmark color, brand pause control (WCAG 2.2.2) and touch-safe hover pause, theme-color, scroll padding, overscroll containment, gallery reduced motion, form attributes, live regions, fab on the sign-in panel, fab above a moving action bar.
4. Not changed (earlier groups, pending Owner): see the chat list (auth panel fill, two primaries on product detail, card promo link and badges, policy pages without title band, account cards).

## Open

Dark fill vs surface is 3.3 on black, 2.7 on E1, 2.2 on E2 (label identifies it); Owner decides lighter vs darker. Accent text step 12 vs 11. Wordmark white in dark. Touch pause relies on `:active` plus the button.
