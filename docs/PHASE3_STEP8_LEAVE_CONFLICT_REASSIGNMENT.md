# Phase 3 — Step 8: Leave Conflict & KTV Reassignment

Status: **OWNER APPROVED / COMPLETE**. Phase 3 Step 9 = **NOT STARTED**.
Steps 1–7 remain **OWNER APPROVED / COMPLETE**.

## Objective and foundations

Identify assigned, unstarted service work affected by approved leave and let a workforce
user with `REASSIGN_SERVICES` explicitly choose and confirm a valid replacement. Reuse the
existing leave lifecycle, availability engine, Q3 planner, booking/Visit lines, conflict
marker, ServiceLineAssignmentChange history, audit and transactional outbox.

No schema migration, duplicate execution model, copied schedule or second occupancy
system is introduced. Initial assignment remains Step 4/6; normal execution remains Step 7.

## Approved leave and conflict discovery

Approved leave already makes an employee unavailable through the Step 3 engine's inclusive
whole-calendar-day leave lookup. The relevant date is the booking/Visit's branch-local
business date, not a UTC date inferred by the browser. Pending, rejected and cancelled leave
do not block availability.

The existing approval transaction now invokes `recordApprovedLeaveConflicts` after changing
the leave status and before returning. It identifies future/current-day CONFIRMED booking
lines and PLANNED Visit lines assigned to the leave employee. It uses the existing
`assignmentConflict = LEAVE` marker and increments each affected line version. It does not
change the KTV, planned time, customer intent, execution state or parent lifecycle.

Conflict discovery for the workforce list joins authoritative line assignments and APPROVED
leave dates directly. It does not rely solely on the marker, so leave approved before this
hook was installed is still visible without a backfill or scheduler. Carried booking lines
are represented by their current Visit line; WAITING and started/terminal work are excluded.
Past business dates are excluded from normal reassignment.

The list defaults to leave conflicts, from branch-local today through 30 days ahead. Users
may inspect all eligible assigned work for manual reassignment. A query spans at most 93
inclusive calendar days and returns 100 lines per page with an opaque line-kind/ID cursor.
The date range can be advanced to inspect later leave intervals. No leave reason/type or
unnecessary customer contact data is exposed by the work list.

## Eligibility, intent and explicit scope

- Booking lines are editable only while their Booking is CONFIRMED and no Visit line has
  carried them over. Visit lines must be assigned PLANNED lines in an OPEN/IN_SERVICE Visit,
  with no execution record. WAITING, IN_PROGRESS, DONE and CANCELLED are refused.
- A replacement must differ from the current KTV. No assignment happens during suggestions
  or leave approval. The browser selects a candidate and confirms a versioned mutation.
- `assignmentMode` is preserved. ANY never silently becomes SPECIFIC and SPECIFIC never
  becomes ANY. For walk-ins, `requestedEmployeeUserId` is unchanged. For booking lines,
  the original specific reference is recovered from the earliest append-only assignment
  history's `fromEmployeeUserId`, falling back to the original actual assignment before
  the first change. A booked Visit also follows its carried booking reference/history.
- SPECIFIC work requires `acknowledgeSpecific = true` and a meaningful manual reason.
  This records the staff member's explicit operational override; it does not fabricate
  customer consent or deliver a message to the customer.
- `LINE` changes only the chosen line. `PARTICIPANT` explicitly selects that participant's
  unstarted lines assigned to the same current KTV, bounded to 20. The UI displays the exact
  lines and submits their IDs/versions. Other participants, other current KTVs, WAITING and
  started/terminal lines remain outside this scope.
- Suggestions reuse `planAssignment` and the existing deterministic workload/employee-code
  tie-break. A candidate that can preserve a single KTV with retained unstarted sibling
  assignments is preferred. Otherwise the planner prefers one candidate across the selected
  scope. If nobody covers the whole scope, no group mutation is offered; staff can explicitly
  inspect individual lines for a split. No unrelated assignment is silently rewritten.

## Replacement validation

`evaluateReassignmentWindow` extends the existing availability engine using its facts and
employee verdict rules. It evaluates each existing exact planned interval, snapshotted
duration and buffer without replanning or substituting edited catalog values.

Future booking work uses REVALIDATION, which does not require future attendance. Same-day
work and Visit work use OPERATIONAL checks. Revalidation covers branch hours and activity,
service availability, employee account and effective employment, branch assignment, skills,
TRAINEE exclusion, approved leave, collaborator SCHEDULED coverage, attendance when applicable,
planned occupancy, actual END buffers, open execution and relevant customer-booking overlap.
An open execution also refuses replacement for an already elapsed planned window.

