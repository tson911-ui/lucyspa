# Redesign group 1, session 6 report (C14, C15). Local only: not pushed, not deployed.

Commits: C14 `3db551a`, C15 `e3e2da5`. No migration, no API change, no permission change. The booking logic files (`lib/customer/booking*.ts`), auth calls and the APIs are untouched; one test in `lib/customer/invoice.test.tsx` was updated for the new frame.

## What changed

- **C14 booking flow (`book.tsx`, `pages-v2.css`, `components-v2.css`):** title band (back link, h1, the four-pill stepper) and a content band: one 720 px column, the summary card as a sticky aside from 1024 px, and on a phone the same
  summary folded in an accordion row above a flat action bar (hairline, no radius or shadow; Back is the neutral button, Continue the primary). The shared `ChoiceCard` is flat (accent edge and tick when chosen, hover is rule 4, no lift), times
  are 44 px pills. Success state is in the same bands (neutral "Đặt lịch khác", primary "Xem chi tiết lịch hẹn"). The steps, their order, the `ls-booking-bar` hook, the focus on the step heading and every API call are as before.
- **C15 sign-in (`auth.tsx`):** wordmark above one 26 rem hairline card on a band of the flat panel color (new v2 tokens `--ls-auth-flat` #782b37 / dark #1c1c1e and `--ls-on-auth-flat`, Q4; contrast asserted). The old rose aside is gone. Staff sign-in
  (`AuthLayout`, `.ls-auth*`) shares only the root `--ls-auth-panel-*` tokens with it and was not touched.
- **C15 member area:** new `AccountScreen` (`account-frame.tsx`): title band (back link, h1, sentence, the page's one action, account tabs from 768 px using the existing `SiteSubNav`) and content band. `CustomerShell` is now only `main`. Account home =
  greeting plus four summary cards (next appointment, points, latest invoice, notifications; each one link, a pill that fills on hover) and, below 768 px, the quick-links list. Bookings, booking detail, invoices, invoice detail, loyalty (a progress bar
  to the next tier), notifications (the inbox takes the frame through a new `frame` prop; staff keeps its own header), orders and order detail moved onto it. The session-check skeleton uses the same two bands.
  Data for the cards comes only from the GETs the pages already used (`/me/bookings`, `/me/loyalty`, `/me/invoices`, the unread count).

## Checks (all run)

- `ui` 563 and `web` 1105 tests pass (one test updated: the invoice list now asserts the member frame); `booking.test.tsx` and `booking-view.test.ts` pass unedited. New tests: `account-frame.test.tsx`, C14/C15 CSS tests, auth-panel token test. Typecheck, eslint, `pnpm format:check` clean.
- DOM audit (customer pages, light 360/768/1440, after the contact pulse ends) against the C1 baseline: no count rises on the 19 pages of the two Steps. `uxui-touch-check` passes (light and dark). `uxui-tabbar-check` on the three sign-in pages: all pass except
  the login keyboard probe, which flakes on some runs (as in sessions 3 to 5; passed 1 of 2 repeats).
- Staff login and staff forgot password: screenshots byte-identical before and after (md5, 5 images). `inbox.tsx` is shared with staff: its staff path keeps the same header, intro and secondary button (covered by `notification-center.test.tsx`, not screenshotted). Real booking on the scratch stack reached the success state (that sheet, `book-success`, has no before: it is after-only).

## UX gate (`.local/uxui-screens/group1-session6/`, 108 before | after sheets)

Booking: four steps, other-person form, no selection, member with no appointments, success, 360/768/1440 light, 1440 dark, 130 % text. Sign-in: login, error notice, register, forgot. Account: home (full and empty), bookings, detail, cancelled, not found, invoices, loyalty,
notifications, orders, order detail, empty lists. All 108 sheets were opened and reviewed. The rig is custom (`.local/g6/harness.mjs`, a CDP driver, not `uxui-screens.mjs`): it fails a combination when the page is a browser error page or has no site frame, and never writes an image for it. Not captured: loading skeletons, 200 % text, dark at 360. Fixed during the gate: the folded summary showed open (a display rule beat `hidden`), the action buttons wrapped to three lines at 130 %, tabs were indented from the title and the sixth tab was cut off at 768 px, the empty appointment list had no box, and on a short phone the contact button sat on the sign-in button (the card now starts at the top of the panel below 1024 px). In the full-page register shots the panel stretches to the screen height; that is a capture artifact.

## Needs your decision (provisional until you answer)

1. Sign-in reading: "centered card on a flat panel band, wordmark above" (no aside). The aside copy keys `auth.asideTitle/One/Two/Three` are now unused. The other reading (a flat panel beside the card) is a small change.
2. The spec names the steps "service, time, details, confirm"; the screen keeps services, guests, staff and time, confirm (reordering would be logic).
3. Account home no longer has the profile card (name is in the greeting; language is in the header) and the "Đặt lịch" button of the home and bookings titles is gone (the header pill and the tab bar already carry it).
4. Breadcrumbs of the detail pages are gone; the code is the title's sentence, Back goes to the parent.
5. Audit tooling: `scripts/uxui-page-audit.js` counts `.ls-acct-actions` (the title band's action slot) as a place for actions.
6. Old direction C rules for booking and member pages stay in `site.css` (C18 deletes them). No guest booking page exists in the code, so none was designed.
