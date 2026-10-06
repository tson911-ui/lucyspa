# Early START: report (E1-E4)

Design and Owner decisions: `docs/EARLY_START_DESIGN.md`. Built, not deployed.

## What changed

- **API:** `startBlock` no longer refuses a planned start still ahead (`service-execution.core.ts`). All other START conditions are unchanged and
  decide the early start (checked-in visit, free technician, no overlap for `[now, now + duration + buffer)`, collaborator shift, hours).
  `SERVICE_NOT_READY` is removed; an early START refused for another job or a collaborator's shift says so (`SERVICE_EARLY_START_CONFLICT`,
  `SERVICE_EARLY_START_OUTSIDE_SHIFT`). `startedEarlyMinutes` (rounded down) is returned on the execution, the open-visits table and the
  per-technician queue, and recorded with `plannedStartAt` in the `SERVICE_STARTED` audit and outbox payload (schemaVersion 1, additive).
- **Listeners checked:** only `apps/worker/src/booking-jobs.ts` consumes `SERVICE_STARTED` (reads `aggregateId`, never the payload); the leave relay
  ignores it; START_OVERDUE is null for a started line, PRE_END / END_OVERDUE follow `expected_end_at` (new worker test).
- **Migration** `20261105000000_early_service_start_occupancy`: `ktv_occupancies` also claims `[started_at, planned_start)`; the database rejects any
  overlap (`ktv_occupancies_no_overlap`). Additive: two functions and one trigger, no table or data change.
- **UI:** "Bắt đầu sớm X phút" badge on Dịch vụ của tôi, on the open-visits table and on the per-technician queue; the two new block reasons
  show under the disabled Start button. No new CSS, kit components only.

## Tests (scratch DB `lucy_spa_earlystart_scratch_20261007`, never the dev DB)

- Database: new test "early START: the database also claims ..." (both write orders, overlap with the previous booking rejected, intruder booking
  rejected, late/on-time keep the planned claim, claim ends with the line); the whole-table reconciliation query was updated to the new rule.
- API integration (`service-execution.integration`): valid early START with audit/outbox/claim, technician busy, overlap with the previous booking
  (then allowed once it finished), safe for the next booking, collaborator outside shift, late START unchanged, technician switch then early START.
  The old `SERVICE_NOT_READY` assertion was replaced. Race (`execution-reassignment.race`, run 5 times): two early STARTs of one technician;
  early START against a walk-in assigned into the early part.
- Web: label and block-reason texts VI/EN. Worker: warning targets for an early-started line.
- Results: `pnpm format:check`, `pnpm lint`, `pnpm typecheck` clean; `pnpm test` all packages 0 failures; `pnpm test:integration` 93 + 11 pass;
  `pnpm test:auth:integration` 601 of 608 pass on the first full run; the 6 failures were one clock-dependent assertion of my own collaborator test
  (fixed: it now uses the current minute, 15/15 pass) and 5 in media-library, combo usage and sold combos (timeouts / rate limit in the long run;
  each file passes alone: 11, 14, 7). Unrelated to this change; CI runs the suite on a clean database.

## UX gate (real app, scratch DB, fixture proxy for the rows)

Screens: Dịch vụ của tôi and the booking board at 360, 768, 1440 light and 1440 dark (theme pinned by the `ls-theme` cookie), every image opened.
Checked: badge pairs wrap cleanly at 360, no horizontal scroll, block reason under the disabled button, queue badge beside the customer, same
look in dark. DOM audit: Dịch vụ của tôi 0 findings; board 0 at 768/1440 and 1 at 360 (FR8 row height of the stacked rows, caused by wrapped
fixture text, not by the new badge). Note: the older fixture rig screenshots were dark by the clock; the theme cookie fix is in `.local` only.

## Open for the Owner

- Answered 2026-10-07: new block codes and messages kept, early minutes rounded down, "the schedule" = the per-technician list on "Lịch hẹn hôm nay" (all approved by the Owner).
