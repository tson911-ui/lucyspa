# Early START of a service (design, E1)

Request (Owner, 2026-10-07): let a technician START a service early when the customer has already arrived and the technician is free.
Replaces the single rule of `docs/PHASE3_STEP7_SERVICE_EXECUTION.md` ("not earlier than its planned start. Future work cannot start.").

## Final rule

START is allowed before the planned start when every other START condition holds (nothing else was relaxed):

- the customer is checked in: the Visit exists and is `OPEN` / `IN_SERVICE` (a booking becomes a Visit only at check-in);
- same branch-local business date; the line is `PLANNED`, assigned, and every earlier line of the participant is `DONE`;
- the signed-in employee is the assigned technician with `PERFORM_SERVICES`; today's attendance is open; no leave;
- the technician has no execution in progress (`SERVICE_KTV_BUSY`);
- the actual interval `[now, now + duration + buffer)` overlaps no other reservation, running or ended work of the technician.
  The next booking is safe by construction: it starts at or after `planned end + buffer`, and an early start also ends early.
  The line's own planned window is the only thing excluded from the comparison;
- a collaborator's scheduled shift covers `[now, now + duration)` (an early start outside the shift stays refused);
- branch hours and service availability, as today.

Late START and on-time START are unchanged. There is no room or bed in the system, so there is nothing to check for them.

## Times and records

- The booked window (`planned_start_at`, `planned_end_at`) is never rewritten. The actual times are `service_executions.started_at` / `ended_at`
  (server clock after the locks). `expected_end_at = started_at + duration`. Price, points, loyalty, invoice: untouched.
- `SERVICE_STARTED` audit `after` and outbox payload gain `plannedStartAt` and `startedEarlyMinutes` (whole minutes, rounded down, 0 when on
  time or late). `schemaVersion` stays 1 (additive). The only listener (`apps/worker/src/booking-jobs.ts`) reads `aggregateId` and the database,
  never the payload; `leave-jobs` ignores the event. START_OVERDUE never fires for a started line (`warningTarget`); PRE_END / END_OVERDUE use
  `expected_end_at`, which already follows the actual start.
- Commission, tour, payroll do not exist yet (Phase 6+/7). They will read the real `started_at` / `ended_at`; nothing to change today.
  Attendance (check-in/out) and the CTV schedule pay are independent of service times.

## Database (migration `20261105000000_early_service_start_occupancy`)

`ktv_occupancies` already rejects any overlap per technician (`EXCLUDE ... gist`). A line that starts early now also claims
`[started_at, planned_start)`: `lucy_sync_visit_line_occupancy` uses `LEAST(planned_start, execution.started_at)`, and a new
`AFTER INSERT` trigger on `service_executions` widens the claim whichever of the line update / execution insert comes first.
A start on or after the planned start keeps today's claim exactly. The claim ends with the line (DONE / CANCELLED), so the unused
later part of the booked slot reopens at END, as it does today.

## Owner decisions (own words, 2026-10-07)

1. Max early start: no separate cap; limited by the existing check-in window (`booking.checkInWindowMinutes`, currently 60).
2. Who may start early: unchanged, only the assigned technician (`PERFORM_SERVICES`). No extra confirmation dialog.
3. Freed later slot: unchanged, it reopens after the service ENDS.
4. Queue order unchanged: booked customers stay ahead of walk-ins.
5. CTV: keep blocking an early start outside the scheduled shift.
6. Notifications: none. Audit log plus a "bắt đầu sớm X phút" label on the boards only.
7. Multiple services in one visit: the rule applies to every line; later lines still wait for the previous line to finish.
8. Database anti-overlap: (b) additive migration so `ktv_occupancies` also holds the early part; the database rejects overlaps.

## Technical details chosen while building (items 1-3 APPROVED by the Owner, 2026-10-07)

- **APPROVED 2026-10-07** (Owner: keep both codes and their messages as written). Two block reasons replace the old "not ready": `SERVICE_EARLY_START_CONFLICT` (other work of the technician is in the way) and
  `SERVICE_EARLY_START_OUTSIDE_SHIFT` (collaborator shift). Used only for an early START and only when that is the whole reason; every
  other reason keeps `SERVICE_START_UNAVAILABLE`. `SERVICE_NOT_READY` is removed (contract, error table, VI/EN texts).
- **APPROVED 2026-10-07** (Owner: confirmed; rounding down of the early minutes also approved, see Times and records). "The schedule" in decision 6 is read as the per-technician queue on the booking board ("Đang phục vụ" rows) plus the open-visits table;
  "Dịch vụ của tôi" shows the label too.
- Implementation of decision 8 (not a separate question). The race rule is the existing lock order (visit, line, execution, technician user row) plus the database constraint; a lost race maps
  to `SERVICE_EXECUTION_CONFLICT` (SQLSTATE 23P01 is already mapped).
