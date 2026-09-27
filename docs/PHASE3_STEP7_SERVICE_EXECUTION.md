# Phase 3 — Step 7: Service Execution START / END

Status: **OWNER APPROVED / COMPLETE**. Phase 3 Step 8 = **NOT STARTED**.
Steps 1–6 remain **OWNER APPROVED / COMPLETE**.

## Objective and lifecycle

Normal execution of an already assigned VisitServiceLine:
`PLANNED → START → IN_PROGRESS → END → DONE`.
WAITING is never silently assigned or started. CANCELLED and DONE cannot START.
END before START is refused. Nothing auto-ENDs or clears an unfinished execution.

The operations domain now contains `ServiceExecutionService`, its controller and core.
It uses the Step 2 `ServiceExecution`, Visit and VisitServiceLine models, existing database
guards, partial unique indexes, occupancy triggers, audit and outbox. No duplicate model,
schema change or migration is needed. Booking remains a pre-service appointment record;
START/END do not change Booking status or introduce payment state.

## START and actual timestamps

- Normal action requires the authenticated employee to be the line's assigned KTV and
  hold `PERFORM_SERVICES` at the persisted Visit branch. No role names or booking/reassignment
  permissions authorize execution. Owner/global authority never impersonates another KTV.
- Active account/session, effective non-ended employment and an unrevoked branch assignment
  are required. Skills are qualifications, never permission grants.
- START requires a PLANNED assigned line in an OPEN/IN_SERVICE Visit on the branch-local
  current business date, not earlier than its planned start. Future work cannot start.
- Every earlier non-cancelled line for the participant must be DONE; another IN_PROGRESS
  line for that participant also blocks START. Different participants may execute independently
  with different KTVs. Existing consecutive assignments are retained.
- The assigned KTV must have no open execution, regardless of its expected end or business date.
- The Step 3 engine's OPERATIONAL facts and employee eligibility rules are reused: branch hours,
  current service availability, active employment, branch assignment, qualification, leave,
  collaborator coverage, today's open attendance, planned reservations, running executions
  and actual END buffers. Only the target line and its carried booking line are excluded
  from their own occupancy comparison.
- `evaluateExecutionStart` checks the exact actual interval using the line's duration and
  buffer snapshots, without rounding to the booking minute grid or using edited catalog
  durations. A late START that conflicts with another reservation is refused; this step does
  not move that reservation or rewrite planned history.
- After acquiring mutation locks, sample PostgreSQL `clock_timestamp()` at millisecond
  precision. Create one IN_PROGRESS execution with `startedAt` equal to that authoritative
  instant and `expectedEndAt = startedAt + durationMinutes`. Client timestamps are rejected.
- Change only the line status/version and, on the first START, Visit `OPEN → IN_SERVICE`.
  Planned start/end, assignment, duration and buffer snapshots remain unchanged.

## END and Visit completion

END requires the same assigned-employee, permission, employment and branch scope checks.
It requires an IN_PROGRESS line and execution. The database clock, sampled after locks,
becomes `endedAt`; the execution becomes ENDED with `endKind = NORMAL`, `endedByUserId`
and incremented version. The line becomes DONE.

END does not require current attendance or START availability: an employee can finish an
already running service after checkout, closing or midnight. It cannot record an END earlier
than START. Loss of account, employment or branch authorization is not bypassed; authorized
exceptional resolution remains deferred.

With the Visit locked, completion counts all lines, including WAITING. Only when every
non-cancelled line is DONE does Visit become COMPLETED with authoritative `completedAt`.
Otherwise it stays IN_SERVICE between services. Visits never become PAID in Step 7.

## Unfinished-service blocking and occupancy

PostgreSQL remains authoritative. The existing unique partial index permits at most one
IN_PROGRESS execution per employee; the participant partial index permits one IN_PROGRESS
line per participant. START explicitly checks both conditions and ordered predecessors.

The existing availability engine reads open executions as unbounded occupancy, so new
assignment/booking checks continue to block that KTV even after expected end. END changes
the execution fact atomically with DONE. The existing line trigger removes its planned
occupancy claim; the engine retains actual `[startedAt, endedAt + buffer)` occupancy.
Application code never writes `KtvOccupancy`. WAITING keeps no occupancy. Redis is not used
to determine execution state.

## Transactions, locking and idempotency

All mutations run inside the existing workforce command transaction and shared authorization
graph lock. It locks the authenticated actor's user row (also the only permissible executing
KTV), then the session. The execution command locks Visit, line, and existing execution in
that order and reloads the facts before deciding.

Visit uses `FOR UPDATE NOWAIT`. Step 6's existing initial-assignment path can hold a Visit
while obtaining candidate-user locks; NOWAIT prevents Step 7 from waiting in the opposite
direction while holding its KTV user lock. Contention aborts the whole command with safe
`SERVICE_EXECUTION_CONFLICT`; refresh/retry is safe. No partial execution, audit or event
survives a failed transaction. No existing Step 6 lock order was redesigned.

- START vs START on one line serializes on the assigned user; replay returns the original
  running execution and timestamps. START after DONE is refused.
- END vs END serializes likewise; replay returns the original ENDED facts.
- START of two lines for one KTV serializes on that same user row; the second sees the open
  execution. The database unique index is the final backstop.
- Different KTVs on one Visit serialize briefly on the Visit, protecting sequence checks,
  cancellation and final completion. A contender can receive a retryable conflict.
- Existing cancellation/assignment also lock Visit; state is reread after locking, so a
  cancelled line cannot start and cancellation cannot overwrite a committed START.
