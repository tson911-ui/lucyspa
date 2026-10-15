# Redesign session 10 report: full quality pass (customer, POS, admin). Checkpoint after Steps 1-3

**Status: STOPPED for the Owner after Step 3**, as agreed on 2026-10-16 (the Owner chose "stop after Steps 1-3"). Local commits only:
not pushed, not deployed. Steps 4-7 have not started. This file is extended at Step 7 into the final report.

Brief: the Owner's session 10 brief (pasted 2026-10-16). Ledger of the run: `.local/s10/LEDGER.md` (git-ignored).

## 0. Questions for the Owner (needed before or during Steps 4-7)

1. **R22 focus ring.** R22 names burgundy step 8 `#dc949a` for the focus ring. Measured: 2.40:1 on white, 2.21:1 on `#f5f5f7`; dark step 8
   `#873742`: 2.66:1 on black, 2.15:1 on `#1c1c1e`. A focus indicator needs 3:1 (WCAG 2.2, C5, DESIGN 12). Kept for now: the link colour
   (light `#60212a`, 12.0:1; dark the neutral text). Keep that, or use step 8 anyway?
2. **B15 vs C4.** B15 asks for "Đặt lịch" as the primary on product and service cards. Applied to service cards (services-list.tsx): a grid of
   12 cards then shows 12 filled buttons in one view, which C4/R1 ("at most 1-2 filled per view") forbid. Keep primaries on every card, or a
   secondary on cards with the whole card as the link? Product cards have no button today (DESIGN 8.3: the card opens the page): add one?
3. **A2 account deletion: two business points the brief does not cover** (no code written for A2 yet; plan in `plans/fd-plan-customer-2.md`,
   block ACCOUNT-DELETION):
   - Unused prepaid combo sessions (money already paid): lost like points, refunded, or does the customer have to use them first?
   - Online orders keep the delivery recipient's name and phone (`online_order_details`, `online_address_corrections`); invoices and payment
     records are kept "de-identified from the person". The hard rule says operational history is never rewritten. Keep those delivery copies
     as they are (only the account is removed), or clear them (a rewrite of order history)?
   - The privacy policy page (your CMS text) says deletion is requested by hotline or email and mentions the light/dark cookie that A1
     removes: you update the text, or the app shows the new flow only.
4. **Dark primary fill.** A4 fixes the dark primary at `#9b424e` (hover `#a74c58`). On black it still reads raspberry in the screenshots
   (dna board dark). Keep, or a deeper fill (for example burgundy 8 `#873742`: white label 7.91:1, but the button stands out less from
   black, 2.66:1 against 3.28:1 today)?
5. **Plans that change layouts beyond a restyle** (from the critique agents; none built yet): the POS board as two panes with the selected
   invoice on the right; the booking-board time grid; product-new as a drawer vs its own page; the 13 loyalty tabs grouped; the dashboard
   "Lối tắt" block removed or reduced. Confirm or narrow before Step 5/6.
6. **New Vietnamese copy proposed in the plans** (stale campaign link, empty invoices, empty states): wording waits for you.
7. **Long names in tables (C15 vs FR8).** C15 says never truncate; the older FR8 says one row height per table. Names now wrap (rows of a
   table can differ in height; the DOM audit counts it, section 3). Keep wrapping, or keep one row height and allow an ellipsis with the
   full name on hover/focus?

## 1. Step 1, baseline (all three areas)

Rig (webapp-testing): `scripts/uxui-capture.py` (Python Playwright, Edge channel; the skill's `with_server.py` was not needed because the
stack runs separately: API 3101 on `lucy_spa_polish1_scratch`, web 3100 production build), in-page measure `scripts/uxui-e2-measure.js`,
summary `scripts/uxui-e2-summary.mjs`, motion probe `scripts/uxui-motion-probe.py`, staff route list `scripts/uxui-staff-pages.json`
(91 routes, area, login). Thresholds fixed before the baseline: `docs/redesign-s10/e2-thresholds.md` (the corrections made after it are
listed there and were applied to the baseline data too: final baseline = one build of `8001336`, one script version).

- **E1:** 49 customer pages (the 42 of `uxui-customer-pages.json` + contact, 4 policies, profile, /en) x 8 modes = 392 images; 89 staff
  routes x 8 modes = 712 images (`.local/uxui-screens/s10base/`). Unmeasured: `my-payslip-detail` (the audit owner has no payslip) and
  `product-rewrite-detail` (no AI rewrite run in the scratch data). Captured empty only: income, my-payslips, my-services,
  collaborator-schedule, chat-requests, shipping-carriers, product-rewrites, product-text-cleanup; `order-soon` shows its expired state;
  `inventory-receipt-edit` shows a confirmed receipt. The scratch photos are flat stand-ins (177 missing files regenerated), so photo
  quality (R13, R15, R17) is not judged from these shots.
