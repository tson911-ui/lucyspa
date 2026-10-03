# Part 2, P2-10: final gate

Run on 2026-10-03 against the scratch database `lucy_spa_uxaudit_20261001` (web 3100, API 3101) and the throw-away `lucy_spa_authtest_20261001` for the integration suites. The dev database was never used.

## What ran and the result

| Gate                                                                             | Result                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| -------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm check` (format, lint, typecheck, whole-repo tests, build) and `pnpm smoke` | green before every push of P2-6 to P2-10 (`ed32756`, `04aa0f6`, `866d49e`, `7fd35af`, `8985abf`, the final fix commit)                                                                                                                                                                                                                                                                                                                                            |
| `pnpm test:integration` (database, 76 tests)                                     | 76 pass, 0 fail                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `pnpm test:auth:integration` (API, 486 tests)                                    | 486 pass, 0 fail on the second run. The first run had 1 failure, a Prisma "Operation has timed out" in `email-dispatch.integration` while the machine was busy; that file passes alone and the whole suite passed on the rerun (unrelated to Part 2, no code involved)                                                                                                                                                                                            |
| axe on every Part 2 page                                                         | 0 violations on all renders                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| DOM audit (23+ pages, 360/768/1440 light, 360/768/1440 dark, real app)           | 0 findings on home (VI/EN), services (list, group, detail VI/EN), sign-in, register, forgot password, booking (all steps and the success page), booking detail, invoice detail, notifications. Findings left, all known: FR8 (phone card rows of different height) on the overview, bookings and invoices lists at 360 px (kit card mode; a branch name wraps); FR3 on the cancel dialog (the dialog over its backdrop) and on the Shop info tab at 360 px (P2-3) |
| Ratchet                                                                          | `wfClassUses`, `nativeFieldsets`, `nativeCheckboxes`, `solidDangerButtons` and every `*SpacingLiterals` counter are 0                                                                                                                                                                                                                                                                                                                                             |
| SEO                                                                              | verified on the running app: indexable only home, list and service pages; account, sign-in, staff and 404 pages `noindex`; `sitemap.xml` and `robots.txt` built from the visitor's host (see the P2-9 report)                                                                                                                                                                                                                                                     |

## Core Web Vitals (throttled phone profile)

`.local/p2-cwv.mjs`: 360 px, 4x CPU slowdown, 1.6 Mbit/s with 150 ms latency, cold cache, load plus a scroll through the page. Run with nothing else on the machine.

| Page                                                                         | LCP          | CLS | JavaScript (gzip) |
| ---------------------------------------------------------------------------- | ------------ | --- | ----------------- |
| Home                                                                         | 1.5 s        | 0   | 269 KB            |
| Services list; service detail                                                | 1.5 s; 2.0 s | 0   | 269 KB            |
| Sign-in                                                                      | 1.4 s        | 0   | 289 KB            |
| Member overview, bookings, booking (client rendered after the session check) | 3.7 to 5.5 s | 0   | 266 to 293 KB     |

- **Met:** CLS 0 on every measured page and LCP <= 2.5 s on the public pages and the sign-in page (the server sends the whole card).
- **Not met:** LCP on the member pages is 3.7 to 5.5 s on this deliberately harsh profile. They show nothing real until the browser has loaded the scripts, asked the API who is signed in and loaded the list. They sit behind a login, are not landing pages, and only the first paint is slow (a "checking your session" state, then the page). The remedy is a follow-up: read the session and the first page of data on the server (cookie forwarded to the API) so the first HTML already holds the content. Not started: it changes how the member area authenticates and needs the Owner's say.
- The numbers on a busy machine were 2x worse and noisy (3 to 5 s for the public pages); the table is the quiet run.
- Layout shifts found and fixed in this Step: the footer and season dividers jumped when member pages loaded (every data-loading page is now at least one screen tall: `.ls-main-tall`); the sign-in card swapped a skeleton for the form (now server rendered from the search parameters); the header bell pushed the tools sideways (the unread count is now a badge on the account button, a member sees Lịch hẹn / Hóa đơn appear in free space after the logo); the phone tab bar waits hidden for the session instead of reshuffling; the overview and booking pages keep their table skeleton / price note in place.

## Fixed during the gate

- Header: unread bell replaced by a badge on the account button (also fits the 360 px header), menu next to the logo.
- Sign-in: `searchParams` read by the server page (no `useSearchParams`, no Suspense skeleton).
- Member pages: viewport-tall main, overview skeleton of the final height, booking price note above the list.

## Deployment

The checklist for the Owner is `docs/DEPLOY_PART2_RUNBOOK.md` (backup, additive migrations, no permission change, no new environment variable, restart, verification, rollback).

## Open for the Owner's review

- Member-area LCP (above): accept, or approve the server-side session follow-up.
- The unread bell is now a badge (not a separate icon) so the header never reshuffles.
- Placeholder hero photo: an admin upload on the live site (steps in the runbook), not part of the code.