- Reads use committed database state and provide advisory action flags. Every mutation
  reauthorizes and reevaluates; a stale GET never grants permission. The own-KTV user lock
  also serializes normal reads with that KTV's START/END commands.

No separate request key is needed: one execution per line plus terminal transition guards
identify replay. Audit/outbox entries are written only for new transitions.

## Audit and domain events

Append-only `SERVICE_STARTED` and `SERVICE_ENDED` audit entries record the actor, branch,
execution identity, Visit/line IDs, state change and authoritative action time. No names,
phone numbers, prices or other unnecessary personal data are copied into metadata.

The same transaction appends one version-1 outbox event of the corresponding name, with
`aggregateType = ServiceExecution`. Payloads contain execution/line/Visit/KTV identities
and relevant execution timestamps; SERVICE_STARTED includes expected end and SERVICE_ENDED
includes resulting Visit status and normal end kind. Naming follows the approved design's
`SERVICE_ENDED` convention. No relay, delivery or warning jobs are added.

## API and contracts

All routes are under `/api/v1/operations`:

| Method | Path                             | Result                                                             |
| ------ | -------------------------------- | ------------------------------------------------------------------ |
| GET    | `branches/:branchId/my-services` | Today's own assigned lines plus older open executions              |
| GET    | `service-lines/:id/execution`    | Own line, execution facts, Visit status and action flags           |
| POST   | `service-lines/:id/start`        | Start or replay the running execution; authoritative line response |
| POST   | `service-lines/:id/end`          | End or replay END; authoritative line response                     |

Both POSTs accept exactly `{}`. Arrays, timestamps, employee IDs, status, branch IDs,
resolution reasons and unknown fields are rejected. Existing session cookies, JSON/Origin
and session-bound CSRF protection apply. UUID paths are validated. Unknown or another KTV's
line is NOT_FOUND; failed permission/employment/branch scope is FORBIDDEN.

Contracts: `ServiceExecutionWork`, `MyServiceWorkResponse`, `ServiceExecutionActionRequest`
and `ServiceStartBlock`. Stable errors distinguish invalid lifecycle, unfinished predecessor,
busy KTV, future work, operational unavailability and retryable contention. Driver details
are not returned.

## Workforce UI

`/{locale}/workforce/my-services` uses the existing workforce shell/components and a
PERFORM_SERVICES navigation entry for employee accounts. It does not require VIEW_BOOKINGS
or MANAGE_BOOKINGS. Branch selection, passive refresh, manual refresh, START/END buttons,
loading/disabled states, localized errors, IN_PROGRESS/DONE state, planned times, actual
start/end and expected end are provided in VI/EN. Timestamps display in the branch timezone.

The screen displays only the signed-in employee's work. Older unfinished executions remain
visible. It renders mutation responses immediately, then reloads eligibility for other lines.
Stale reads are discarded by request generation; requests in flight cannot overwrite a
mutation response. Controls require both the server action flag and a compatible state.
The existing stacked workforce sections keep the UI usable on mobile and desktop.

## Tests added — NOT EXECUTED

- `service-execution.availability.test.ts`: exact milliseconds, snapshot duration/buffer,
  unfinished occupancy, actual END buffer, branch-local date, employment/branch/skill/attendance,
  hours and collaborator coverage.
- `service-execution.integration.test.ts`: real database/session lifecycle, idempotent replay,
  audit/outbox uniqueness, actual timestamps, unchanged planned times, completion, split KTV
  sequencing, independent participants, unfinished KTV block, scope, END-before-START,
  attendance/checkout, future and cancelled work, WAITING and incomplete Visit handling.
  Registered in the existing opt-in integration entry point; fixtures are designed to roll back.
- `service-execution.http.test.ts`: CSRF/Origin, strict empty bodies, timestamp/identity rejection,
  authoritative responses and safe domain error envelopes.
- Web `service-execution.test.tsx`: permission navigation/branch filtering, invalid/stale action
  states, VI/EN error mapping and initial screen rendering.

**Validation is explicitly deferred to the final Phase 3 gate.** No tests, regression suites,
race suites, lint, format checks, builds, typechecks, database migrations or production
validation were executed for Step 7. No claim is made that these new tests pass. The final
gate must also exercise real concurrent START/START, END/END, different KTVs in one Visit,
assignment/cancellation contention, crossed business dates, and browser mutation/refresh races.

## Limitations and boundaries

- Normal own-assigned START/END only. The existing `RESOLVE_SERVICE_EXECUTION` permission and
  MANAGER_RESOLVED model foundation are preserved, but intervention/exceptional resolution is
  not exposed by these endpoints. No manager impersonation or fabricated END.
- No reassignment, leave-conflict resolution or planner redesign (Step 8).
- No warning workers, jobs, relay or notification delivery (Step 9). Planned start and
  authoritative started/expected-end/ended facts remain available for planned-start + 5,
  expected-end − 5 and expected-end + 5 rules. Warning fields are untouched; never auto-END.
- No extra services, account changes, loyalty, combo balances, invoices, payments, POS,
  payroll, commissions or premium redesign.
- No unresolved Owner decision is required for this normal execution scope. Step 7 is OWNER APPROVED / COMPLETE. Step 8 and Step 9 functionality are not implemented.
- Protected `apps/web/next-env.d.ts` remains untouched and unstaged; expected blob hash
  `a419cbe4e3a5e8d4b481b851dbf4ac767de069e6`.
