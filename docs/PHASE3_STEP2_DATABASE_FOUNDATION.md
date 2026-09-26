# Phase 3 — Step 2: Booking & Visit Database Foundation

Status: **OWNER APPROVED / COMPLETE.** Step 3 (Availability & Qualification Engine) is **NOT STARTED**.

This step implements only the database foundation required by the approved design contract
[`PHASE3_BOOKING_VISITS_DESIGN.md`](PHASE3_BOOKING_VISITS_DESIGN.md) (Q1–Q6, O1–O11 locked,
commit `bb38c31`). It adds no availability engine, API, UI, background job, notification, queue
table or billing. Everything here is additive: no existing table, column or data is changed,
except the replacement of the `permissions_catalog_semantics` CHECK so that it accepts the new
GLOBAL_ONLY code.

## 1. Migrations

| Migration                                        | Purpose                                                                                                                                                                                                                                                                                                                          |
| ------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `20261005000000_phase3_permission_codes`         | `ALTER TYPE "PermissionCode" ADD VALUE` for the seven O8 codes. It is kept in a separate file because PostgreSQL cannot use a new enum value in the transaction that adds it.                                                                                                                                                    |
| `20261005000001_phase3_booking_visit_foundation` | `btree_gist`, enums, tables, constraints, indexes, guard and occupancy triggers, the settings registry with defaults, and the catalog CHECK replacement.                                                                                                                                                                         |
| `20261005000002_phase3_occupancy_integrity`      | KTV occupancy integrity (§5.1): the occupancy table is trigger-written only; TRUNCATE guards on it and on both source line tables; row locks that serialize claim writes with booking and visit status changes; a visit closes only when no line is PLANNED or IN_PROGRESS; lines are added only to an OPEN or IN_SERVICE visit. |

Local workflow used: `pnpm db:deploy`, `pnpm db:generate`; `prisma migrate diff
--from-config-datasource --to-schema prisma/schema.prisma` prints `-- This is an empty migration.`
(no drift). No reset and no `db push` were run.

## 2. Enums

| Enum                       | Values                                            | Note                                                         |
| -------------------------- | ------------------------------------------------- | ------------------------------------------------------------ |
| `BookingStatus`            | `CONFIRMED`, `CHECKED_IN`, `CANCELLED`, `NO_SHOW` | A booking is auto-confirmed. There is **no PENDING** state.  |
| `BookingChannel`           | `ONLINE`, `DESK`                                  |                                                              |
| `BookingRecipientRelation` | `SELF`, `CHILD`, `FAMILY`, `OTHER`                | O11: recipients are never accounts.                          |
| `KtvAssignmentMode`        | `SPECIFIC`, `ANY`                                 | The customer chose a named KTV, or accepted any KTV.         |
| `AssignmentConflict`       | `LEAVE`                                           | Warning fact: an approved leave now conflicts with the line. |
| `AssignmentChangeReason`   | `LEAVE`, `CUSTOMER_CHOICE`, `MANAGER`             |                                                              |
| `VisitOrigin`              | `BOOKING`, `WALK_IN`                              |                                                              |
| `VisitStatus`              | `OPEN`, `IN_SERVICE`, `COMPLETED`, `CANCELLED`    |                                                              |
| `VisitParticipantKind`     | `MEMBER`, `GUEST`, `CHILD`                        |                                                              |
| `VisitServiceLineStatus`   | `PLANNED`, `IN_PROGRESS`, `DONE`, `CANCELLED`     |                                                              |
| `ServiceExecutionStatus`   | `IN_PROGRESS`, `ENDED`                            | Nothing ever ends an execution automatically (O1).           |
| `ServiceExecutionEndKind`  | `NORMAL`, `MANAGER_RESOLVED`                      | `MANAGER_RESOLVED` requires an actor and a reason.           |

## 3. Tables (Prisma models)

