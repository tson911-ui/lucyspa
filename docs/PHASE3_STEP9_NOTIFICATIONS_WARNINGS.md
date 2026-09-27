# Phase 3 Step 9 — Booking / Visit Notifications & Five-Minute Warnings

Status: **OWNER APPROVED / COMPLETE**. Phase 3 Step 10 = **NOT STARTED**.
Steps 1–8 remain **OWNER APPROVED / COMPLETE**.

## Objective and boundaries

Deliver the approved Phase 3 booking/visit messages and execution warnings through an
in-app inbox. PostgreSQL owns business state, warning emission and notification persistence;
the existing BullMQ worker supplies technical delayed jobs. No service action, assignment,
attendance, occupancy, payment or customer intent is changed by notification work.

No tests, regression, typecheck, lint, formatting, build, migration application, Prisma
generation or production validation were run in Step 9. Everything is explicitly deferred
to the Step 10 Phase 3 gate. This is implementation completion, not validation approval.

## Persistence and migration

`20261009000001_phase3_notifications` adds two narrow tables:

- `notifications`: recipient user, branch, source outbox event, allowlisted notification
  type, Booking/Visit reference and code, authoritative event time, database creation time
  and nullable read time. Unique `(source_event_id, recipient_user_id)` prevents duplicate
  visible delivery. Recipient/time/ID and unread indexes support bounded inbox reads.
- `service_warning_schedules`: line reference, warning kind, authoritative target time and
  snapshotted due time. Unique `(line_id, kind, target_at)` gives each semantic timer a
  stable PostgreSQL identity. Metadata is immutable. It contains no independent service
  state or employee assignment; those are always read from the source line/execution.

A partial recovery index covers un-warned PLANNED and IN_PROGRESS lines. Existing warning
facts on `VisitServiceLine` / `ServiceExecution` are reused; no duplicate execution model,
assignment history, schedule of customer occupancy or notification delivery provider exists.
The migration preserves existing data. It has been authored but **not applied**. Prisma
client generation against the changed schema is a prerequisite for the Step 10 gate.

## Warning applicability and timing

| Warning | Authoritative condition | Due time (default) | Recipients |
| --- | --- | --- | --- |
| START_OVERDUE | Arrived Visit OPEN/IN_SERVICE; assigned PLANNED line; no execution; warning fact null | planned start + 5 minutes | Current assigned KTV and authorized branch management |
| PRE_END | Line and execution IN_PROGRESS; no END; warning fact null | expected end − 5 minutes | Current assigned KTV and authorized branch management |
| END_OVERDUE | Line and execution IN_PROGRESS; no END; warning fact null | expected end + 5 minutes | Current assigned KTV and authorized branch management |

A reservation whose customer has not arrived receives no START-overdue warning, following
the approved design section 12. WAITING lines never acquire timers. Old unfinished
executions remain eligible across business dates; recovery does not clear them at midnight.

Step 7 persists `expectedEndAt = startedAt + durationMinutes`, using authoritative START and
the service-line duration snapshot. The worker uses that persisted execution fact, never
planned end, current catalog duration or a client timestamp. Planned times are unchanged.

The existing `service.startOverdueMinutes`, `service.warningLeadMinutes` and
`service.endOverdueMinutes` registry settings supply the approved defaults of five minutes.
The first schedule creation snapshots the due time. A later settings change affects only
new timer occurrences; Redis loss cannot change an already persisted due time. No settings
administration UI is introduced here.

## Worker, outbox and scheduling

`startBookingJobs` is registered in the existing worker process with its existing Redis
connection conventions and queue prefix. Queue: `booking-events`. Job: `service-warning`.
The job body contains only a PostgreSQL schedule ID. BullMQ IDs use `warning-<uuid>` because
custom BullMQ IDs cannot contain the colons shown in the conceptual design.

The relay handles only known schema-version-1 events for Booking, Visit and ServiceExecution:
`BOOKING_CREATED`, `BOOKING_CANCELLED`, `BOOKING_NO_SHOW`, `CUSTOMER_ARRIVED`,
`BOOKING_KTV_CONFLICT`, `KTV_REASSIGNED`, `WALK_IN_CREATED`, `VISIT_LINE_SCHEDULED`,
`SERVICE_STARTED`, and `SERVICE_ENDED`. Existing arrival/walk-in/reassignment events are
sufficient to ensure timers; completed source transactions are not redesigned to emit
redundant scheduling events. END produces no additional inbox message.

