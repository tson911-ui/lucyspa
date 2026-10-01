# UX/UI Step 10a: Booking board, walk-in, reassignment

Status: Owner reviewed (2 rounds), committed with this report. Plan: UXUI_REDESIGN_STEP7_5_PLAN.md section 8 (10a). Base: 8f1d353 (CI green, incl. `test:auth:integration`). UI only: no API, DB or permission change.

## What changed

- **Booking board** (`booking-board.tsx` + `-sections`, `-dialogs`): toolbar (search, branch, date note, reload) over four blocks. Bookings = client `DataTable` (time + code, customer + phone, services, status + note); open visits = one row per service line; waiting pool = `DataTable`; queue = equal-height `Card` grid. **Check-in is a button on the row** ("Nhận khách", icon-only below 1280 px) when the API offers it; the other decisions are in the `⋮` menu.
- **Dialogs**: arrive (short, says it cannot be undone: the API has no undo), no-show, priority, cancel walk-in, cancel unstarted service = `ConfirmDialog` (solid red only there). Forgotten END = `FormDialog`. Add service = `AddServiceDialog`. Change requested staff = `IntentDialog`.
- **Walk-in**: form page (`Page width="form"`), member lookup is a dialog, per-person `FormSection`s, footer = primary only.
- **Reassignment**: toolbar, `DataTable` 20/page + "Load more", `⋮` Choose replacement, `ReassignmentDialog`.
- **Tablet fit (measured, every table 0 px over at 768/1024/1280)**: below 1280 the phone number, arrival note, staff, timing, guest-type columns drop out; services stay (two lines, 8 rem); bookings header is "Dịch vụ".
- **Kit**: `FormSection actions`, `.ls-repeat-row`, `.ls-list-plain`, `.ls-cell-stack/-main/-sub/-title/-clamp`, `.ls-show-below-xl`, toolbar filter width/height. `AddServiceForm` stays for My services (10b).

## Behavior differences (all UI; same endpoints and bodies)

1. Commands: inline card form -> dialog; a refusal keeps the dialog open with the reason and the support reference.
2. Success is a toast (notice if no provider); "still waiting" after Assign stays a notice.
3. Change staff: one dialog; only changed lines are sent, one request each, in order, stopping at the first failure.
4. Open visits: card per visit -> row per service line. Walk-in has an unsaved-changes guard. Reassignment: conflicts checkbox -> select; a failed confirm still reloads, closes the dialog and shows the page error.

## Tests

- Web 275/275 (incl. ratchet), packages/ui 238/238, typecheck, eslint, `format:check` clean. Ratchet: raw tables 6 -> 5, wf uses 325 -> 237, fieldsets 7 -> 5, checkboxes 4 -> 2, solid danger 6 -> 3.
- **Real flows on the scratch DB** (bookings made through the public API: register, activate from the intent, login, book; scripts in `.local/`): arrive (button, short confirm, ARRIVED + visit, not offered again) PASS; late arrival (LATE_HOLD, then LATE_IN_HOLD) PASS; priority (empty reason refused, then override recorded) PASS; KTV check-in, start (IN_PROGRESS), end (booking COMPLETED, visit closed) PASS; forgotten END on an overdue line (line ended, visit closed) PASS; change requested staff (any -> named KTV, toast) PASS; no-show after the hold (HOLD_EXPIRED, reason, NO_SHOW) PASS; plus assign, cancel walk-in, add service, refused arrival (9/9 earlier). States seen: UPCOMING, WINDOW_OPEN, LATE_HOLD, HOLD_EXPIRED, ARRIVED, COMPLETED, NO_SHOW. Not seen live: CANCELLED, IN_SERVICE.
- Notes: the KTV needs the KTV role, an attendance check-in and a passed planned start (API rules). Reassignment rows (leave conflicts) were rendered from fixture data only.

## UX gate

- Rendered the three pages at 360/768/1440 light + 1440 dark, every dialog at 1440 and 360. Fixed from review: clipped actions at 1440 and at 768/1024, repeated "Chi nhánh" heading, stacked date inputs, 44 px date input beside 40 px selects, clipped service text.
- DOM audit: booking-board 123 -> 6, walk-in 62 -> 2, reassignment 58 -> 2. Only `row-height-uneven` rose (24 -> 26): phone card lists whose cards differ by content. **Owner approved this as an exception.** Walk-in `surface-style-mix` at 360 is the shared sticky `FormActions` bar.
- Reference comparison: yes to all 8 except phone card heights (approved exception).