Only the explicitly selected lines are excluded from their own occupancy checks; the owning
booking is excluded from its own customer-conflict check. Other work continues to block.
Candidate lists are advisory. The mutation reruns eligibility inside the authoritative
transaction after locking the replacement employee. PostgreSQL remains authoritative.

## Transactions, locks and concurrency

The existing workforce command frame holds the shared authorization graph lock, locks Users
in UUID order (actor, current KTVs, replacement and relevant booking owner), then the actor's
session. A preliminary scope read discovers those identities; it does not authorize a write.

The mutation locks Booking when present, then Visit when present, then target lines in
deterministic ID order. Parent and line locks use NOWAIT to avoid waiting in the opposite
direction to existing arrival/initial-assignment operations. It reloads scope, lifecycle,
assignment and versions under locks and refuses a changed/missing target or an employee
identity that was not locked. Time is sampled from PostgreSQL after these locks.

In the same transaction it revalidates the replacement, changes actual KTV and clears the
resolved conflict marker, increments versions, appends assignment history, audit and outbox,
and returns authoritative line state. Planned start/end, duration/buffer, order and requested
intent are not rewritten. No ServiceExecution row is manipulated.

| Concurrent actions                     | Integrity behavior                                                                                                                                                                    |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Reassignment vs START                  | Current-KTV user lock and Visit/line lock serialize decisions; PLANNED/no-execution is rechecked. A former assignee cannot start after reassignment.                                  |
| Reassignment vs cancellation/arrival   | Booking/Visit locks plus line state/version checks prevent writing cancelled or carried work.                                                                                         |
| Two reassignment requests/managers     | Shared employee locks and line versions allow only the valid current request to commit; stale versions conflict.                                                                      |
| Replacement vs new booking/assignment  | Replacement user lock, engine recheck and the existing PostgreSQL exclusion constraint protect the interval.                                                                          |
| Leave approval vs booking/reassignment | Both lock the leave employee's user. If assignment wins first, approval subsequently identifies its conflict; if approval wins, revalidation rejects that employee.                   |
| Leave approval vs arrival              | The hook locks affected CONFIRMED/CHECKED_IN Booking parents, then reads and locks Visit parents in a fresh statement, so carried work is flagged once in its current representation. |

Recognized lock, version and overlap conflicts produce safe refresh/retry errors. An abort
rolls back every changed line, history entry, audit and event. Approval contention rolls back
the approval too and uses its existing versioned retry flow. Repeating a successful mutation
with old versions cannot append duplicate history; after a lost response the caller refreshes.

## Occupancy and history

Application code never writes `KtvOccupancy`. Updating actual KTV causes the existing source
line trigger to move the planned claim. The database overlap constraint remains the final
backstop, including overlap between two selected lines assigned to the same replacement.
WAITING retains no occupancy; open executions remain blocking; no service is auto-ended.

Each changed line appends one existing `ServiceLineAssignmentChange` row with its booking
or Visit line ID, old/new KTV, actor, database action time, reason enum (`LEAVE` or `MANAGER`)
and a normalized explanation. History is never overwritten. Planned and requested facts
remain available alongside the actual assignment chain.

## Permissions, reasons, audit and events

Normal reassignment requires `REASSIGN_SERVICES` at the persisted branch. Existing session,
active account, permission/deny and branch scope rules are used. Employee actors also need
current non-ended employment; Owner authority follows the existing account model. Global
permission scope retains its existing meaning; branch grants require active membership.
Replacement workforce eligibility and branch assignment are checked separately by the engine.
No role-name checks, MANAGE_BOOKINGS substitute or skill-as-permission rule is introduced.

Every mutation requires 3–500 normalized code points with a letter/number in the explanation.
`LEAVE` context requires a currently affected line. UI guidance asks for an operational reason
without unnecessary personal details. The selected scope and SPECIFIC acknowledgement are
explicitly confirmed before submission.

- Append-only audit action `KTV_REASSIGNED` records actor, branch, line, old/new employee,
  versions, original intent/reference, reason, leave context and authoritative time.
- Transactional outbox `KTV_REASSIGNED` follows the approved design's existing event naming.
  It includes parent/line/employee identities and context, without names, contact details or
  the free-text reason.
- Approval emits `BOOKING_KTV_CONFLICT` per newly flagged line and
  `EMPLOYEE_LEAVE_APPROVED` with leave dates/employee and affected-line count. The existing
  LEAVE_APPROVED audit also records the count. Leave reasons are not copied into events.