| Table / model                                                     | Holds                                                                                                                                                                                                                                                                                             |
| ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `bookings` / `Booking`                                            | Code, branch, owner (must be a CUSTOMER), status, channel, `starts_at`/`ends_at`, `service_date` (branch-local date of `starts_at`), `(created_by, idempotency_key)`, check-in, cancel (`cancelled_late`) and no-show facts, `row_version`.                                                       |
| `booking_recipients` / `BookingRecipient`                         | Who receives the service (O11): `SELF`, or a named child, family member or other person, with an optional phone. Never a user account.                                                                                                                                                            |
| `booking_service_lines` / `BookingServiceLine`                    | One service per line: sequence, recipient (composite FK within the same booking), service, KTV (one per line, Q3), assignment mode, planned start/end, duration and buffer snapshots, the O5 catalog snapshot (code, VI/EN names, min/max catalog price, pricing unit) and `assignment_conflict`. |
| `visits` / `Visit`                                                | Origin (`BOOKING` with a unique `booking_id`, or `WALK_IN`), branch, owner, status, `service_date`, `arrived_at`, `completed_at`, cancel facts, queue override (`queue_override_at` and `queue_override_by`), creator, idempotency key.                                                           |
| `visit_participants` / `VisitParticipant`                         | `MEMBER` (a customer account), `GUEST` (name and phone) or `CHILD` (with a guardian participant in the same visit). May carry a unique `booking_recipient_id`.                                                                                                                                    |
| `visit_service_lines` / `VisitServiceLine`                        | The executed plan. It can carry a unique `booking_service_line_id`, holds the same snapshot fields, and records `added_on_behalf` (with actor and time), cancel facts, `assignment_conflict` and `start_overdue_warned_at`.                                                                       |
| `service_executions` / `ServiceExecution`                         | START/END facts: one per visit line, the KTV, `started_at`, `expected_end_at`, `ended_at`, `end_kind`, the actor who ended it, `resolution_reason`, and the `pre_end_warned_at` and `end_overdue_warned_at` warnings.                                                                             |
| `service_line_assignment_changes` / `ServiceLineAssignmentChange` | Append-only reassignment history for exactly one booking line or visit line: from/to KTV, reason, actor, note.                                                                                                                                                                                    |
| `app_settings` / `AppSetting`                                     | The settings registry: `key` PK, `value jsonb`, `row_version`, `updated_by`.                                                                                                                                                                                                                      |
| `ktv_occupancies` / `KtvOccupancy`                                | Derived, trigger-maintained. Holds the employee, `period tstzrange` and exactly one source line. It exists only for the overlap backstop (§5), is not a queue table, and has no relations in Prisma.                                                                                              |

**The queue is derived. No queue table exists** (design contract).

The three O1 warning facts:

- `visit_service_lines.start_overdue_warned_at`;
- `service_executions.pre_end_warned_at`;
- `service_executions.end_overdue_warned_at`.

Each is write-once. Nothing in the database acts on them.

## 4. Constraints, indexes and guards

**Referential integrity.** Every foreign key is `ON DELETE RESTRICT`, which covers services, employees, users, branches, bookings and lines. A service referenced by any booking or visit line cannot be deleted; the integration test verifies this. No Phase 3 table allows DELETE (`lucy_reject_phase3_delete`). `bookings`, `visits`, `service_executions`, `service_line_assignment_changes`, `booking_service_lines`, `visit_service_lines` and `ktv_occupancies` also reject TRUNCATE (`lucy_reject_permanent_history_mutation`).

**Uniqueness and idempotency:**

- `bookings_code_key`, `visits_code_key`.
- `bookings_creator_idempotency_key` and `visits_creator_idempotency_key` on `(created_by_user_id, idempotency_key)`.
- `booking_recipients_one_self_key`: at most one SELF recipient per booking.
- `visit_participants_one_member_key`.
- `visits_booking_id_key`: one visit per booking.
- `visit_service_lines_booking_service_line_id_key` and `visit_participants_booking_recipient_id_key`: each is carried over at most once.
- `booking_service_lines_booking_sequence_key` and `visit_service_lines_participant_sequence_key`.
- `visit_service_lines_one_in_progress_key`: a participant receives one service at a time.
- `service_executions_visit_service_line_id_key`.
- `service_executions_one_open_per_employee_key`: a KTV has at most one open execution.

**CHECK constraints:**

- Status facts: `bookings_status_facts`, `visits_status_facts`, `service_executions_status_facts`.
- Formats: `bookings_code_format` and `visits_code_format` (`^[A-Z0-9][A-Z0-9-]{3,31}$`); `bookings_time_order`.
- Line shape: `booking_service_lines_shape` and `visit_service_lines_shape` (`planned_end = planned_start + duration`, sequence, buffer). `*_snapshot` requires non-blank names and min ≤ max price.
- Recipients and participants: `booking_recipients_shape`/`_phone`, `visit_participants_shape`/`_phone`/`_lengths`.
- Visit lines and visits: `visit_service_lines_on_behalf`, `visit_service_lines_cancellation`, `visits_origin`, `visits_queue_override`.
- Assignment changes: `assignment_changes_shape` (exactly one source, from ≠ to).
- Settings: `app_settings_known_values`.
- `ktv_occupancies_source`, `ktv_occupancies_period`.

