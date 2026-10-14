# Redesign group 1, session 7 report (C16, C17 and the session 6 follow-ups). Local only: not pushed, not deployed.

Commits: follow-ups `e30ef9c`, C16 `07c5365` (+ test fix `81b1346`), C17 `7d18d6c`. No migration, no API change, no permission change, no booking or auth logic touched.
`e30ef9c`'s message says the tab row fits at 768 px; it did not yet. The fit (shorter "Lịch hẹn" tab, 8 px reach into the gutter) is in `7d18d6c`.

## What changed

- **Follow-ups (Owner decisions on the S6 report, recorded in the plan):** aside copy keys removed; DESIGN.md 9.2 follows the built booking steps. New **"Hồ sơ" tab** (`/account/profile`, last of the tabs and phone quick links): name and language from the session. **Read only:** no customer profile API exists (`/me/account` is workforce only and refuses customers) and the old home card was read only, so "edit" is **pending Owner approval** (needs a new customer endpoint). The "← Quay lại" link already existed on every detail page (`PageBack`); none was added (see decision 1).
- **C16:** ticket = a centered 30 rem column (code at the page-title size, badge, details), header reduced to the wordmark, phone tab bar hidden, printable without footer or chat button. 404 / error / missing ticket: flat and centered, `title` size, one-sentence copy, the direction C ring removed; the generic 404 offers "Về trang chủ" + "Đặt lịch". New `InfoPage` (680 px article of h2 sections, contents list from 1024 px when there are 2+ sections) and `ContactPage` (place left, details and pills right). **Not routed:** there is no info, contact or policy route, content store or admin in the code (`[...rest]` only answers 404). Layouts were checked on placeholder content (`.local/g7/info-gallery.tsx`). A page with no section is only its title band.
- **C17:** home hero sequence (CSS, transform only, nothing hidden), stagger on service and account cards, shared photo list to detail for services and products (`SharedPhoto`), booking step slide (`useStepSlide`), loyalty counter (`CountUp`, final number always in the DOM), `data-ls-fx="off"` on `<html>` from the `ls-fx` cookie.

## Checks (all run)

- Tests: ui 575, web 1106 pass (whole packages); typecheck, eslint clean; `prettier . --check` (= `format:check`) clean. The C16 commit left one failing ui test (class check) that I had not run; fixed in `81b1346`.
- **G6 in a real browser** (`.local/g7/motion-check.mjs`), 22 customer pages x full / `ls-fx=off` / reduced motion, run twice: in off and reduced there is no hero tween, no hidden block, no inline transform left, and no animation or transition still running after settle; counter, booking slide and shared photo run in full only; every block reveals when scrolled to the end (desktop and 360). Counter ("620" in the DOM at once), booking slide (focus stays on the step heading) and both forward morphs pass. A first run listed nav-pill transitions as running; that was the headless page being hidden (animations not ticking); with the page brought to the front none remain.
- **Not exercised:** the hero photo "settle" (the scratch shop has no hero photo; only the text rise ran). The morph on history Back does not happen (reported by the script, not failed).
- Bundle: home first load 344.8 KB gzip (was 345.4), lazy GSAP unchanged (44.6 KB). DOM audit vs the C1 baseline: no count rises (profile has no baseline; its one finding, the footer icons, equals `account`).

## UX gate (`.local/uxui-screens/group1-session7/`: 64 before | after sheets, `c16-layouts/` 24, `profile__t130-768-after-only.png`)

Account home, bookings, booking / invoice / order detail, cancelled and not-found booking, profile, ticket, missing ticket, 404 (page, service, product), at 360/768/1440 light, 1440 dark, 130 % text (360; profile also at 768); home, services, products, loyalty, booking (after only); info page (3 sections, 1, none, long words), contact page, error page. **All 89 images were opened and reviewed.** Fixed during the gate: 7 tabs did not fit at 768 px; counter and reveal blocks were caught mid-tween in the first shots (the rig now scrolls first). Seeded media in the scratch shop (home slider picture) is a broken image in both before and after. Still images cannot show motion; the browser script is the evidence. Not captured: loading skeletons, 200 % text, the real `error.tsx` (needs a thrown error; its markup is in `c16-layouts/error-*`).

## Needs your decision

1. **Back from a detail page:** you asked for a link "back to its list". It exists, but with in-app history it returns to the previous page (account home card -> booking detail -> Back = home), the 2026-10-04 rule; opened directly it goes to the list. Choose: keep, or always the list.
2. Customer profile edit needs a new customer API; the tab is read only until you approve it.
3. Info, contact and policy pages: where does the content live (new CMS model, or shop info)? Does the contact page need a map (no provider chosen)? What should an empty page show?
4. Error page: "Tải lại" primary, "Về trang chủ" second (a retry is the useful action); the spec text says home + "Đặt lịch".
5. Ticket: no QR (no library; the code is read out at the counter); the footer stays on screen.
6. **Security signal:** the pnpm shim was blocked by NVM mid-session (event NVM4306, "delegated script identity changed"). I ran prettier, eslint, tsc, tests and `next build` through `node` directly. Please check `nvm reshim` or reinstall Node.
