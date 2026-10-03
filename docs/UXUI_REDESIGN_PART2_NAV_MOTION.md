# Part 2 follow-up: navigation motion and the 360 px audit findings

Run on 2026-10-03 against the scratch database (web 3100, API 3101). Public site only; member sign-in is unchanged.

## What changed

- **Near-instant page changes.** The header menu, phone tab bar, member sub-menu and the header/hero calls to action use `prefetch` (the whole page loads when the link is on screen; production builds only). Measured on the built app: a menu click changes the URL within 20 ms.
- **Menu pill slides.** `SiteNav` and `SiteSubNav` (now client components in `packages/ui/src/site-nav.tsx`) draw one pill under the current entry and slide it to the next on a route change (token `--ls-dur-slide`, 360 ms). First paint, a resize or a hidden menu place it without sliding; without scripts the current link keeps its own highlight.
- **Page content eases in on a route change** (`RouteEnter`, used by the public and account templates): a small rise plus fade. The **first load never animates** (no LCP cost). Off for reduced motion, data saver and low-memory devices.
- **Sections reveal softly:** the section headings of the home page and the services groups use `Reveal` like their cards (below the fold only).
- **Reduced motion:** all new durations are tokens that are 0 under `prefers-reduced-motion`; verified in the browser (pill jumps, no fade).

## Audit findings at 360 px

- **FR8 card rows (overview, bookings, invoices):** two causes. The last card of every phone list had a different layout (a `:last-child td` rule outranked the labelled-cell rule, so a long value wrapped under its label); fixed in the kit. Lists that must keep one height opt in with `className="ls-cards-one-line"` (value held to one line with an ellipsis); the services cell shows the first service and "+N".
- **FR3 cancel dialog:** the audit counted the dialog's textarea as a surface (false positive; the audit now skips text fields). A real bug showed up while checking: with a season active, the phone tab bar stacked over the dialog's buttons and blocked them. The tab bar now hides while a dialog or drawer is open.
- **FR3 Shop info tab:** the phone form-actions bar is docked chrome like the booking action bar (audit exception, same precedent).

## Tests and results

`pnpm format:check`, `pnpm lint`, `pnpm check` (whole repo tests + build) and `pnpm smoke` pass. DOM audit and axe on home, services, service detail, sign-in, overview, bookings, invoices, notifications, cancel dialog and Shop info tab: 0 findings (360/768/1440 light and dark). The first `pnpm check` run had three API http-test timeouts while the machine was busy (no API code touched); the second run was fully green.

## Notes

- No migration, permission or environment variable. Prefetched pages stay in the browser's router cache for a few minutes, so a promotion changed in the admin can show up on a client navigation up to that long later (a reload shows it at once).
- Open for the Owner: the member pages are still client rendered (LCP note in the P2-10 report).