**Guard triggers** (all functions hardened with a fixed `search_path` and `REVOKE ALL FROM PUBLIC`):

- `lucy_guard_booking`:
  - a booking is inserted CONFIRMED at version 1, with a CUSTOMER owner;
  - identity fields are immutable;
  - transitions are only CONFIRMED → CHECKED_IN, CANCELLED or NO_SHOW;
  - every change bumps `row_version`;
  - `service_date` equals `lucy_branch_local_date(branch, starts_at)`.
- `lucy_guard_booking_child`:
  - recipients are insert-only, and lines are added only to a CONFIRMED booking;
  - lines change only while the booking is CONFIRMED;
  - snapshot, sequence, service and recipient are immutable.
- `lucy_guard_visit`:
  - a visit is inserted OPEN at version 1, with a CUSTOMER owner when present;
  - a booking visit keeps the booking's branch and owner;
  - transitions are OPEN → IN_SERVICE | CANCELLED, and IN_SERVICE → COMPLETED;
  - `service_date` is the branch-local date of `arrived_at`.
- `lucy_guard_visit_participant`: insert-only; a MEMBER must be a customer; a carried recipient must belong to the visit's booking.
- `lucy_guard_visit_service_line`:
  - a line is inserted PLANNED at version 1, and a carried booking line must belong to the same booking;
  - transitions are PLANNED → IN_PROGRESS | CANCELLED, and IN_PROGRESS → DONE;
  - the KTV is fixed after PLANNED;
  - snapshot fields are immutable, and the warning fact is write-once.
- `lucy_guard_service_execution`:
  - an execution is inserted IN_PROGRESS at version 1, with the line's KTV;
  - ENDED is final;
  - warning facts are write-once, and identity fields are immutable.
- `lucy_reject_update` makes assignment changes append-only.
- `lucy_guard_app_setting`: the key is immutable, and every change bumps the version.

**Interpretation, not a new rule.** A visit stays `IN_SERVICE` between its lines. It moves OPEN → IN_SERVICE on the first START and IN_SERVICE → COMPLETED when the application closes it.

**Main indexes:**

- `bookings_branch_date_idx` and `visits_branch_date_idx`, for day views and queue derivation;
- `booking_service_lines_employee_idx`, `visit_service_lines_employee_idx` and `service_executions_employee_idx`;
- an index on every actor foreign key.

## 5. Overlap protection (O9): btree_gist decision and result

**Verification.** This was done read-only, from the repository and the local database; production was not touched.

- The local database is PostgreSQL 17.11, and `btree_gist` 1.7 is available.
- The repository's `compose.yaml` runs the same `postgres:17-alpine` image in production, 17.11.
- In the official image, the configured `POSTGRES_USER` is the database owner and a superuser.
- `btree_gist` has also been a trusted extension since PostgreSQL 13.

The migration therefore uses `CREATE EXTENSION IF NOT EXISTS btree_gist`.

**Operator pre-check before the production deploy (read-only):**

```sql
SELECT name, default_version, installed_version FROM pg_available_extensions WHERE name = 'btree_gist';
```

If this returns no row, stop and do not deploy.

**Choice.** A single EXCLUDE constraint cannot span two tables, and a KTV's time is claimed both by booking lines and by visit lines (walk-ins and add-ons). So `ktv_occupancies` is a derived table maintained by triggers:

- `lucy_sync_booking_line_occupancy`: a booking line occupies time while its booking is CONFIRMED and the line has not been carried into a visit line.
- `lucy_release_booking_occupancy`: status changes on bookings (cancel, no-show, check-in) release their lines.
- `lucy_sync_visit_line_occupancy`: a visit line takes over its booking line's interval and occupies time while PLANNED or IN_PROGRESS. DONE or CANCELLED releases it.
- The period is `tstzrange(planned_start, planned_end + buffer_minutes, '[)')`: inclusive start, exclusive end, and the buffer is part of the occupied time (locked O7). Example: a service planned 10:00–11:00 with a 10-minute buffer occupies the KTV over `[10:00, 11:10)`. Another service for that KTV **cannot start at 11:00** and **can start at 11:10**. Services touch without a gap only when the buffer is 0. The buffer is the line's own snapshot (`buffer_minutes`), so a later settings change does not move existing claims. The integration test asserts the 13:00 (= planned end) rejection, the 13:05 rejection and the 13:10 acceptance for a 12:00–13:00 line with a 10-minute buffer.
- The rule itself is `ktv_occupancies_no_overlap EXCLUDE USING gist (employee_user_id WITH =, period WITH &&)`. A violation raises SQLSTATE `23P01`.