- No consumers, relay, delivery, notification UI or jobs are implemented here.

## API and contracts

All endpoints are under `/api/v1/operations`:

| Method | Path                                      | Input/result                                                                                                     |
| ------ | ----------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| GET    | `branches/:branchId/reassignment-work`    | Optional `from`, `to`, `conflictsOnly`, `cursor`; authorized assigned work and next cursor                       |
| GET    | `assignment-lines/:kind/:id/replacements` | Required `scope=LINE\|PARTICIPANT`; exact lines/versions, eligible common replacements and planner suggestions   |
| POST   | `assignment-lines/:kind/:id/reassign`     | Explicit scope, target IDs/expected versions, replacement employee, context, reason and SPECIFIC acknowledgement |

`:kind` is BOOKING or VISIT. New shared contracts are `ReassignmentLineKind`,
`ReassignmentScope`, `ReassignmentLine`, `ReassignmentWorkResponse`,
`ReplacementOptionsResponse`, `ReassignServicesRequest` and `ReassignServicesResponse`.

Strict DTOs reject unknown properties, client timestamps, status, planned times, branch
overrides and assignment-mode changes. Domain checks validate UUIDs, versions, duplicate
targets, date bounds, scope and reasons. Existing JSON/Origin/session-bound CSRF protection
applies. Stable reassignment errors do not expose database internals.

## Workforce UI

`/{locale}/workforce/reassignment` extends the existing workforce shell and components.
Navigation and branch choices use REASSIGN_SERVICES. VI/EN provides leave-conflict filtering,
date range/pagination, current KTV, ANY/SPECIFIC intent, replacement inspection, common-KTV
suggestion, displayed mutation scope, required reason, explicit acknowledgement and confirmation.
No replacement is preselected for mutation. Loading, disabled, empty, success and safe error
states are included. Controls never offer WAITING or started/terminal work.

Mutation responses update visible assignments; the list is reloaded from the server. Stale
list/options requests are discarded. A failed or stale mutation clears its candidate selection
and requires inspection again. Existing stacked sections and form controls support mobile and
desktop without a visual redesign.

## Tests added — NOT EXECUTED

- `reassignment.rules.test.ts`: meaningful reasons, explicit versions/scope/acknowledgement,
  exact snapshot windows/buffers, future vs operational attendance, open execution, leave,
  skills, TRAINEE, branch, collaborator coverage and customer conflict.
- `reassignment.integration.test.ts`: real sessions and database transactions; pending vs
  approved leave, conflict flags/events without assignment, future/operational replacements,
  permission scope, SPECIFIC acknowledgement, Q3 explicit scope, unchanged times/intent,
  history/audit/outbox, stale versions, trigger occupancy and excluded lifecycle states.
  Fixtures are designed to roll back; registered in the existing opt-in integration entry point.
- `reassignment.http.test.ts`: CSRF/Origin, strict bodies and query fields, required versions,
  client-authority rejection, authoritative response and safe errors.
- Web `reassignment.test.tsx`: permission navigation/branch filtering, exact versioned request,
  explicit candidate/reason/SPECIFIC acknowledgement, VI/EN rendering and safe error mapping.

**All validation is deferred to the final Phase 3 gate.** No unit, integration, race, HTTP,
web or regression tests were executed. No typecheck, lint, format check, build, migration or
production validation was run. No passing result is claimed. The final gate must also exercise
the real concurrent cases above and browser request/confirmation races.

## Limitations and Step 9 boundary

- No in-progress reassignment, exceptional execution resolution, fabricated/automatic END,
  execution redesign or automatic replacement.
- No customer self-service replacement/rescheduling flow or implied customer consent. Staff
  can explicitly resolve SPECIFIC requests; original references and history remain intact.
- No new time planning: conflicts without a replacement remain visible for operational/customer
  resolution. Group scope uses one replacement; an explicit per-line action handles necessary splits.
- No notification delivery, warning worker/jobs, emails, SMS or external messaging. Step 9 reads
  the committed events; it is **NOT STARTED**.
- No payments, invoices, POS, loyalty, combos, payroll, commission, Phase 4 or premium redesign.
- No unresolved Owner decision blocks this scoped implementation. Step 8 is OWNER APPROVED / COMPLETE. Comprehensive validation remains deferred.
- Protected `apps/web/next-env.d.ts` is untouched and unstaged; known blob hash
  `a419cbe4e3a5e8d4b481b851dbf4ac767de069e6`.