- **E2 baseline:** section 4.
- **web-design-guidelines** (rules fetched from the skill's URL on 2026-10-16): 698 findings, `docs/redesign-s10/audit/wig-*.md`
  (customer 65, POS 182, admin 198 + 188, kit 65).
- **vercel-react-best-practices** (SKILL.md + AGENTS.md): 163 findings, `audit/rbp-*.md` (customer 47, staff 67, kit 49).
- **vercel-react-view-transitions** (implementation.md step 1): `audit/vt-audit.md` (navigation map, shared elements, findings VT1-VT6).
- **frontend-design:** critique of every page's light and dark sheet: `audit/fd-critique.md` (sheets I opened) + the critique halves of
  `plans/fd-plan-*.md` (the other sheets, opened by five critique agents, each told to open every light and dark sheet of its pages).
  Generic tells found on most pages: "→" appended to outline buttons, 12 px grey eyebrow labels above names and values, middle-dot meta
  strings, identical grey card kits (member area), ALL-CAPS sidebar group labels, "← Quay lại" text on top-level pages.

## 2. Step 2, plans

- Shared foundation: `docs/redesign-s10/plans/plan-foundation.md` (F1 tokens, F2 kit, F3 motion, F4 checks).
- Every customer page and every POS/admin screen: `plans/fd-plan-customer-1.md`, `fd-plan-customer-2.md`, `fd-plan-pos.md`,
  `fd-plan-admin-a.md`, `fd-plan-admin-b.md` (pattern followed, changes, tells removed, baseline findings fixed, transitions, checks).
- Review against the brief (frontend-design: review the plan before building), revisions made:
  - Hiding the header "Đặt lịch" pill on auth pages (proposed by a plan) rejected: C4 allows one or two prominent actions and R1 only forbids
    two filled side by side; empty states use a secondary instead.
  - Dark chart series 1 `#c9647a` reads pink: moved to the dark burgundy fill (B22 overrides "chart palette unchanged").
  - Staff pill fields, rose ink and serif titles: no per-screen work; the v2 tokens on every area fix them.
  - Table text: names wrap by word (C15) rather than an ellipsis; first attempt (`overflow-wrap: anywhere`) squeezed columns to single
    letters and was replaced by `break-word`.
- View transitions (planned): customer route fade (existing `ls-page`, ≤ 240 ms) and the photo morph card → detail (existing
  `SharedPhoto`) as the detail pages' one moment; staff: 120 ms opacity fade only; reduced motion: instant.

## 3. Step 3, shared foundation (built and verified)

What changed (all areas share it; file:line in the commits):

- **A1:** theme modules deleted (`theme-core`, `theme-script`, `theme-toggle`, `theme-cycle`, `use-theme` + tests), every `data-theme`
  selector removed (tokens.css, season.css via `season-css.ts`), `:root { color-scheme: light dark }`, two `theme-color` metas in the root
  layout, no pre-paint script; the admin season preview forces a theme through `data-preview-theme` on `<html>`.
- **One token source (D1, R6):** `data-ui="v2"` on `<body>`; `data-density="compact"` on the staff shell and staff sign-in. Direction C
  fonts (Fraunces, Nunito Sans) no longer loaded; Playfair (season greetings) not preloaded.
- **A3/A4/R2/R11/R21-R25 roles** (tokens.css v2 blocks): link `#60212a` (dark: neutral, underlined), primary 9/10/11 (dark 9/10/8),
  secondary outline with a burgundy 3 hover tint and the burgundy 12 border (dark: neutral border, grey 3 tint), transparent controls grey
  3/4, no role on `#dcadb0` or `#f8ddde`, secondary lift/zoom/arrow tokens deleted, subtle text 7.9:1 (B1).
- **Kit:** button states (`components-v2.css`), interaction states of links, nav, sidebar, chips, segments, tabs, pager, menu items, rows,
  tab bar, select, footer, header, staff sign-in, wide-table scrollbar, table names that wrap (`foundation-v2.css`, loaded last);
  `HeaderBar` used by the customer header and the staff top bar (R7); wordmark one face on the scale; Badge status icons and neutral shop
  labels (B18); Select chevron everywhere (B9); field defaults (name, autocomplete, spellcheck, numeric keypad); toast live region;
  PageBack = chevron icon only where a parent exists (B7, C40).
- **Motion:** `Reveal` plain, `CountUp` static, GSAP wrapper clamps 200 ms in the compact scope, records tweens for the probe, kills every
  context on route change; staff route = 120 ms fade; everything at 0 under reduced motion, data saver and `ls-fx=off`; contact pulse gone.
- **React:** the header bell no longer loads the staff dictionary on customer pages (`notifications/unread.ts`, `i18n/fill.ts`); chat panel
  is a dynamic import; staff money and dates use cached `Intl` formatters (no-break space before ₫).
- **Docs:** DESIGN.md (header, sections 3, 4, 5, 6.2, 8.5, 13, 14, 16 lines, new section 17), CLAUDE.md rule 4.

Verification (webapp-testing) on one customer page, one POS screen and one admin screen, all 8 modes (`.local/uxui-screens/s10f/`,
sheets in `sheets/`, DNA board `dna-board-{light,dark}.png`, opened and reviewed):

```text
customer/home
  clipped-text            1 ->      0
  font-size              21 ->      0
  grid-misaligned         1 ->      1
  hit-target             96 ->     95
  hover-missing          30 ->     32
  non-radix              11 ->      0
  overlap               134 ->     44
  pink-dark              15 ->      0
  pressed-missing       174 ->    122
  secondary-filled        0 ->      0
  sticky-cover            1 ->      1

staff/pos
  brand-text              6 ->      0
  card-heights            1 ->      0
  font-size              28 ->      0
  hit-target            156 ->     62
  hover-missing           8 ->      2
  non-radix             244 ->      0
  pink-dark              18 ->      0
  pressed-missing        62 ->      8
  secondary-filled        0 ->      0
  shadow-gradient        46 ->      0

staff/employees
  brand-text              6 ->      0
  clipped-text           13 ->      0
  font-size              42 ->      0
  hit-target            376 ->    120
  hover-missing          12 ->      4
  non-radix             284 ->      0
  pink-dark              21 ->      0
  pressed-missing       150 ->     38
  secondary-filled        0 ->      0
  shadow-gradient        70 ->      0
```

The three-screen numbers above are from the committed foundation build (re-captured after the last foundation change). Two counts rose and
are explained: home hover-missing 30 -> 32 (the category cards and the slider dots have no hover yet: home page work in Step 4) and the
employees hit-target count went 74 -> 120 on the last build (still far below the baseline 376) for one cause: the record links are now full 40 px targets
(they were 22 px), so two links in neighbouring rows sit 6-7 px apart (the "8 px between targets" rule); Step 6 makes the whole row the link, which removes both.

Reviewed by me (opened with Read): the light and dark sheets of home, pos and employees (`s10f/sheets/`) and both DNA boards (`s10f/`).
What I checked and saw (frontend-design):

- **Shared DNA** (`dna-board-light.png` / `-dark.png`, before `s10base`, after `s10f`): the staff screens now carry the customer
  wordmark (one face, same tracking), the same header bar with a hairline, the white / `#f5f5f7` canvas, the same buttons, fields and
  status badges with icons, the compact 14 px text. Before: serif wordmark, rose canvas with a blush gradient, ALL-CAPS burgundy group
  labels, a theme switch, "← Quay lại" on top-level pages.
- **Dark:** no pink text, link or border on the three screens (E2 pink-dark 0); links and the current menu entry are neutral and underlined;
  secondary buttons are neutral outlines. The only burgundy in dark is the A4 fill `#9b424e` (primary buttons, the current sidebar item,
  the home brand band), which still reads raspberry next to black: question 4.
- **Fixed after the first look:** names in tables broke letter by letter; record links grew every row to 64 px; a long warning badge pushed
  the cash page sideways at 200 % text; the dark link hover was invisible; footer link rows touched; staff headings were burgundy capitals;
  the shell kept its blush gradient, an inset shadow on the current item and shadows on cards below 1024 px.
- **Not changed yet (page work, Steps 4-6):** the home hero has no photo and the brand band is the accent fill (R13, R16); at 200 % text
  the customer menu and tools touch ("Mỹ phẩm EN"); the branch column still ends in an ellipsis; staff names wrap to 3-4 lines in narrow
  columns at 1280 (column widths are page work); the sidebar at 200 % text is cramped.

A1 check (`.local/s10/a1-check.log`, customer home and staff pos): the page switches light -> dark -> light with no reload when the
device setting changes (`--ls-bg-page` #fff -> #000 -> #fff); no `data-theme` attribute anywhere; both `theme-color` metas present
(`#ffffff` light, `#000000` dark); `color-scheme: light dark`; no theme cookie and no theme button. PASS on both.

Regression sweep on the committed build (every route, no screenshots, `s10f-all`, section 4): **no metric rose in any area** against the
baseline. Two rises seen on an intermediate Step 3 build were fixed before the commit: 80 contrast hits (disabled fields: the measure
lacked the disabled exemption for field borders that it already had for text) and one horizontal overflow (cash at 200 % text:
description-list rows now capped to their column). The 8 admin console errors are the same as the baseline (pre-existing).

Code re-audit of the files the foundation commit changed (`docs/redesign-s10/audit/step3-reaudit.md`): web-design-guidelines 61 baseline
findings in those files, 8 closed, 53 still open (51 of them in parts of the files the commit did not touch), 2 new (LOW: a leftover
`suppressHydrationWarning` on `<html>`; a field named after a generated id); react-best-practices 32, 6 closed, 26 open (20 untouched
parts), 1 new (LOW: `hasParent` recomputes its keys per render). The three new findings are fixed in Step 4.

DOM audit (`docs/uxui-audit-baseline.json`, the 26 baseline pages, `lucy_spa_uxaudit_20261001`; the audit's type scale was updated to
DESIGN.md 6.3 inside the v2 scope, which supersedes the older staff scale):

```text
type                       rule   before   after   delta
edge-left                  FR6         4       4       0
list-height-uneven         FR8         4       7       3   dashboard widgets (Step 6 dashboard plan)
row-height-uneven          FR8         8      20      12   long names wrap instead of an ellipsis (brief C15 over FR8's one row height)
sibling-gap-uneven         FR2         6       6       0
surface-style-mix          FR3         3       0      -3
unpaged-list               FR8         3       3       0
wrapped-label              FR8         1       3       2   dashboard button labels (Step 6 dashboard plan)
```

The three rises are reported, not hidden; the ratchet is not lowered for them. The CLAUDE.md rule "no count may rise" is therefore not
met at this checkpoint; the row-height rise needs your call (question 7).

## 4. E2 measurements per area (baseline `s10base` -> after Step 3 `s10f-all`)

Every route, light and dark at three widths, 200 % zoom and 200 % text. The final run (Step 7) must show 0 in every row.

### customer: 49 pages, 49 with failures, 0 unmeasured, 0 truncated

| metric           | s10base | s10f-all |
| ---------------- | ------: | -------: |
| overflow-x       |       0 |        0 |
| overlap          |    5164 |      810 |
| sticky-cover     |      49 |       49 |
| double-border    |      16 |       16 |
| card-heights     |       9 |        9 |
| grid-misaligned  |      21 |        8 |
| clipped-text     |     120 |       85 |
| font-size        |    1160 |        5 |
| font-weight      |       0 |        0 |
| contrast         |      64 |       64 |
| hit-target       |    2195 |     1853 |
| hover-missing    |     590 |      400 |
| pressed-missing  |    3054 |      848 |
| secondary-filled |       2 |        0 |
| pink-dark        |     354 |        0 |
| brand-text       |       8 |        5 |
| non-radix        |     539 |        0 |
| shadow-gradient  |      80 |       80 |
| transition-all   |       0 |        0 |
| console-errors   |       0 |        0 |

- contrast pairs over a gradient or an image (not measurable; never counted as a pass): 0

### admin: 77 pages, 75 with failures, 2 unmeasured, 0 truncated

| metric           | s10base | s10f-all |
| ---------------- | ------: | -------: |
| overflow-x       |       0 |        0 |
| overlap          |     276 |       71 |
| sticky-cover     |       0 |        0 |
| double-border    |     184 |       16 |
| card-heights     |       0 |        0 |
| grid-misaligned  |      25 |       25 |
| clipped-text     |     897 |      268 |
| font-size        |    3631 |        0 |
| font-weight      |       0 |        0 |
| contrast         |       0 |        0 |
| hit-target       |    8184 |     6311 |
| hover-missing    |     938 |      532 |
| pressed-missing  |    4378 |     1086 |
| secondary-filled |       0 |        0 |
| pink-dark        |    1395 |        0 |
| brand-text       |     454 |       10 |
| non-radix        |   15295 |       13 |
| shadow-gradient  |    4136 |        0 |
| transition-all   |       0 |        0 |
| console-errors   |       8 |        8 |

- contrast pairs over a gradient or an image (not measurable; never counted as a pass): 0
- unmeasured: my-payslip-detail: no record to open from my-payslips
- unmeasured: product-rewrite-detail: no record to open from product-rewrites

### pos: 14 pages, 14 with failures, 0 unmeasured, 0 truncated

| metric           | s10base | s10f-all |
| ---------------- | ------: | -------: |
| overflow-x       |       0 |        0 |
| overlap          |       0 |        0 |
| sticky-cover     |       0 |        0 |
| double-border    |       0 |        0 |
| card-heights     |       1 |        0 |
| grid-misaligned  |       0 |        0 |
| clipped-text     |     161 |        8 |
| font-size        |     791 |        0 |
| font-weight      |       0 |        0 |
| contrast         |       0 |        0 |
| hit-target       |    1387 |      945 |
| hover-missing    |     132 |       48 |
| pressed-missing  |     710 |      132 |
| secondary-filled |       0 |        0 |
| pink-dark        |     261 |        0 |
| brand-text       |      84 |        0 |
| non-radix        |    3046 |        0 |
| shadow-gradient  |     772 |        0 |
| transition-all   |       0 |        0 |
| console-errors   |       0 |        0 |

- contrast pairs over a gradient or an image (not measurable; never counted as a pass): 0

## 5. Motion evidence (G8)

Probe: `scripts/uxui-motion-probe.py` (GSAP tweens through the wrapper's probe + every CSS animation, transition and Web Animation seen
by `document.getAnimations()` from load through a scroll to the bottom and back; full, reduced motion and `ls-fx=off`; staff: any
tween over 200 ms fails, the skeleton loop excluded). Results: `.local/s10/motion/s10base/` and `.local/s10/motion/s10f/`.

| Page           | Full (after Step 3)                                                                                                                                                               | Reduced | Off |                      Staff over 200 ms |
| -------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------: | --: | -------------------------------------: |
| home           | hero rise 560 ms x3 (CSS; becomes the one hero sequence ≤ 800 ms through useMotion in Step 4), brand marquee loop, header compaction 280 ms, skeleton pulse, button colour 240 ms |       0 |   0 |                                      - |
| services       | header compaction 280 ms, skeleton pulse                                                                                                                                          |       0 |   0 |                                      - |
| product-detail | header compaction 280 ms                                                                                                                                                          |       0 |   0 |                                      - |
| pos            | sidebar pill 120 ms, nav colour 200 ms, skeleton pulse                                                                                                                            |       0 |   0 | 0 (baseline: 2, the 360 ms route rise) |
| employees      | same as pos                                                                                                                                                                       |       0 |   0 |                        0 (baseline: 2) |

Baseline (`s10base`) under `ls-fx=off`: 4 animations still ran on home (skeleton pulse, contact pulse, button colours); now 0. The contact
button's attention pulse (1.6 s, not a user action) is gone. GSAP tweens: 0 on these pages after Step 3 (no reveals, no count-up); the hero
sequence and the feedback tweens of Steps 4-6 will show in the same probe. Frame sequence of the home load (0-900 ms, 100 ms apart):
`.local/uxui-screens/s10f/motion/customer-home-*.png` (the current CSS hero rise; re-recorded after the Step 4 hero sequence).
Per-page animation list (trigger, element, duration, easing): the JSON files above; the full table per page comes with Steps 4-7.

## 6. Item rows

Status words: **done** = changed and verified; **foundation** = changed in the shared foundation and verified on the three Step 3 screens (each page is re-checked in Steps 4-6); **planned** = in the Step 2 plan for Steps 4-6; **pending Owner** = needs a decision (section 0); **n/a** = the element does not exist in that area.

### S. Skills x steps

| Step         | Skill                         | Status | Rule names used                                                                                                                                                                                                                                                                                                    | Evidence                                                                                                                                                                                                                         |
| ------------ | ----------------------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1 Baseline   | frontend-design               | done   | generic tells list (all-caps labels, eyebrows, appended arrows, card kits, numbering, middle dots, scattered entrances); hierarchy, one primary, Aevi patterns R13-R17                                                                                                                                             | audit/fd-critique.md (sheets opened by me: home, services, service-detail, products, product-detail, login, pos, services dark); the other pages' sheets were opened by the critique agents (plans/fd-plan-*.md Critique blocks) |
| 1 Baseline   | web-design-guidelines         | done   | Accessibility, Focus States, Forms, Animation, Typography, Content Handling, Images, Performance, Navigation & State, Touch, Safe Areas, Dark Mode, Locale, Hydration, Hover, Copy, Anti-patterns (Title Case replaced by sentence case)                                                                           | audit/wig-customer.md 65, wig-pos.md 182, wig-admin-a.md 198, wig-admin-b.md 188, wig-ui.md 65                                                                                                                                   |
| 1 Baseline   | vercel-react-best-practices   | done   | async-_, bundle-_, server-_, client-_, rerender-_, rendering-_, js-_, advanced-_                                                                                                                                                                                                                                   | audit/rbp-customer.md 47, rbp-staff.md 67, rbp-ui.md 49                                                                                                                                                                          |
| 1 Baseline   | vercel-react-view-transitions | done   | implementation.md step 1 (links, Suspense, persistent elements, shared elements, navigation map)                                                                                                                                                                                                                   | audit/vt-audit.md                                                                                                                                                                                                                |
| 1 Baseline   | webapp-testing                | done   | reconnaissance-then-action, networkidle waits, console logging (Python Playwright)                                                                                                                                                                                                                                 | scripts/uxui-capture.py; 392 + 712 images .local/uxui-screens/s10base; E2 JSON .local/s10/e2/s10base                                                                                                                             |
| 2 Plan       | frontend-design               | done   | plan per page (pattern, changes, tells removed), review against the brief with revisions                                                                                                                                                                                                                           | plans/plan-foundation.md, fd-plan-customer-1/2, fd-plan-pos, fd-plan-admin-a/b; report section 2                                                                                                                                 |
| 2 Plan       | web-design-guidelines         | done   | each plan lists the wig file:line findings it fixes                                                                                                                                                                                                                                                                | plans/*.md 'Baseline findings fixed'                                                                                                                                                                                             |
| 2 Plan       | vercel-react-best-practices   | done   | each plan lists the rbp findings it fixes; foundation picks the shared ones (bundle-dynamic-imports, js-cache-function-results)                                                                                                                                                                                    | plans/*.md; plan-foundation.md                                                                                                                                                                                                   |
| 2 Plan       | vercel-react-view-transitions | done   | shared element (photo morph), route fade, staff 120 ms fade, reduced motion                                                                                                                                                                                                                                        | report section 2; audit/vt-audit.md navigation map                                                                                                                                                                               |
| 2 Plan       | webapp-testing                | done   | checks per page: E2 metrics to reach 0 and the modes to look at                                                                                                                                                                                                                                                    | plans/*.md 'Checks'                                                                                                                                                                                                              |
| 3 Foundation | frontend-design               | done   | one DNA (wordmark, header, button, input, card, table), restraint (no gradients, no shadows, no pink), critique of the three screens, fixes, re-capture                                                                                                                                                            | dna-board-light/dark.png (s10base vs s10f); sheets s10f/sheets/*                                                                                                                                                                 |
| 3 Foundation | web-design-guidelines         | done   | Focus States (scroll-padding), Forms (name, autocomplete, spellcheck, inputmode), Animation (reduced motion, ls-fx off), Touch (touch-action, tap highlight), Dark Mode (color-scheme, theme-color, native select colours), Locale (Intl formatters), Hover (states everywhere), Accessibility (toast live region) | docs/redesign-s10/audit/step3-reaudit.md (61 baseline findings in the changed files: 8 closed, 53 open, 2 new LOW)                                                                                                               |
| 3 Foundation | vercel-react-best-practices   | done   | bundle-dynamic-imports (chat panel), bundle-barrel/conditional (bell without the staff dictionary), js-cache-function-results (Intl formatters, notification timestamps), rendering-hydration-no-flicker (no theme script)                                                                                         | docs/redesign-s10/audit/step3-reaudit.md (32 baseline findings in the changed files: 6 closed, 26 open, 1 new LOW)                                                                                                               |
| 3 Foundation | vercel-react-view-transitions | done   | reduced motion instant, staff route 120 ms fade, no GSAP on a shared element (G7)                                                                                                                                                                                                                                  | shell.css route-enter, reveal.tsx; motion probe s10f                                                                                                                                                                             |
| 3 Foundation | webapp-testing                | done   | before/after capture of home, pos, employees in 8 modes; E2 sweep of every route; motion probe full/reduced/off                                                                                                                                                                                                    | .local/uxui-screens/s10f; .local/s10/e2/s10f, s10f-all; .local/s10/motion/s10f                                                                                                                                                   |
| 4 Customer   | frontend-design               | open   |                                                                                                                                                                                                                                                                                                                    |                                                                                                                                                                                                                                  |
| 4 Customer   | web-design-guidelines         | open   |                                                                                                                                                                                                                                                                                                                    |                                                                                                                                                                                                                                  |
| 4 Customer   | vercel-react-best-practices   | open   |                                                                                                                                                                                                                                                                                                                    |                                                                                                                                                                                                                                  |
| 4 Customer   | vercel-react-view-transitions | open   |                                                                                                                                                                                                                                                                                                                    |                                                                                                                                                                                                                                  |
| 4 Customer   | webapp-testing                | open   |                                                                                                                                                                                                                                                                                                                    |                                                                                                                                                                                                                                  |
| 5 POS        | frontend-design               | open   |                                                                                                                                                                                                                                                                                                                    |                                                                                                                                                                                                                                  |
| 5 POS        | web-design-guidelines         | open   |                                                                                                                                                                                                                                                                                                                    |                                                                                                                                                                                                                                  |
| 5 POS        | vercel-react-best-practices   | open   |                                                                                                                                                                                                                                                                                                                    |                                                                                                                                                                                                                                  |
| 5 POS        | vercel-react-view-transitions | open   |                                                                                                                                                                                                                                                                                                                    |                                                                                                                                                                                                                                  |
| 5 POS        | webapp-testing                | open   |                                                                                                                                                                                                                                                                                                                    |                                                                                                                                                                                                                                  |
| 6 Admin      | frontend-design               | open   |                                                                                                                                                                                                                                                                                                                    |                                                                                                                                                                                                                                  |
| 6 Admin      | web-design-guidelines         | open   |                                                                                                                                                                                                                                                                                                                    |                                                                                                                                                                                                                                  |
| 6 Admin      | vercel-react-best-practices   | open   |                                                                                                                                                                                                                                                                                                                    |                                                                                                                                                                                                                                  |
| 6 Admin      | vercel-react-view-transitions | open   |                                                                                                                                                                                                                                                                                                                    |                                                                                                                                                                                                                                  |
| 6 Admin      | webapp-testing                | open   |                                                                                                                                                                                                                                                                                                                    |                                                                                                                                                                                                                                  |
| 7 Final      | frontend-design               | open   |                                                                                                                                                                                                                                                                                                                    |                                                                                                                                                                                                                                  |
| 7 Final      | web-design-guidelines         | open   |                                                                                                                                                                                                                                                                                                                    |                                                                                                                                                                                                                                  |
| 7 Final      | vercel-react-best-practices   | open   |                                                                                                                                                                                                                                                                                                                    |                                                                                                                                                                                                                                  |
| 7 Final      | vercel-react-view-transitions | open   |                                                                                                                                                                                                                                                                                                                    |                                                                                                                                                                                                                                  |
| 7 Final      | webapp-testing                | open   |                                                                                                                                                                                                                                                                                                                    |                                                                                                                                                                                                                                  |

### G. Motion

| Item | Rule                                                                                     | Customer   | POS        | Admin      | What changed                                                                                                                  | Evidence                                                                  |
| ---- | ---------------------------------------------------------------------------------------- | ---------- | ---------- | ---------- | ----------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| G1   | One main motion moment per customer page                                                 | planned    | n/a        | n/a        | Photo morph (SharedPhoto, ViewTransition) and brand marquee exist; hero sequence via useMotion planned for Step 4 (home)      | audit/vt-audit.md; motion/s10base/customer.json (hero CSS rise 560 ms x4) |
| G2   | No scroll reveals or card stagger                                                        | foundation | n/a        | n/a        | packages/ui/src/reveal.tsx: plain wrapper, no ScrollTrigger, no stagger                                                       | motion probe s10f: 0 reveal tweens                                        |
| G3   | Other motion = feedback to a user action only                                            | foundation | foundation | foundation | count-up.tsx: final number only; feedback motion = existing overlay/toast keyframes on tokens                                 | motion probe                                                              |
| G4   | All GSAP via useMotion; transform/opacity; no literal durations; killed on unmount/route | foundation | foundation | foundation | motion.ts: guarded GSAP (compact clamp), __lsMotionLog probe, ls:route kill (page-back.tsx RouteHistoryTracker)               | motion.test.tsx                                                           |
| G5   | Staff: only press/hover/focus/overlays/toast/tab/120 ms route fade/skeleton; <= 200 ms   | n/a        | foundation | foundation | shell.css route-enter 120 ms fade (--ls-dur-route), motion.ts clamp 0.2 s                                                     | motion probe staff: over200ms                                             |
| G6   | Reduced motion / data saver / ls-fx=off: no tweens                                       | foundation | foundation | foundation | base.css: all animations/transitions 0.01 ms under prefers-reduced-motion, html[data-ls-fx=off], html[data-ls-motion=reduced] | motion probe reduced/off                                                  |
| G7   | GSAP and ViewTransition never on the same element at once                                | foundation | foundation | foundation | Reveal no longer tweens a SharedPhoto card during a route change                                                              | audit/vt-audit.md VT4                                                     |
| G8   | Evidence: animation list, tween counts, 200 ms check, frame sequences                    | foundation | foundation | foundation | scripts/uxui-motion-probe.py (tween + animation counts, 200 ms check, frame sequences)                                        | .local/s10/motion/<phase>/                                                |

### R. References

| Item | Rule                                                                                        | Customer      | POS           | Admin         | What changed                                                                                           | Evidence                            |
| ---- | ------------------------------------------------------------------------------------------- | ------------- | ------------- | ------------- | ------------------------------------------------------------------------------------------------------ | ----------------------------------- |
| R1   | Filled accent only on primary/selected; never two filled side by side                       | foundation    | foundation    | foundation    | components-v2.css buttons: one solid fill (primary); secondary outline never fills                     | E2 secondary-filled                 |
| R2   | Links #60212a, fill #782b37                                                                 | foundation    | foundation    | foundation    | tokens.css --ls-link #60212a, fill #782b37                                                             | tokens-v2.test.ts                   |
| R3   | Type steps 12/14/17/21/28/40/56 (compact one down)                                          | foundation    | foundation    | foundation    | BrandWordmark on scale steps (21/17); skip link 14; subtle text 7.9:1 (B1)                             | E2 font-size                        |
| R4   | 4 px grid, 64 px section rhythm, card padding 24/16, gap 12                                 | planned       | planned       | planned       | Spacing tokens exist (4 px grid); per-page rhythm in Steps 4-6                                         | plans/*.md                          |
| R5   | No shadows                                                                                  | foundation    | foundation    | foundation    | v2 shadows none; staff auth flat; sidebar hairlines are borders (no gradient)                          | E2 shadow-gradient                  |
| R6   | Customer bands #fff/#f5f5f7; staff one Card on sunken canvas                                | planned       | foundation    | foundation    | data-ui=v2 on <body>: staff now on the sunken canvas with one Card surface                             | plans                               |
| R7   | Header: wordmark, nav, actions, hairline; compacts; never covers content; same component    | foundation    | foundation    | foundation    | packages/ui/src/header-bar.tsx used by SiteHeader and AppShell; hairline; not sticky under 560 px tall | site-frame.test.tsx, shell.test.tsx |
| R8   | Flat footer: 12 px grey links, dividers, aligned columns                                    | foundation    | n/a           | n/a           | foundation-v2.css footer: 12 px grey links, 44 px rows, no footer button (site-chrome.tsx)             | E2 overlap (footer)                 |
| R9   | Inputs 8 px, 1 px control border, sunken fill, 2 px focus ring                              | foundation    | foundation    | foundation    | v2 inputs 8 px, 1 px control border, sunken fill, 2 px ring (now on staff too)                         | controls-v2.test.tsx                |
| R10  | Links underline on hover; line icons in currentColor                                        | foundation    | foundation    | foundation    | foundation-v2.css links: underline on hover (light), always (dark), pressed state                      | E2 hover/pressed                    |
| R11  | 95 % achromatic; one accent; hover never vivid                                              | foundation    | foundation    | foundation    | tokens: hover = grey steps; rule 4 retired (CLAUDE.md, DESIGN 17)                                      | tokens-v2.test.ts                   |
| R12  | Content max 1200; hero and bands full bleed                                                 | planned       | n/a           | n/a           | Container 1200 exists; bands full bleed per page in Step 4                                             | plans                               |
| R13  | Hero: full-width photo, headline, one primary (+ secondary)                                 | planned       | n/a           | n/a           | Home hero (Step 4); scratch photos are flat stand-ins: photo quality not judged                        | plans/fd-plan-customer-1.md home    |
| R14  | Editorial block: text leading, framed photo trailing                                        | planned       | n/a           | n/a           | Step 4                                                                                                 | plans                               |
| R15  | Category grid 3 columns, photo fills card, white label over flat scrim, whole card one link | planned       | n/a           | n/a           | Step 4 (category grid with photos)                                                                     | plans                               |
| R16  | Brand-logo band: light, uniform height, no boxes                                            | planned       | n/a           | n/a           | Step 4: light brand band, ink logos (DESIGN 17.2)                                                      | plans                               |
| R17  | Product photos fill frame; no shadow/gradient/blur                                          | planned       | n/a           | n/a           | Step 4                                                                                                 | plans                               |
| R18  | Nav current page = underline (staff sidebar per 8.5)                                        | foundation    | n/a           | foundation    | customer nav: plain hover, 2 px underline current; sidebar current solid (8.5)                         | foundation-v2.css                   |
| R19  | Icons never carry colour                                                                    | foundation    | foundation    | foundation    | icons currentColor (kit); status badges carry an icon                                                  | surfaces-v2.test.tsx                |
| R20  | Radix steps 1-2 page backgrounds                                                            | foundation    | foundation    | foundation    | page backgrounds gray 1/2 (dark 1/2)                                                                   | tokens-v2.test.ts                   |
| R21  | Steps 3/4/5 component bg normal/hover/pressed                                               | foundation    | foundation    | foundation    | component bg 3/4/5; transparent hover 3 pressed 4                                                      | tokens-v2.test.ts                   |
| R22  | Step 6 subtle borders, 7/8 interactive borders, 8 focus ring                                | pending Owner | pending Owner | pending Owner | Step 8 focus ring measures 2.40:1 (light) / 2.15-2.66:1 (dark) < 3:1; ring kept at #60212a / gray 12   | DESIGN.md 17.1                      |
| R23  | Step 9 solid fill, 10 its hover                                                             | foundation    | foundation    | foundation    | primary fill 9, hover 10 (dark 9/10), white label                                                      | components-v2-css.test.ts           |
| R24  | Step 11 links; dark links neutral + underline                                               | foundation    | foundation    | foundation    | links burgundy 11 light; dark neutral + underline; no #dcadb0 role                                     | tokens-v2.test.ts                   |
| R25  | Step 12 strong accent border only (secondary hover)                                         | foundation    | foundation    | foundation    | #521b24 only as the secondary hover border                                                             | tokens-v2.test.ts                   |
| R26  | Never edit Radix scales; semantic colours                                                   | foundation    | foundation    | foundation    | Radix scales unchanged; status = red/green/orange scales; chart dark slot 1 off pink                   | tokens.css                          |

### A. Owner decisions

| Item | Rule                                      | Customer      | POS        | Admin         | What changed                                                                                                 | Evidence                                                                                                             |
| ---- | ----------------------------------------- | ------------- | ---------- | ------------- | ------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------- |
| A1   | No in-app theme switch; follow the device | done          | done       | done          | theme modules deleted; data-theme gone; colorScheme + 2 theme-color metas; preview uses data-preview-theme   | .local/s10/a1-check.log (live switch, no data-theme, 2 theme-color metas) PASS on customer and staff; tokens.test.ts |
| A2   | Customer account deletion                 | pending Owner | n/a        | pending Owner | Plan: plans/fd-plan-customer-2.md ACCOUNT-DELETION; open: prepaid combo sessions, delivery name/phone copies | Owner questions                                                                                                      |
| A3   | Brand colour only on clickable text       | foundation    | foundation | foundation    | tokens roles; badges neutral; links #60212a                                                                  | E2 brand-text, pink-dark                                                                                             |
| A4   | Button states per Apple and Radix         | foundation    | foundation | foundation    | components-v2.css button states; lift/arrow removed                                                          | components-v2-css.test.ts; E2 hover/pressed/secondary-filled                                                         |

### B. Owner-reported defects

| Item | Rule                                                      | Customer      | POS        | Admin      | What changed                                                                                                                                   | Evidence                           |
| ---- | --------------------------------------------------------- | ------------- | ---------- | ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------- |
| B1   | Captions too small and faint                              | foundation    | foundation | foundation | --ls-text-subtle 7.91:1; meta lines to 14 px in Step 4-6                                                                                       | tokens-v2.test.ts                  |
| B2   | Hero                                                      | planned       | n/a        | n/a        | Step 4 home hero                                                                                                                               | plans                              |
| B3   | Facts strip                                               | planned       | n/a        | n/a        | Step 4 facts strip                                                                                                                             | plans                              |
| B4   | Price list main action = primary                          | planned       | n/a        | n/a        | Step 4 price list primary                                                                                                                      | plans                              |
| B5   | Service rows hover black and overflow                     | foundation    | n/a        | n/a        | hover tokens grey (no black fill); row overflow in Step 4                                                                                      | plans                              |
| B6   | Uneven card heights                                       | foundation    | planned    | planned    | svc-card rows auto/1fr/auto; primary action pinned                                                                                             | E2 grid-misaligned                 |
| B7   | "Quay lại" on top-level pages; chevron only with a parent | foundation    | foundation | foundation | PageBack chevron icon-only, only with a parent (hasParent, menuRoot); detail pages still pair it with a breadcrumb (Step 4-6)                  | public-pages.test.tsx              |
| B8   | Black chip band                                           | planned       | n/a        | n/a        | Step 4: chips inside the title band                                                                                                            | audit/fd-critique.md services dark |
| B9   | Native select styled, both modes                          | foundation    | foundation | foundation | Select chevron everywhere, explicit colours both modes                                                                                         | controls-v2.test.tsx               |
| B10  | Chips clipped with no scroll sign                         | foundation    | planned    | planned    | chip rows: peek padding; per-page wrap in Steps 4-6                                                                                            | foundation-v2.css                  |
| B11  | Two solid filled buttons side by side                     | foundation    | foundation | foundation | one solid fill; tinted pills become outline/neutral                                                                                            | E2                                 |
| B12  | Double borders / nested boxes                             | planned       | planned    | planned    | Steps 4-6 per page (E2 double-border)                                                                                                          | plans                              |
| B13  | Footer columns misaligned                                 | foundation    | n/a        | n/a        | footer rows 44 px, 12 px, aligned grid                                                                                                         | E2 overlap                         |
| B14  | Chips have no hover                                       | foundation    | foundation | foundation | chip hover grey 4, pressed grey 5                                                                                                              | E2 hover-missing                   |
| B15  | Card main action = primary ("Đặt lịch")                   | pending Owner | n/a        | n/a        | Service card "Đặt lịch" is the primary (services-list.tsx); many fills in one grid vs C4: Owner to confirm; product cards have no button (8.3) | Owner questions                    |
| B16  | Product detail has two primaries                          | planned       | n/a        | n/a        | Step 4 product detail                                                                                                                          | plans                              |
| B17  | Policy page title band                                    | planned       | n/a        | n/a        | Step 4 policy pages                                                                                                                            | plans                              |
| B18  | Product-card badges inconsistent                          | foundation    | n/a        | n/a        | Badge neutral shop labels, out of stock = warning + icon                                                                                       | surfaces-v2.test.tsx               |
| B19  | Account page cards                                        | planned       | n/a        | n/a        | Step 4 account pages                                                                                                                           | plans                              |
| B20  | Sticky header overlaps at 200 % zoom                      | foundation    | foundation | foundation | header not sticky under 560 px tall (200 % zoom)                                                                                               | E2 sticky-cover                    |
| B21  | Services menu has no hover                                | foundation    | n/a        | n/a        | nav hover underline                                                                                                                            | E2 hover-missing                   |
| B22  | Main menu pink in dark; no pink anywhere                  | foundation    | foundation | foundation | no role on burgundy dark 11/12; chart slot 1 off pink                                                                                          | E2 pink-dark                       |
| B23  | Hover and pressed on every interactive element            | foundation    | foundation | foundation | hover + pressed for buttons, links, nav, chips, tabs, pager, menu, rows, tab bar                                                               | E2 hover/pressed-missing           |
| B24  | Pages/screens off the Aevi pattern or the shared DNA      | planned       | planned    | planned    | Steps 4-6 per page / screen                                                                                                                    | plans                              |

### C. HIG rules

| Item | Rule                                                                                      | Customer      | POS        | Admin         | What changed                                                                                                 | Evidence        |
| ---- | ----------------------------------------------------------------------------------------- | ------------- | ---------- | ------------- | ------------------------------------------------------------------------------------------------------------ | --------------- |
| C1   | One colour = one meaning                                                                  | planned       | planned    | planned       | Steps 4-6 (plans)                                                                                            | baseline E2     |
| C2   | No brand colour on non-clickable text                                                     | foundation    | foundation | foundation    | A3 tokens                                                                                                    | E2 / tests      |
| C3   | Primary shown by background colour                                                        | foundation    | foundation | foundation    | A4                                                                                                           | E2 / tests      |
| C4   | At most 1-2 filled/prominent buttons per view                                             | foundation    | foundation | foundation    | one solid fill                                                                                               | E2 / tests      |
| C5   | Never colour alone; focus outline                                                         | foundation    | foundation | foundation    | badge icons; links underlined                                                                                | E2 / tests      |
| C6   | Light, dark and prefers-contrast variants                                                 | foundation    | foundation | foundation    | light/dark done; prefers-contrast: pending                                                                   | E2 / tests      |
| C7   | No hard-coded colours; semantic tokens on Radix steps                                     | foundation    | foundation | foundation    | v2 tokens on every area                                                                                      | E2 / tests      |
| C8   | Backgrounds support content                                                               | planned       | planned    | planned       | Steps 4-6 (plans)                                                                                            | baseline E2     |
| C9   | Contrast >= 4.5:1 both modes; every pair reported                                         | foundation    | foundation | foundation    | contrast measured (E2 pairs)                                                                                 | E2 / tests      |
| C10  | Two background levels: base and elevated                                                  | foundation    | foundation | foundation    | raised surface tokens                                                                                        | E2 / tests      |
| C11  | White-background images dimmed in dark                                                    | planned       | planned    | planned       | Steps 4-6 (plans)                                                                                            | baseline E2     |
| C12  | Icons visible on dark                                                                     | planned       | planned    | planned       | Steps 4-6 (plans)                                                                                            | baseline E2     |
| C13  | Body 17 (compact 14); nothing below 12; weight >= 400                                     | foundation    | foundation | foundation    | scale                                                                                                        | E2 / tests      |
| C14  | Only the 6.3 scale; every size reported                                                   | foundation    | foundation | foundation    | scale                                                                                                        | E2 / tests      |
| C15  | No truncation; no tight leading on 3+ lines                                               | planned       | planned    | planned       | Steps 4-6 (plans)                                                                                            | baseline E2     |
| C16  | 200 % zoom and 200 % text hold                                                            | foundation    | foundation | foundation    | header B20; table scroll                                                                                     | E2 / tests      |
| C17  | Most important content top/leading                                                        | planned       | planned    | planned       | Steps 4-6 (plans)                                                                                            | baseline E2     |
| C18  | Grid alignment, spacing, equal card heights                                               | planned       | planned    | planned       | Steps 4-6 (plans)                                                                                            | baseline E2     |
| C19  | Group with spacing or one separator; no nested borders                                    | planned       | planned    | planned       | Steps 4-6 (plans)                                                                                            | baseline E2     |
| C20  | Hover/focus never cover a neighbour or overflow                                           | foundation    | foundation | foundation    | grey hover                                                                                                   | E2 / tests      |
| C21  | Same functions at 390/768/1440 (staff 1024/1280/1440); safe areas; centred                | planned       | planned    | planned       | Steps 4-6 (plans)                                                                                            | baseline E2     |
| C22  | Small screens: <= 2 text or 3 icon buttons side by side                                   | planned       | planned    | planned       | Steps 4-6 (plans)                                                                                            | baseline E2     |
| C23  | Motion (see G)                                                                            | see G         | see G      | see G         | Motion is section G                                                                                          | -               |
| C24  | Motion (see G)                                                                            | see G         | see G      | see G         | Motion is section G                                                                                          | -               |
| C25  | Motion (see G)                                                                            | see G         | see G      | see G         | Motion is section G                                                                                          | -               |
| C26  | Responsive images: srcset, WebP/AVIF, size, lazy/priority                                 | planned       | planned    | planned       | Steps 4-6 (plans)                                                                                            | baseline E2     |
| C27  | Text over images has a flat scrim                                                         | planned       | planned    | planned       | Steps 4-6 (plans)                                                                                            | baseline E2     |
| C28  | Icons consistent; icon-only controls named; decorative aria-hidden                        | foundation    | foundation | foundation    | status icons                                                                                                 | E2 / tests      |
| C29  | Hit targets 44 (compact 40); spacing around controls                                      | foundation    | foundation | foundation    | footer rows 44                                                                                               | E2 / tests      |
| C30  | Keyboard, tab order, focus-visible, labels, skip link                                     | foundation    | foundation | foundation    | focus ring kept                                                                                              | E2 / tests      |
| C31  | No autoplay without stop; minimise time limits                                            | planned       | planned    | planned       | Steps 4-6 (plans)                                                                                            | baseline E2     |
| C32  | Verb-first labels; no "click here"; sentence case; "…"                                    | planned       | planned    | planned       | Steps 4-6 (plans)                                                                                            | baseline E2     |
| C33  | Errors beside the field with the fix; empty states with a next step                       | planned       | planned    | planned       | Steps 4-6 (plans)                                                                                            | baseline E2     |
| C34  | Branding defers to content; no branded loading screen                                     | planned       | planned    | planned       | Steps 4-6 (plans)                                                                                            | baseline E2     |
| C35  | Hover and pressed everywhere                                                              | foundation    | foundation | foundation    | A4                                                                                                           | E2 / tests      |
| C36  | Options in a group same size; preferred by style                                          | foundation    | foundation | foundation    | -                                                                                                            | E2 / tests      |
| C37  | Destructive never primary/default                                                         | foundation    | foundation | foundation    | danger never primary                                                                                         | E2 / tests      |
| C38  | Pending actions: spinner + "…", disabled                                                  | planned       | planned    | planned       | Steps 4-6 (plans)                                                                                            | baseline E2     |
| C39  | Buttons that open a view end with "…"                                                     | planned       | planned    | planned       | Steps 4-6 (plans)                                                                                            | baseline E2     |
| C40  | Back chevron only where a parent exists                                                   | foundation    | foundation | foundation    | B7                                                                                                           | E2 / tests      |
| C41  | Short page titles; brand is not a title                                                   | planned       | planned    | planned       | Steps 4-6 (plans)                                                                                            | baseline E2     |
| C42  | One primary in the top bar/toolbar, trailing; <= 3 groups                                 | planned       | planned    | planned       | Steps 4-6 (plans)                                                                                            | baseline E2     |
| C43  | Monochrome bar labels; edge effect only when scrolled under                               | foundation    | foundation | foundation    | -                                                                                                            | E2 / tests      |
| C44  | Tab bar <= 5 tabs icon + one word; staff sidebar 2 levels, collapsible                    | planned       | planned    | planned       | Steps 4-6 (plans)                                                                                            | baseline E2     |
| C45  | Short menu items, verbs, one submenu level                                                | planned       | planned    | planned       | Steps 4-6 (plans)                                                                                            | baseline E2     |
| C46  | Selects for exclusive options with default; native behaviour kept                         | foundation    | foundation | foundation    | select                                                                                                       | E2 / tests      |
| C47  | < 3 items -> buttons/toggles; destructive items red, last, confirmed                      | planned       | planned    | planned       | Steps 4-6 (plans)                                                                                            | baseline E2     |
| C48  | Segmented: up to 5 phone, 5-7 desktop, equal widths                                       | planned       | planned    | planned       | Steps 4-6 (plans)                                                                                            | baseline E2     |
| C49  | In-page tabs <= 6, short nouns                                                            | planned       | planned    | planned       | Steps 4-6 (plans)                                                                                            | baseline E2     |
| C50  | Selected not by colour alone; chips hover                                                 | foundation    | foundation | foundation    | chip states                                                                                                  | E2 / tests      |
| C51  | Visible label; stacked fields consistent widths                                           | planned       | planned    | planned       | Steps 4-6 (plans)                                                                                            | baseline E2     |
| C52  | Email on blur; errors beside; focus first error; type/inputmode/autocomplete; paste       | foundation    | foundation | foundation    | field defaults                                                                                               | E2 / tests      |
| C53  | Search: scope placeholder, as-you-type, clear, suggestions                                | planned       | planned    | planned       | Steps 4-6 (plans)                                                                                            | baseline E2     |
| C54  | Time-slot steps divide 60                                                                 | planned       | planned    | planned       | Steps 4-6 (plans)                                                                                            | baseline E2     |
| C55  | Short list rows, no truncation, drill-down chevron                                        | planned       | planned    | planned       | Steps 4-6 (plans)                                                                                            | baseline E2     |
| C56  | Relevant first; load more / 20 per page; URL state                                        | planned       | planned    | planned       | Steps 4-6 (plans)                                                                                            | baseline E2     |
| C57  | Standard grids; hover never overlaps; no layout shift                                     | planned       | planned    | planned       | Steps 4-6 (plans)                                                                                            | baseline E2     |
| C58  | Boxes never near full width; no nested boxes                                              | planned       | planned    | planned       | Steps 4-6 (plans)                                                                                            | baseline E2     |
| C58b | Staff tables: one surface, sunken header, tabular, sortable, sticky, row hover            | foundation    | foundation | foundation    | table scroll edge                                                                                            | E2 overflow-x   |
| C59  | Horizontal rows show the next item; no same-direction nested scroll                       | planned       | planned    | planned       | Steps 4-6 (plans)                                                                                            | baseline E2     |
| C60  | One sheet/modal at a time; close + title; confirm before losing input; overscroll contain | foundation    | foundation | foundation    | overscroll contain (v2)                                                                                      | E2 / tests      |
| C61  | Alerts only for important actionable things                                               | planned       | planned    | planned       | Steps 4-6 (plans)                                                                                            | baseline E2     |
| C62  | No popovers at phone width; bottom sheet                                                  | planned       | planned    | planned       | Steps 4-6 (plans)                                                                                            | baseline E2     |
| C63  | Spinners, determinate progress, skeletons                                                 | foundation    | foundation | foundation    | toast live region                                                                                            | E2 / tests      |
| C64  | Clickable image is a labelled link/button with hover                                      | planned       | planned    | planned       | Steps 4-6 (plans)                                                                                            | baseline E2     |
| C65  | Carousel dots centred, <= 10, uncoloured                                                  | planned       | planned    | planned       | Steps 4-6 (plans)                                                                                            | baseline E2     |
| C66  | Sensible defaults; no prefilled passwords; autofill works                                 | planned       | planned    | planned       | Steps 4-6 (plans)                                                                                            | baseline E2     |
| C67  | Continue enabled only when ready; say why when blocked                                    | planned       | planned    | planned       | Steps 4-6 (plans)                                                                                            | baseline E2     |
| C68  | Sign-in explains why booking needs an account; return with choices                        | planned       | planned    | planned       | Steps 4-6 (plans)                                                                                            | baseline E2     |
| C69  | Account deletion per A2                                                                   | pending Owner | n/a        | pending Owner | Plan: plans/fd-plan-customer-2.md ACCOUNT-DELETION; open: prepaid combo sessions, delivery name/phone copies | Owner questions |
| C70  | Return to a list keeps scroll and filters                                                 | planned       | planned    | planned       | Steps 4-6 (plans)                                                                                            | baseline E2     |
| C71  | Every public page: title and meta description                                             | planned       | planned    | planned       | Steps 4-6 (plans)                                                                                            | baseline E2     |
| C72  | Remove cart item / POS line offers Undo                                                   | planned       | planned    | planned       | Steps 4-6 (plans)                                                                                            | baseline E2     |
| C73  | Ask only needed data; permissions on use                                                  | planned       | planned    | planned       | Steps 4-6 (plans)                                                                                            | baseline E2     |
| C74  | Shared terminal: signed-in staff name always visible                                      | planned       | planned    | planned       | Steps 4-6 (plans)                                                                                            | baseline E2     |

## 7. Checks run at this checkpoint

- `eslint . --max-warnings 0` and `check-boundaries`: clean. `prettier . --check`: clean. `tsc --noEmit` (packages/ui, apps/web): clean.
  `apps/web/next-env.d.ts` untouched.
- Unit tests: packages/ui 551 pass, 0 fail; apps/web 1144 pass, 0 fail (updated to the new rules; no coverage removed except for the
  deleted theme switch, each replaced by an assertion that it is gone). The whole-repo `pnpm test`, `pnpm test:integration`, `pnpm smoke`
  and the F workflows (sale, payment, booking check-in, product edit, invoice view) run in Step 7, as the brief's "Finish" asks.
- Migrations: none.

## 8. Not done yet / open

- Steps 4-7 (every customer page, POS screen and admin screen; the final E1/E2/E3 runs; A2 account deletion; the Aevi side-by-sides and
  the B1-B24 before/after pairs, which need the page work).
- Unmeasured: `my-payslip-detail`, `product-rewrite-detail` (no record in the scratch data); campaign page: the only campaign ends
  2026-10-16 03:14 local and the database refuses to move a published window, so the final run needs a new scratch campaign.
- During the DOM audit switch I stopped two API processes on this machine that ran `apps/api/dist/main.js`; one was started from a
  different Node install and may have belonged to another session (it was not on the audit port). Restart it if you were using it.