### 5.1 Occupancy synchronization and source of truth

`ktv_occupancies` is **internal and derived**. The authoritative facts are the booking and visit service lines together with their booking and visit statuses. The table exists only because one EXCLUDE constraint cannot span both line tables. Application code must never read it as a business source (availability, schedules and the queue are derived from the lines) and cannot write it.

| Transition                                                        | Effect on the claim (same transaction, by trigger)                                                                                               |
| ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| Booking line INSERT (booking CONFIRMED)                           | Claim created                                                                                                                                    |
| Booking line UPDATE: reassignment (KTV), replan (times or buffer) | Claim upserted to the new KTV and period, and re-checked by the EXCLUDE constraint                                                               |
| Booking → CANCELLED, NO_SHOW or CHECKED_IN                        | All of the booking's line claims deleted. Line changes on a non-CONFIRMED booking are rejected, and the booking can never return to CONFIRMED.   |
| Visit line INSERT carrying a booking line (check-in)              | The booking-line claim is deleted and the visit-line claim created; later booking-line updates see the carry-over and do not re-create the claim |
| Visit line INSERT (walk-in or add-on)                             | Claim created. It is allowed only while the visit is OPEN or IN_SERVICE.                                                                         |
| Visit line UPDATE while PLANNED (reassignment or replan)          | Claim upserted                                                                                                                                   |
| Visit line → DONE or CANCELLED                                    | Claim deleted. Terminal lines are immutable.                                                                                                     |
| Visit → CANCELLED or COMPLETED                                    | Rejected while any line is PLANNED or IN_PROGRESS, so a closed visit never holds a claim                                                         |
| Any DELETE of a line, booking or visit                            | Rejected (history is never deleted), so a claim can never be orphaned                                                                            |
| Direct INSERT, UPDATE or DELETE on `ktv_occupancies`; TRUNCATE    | Rejected (`lucy_guard_ktv_occupancy_write` allows writes only from the occupancy triggers, `pg_trigger_depth() >= 2`)                            |

**Concurrency.** Claim maintenance runs inside the writing transaction, so it commits or rolls back with the source change.

- A booking line write locks its booking `FOR SHARE`. That serializes it with a concurrent cancel, no-show or check-in.
- A visit line insert locks its visit `FOR SHARE`, serializing it with a concurrent visit close.
- A carried booking line is locked `FOR UPDATE`, serializing it with a concurrent replan of that line.

The integration test checks all of the following:

- direct writes and TRUNCATE are rejected;
- reassignment moves the claim;
- a visit cannot close over a planned line, and a closed visit takes no new line;
- a **whole-table reconciliation** (claims = expected claims derived from the lines, compared as multisets in both directions) returns zero differences.

**Out of scope for "normal paths":** a superuser disabling triggers (`session_replication_role = replica`) or dropping constraints. Such a repair, if ever needed, is to recompute the table from the lines with the reconciliation query above.

This is a **backstop** and never the primary control. Step 3+ must still use application locking and re-check availability inside the transaction (design contract).

**Known limits, documented rather than enforced here:**

- The backstop covers **planned** windows. A service running past its planned end is limited by `service_executions_one_open_per_employee_key` plus application logic.
- The rule that a customer's own bookings must not overlap each other belongs to the availability engine (Step 3+).

## 6. Configuration foundation

`app_settings` is seeded with the design contract's section-18 keys. The same registry is in code as `BOOKING_SETTINGS` and `isValidBookingSetting` (`packages/database/src/booking-settings.ts`). The SQL CHECK `app_settings_known_values` rejects unknown keys and out-of-range values.

| Key                              | Default | Range                |
| -------------------------------- | ------- | -------------------- |
| `booking.maxAdvanceDays`         | 60      | 1–365                |
| `booking.slotIntervalMinutes`    | 15      | 5–60, must divide 60 |
| `booking.lateHoldMinutes`        | 20      | 0–120                |
| `booking.lateCancelAlertMinutes` | 15      | 0–1440               |
| `service.warningLeadMinutes`     | 5       | 1–60                 |
| `service.startOverdueMinutes`    | 5       | 1–60                 |
| `service.endOverdueMinutes`      | 5       | 1–60                 |
| `booking.checkInWindowMinutes`   | 60      | 0–1440               |
| `booking.serviceBufferMinutes`   | 0       | 0–60                 |

(Ranges are as implemented in `booking-settings.ts` and the matching SQL CHECK.) No setting UI or API exists yet.

## 7. Permissions (O8)