Every relay pass reads at most 50 pending events and processes one row per transaction using
`FOR UPDATE SKIP LOCKED`. A UUID cursor progresses past failed rows and wraps to retry them,
so a poisoned older event does not permanently starve newer events. A row is marked published
only after inbox handling and job enqueue succeed. Rollback leaves the event retryable;
already enqueued orphan jobs safely find no PostgreSQL timer. Auth-email events and unrelated
aggregates are untouched. Relay interval is two seconds between completed passes.

BullMQ uses ten attempts with exponential backoff. Completed technical jobs are removed;
failed technical jobs have bounded retention. PostgreSQL uniqueness and warning facts—not
Redis job retention—provide business idempotency. Logs contain error class names only.

## Atomic warning delivery and stale jobs

The warning handler takes the existing shared authorization-graph lock, then Visit, line
and execution row locks in that order. NOWAIT avoids waiting in the reverse order of source
commands. It rereads authoritative state and requires the job target timestamp to match.
PostgreSQL time is sampled after locking. An early job retries; stale work returns without
writing anything.

The handler resolves the **current** assigned KTV, writes the existing per-kind warning fact
with the required row-version increment, appends `SERVICE_WARNING_DUE`, inserts recipient
inbox rows, and marks that event consumed in one transaction. This is the in-app consumer
inside the worker transaction: there is no separate delivery gap in which reassignment can
commit and cause an old KTV to receive a newly delivered warning. If anything fails, the
warning fact, event and inbox all roll back.

Source `START`, `END`, cancellation and reassignment already serialize on Visit/line rows.
If the source action commits first, the warning observes the new state or current assignee.
If the warning commits first, it records a valid historical warning; later execution changes
do not retract history. No cancellation of Redis jobs is needed for correctness.

Warning fact fields remain monotonic: at most one warning of each kind per line/execution,
as established by Step 2. Reassignment after a warning was already emitted does not emit
another START warning for the same line. The reassignment event supplies its own message.

## Recovery and reconciliation

At startup and then every minute between completed passes, recovery reads at most 100
active lines with keyset pagination. It includes older unfinished executions and scans
through successive pages without truncating to only today's date. It ensures missing
PostgreSQL timer records and reconstructs BullMQ jobs for future due times.

Already-due warnings run through the same authoritative handler directly, as approved in
design section 12, so they can still reach the inbox when Redis is unavailable. Recovery and
normal scheduling may race; the unique occurrence key and monotonic warning facts make both
paths retry-safe. A failed line is retried on a later sweep. There is no second scheduler or
permanent copy of the appointment/occupancy schedule.

The bounded sweep can take multiple passes on a large active backlog. Worker downtime or
backlog may delay notifications; recovery preserves correctness, not an exact wall-clock
delivery guarantee. Future delayed jobs remain the primary timing mechanism.

## Recipients, events and customer behavior

The existing `decide` evaluator, authority-graph types and `loadAuthorityGraph` are shared
through `@lucy-spa/server`; API import paths re-export them. Their decision logic is reused
unchanged rather than constructing a second permission engine.

Management means effective `MANAGE_QUEUE` **or** `MANAGE_BOOKINGS` at the event branch,
including active-role grants, overrides and DENY precedence. Branch grants require active
membership; existing GLOBAL/Owner authority remains broader. Display role names and
manager-group labels confer nothing. Recipients must have active accounts and, for
employees, non-ended effective employment on the branch-local current date. Assigned KTV
recipients additionally need active branch membership and `PERFORM_SERVICES` there.
Recipient user rows use sorted shared NOWAIT locks while reading account/employment facts;
contention retries the worker transaction.

| Source event | In-app behavior |
| --- | --- |
| BOOKING_CREATED | Booking owner and assigned KTVs receive confirmation/new-work information |
| BOOKING_CANCELLED | Owner and assigned KTVs receive cancellation information |
| BOOKING_CANCELLED with customer actor and `late=true` | Management additionally receives distinct LATE_CANCELLATION; cancellation remains unconditional |
| BOOKING_NO_SHOW | Owner and assigned KTVs receive no-show information |
| CUSTOMER_ARRIVED | Assigned KTVs receive arrival information; Visit timers are ensured |
| BOOKING_KTV_CONFLICT | Branch management and affected customer account receive conflict information |
| KTV_REASSIGNED | Management, previous/replacement KTVs and affected customer account receive a historical reassignment update |

