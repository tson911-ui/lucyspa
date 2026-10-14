# Redesign group 1, session 7 report (C16, C17 and the session 6 follow-ups). Local only: not pushed, not deployed.

Commits: follow-ups `e30ef9c`, C16 `07c5365` (+ test fix `81b1346`), C17 `7d18d6c`. No migration, no API change, no permission change, no booking or auth logic touched.

## What changed

- **Follow-ups (Owner decisions on the S6 report, recorded in the plan):** aside copy keys removed; DESIGN.md 9.2 follows the built booking steps. Account: new **"Hồ sơ" tab** (`/account/profile`, last of the tabs and phone quick links), name and language from the session. **It is read only:** no customer profile API exists (`/me/account` is workforce only and refuses customers) and the old home card was read only, so "edit" is **pending Owner approval** (a new customer endpoint, with its audit and rules). The "← Quay lại" link already existed on every detail page (`PageBack`); no second one was added. It goes to the page the person came from (the list when they came from it) and to the list when opened directly. Seven tabs would not fit at 768 px, so the tab is "Lịch hẹn" (as the header menu), 8 px padding, and the row wraps instead of scrolling at larger text.
- **C16:** ticket = one centered 30 rem column (code at the page-title size, status badge, details), header reduced to the wordmark, phone tab bar hidden, printable without footer or chat button. 404 / error / missing ticket: flat, `title` size, one-sentence copy, direction C ring removed; the generic 404 offers "Về trang chủ" + "Đặt lịch". New `InfoPage` (680 px article of h2 sections, table of contents from 1024 px only when there are 2+ sections) and `ContactPage` (place left, details and pills right). **They are not routed:** there is no info/CMS/contact/policy route or content store in the code (`[...rest]` only answers 404) and no admin to feed them; the layouts are checked on placeholder content (`.local/g7/info-gallery.tsx`).
- **C17:** hero sequence (CSS, transform only, nothing hidden, first paint unchanged); stagger on service and account cards; shared photo list to detail for services and products (`SharedPhoto`); booking step slide (`useStepSlide`); loyalty counter (`CountUp`, final number always in the DOM). New `data-ls-fx="off"` on `<html>` from the `ls-fx` cookie (server) so the CSS hero is off from the first paint.

## Checks (all run)

- Tests: ui 575, web 1106 pass (whole packages, via `node --test`); typecheck and eslint clean; `prettier --check .` clean. New: info-page, motion-pass, C16/C17 CSS guards. The C16 commit had one failing ui test I had not run (class check); fixed in `81b1346`.
- **G6, real browser, 22 customer pages x full / `ls-fx=off` / reduced motion** (`.local/g7/motion-check.mjs`): off and reduced give no hero tween, no hidden block, no inline transform left behind; counter, booking slide and shared photo run in full only; scrolling reveals every block (services, products, home). Hero, counter ("620", final text in the DOM from the start), booking slide (focus stays on the step heading) and both shared photos pass.
- Bundle: home first load 344.8 KB gzip (was 345.4), lazy GSAP unchanged (44.6 KB). DOM audit vs the C1 baseline: no count rises (profile has no baseline; its one finding, the footer icons, is the same as on `account`).

## UX gate (`.local/uxui-screens/group1-session7/`, 64 before | after sheets + `c16-layouts/` + `profile__t130-768-after-only.png`)

Account home, bookings, detail pages, profile, ticket, 404 (page, service, product, booking), missing ticket at 360/768/1440 light, 1440 dark, 130 % text; home, services, products, loyalty, booking (after only: C17 changes no static look); layouts of info page (3 sections, 1 section, none, long words), contact page. Opened and reviewed: account 768, ticket 360, services 1440, profile 768 and 130 %, loyalty 768, info long 360, contact 360, policy dark, 404 pages. **Motion cannot be shown by still images:** it is proved by the browser script above, not by the screenshots. Not captured: loading skeletons, 200 % text, the real error page (`error.tsx` needs a thrown error; its markup is rendered in `c16-layouts/error-*`).

## Needs your decision

1. Customer profile edit (name, language, phone, email, date of birth): needs a new customer API; the tab is read only until you approve it.
2. Info, contact and policy pages: the layouts exist; there is no route, content store or admin. Say where the content lives (a new CMS model, or the shop info) and whether the contact page needs a map (no provider chosen).
3. Error page keeps "Tải lại" as the primary (a retry is the useful action) and "Về trang chủ" second; the spec text says home + "Đặt lịch".
4. Ticket: no QR (no library; the code is read out at the counter); the footer stays on screen.
5. Back from a detail page does not morph the photo back (history Back carries no transition type and the list re-renders); the page cross-fades as before.
6. The pnpm shim was blocked by NVM mid-session (event NVM4306, "delegated script identity changed"); I ran prettier, eslint, tsc, tests and `next build` through `node` directly. Please check `nvm reshim`.
