# Notification Center — Step 3: Leave Notification Events

Status: **IMPLEMENTED, PENDING OWNER REVIEW. Not committed, not pushed, not deployed.**
Builds on [Step 1](NOTIFICATION_CENTER_STEP1_FOUNDATION.md) (foundation) and
[Step 2](NOTIFICATION_CENTER_STEP2_ROUTING.md) (hierarchy routing). In-app only. Revenue notifications
remain deferred until Phase 4. No schema/migration change in this step.

## What was built

Connects the existing Leave workflow to the notification foundation and the routing resolver:

- leave request **created** → the appropriate manager(s) are notified;
- leave **approved or rejected** → the requesting employee is notified.

Phase 3 notification behavior, its relay and its recipient selection are untouched.

## Event contracts

Both events use outbox aggregate `LeaveRequest`, `schemaVersion` 1, `branch_id` null (a leave request
belongs to an employee, not a branch), and are written **in the same transaction** as the business
change (`appendOutboxEvent`), so a failed or rolled-back command leaves no event.

| Event             | Written by                             | Payload                                                  |
| ----------------- | -------------------------------------- | -------------------------------------------------------- |
| `LEAVE_REQUESTED` | `LeaveService.create`                  | `{ employeeUserId }`                                     |
| `LEAVE_DECIDED`   | `LeaveService.decide` (approve/reject) | `{ employeeUserId, decision: 'APPROVED' \| 'REJECTED' }` |

The payload holds no reason, manager note, name or dates. The consumer reads dates and leave type from
the authoritative `LeaveRequest` row. `cancel()` emits nothing (out of scope). The existing Phase 3
event `EMPLOYEE_LEAVE_APPROVED` is unchanged and is not a Leave notification event.

Shared definitions (builders, strict parser, constants): `packages/server/src/leave-events.ts`.

## Consumer architecture

- Core: `processLeaveEvent(tx, eventId)` in `packages/server/src/leave-notifications.ts`. It lives in the
  shared server package so the API integration tests can drive it against a real transaction (the API
  cannot import the worker). `@lucy-spa/server` now declares a workspace dependency on
  `@lucy-spa/contracts` (allowed by the boundary rules) to reuse the Step 1 registry validator.
- Scheduling: `apps/worker/src/leave-jobs.ts` (`startLeaveNotifications`, registered and stopped in the
  worker lifecycle in `main.ts`). It polls every 2 s, at most 50 pending Leave events per pass, in id
  order with a wrapping keyset cursor (the Phase 3 pattern, so a poisoned older event cannot starve newer
  ones), and runs **each event in its own transaction**. No BullMQ, no email, no delivery table.
- Independence from Phase 3: the Phase 3 relay selects only its own event types and the
  Booking/Visit/ServiceExecution aggregates, and the Leave consumer claims only `LEAVE_REQUESTED` /
  `LEAVE_DECIDED` on `LeaveRequest`. There is no consumer conflict on `outbox_events.published_at`, so no
  `outbox_consumptions` table was added. `EMPLOYEE_LEAVE_APPROVED` stays pending and unconsumed as before.

Per event, in one transaction: take the shared authorization-graph lock → claim the row
`FOR UPDATE SKIP LOCKED` while `published_at IS NULL` → require `schemaVersion` 1 and a strict payload →
load the LeaveRequest → decide recipients → insert inbox rows (`skipDuplicates`) → mark `published_at`
**last**. Any throw rolls everything back and the event stays pending for retry.

## Routing

- **LEAVE_REQUESTED**: if the request is no longer `PENDING` the event is consumed without notifying
  (`SKIPPED`). Otherwise `resolveSupervisorRecipients` (Step 2) is called with the requester as subject,
  permission `APPROVE_LEAVE`, `exclude: [requester]`, and `branchIds` = the employee's **non-revoked**
  branch assignments, the same set Leave approval authorizes against. Result: the lowest eligible level,
  **all** eligible people at that level, none above, escalation only when a level has nobody, Owner only
  as the final fallback. If nobody at all can be reached the event is consumed with no rows
  (`UNROUTABLE`, logged as a warning without personal data).
- **LEAVE_DECIDED**: recipient is the requesting employee only, and only if the recorded decision equals
  the payload decision, the account is ACTIVE and employment is not ended (else `SKIPPED`). No routing.

## Notification rows

`type` `LEAVE_REQUESTED` / `LEAVE_DECIDED`; `entityType` `LeaveRequest`; `entityId` the leave id;
`branchId` null; `contextCode` the employee code; `actionAt` the event time; `params` built through the
Step 1 allowlist (`parseNotificationParams`): requested `{ subjectUserId, startDate, endDate,
leaveType }`, decided `{ decision, startDate, endDate, leaveType }`. Neither the leave reason nor the
decision reason/manager note is ever stored in an event or inbox row.

## Idempotency and transactions

- The Phase 3 key `unique(source_event_id, recipient_user_id)` is unchanged and sufficient.
- A consumed event is never claimed again (`NOT_CLAIMED`). A forced re-run inserts nothing new and never
  resets read state (`ON CONFLICT DO NOTHING`).
- Event creation is atomic with leave creation/decision; notification persistence is atomic with marking
  the event consumed. Concurrent workers are safe through `SKIP LOCKED`.

## Validation performed (targeted; no full regression)

- `leave-events.test.ts` (3, unit): builders, strict parser (reasons/notes/extra keys refused), event types.
- `leave-relay-isolation.test.ts` (2, unit, stub transaction): the Phase 3 relay returns false and never
  marks any `LeaveRequest` event (including `EMPLOYEE_LEAVE_APPROVED`); the Leave consumer returns
  `IGNORED` for Booking/Visit/ServiceExecution events and the Phase 3 conflict event.
- `leave-notifications.integration.test.ts` (1, real PostgreSQL, rolled back, real `LeaveService`):
  create → one minimal event in the same transaction; both Deputies notified, not the Store Manager, the
  requester or the Owner; params contain no free text; retry/forced re-run adds nothing and keeps read
  state; a Deputy's own request escalates past the peer to the Store Manager; Owner fallback when nobody
  is eligible; approve and reject notify only the employee with the decision and no reason/note; a stale
  `LEAVE_REQUESTED` after a decision is skipped; overlap conflict and stale-version approval leave no
  event; an injected consumer failure leaves no rows and the event pending, and the retry succeeds.
- Regression guard: leave, reassignment, service-execution and employee-directory integration suites,
  notification unit/HTTP tests, and worker `service-warnings` tests all still pass.
- Typecheck, lint and format: see the Step 3 report summary.

## Deferred / limitations

Step 4: notification API filters, mark-all-read, archive, unread by category, links to leave and the UI
(the Leave message strings from Step 1 are placeholders until then). Leave cancellation notifications,
absence, security and other categories. Migrating Phase 3 recipients (separate decision). Email,
preferences, revenue, retention/cleanup.

## Context for Step 4

Leave inbox rows have `branchId` null and `params`; listing must handle a null branch (the Step 1
contract already does). Category filters use `notificationTypesInCategory('HR')` (the two Leave types).
The destination for `LeaveRequest` is the leave screen; the destination API still enforces authority.
Archive uses `archived_at`; unread counts should exclude archived rows.