The approved Step 4 `<15m` cancellation fact is consumed as recorded; the worker does not
recalculate it using later delivery time. Step 8 conflict and reassignment facts remain
historical and auditable even if operations have resolved the conflict before delivery.
For Visit conflicts/reassignment, the affected member participant or account-bearing guardian
is included where present, along with a Visit owner account. Guests/children acquire no new
accounts. No unnecessary personal data or reassignment reason is copied to the inbox.

The leave-approval hook already emits per-line `BOOKING_KTV_CONFLICT`; the general
`EMPLOYEE_LEAVE_APPROVED` event is not turned into a duplicate conflict alert or a new leave
notification subsystem. ANY/SPECIFIC intent and all Step 8 behavior remain unchanged.

## Authenticated API

| Method | Endpoint | Behavior |
| --- | --- | --- |
| GET | `/api/v1/notifications` | Own inbox, 30 rows, newest-first timestamp/UUID cursor, unread count |
| GET | `/api/v1/notifications/unread-count` | Own unread count |
| POST | `/api/v1/notifications/:id/read` | Empty JSON body, idempotently mark own row read with database time |

Both customer and workforce authenticated sessions can read their own inbox. Session identity
supplies the recipient; there is no caller-provided recipient or management override.
Foreign and missing notification IDs return the same safe NOT_FOUND. Unknown query/body
fields are rejected. Existing Origin/CSRF handling applies to read mutations. Responses
exclude internal event payloads, recipient IDs, audit notes and outbox IDs. Passive polling
does not refresh session idle activity. Display and read actions produce no security-audit
noise; source operational actions retain their existing audits.

## UI

Existing workforce and customer shells show a notification link with an unread badge
(display capped at 99+) refreshed passively every 30 seconds. A read action refreshes the
indicator. Inbox routes: `/{locale}/workforce/notifications` and
`/{locale}/account/notifications`. Both use one shared responsive list/card implementation,
VI/EN dictionaries, loading/error/empty states, bounded pagination, explicit refresh and
server-authoritative read results. A request generation guard prevents an older list response
from undoing a read mutation. Failures use localized messages, never raw domain/event codes.

Allowlisted links use existing booking detail, My Services, booking-board and reassignment
screens when current permission hints make them useful. Target APIs remain authoritative.
No duplicate KTV dashboard, native push infrastructure or premium redesign is added.
Inbox list refresh is explicit; the shell unread indicator polls automatically.

## Concurrency and test source

Added but **NOT EXECUTED**:

- Worker rule tests: three due times, START/END/cancel/WAITING stale behavior, independent
  warning facts, execution-derived expected end, no state mutation by condition evaluation.
- Worker PostgreSQL integration/race source: duplicate warning jobs, source Visit locks vs
  START/END/cancel/reassignment, current KTV selection, per-kind atomic emission, no auto-END,
  Redis-loss recovery, concurrent timer creation, permission-based managers/DENYs/inactive
  accounts, late-cancel outbox duplication, read racing duplicate inbox insertion.
- API service tests: recipient filtering, safe projection, bounded keyset pagination,
  read timestamp/ownership, missing/expired authentication.
- HTTP tests: strict inputs, session scope, Origin/CSRF and read endpoint.
- Web tests: VI/EN warning cards, read/unread/loading state, navigation scope and merging
  authoritative read state without duplicate rows.

The worker database test is opt-in via `PHASE3_TEST_DATABASE_URL`, a disposable migrated and
seeded local PostgreSQL database with cleanup privileges. It does not load the application's
`.env`. Its committed race fixtures are removed by exact fixture IDs; it follows the existing
local integration convention for removing append-only test history. No test source has been
executed. Full Phase 3 validation, including generated Prisma types, migration behavior,
BullMQ integration and complete regressions, remains explicitly deferred to **Step 10**.

## Limitations and deferrals

- No email, SMS, Zalo, Facebook, native push or external delivery integration.
- No auto-START, auto-END, automatic reassignment, cancellation, Visit completion or payment.
- No exceptional execution resolution, POS, finance, payroll, rewards or Phase 4 changes.
- No unread-to-unread reset API, bulk read API, retention/deletion policy or preference UI.
- Historical inbox rows remain visible to their recipient after a scope change; they contain
  only minimal event context, and navigation never bypasses current target authorization.
- Worker and database must be running for timely delivery. Backlogs recover in bounded pages.
- Deployment/migration, generated client and real Redis lifecycle behavior await Step 10.
- No unresolved Owner decision is needed for this scope. Step 9 is **OWNER APPROVED / COMPLETE**. Step 10 = **NOT STARTED**.
- Protected `apps/web/next-env.d.ts` was not modified, restored, regenerated or staged.
