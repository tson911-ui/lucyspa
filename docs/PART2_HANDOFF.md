# Part 2 handoff (customer area and public site): read this first in a fresh session

Last updated 2026-10-03. Contract: `UXUI_REDESIGN_PART2_DESIGN.md`. Plan: `UXUI_REDESIGN_PART2_PLAN.md`. Mockups: `docs/mockups/part2/`.
Per-step reports: `UXUI_REDESIGN_PART2_P2-1_FOUNDATIONS.md`, `_P2-2_BACKEND.md`, `_P2-3_SHOP_INFO_TAB.md`, `_P2-4_HOME.md`, `_P2-6_MEMBER_AUTH.md`, `_P2-7_BOOKING.md`, `_P2-8_MEMBER_AREA.md`, `_P2-9_MOTION_SEO.md`, `_P2-10_FINAL_GATE.md`.
Repo rules are in `CLAUDE.md` (UX gate, ratchet, no heredocs, never force-push, never touch `apps/web/next-env.d.ts`).

## Where we are

| Step                                                                                                                 | Commits                                   | State                                                                                                                                  |
| -------------------------------------------------------------------------------------------------------------------- | ----------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| Contract, plan, mockups (Owner answers Q-P2-1..11 recorded)                                                          | `a1432b5`                                 | done                                                                                                                                   |
| P2-1 foundations (tokens, kit site frame, siteNav registry, chrome)                                                  | `84b8141`, `55f298d`                      | done, CI green                                                                                                                         |
| P2-2 shop info backend (migration `20261023000000_uxui_part2_shop_info`, `/public/site`, `/public/services[/:code]`) | `d438ed0`                                 | done, CI green                                                                                                                         |
| P2-3 admin "Shop info" tab (website page, last tab)                                                                  | `84676b9`                                 | done, CI green                                                                                                                         |
| P2-4 public home + services list/detail                                                                              | `9f1d319`, **`5ec3cdb`** (smoke-test fix) | done, **CI green at `5ec3cdb`**                                                                                                        |
| P2-5 services polish                                                                                                 | -                                         | **folded into P2-7 (booking preselect) and P2-9 (metadata)**; list and detail already exist                                            |
| P2-6 member auth in the site chrome                                                                                  | see git log                               | done 2026-10-03 (report `UXUI_REDESIGN_PART2_P2-6_MEMBER_AUTH.md`); `wfClassUses` 65                                                   |
| P2-7 booking in four steps                                                                                           | see git log                               | done 2026-10-03 (report `UXUI_REDESIGN_PART2_P2-7_BOOKING.md`); `nativeFieldsets` 0, `nativeCheckboxes` 0, `wfClassUses` 38            |
| P2-8 member area on the kit (overview, bookings, invoices as DataTables, cancel dialog, `customer.css` deleted)      | see git log                               | done 2026-10-03 (report `UXUI_REDESIGN_PART2_P2-8_MEMBER_AREA.md`); all four ratchet counters 0                                        |
| P2-9 motion pass + SEO data (metadata, sitemap, robots, LocalBusiness)                                               | see git log                               | done 2026-10-03 (report `UXUI_REDESIGN_PART2_P2-9_MOTION_SEO.md`)                                                                      |
| P2-10 final gate + `DEPLOY_PART2_RUNBOOK.md`                                                                         | see git log                               | done 2026-10-03 (report `UXUI_REDESIGN_PART2_P2-10_FINAL_GATE.md`, runbook `DEPLOY_PART2_RUNBOOK.md`); **stop for the Owner's review** |

Nothing is deployed. All Part 2 ratchet counters are 0 (`wfClassUses`, `nativeFieldsets`, `nativeCheckboxes`, `solidDangerButtons`, `siteCssSpacingLiterals`) and must stay 0.
**P2-1 to P2-10 are done; the Owner reviews the whole of Part 2 next, then deploys with `docs/DEPLOY_PART2_RUNBOOK.md`.** Open items for the Owner: member-area LCP (see the P2-10
report), the placeholder hero photo (admin upload, in the runbook), and the review notes above.

