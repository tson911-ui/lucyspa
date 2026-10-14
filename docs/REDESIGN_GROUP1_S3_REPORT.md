# Redesign group 1, session 3: C7, C8, C9 (report)

Commits (local, not pushed): `238bf10` C7, `43c0dda` C8, `3ba876e` C9, `e492057` (Reveal follow-up) and this report. Plan: `docs/REDESIGN_GROUP1_PLAN.md` (the session 2 Owner decisions are recorded in it).

## What changed

- **C7 GSAP wrapper:** `gsap` 3.15.0 in `packages/ui`. `motion-core.ts` (the switches, token parsing, the 200 ms staff cap), `motion.ts` (`useMotion().run(scope, build)`: one dynamic import of `gsap` + `ScrollTrigger` after first paint, a context per scope reverted on unmount and when motion turns off, no tween under a focused text field). `MotionGate` now also reads `ls-fx=off`, a `staffSetting` prop (the stubbed staff-wide setting) and the build flag `NEXT_PUBLIC_LS_MOTION=off`. `Reveal` runs through ScrollTrigger and hides a block only once GSAP has loaded (`e492057`).
- **C8 header:** `chrome-v2.css` (new, under `[data-ui='v2']`). 96 % blur surface with a hairline, clear at the top, no fade; accent text + 2 px underline for the current page, hover pill only on hover/focus; bare 44 px tools; "Đặt lịch" pill with an icon from 640 px; compact header keeps the logo at full size (the 0.92 scale made the wordmark link 40 px). Select chevron from `icons.tsx` (`SelectIconScope`, customer frame only).
- **C9 footer, tab bar, contact, popup:** alternate band under a hairline (no brand-red fill, no wave), 2 columns on a phone, 12 from 1024 px; footer icon targets now 12 px apart (was 4); tab bar page color with the hairline above its box; flat booking disc; contact button and popup without shadows. Direction C footer, tab bar and popup rules deleted from `customer.css`.

## GSAP license and bundle (the budget is a proposal, pending your approval)

- License: gsap.com/standard-license (effective 2025-04-30, modified 2025-05-30): free for anyone, commercial use and ScrollTrigger included; the only limit is a competing no-code animation builder. npm: `Standard 'no charge' license`.
- Home `/vi` first load, gzip: 340.4 KB before, 342.5 KB after (+2.1). GSAP is two lazy chunks, 44.6 KB gzip (114 KB raw), loaded after first paint only. A build with `NEXT_PUBLIC_LS_MOTION=off` emits no GSAP chunk (verified: 0 files). Proposed budget: first load +3 KB at most, lazy GSAP 50 KB at most.

## Tests (all green)

`packages/ui` 548 pass (new: `motion`, `chrome-v2-css`, select), `apps/web` 1075 pass, `pnpm lint`, ui and web typecheck, `pnpm format:check`. Not run: the other packages and the integration suites (no push, no API change). Real browser: `uxui-touch-check` light/dark/auto pass; `uxui-tabbar-check` 360/390, dpr 2/2.625, light/dark: 122 of 122 pass on the final CSS (one keyboard probe failed once at 390 light and passed twice on rerun, not reproduced); Reveal on a fresh load: jump to the bottom, `ls-fx=off`, reduced motion and switching off while open all pass.

## UX gate (session 3)

1. Before/after sheets (360/768/1440 light, 1440 dark, 130 % text at 360, bell and account menu open, contact open, popup, footer): `.local/uxui-screens/group1-session3/`; opened and reviewed (header top and scrolled, member, cart, footer in both modes, contact panel, popup, 130 % member and home).
2. Season layer: a Tết season on the scratch shop renders the header with its logo accent; the season was switched off again.
3. DOM audit, 6 pages x 3 widths (home, services, login, register, account, cart): no count rises (login 360 improves, 3 to 1).
4. Not done here: 200 % text and the full 42-page set (C18); the page bodies are still direction C (home wave band, offer ribbon, cards).
5. "Before" of the scrolled header is not a true scrolled capture (the old build was replaced); the scrolled header has after images only.

## Needs your decision

- Header "Đặt lịch" pill: DESIGN.md 8.5 wants it from 360 px, icon + text. A 360 px member bar has 9 px free (wordmark + cart, bell, language, theme, account), so it shows from 640 px and the booking tab of the phone tab bar is the call to action below that. Alternatives: icon-only at 360 for guests only, or move language and theme into the account menu.
- Clear-at-top header kept (DESIGN.md 6.5 does not say to drop it). Always-on would add a hairline at the top of every page.
- Bundle budget above (proposal).
- Seen, not changed: the home offer ribbon's "Mua ngay" outline button is nearly invisible on the red ribbon in light mode (C10).
