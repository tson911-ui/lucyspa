# Notification Center — Step 1: Notification Foundation

Status: **IMPLEMENTED, PENDING OWNER REVIEW. Not committed, not pushed, not deployed.**
Scope: Owner-approved 4-step V1 (Foundation → Hierarchy routing → Leave events → API + UI),
in-app only. Revenue notifications are **deferred until Phase 4** (real Invoice/Payment data, events
such as `INVOICE_PAID`, and the revenue authorization model); nothing revenue-related is mocked.

## What Step 1 does (and does not)

Extends the existing Phase 3 `notifications` table and contracts with only what the approved V1
needs. It does **not** redesign Phase 3 notifications, add routing, add events, change the API or
add UI behavior.

Not added, by decision: `dedupe_key`, `notification_deliveries`, `outbox_consumptions`, email,
preferences, `MANAGE_NOTIFICATION_SETTINGS`, revenue notifications, retention/hard delete.

Why no `dedupe_key`: the existing `unique(source_event_id, recipient_user_id)` is sufficient. Each
Leave event yields at most one notification per recipient, and inbox rows are written in the same
transaction that marks the event consumed, so a retry only follows a full rollback.

Why no `outbox_consumptions`: the Phase 3 relay selects only its own event types and aggregate types
(Booking/Visit/ServiceExecution). Leave events use the `LeaveRequest` aggregate and will get their own
consumer in Step 3, so no event has two independent consumers.

## Migration (`20261012000000_notification_foundation`, additive)

| Change                                                     | Reason                                                                                                                 |
| ---------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `branch_id` → nullable                                     | A leave request belongs to an employee (employee-level row, no branch); an employee may span several branches or none. |
| `params jsonb` (nullable)                                  | Minimal structured facts (ids, dates, enums). Validated in code by an allowlist; never free text.                      |
| `archived_at timestamptz(3)` (nullable)                    | Archive state, independent of `read_at`. No hard deletion.                                                             |
| `type` CHECK widened by `LEAVE_REQUESTED`, `LEAVE_DECIDED` | Registry types. The ten Phase 3 members are unchanged.                                                                 |
| `entity_type` CHECK widened by `LeaveRequest`              | Leave source entity (matches the outbox aggregate name).                                                               |
| `notifications_params_object`                              | `params` is NULL or a JSON object.                                                                                     |
| `notifications_type_entity`                                | Leave types ⇔ `LeaveRequest` entity; Phase 3 types keep Booking/Visit.                                                 |
| `notifications_branch_scope`                               | A branch is required unless the entity is a `LeaveRequest`; Phase 3 rows always have one.                              |

No data is rewritten. Existing rows satisfy every new constraint. The unique key, indexes and
foreign keys are untouched. Category, severity and destination are **not columns**: they are derived
from the registry by `type`.

`schema.prisma`: `Notification.branchId/branch` optional; `params Json? @db.JsonB`; `archivedAt`.
`prisma migrate diff` after the migration reports only the two known composite-FK Prisma limitations
(organization tables); nothing on notifications.

## Contracts and registry (`packages/contracts/src/notification-registry.ts`)

Single, dependency-free source shared by API, worker and web:

- `NOTIFICATION_TYPE_REGISTRY` per type: `category` (`OPERATIONS` | `HR`), `severity`
  (`INFO` | `ATTENTION` | `WARNING`), allowed `entityTypes`, `i18nKey`, `params` kind.
  `NotificationType` is now derived from the registry keys.
- Phase 3 types allow **both** `Booking` and `Visit` (the worker writes either, for example a
  reassignment on a walk-in visit), so Phase 3 behavior is described, not changed. Leave types allow
  `LeaveRequest` only.
- `NOTIFICATION_TARGET_BY_ENTITY` (destination kind by source entity), `isAllowedNotificationEntity`,
  `notificationTypesInCategory` (for `type IN (...)` filters in Step 4), `isNotificationType`.
- `parseNotificationParams`: strict allowlist. `LEAVE_REQUESTED` = `{subjectUserId, startDate,
endDate, leaveType}`; `LEAVE_DECIDED` = `{decision, startDate, endDate, leaveType}`. Extra keys, a
  name, a reason, bad dates or unknown enums are refused. This is what Step 3 must use before writing.
- `NotificationItem.branch` may be `null`; `source.type` is the widened entity union. The wire shape
  is otherwise unchanged (`params`/`archivedAt` are not yet exposed; Step 4).

## Compatibility with Phase 3

- Existing rows, the unique key, the relay, warnings, recipient selection and `deliverInbox` are
  untouched. The relay and worker code are unchanged.
- Two small consumer edits keep the code compiling and behaving identically for existing rows:
  `notification.service.ts` (source type cast to the widened union) and the web inbox
  (`branch` may be null: time zone falls back to the viewer's; `notificationHref` returns no link for
  person-level items and reads `item.branch.id` only when present). The dictionaries gained the two
  Leave message strings required by the exhaustive `Record<NotificationType, string>`; final wording
  and links are reviewed in Step 4.

## Validation performed (minimal; no full regression)

- `prisma validate` + `generate`; migration applied to the isolated validation database
  `lucy_spa_org_validation_20260929` (not production); drift diff clean for notifications.
- Typecheck (all packages), lint, format: pass.
- `notification-registry.test.ts` (3): registry keeps the ten Phase 3 types and adds only two Leave
  types; category/target derivation; strict `params` allowlist.
- `notification-foundation.integration.test.ts` (1, rolled back): a Phase 3 row is unchanged; the
  unique key still rejects a duplicate; a Leave row with no branch and params is accepted; branch
  scope, type/entity pairing, unknown type and non-object params are refused; archive is independent
  of read.
- Existing `notification.test`/`notification.http.test` (API), `service-warnings.test` (worker) and
  the web suite (140) still pass.

## Deferred / limitations

Step 2 recipient routing; Step 3 Leave events and their consumer; Step 4 API filters, mark-all-read,
archive, unread-by-category and UI; Leave links; revenue notifications (Phase 4); email and
preferences; retention/cleanup policy.

## Context for Step 2

Reuse `canSupervise`, `decide`, `loadAuthorityGraph` and the organization tables from
`@lucy-spa/server`. Routing rule (Owner approved): lowest eligible supervisory level that has the
required permission and whose scope/containment covers the subject; **all** eligible people at that
level receive it; never the whole chain; escalate upward only when that level has no eligible
recipient; the Owner is only the final fallback and does not receive routine operational
notifications; no timers. Phase 3 recipient selection stays as is. Leave notification `params` must go
through `parseNotificationParams`.