**Follow-up 2026-10-03 (after the P2-10 review request):** navigation motion for the public site (prefetch, sliding menu pill, route entrance on navigation only, softer reveals) and the 360 px audit findings (FR8 phone cards, FR3 cancel dialog and Shop info tab). Report `UXUI_REDESIGN_PART2_NAV_MOTION.md`. Lesson: the seasonal frame is a stacking context below the phone tab bar, so anything fixed that must sit above the tab bar needs the tab bar hidden (`.ls-site:has(.ls-backdrop)`).

## Owner decisions (locked; do not reopen)

- Q-P2-1 shop info = one `website_shop_info` row edited in admin; opening hours come from the chosen branch's operating hours (one source with booking).
- Q-P2-2 **no guest booking**: signing in stays required; the CTA keeps the chosen service through login (`?service=CODE`, `next`).
- Q-P2-3 **no "Vì sao chọn LUCY SPA" section** at all (the reference's claims are not real).
- Q-P2-4 **remove `noindex` and add SEO data now** (site not launched): home, services, service detail only; account/auth/staff stay noindex. Done in P2-9.
- Q-P2-5..11 as recommended: Playfair Display 500/600 for h1-h3 on public/member pages; no service photos; same English slugs in VI and EN; services inside
  a group ordered price ascending then name; map as a link only; the Lovable hero photo imported as a clearly marked placeholder; EN copy approved as proposed.
- **After the P2-4 review (2026-10-03):** keep the English tagline "Heartfelt Relaxation – Elevated Beauty". **"Chỉ đường" opens the Owner's map link
  first (Shop info), and only without one searches the address on a map** (this is how `directionsUrl` in `lib/public-site-core.ts` works).
- Promotions come only from the Owner's Slider and Popup; services and prices come live from the catalogue; shop facts come from Shop info. No cosmetics
  ("Mỹ phẩm") route or hidden link; the nav is data-driven (`lib/site-nav.ts`) so one entry adds it later.

## Owner review notes (keep this list; mark each one when handled)

- **P2-4 approved by the Owner (2026-10-03).** P2-6 to P2-10 run without stopping between steps: per step lint, smoke, full checks, a normal push, one hash line; the Owner stops the run at the runbook.
- 2026-10-03 services page: "Nail gel (gói 13)" shows under the Massage group. **Checked: scratch data only, not a bug.** `.local/uxui-audit/seed.mjs` assigns categories round-robin
  (`pick(categories, index)`) and appends "(gói N)" to filler names; the scratch row `SV013` really has `category_id` = `CAT1` "Massage", and `public-catalog.core.ts` groups strictly by the
  service's own category. Real data is grouped by what the Owner sets in the catalogue.

- 2026-10-03 site header (asked as part of P2-6, done as a follow-up commit because P2-6 was already pushed): match the Lovable reference. Logo left; menu
  "Trang chủ, Dịch vụ, Lịch hẹn, Hóa đơn"; then the theme icon, the account icon and the single "Đặt lịch ngay" button. The separate "Đặt lịch" menu item is
  gone (also from the phone tab bar, where the booking tab now reads "Đặt lịch ngay"). "Lịch hẹn" and "Hóa đơn" show to signed-in members only. "Mỹ phẩm" stays
  hidden until the cosmetics phase (no entry exists; one registry line adds it). The VI/EN switch stays as a compact round button. The theme icon is a plain
  sun/moon toggle that shows the theme in use; the clock icon (the "by time of day" state) is dropped from the public header because the page already follows
  the clock until the visitor chooses (the staff area keeps its three-way toggle). Same items on phones: the header keeps logo, language, theme, account; the
  tab bar carries Trang chủ, Dịch vụ, Đặt lịch ngay and, for members, Lịch hẹn and Hóa đơn (the call to action does not fit the 360 px header next to the tools).

## What exists now (so you do not rebuild it)

- Kit (`packages/ui`): `site.css` (tokens only), `SiteHeader` (client, scroll sentinel), `SiteNav`, `TabBar`, `SiteFooter`, `PublicMain`, `Band`, `PublicPage`, `PriceList`, `Steps`,
  `ChoiceCard` (native checkbox/radio in a label; not used yet), `Reveal` + `reveal-core`, `ThemeCycle`, `buttonClass` (server-safe, `button-class.ts`). Tokens `--ls-text-3xl`,
  `--ls-text-display`, `--ls-font-display`, motion tokens (`--ls-dur-reveal`, `--ls-dur-zoom`, `--ls-ease-premium`, `--ls-reveal-shift`, `--ls-stagger`, `--ls-parallax-shift`).
  Not built yet: parallax (M6), hover zoom (M3 photo), booking summary/action-bar CSS, `Steps` use.
- Web: chrome in `components/public/site-chrome*.tsx` (header account button is a plain link to `/{locale}/account`; the signed-in/out account menu is **P2-6**), texts in
  `i18n/site.ts` (add new customer texts there, not in the staff dictionary), `lib/fill.ts`, `lib/hours.ts`, `lib/public-site-core.ts` (checked parsers + formatters + links),
  `lib/public-site.ts` (server reads), `lib/public-site-client.ts`, `lib/ttl-memo.ts`. Routes: `(public)/(home)`, `(public)/services/(list)` (both with `loading.tsx`), `services/[code]` (no loading file on purpose), `(public)/not-found.tsx`.
- API: `GET/POST /api/v1/website/shop-info` (admin), `GET /api/v1/public/{site,services,services/:code}?locale=` (anonymous, cache 60 s, never `durationMinutes`).
- The booking page still ignores `?service=`; "Đặt lịch" buttons already link `/{locale}/account/book?service=CODE`.

## Next steps in detail

1. **Owner reviews the home on their machine, then says go.** Expect small copy/visual notes.
2. **P2-6 member auth**: login, register, forgot password (and the reset page if it exists) as a centered card in the site chrome (not the red staff panel), `SegmentedControl` linking
   Đăng nhập and Đăng ký, show/hide password, "Quên mật khẩu?" at the end of the password label row, `next` honoured for same-origin paths only. Add the header account menu
   (signed out: Đăng nhập/Đăng ký; signed in: Lịch hẹn, Hóa đơn, Thông báo, Đăng xuất). Move `components/customer/shell.tsx` onto the shared chrome. Clears `auth.tsx`, `session.tsx`, `shell.tsx` `wf-*`.
3. **P2-7 booking**: 6 internal views become 4 steps (Dịch vụ [+ branch only if more than one] / Khách / Nhân viên và giờ / Xác nhận), API and rules unchanged. `ChoiceCard` rows, `RadioGroup` and
   `FormSection` instead of native fieldsets, sticky summary (desktop) and action bar (phone), preselect from `?service=CODE` (codes -> ids after loading the branch services), per-nail services show the range and
   "số ngón chốt tại tiệm" (the customer booking has **no quantity**), total = fixed prices + "+ giá theo ngón". Clears `nativeFieldsets` and `nativeCheckboxes`. Keep `lib/customer/booking.test.tsx` green.
4. **P2-8 member area**: overview (greeting, upcoming bookings, read-only profile from `/auth/me`), bookings and invoices as `DataTable` + `Pagination` (20/page), detail pages, cancel via
   `ConfirmDialog` danger tone with `reasonField` (clears `solidDangerButtons`), notifications reuse the shared inbox; delete the `customer.css` legacy `wf-*` block, `cu-*` classes and `wf-app`; set the four counters to 0 with `UPDATE_RATCHET=1`.
5. **P2-9 motion + SEO**: apply M1-M7 (contract section 7) consistently; parallax only inside `@supports (animation-timeline: view())`, >= 1024 px, fine pointer, not for reduced motion/save-data/low memory.
   SEO: change `generateMetadata` in `app/[locale]/layout.tsx` (today `robots: { index: false }` for everything) so home/services/detail are indexable with titles, descriptions, Open Graph (slide or hero image), `hreflang`
   alternates, `sitemap.xml`, `robots.txt` (disallow account and workforce), LocalBusiness JSON-LD from Shop info. Import the Lovable hero photo (`docs/mockups/part2/assets/placeholder-hero.jpg`) into the media
   library titled "PLACEHOLDER - replace with a real shop photo" (alt text VI required) and choose it as hero only if the Owner still agrees.
6. **P2-10 final gate** and **`docs/DEPLOY_PART2_RUNBOOK.md`** (the Owner asked for it): `pnpm check`, `pnpm test:integration`, `pnpm test:auth:integration`, `pnpm smoke`, build; axe + DOM audit on every public/member page
   (360/768/1440 light, 1440 dark, plus 360 dark); CWV measurement (CLS 0, LCP <= 2.5 s throttled); the checklist: additive migration `20261023000000` via `db:deploy`, no permission sync, no new env var, restart API+web,
   `MEDIA_STORAGE_DIR` unchanged, backup scope, rollback (redeploy the previous commit; the `website_shop_info` table is additive and can stay), the Owner must open Admin > Website > Shop info once to check the seeded values and the branch hours (09:00-21:00 is the default).

## How to work (lessons that cost time)

- **Run `pnpm lint` and `pnpm smoke` before every push**, not only `pnpm test`. CI failed twice: a raw `<a href>` in a kit test (lint, `55f298d`) and `scripts/smoke-web.mjs` still asserting the old home headline (`5ec3cdb`).
  When a route or the home page changes, update `scripts/smoke-web.mjs` in the same commit.
- **Do not wait on CI; the Owner checks GitHub** and reports. `gh` is not installed: failed steps are readable at `https://api.github.com/repos/tson911-ui/lucyspa/actions/runs/{id}/jobs`; logs need a login.
- Commit trailer: `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`. Follow-ups are new commits; never amend a pushed commit or force-push.
- Server pages cannot pass functions (a router `Link`) to client components: wrap in a small client component (`PublicBreadcrumbs`, `PublicNav`).
- Next's fetch cache never replaces a stored 200 with a 204 or an error: use `ttlMemo` for server reads that can go from "something" to "nothing" (the season bug).
- A `loading.tsx` above a route that calls `notFound()` makes the HTTP status 200; keep loading files off such routes (route groups).
- Class names in `site.css` must not clash with `components.css`/`shell.css` (a guard test fails; `.ls-facts` once silently got a grey admin background).
- Reveal-on-scroll hides below-the-fold blocks until scrolled: `gate14.mjs` and `scripts/uxui-screens.mjs` scroll through the page first; use them rather than raw screenshots.
- `rm -rf apps/web/.next/dev` if `pnpm typecheck` complains about generated types after moving routes. `next dev` creates `apps/web/AGENTS.md` and `CLAUDE.md`: delete them before committing.
- Heredocs are blocked by a repo hook: use the Write/Edit tools. Shell backticks and `\` in `node -e` strings corrupt code: write scripts to a file.
- After editing Vietnamese strings through the shell, grep the result: encoding and escaping mistakes silently produce wrong text.

## Local tooling (in `.local/`, git-ignored; recreate if missing)

- Stack for real-app gates: scratch DB `lucy_spa_uxaudit_20261001` (and authtest `lucy_spa_authtest_20261001`), both already migrated through `20261023000000`; Docker Postgres and Redis must be up.
  `node .local/p2-rebuild.mjs [--api]` stops web (3100), rebuilds, restarts (with `--api` also rebuilds and restarts the API on 3101).
- Gate: `node .local/uxui-audit/gate14.mjs <page names>` (pages list inside; Part 2 added `public-services*`, `public-service-detail*`, `website-shop-tab`), then `node .local/uxui-audit/gate14-summary.mjs --audit` and
  `node scripts/uxui-audit-summary.mjs --dir .local/uxui-audit/results14-compat --page <name>`. Pages that answer 404 on purpose are checked with curl, not the gate. Visual review: `node scripts/uxui-screens.mjs <name> <url> --theme-cookie --widths 360,768,1440 --all`; open every image.
- Ship: write the message to `.local/p2-commit-msg.txt`, then `node .local/p2-ship.mjs --no-wait` (format, lint, typecheck, whole-repo test, commit all, push). It does not run `pnpm smoke`: run that yourself.
- Scratch data states: `node .local/p2-states.mjs hero-noseason|slide|restore` (restored now: season on, no slide, no hero picture). The scratch branch opens 00:00-24:00 and its catalogue names are test data.
- Integration tests against authtest: `node .local/uxui-audit/run-at.mjs apps/api/dist/website/<file>.integration.test.js` (build the API first).