These codes were added to the `PermissionCode` enum and the code-owned `PERMISSION_CATALOG`. Rows are created by the existing `pnpm db:permissions:sync`.

- **BRANCH_CAPABLE:** `VIEW_BOOKINGS`, `MANAGE_BOOKINGS`, `MANAGE_QUEUE`, `REASSIGN_SERVICES`, `PERFORM_SERVICES`, `RESOLVE_SERVICE_EXECUTION`.
- **GLOBAL_ONLY:** `MANAGE_BOOKING_SETTINGS`.

`permissions_catalog_semantics` was replaced to list both GLOBAL_ONLY codes (`MANAGE_SERVICE_PRICES`, `MANAGE_BOOKING_SETTINGS`). Consumers were updated so everything still type-checks and the pinned catalog tests still pass:

- `PermissionCodeName` in `packages/contracts`;
- the role-admin groups and the VI/EN labels in `apps/web`;
- the pinned authorization tests in `apps/api`.

No role is granted the new permissions by this step; the Owner assigns them through role administration. **Before Step 3 goes live**, production must run `pnpm db:permissions:sync` after `pnpm db:deploy`, as in earlier steps.

## 8. Validation (local, targeted)

| Check                                                                       | Result                                           |
| --------------------------------------------------------------------------- | ------------------------------------------------ |
| `prisma validate` / `format`; `db:deploy`; `db:generate`                    | OK                                               |
| `prisma migrate diff` (DB ↔ schema)                                         | empty migration (no drift)                       |
| `packages/database` `tsc` + build                                           | OK                                               |
| `packages/database` `pnpm test:integration` (includes the new Phase 3 test) | 40 / 40 pass (before the §5.1 fix)               |
| New `phase3-foundation.integration.test.ts`                                 | 10 / 10 pass after §5.1 (all fixtures roll back) |
| `apps/api` and `apps/web` `tsc --noEmit`                                    | OK                                               |
| `apps/api` `authorization.test` (unit)                                      | 8 / 8 pass                                       |
| `apps/api` `authorization` and `role-admin` integration tests               | 12 / 12 pass                                     |
| `pnpm lint` (ESLint and import boundaries) and `pnpm format:check`          | pass                                             |

The new Phase 3 integration test covers:

- **Settings:** keys, defaults and SQL range enforcement.
- **Permissions:** the enum and catalog rows after sync, with scope and classification.
- **Booking creation:**
  - bookings are CONFIRMED-only;
  - the owner must be a customer;
  - idempotency is enforced;
  - `service_date` is branch-local.
- **Service lines:**
  - multiple sequential lines on one KTV are accepted;
  - recipients never create accounts;
  - line shape and snapshot are immutable.
- **Overlap backstop:**
  - the same KTV cannot be double-booked across bookings;
  - adjacent services are allowed;
  - the buffer is counted;
  - cancelling releases the time.
- **Check-in:**
  - check-in moves the occupancy to the visit line;
  - there is one visit per booking.
- **Service execution:**
  - one open execution per KTV;
  - a MANAGER_RESOLVED end requires an actor and a reason;
  - warning facts are write-once;
  - terminal states are final.
- **Walk-ins:**
  - guest and child participants;
  - one in-progress service per participant;
  - walk-in lines are covered by the overlap backstop.
- **History:** no DELETE, append-only reassignment history, and RESTRICT on the service.

Full workspace suites and builds were not run, per the step's scope. `pnpm typecheck` was deliberately not used because it regenerates `apps/web/next-env.d.ts`.

## 9. Deferred to Step 3 and later (not implemented)

- The availability and slot engine, including the customer self-overlap rule;
- Step 3+ application locking and in-transaction re-checks;
- all booking, visit, queue, execution and settings APIs and UI;
- the jobs that compute and write warning facts, late holds and no-shows;
- notifications and outbox events;
- leave-conflict detection that sets `assignment_conflict`;
- the reassignment workflow;
- billing and invoicing;
- role grants for the new permissions.

## 10. Context for Step 3

- Write to these tables only inside transactions that:
  - take application locks, for example on the KTV and date;
  - re-check availability;
  - treat SQLSTATE `23P01` from `ktv_occupancies_no_overlap` as "slot just taken".
- Never write `ktv_occupancies` directly, and never use it as a business source; the triggers own it (§5.1). Close a visit only after cancelling or finishing each of its lines.
- Every update must bump `row_version`; the guards reject updates that do not.
- Read settings through `BOOKING_SETTINGS` and `isValidBookingSetting`, and write them with a version bump.
- Warning facts are write-once. Execution END is never automatic (O1).
