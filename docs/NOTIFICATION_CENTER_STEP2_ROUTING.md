# Notification Center — Step 2: Hierarchy Recipient Routing

Status: **IMPLEMENTED, PENDING OWNER REVIEW. Not committed, not pushed, not deployed.**
Builds on [Step 1](NOTIFICATION_CENTER_STEP1_FOUNDATION.md). In-app only; revenue notifications remain
deferred to Phase 4. No schema change in this step.

## What was built

A reusable resolver in `packages/server` (importable by API and worker):

```ts
resolveSupervisorRecipients(tx, { subjectUserId, permission, branchIds?, exclude? })
  -> { recipients: string[]; source: 'SUPERVISOR' | 'OWNER_FALLBACK' | 'NONE'; level: OrganizationLevel | null }
```

`subject + required permission → recipients`. It only **selects** recipients. It writes nothing, creates
no events and no notifications (Step 3), and adds no authorization model: it composes the existing
`loadAuthorityGraph`, `decide`, and a new `supervisionRank` that `canSupervise` is now defined by.
Phase 3 recipient selection (`operationalRecipients`) is untouched.

Files: `packages/server/src/notification-routing.ts` (new), `packages/server/src/organization.ts`
(`supervisionRank`, `OWNER_SUPERVISION_RANK`; `canSupervise` = "has a rank", behavior identical),
`packages/server/src/index.ts` (exports).

## Hierarchy traversal

1. Load the subject's authority graph; the subject must be an EMPLOYEE (an Owner or customer subject
   yields no recipients).
2. Subject location = `branchIds` if given, otherwise the subject's active branches. Callers that must
   mirror an existing action pass the branch set that action authorizes against.
3. Candidate pool (SQL, narrowing only): ACTIVE employee accounts, excluding the subject and
   `exclude`, that hold an active organization appointment whose scope can contain the subject
   (SYSTEM, the subject branches' REGION or AREA, or a subject BRANCH). With no branch, only SYSTEM
   appointments qualify.
4. Each candidate is checked authoritatively (below). Eligible people are ranked by the level at
   which they supervise the subject.
5. The **lowest** rank that has at least one eligible person is selected; **all** eligible people at
   that rank receive it. Higher ranks are never added. A level with nobody eligible is skipped, which
   is the upward escalation. There are no timers.
6. Only if no employee is eligible at any level: the Owner (single ACTIVE Owner not in `exclude`) is
   returned as `OWNER_FALLBACK`. While any employee is eligible the Owner is never a recipient.

## Eligibility (all must hold)

- Account status ACTIVE; employment not ENDED on the latest branch-local calendar date among the
  subject's branches (same semantics as Phase 3 recipient selection).
- **Hierarchy + containment**: `supervisionRank(candidate, subject, branches)` is not null. The
  candidate's appointments must contain **every** subject branch (a multi-branch subject needs all of
  them covered) and outrank the subject's own appointments there; a Team Leader counts only for
  members of their own team. Ended employment holds no position, an inactive scope holds none, and
  an archived team holds none (existing graph rules).
- **Permission + scope + DENY**: the permission is effectively held at every subject branch (SYSTEM
  when the subject has no branch), exactly `decideAcross`, so a DENY at any of them disqualifies.
- Position never grants the permission and the permission never grants position: both are required,
  which also means a routed recipient can actually perform the corresponding action (for example
  Leave approval checks the same permission-across-branches and supervision).
- No role names, display titles, `isManagerGroup` or ids are consulted.

## Level definition

A candidate's level is the highest of their appointments that supervise the subject at a location;
for a multi-branch subject it is the lowest of those per-branch levels. So a person who is both
Deputy and Area Manager over the subject counts as Area Manager. `level` in the result is the shared
level of the recipients (null for Owner/none).

## Owner protection

Unchanged. The Owner is outside the hierarchy, is never a subject, never appointed, and is reached
only as the final fallback. `OWNER_SUPERVISION_RANK` (above CEO) exists so `supervisionRank` can
describe an Owner actor consistently; the resolver never ranks the Owner among employees.

## Concurrency and transactions

Read-only. The caller (the Step 3 consumer) holds the shared authorization-graph lock as Phase 3
delivery does, and writes the inbox rows in the same transaction; the resolver takes no locks itself.

## Validation performed (targeted)

- `organization-policy.test.ts` (10, unit): `supervisionRank` levels, Team Leader reach, multi-branch
  lowest rank, peers/superiors/self/non-employees, and that `canSupervise` ≡ "has a rank".
- `notification-routing.integration.test.ts` (1, rolled back, real PostgreSQL): lowest level only
  (own Team Leader, another team's leader ignored); a non-member skips Team Leaders and **all three**
  Deputies receive, not the Deputy lacking the permission nor anyone above; subject/`exclude` never
  routed; a peer is not a supervisor; multi-branch needs every branch covered; branchless subject
  reaches only a SYSTEM holder; pinned `branchIds`; escalation across DENY, inactive account and ended
  employment, then Store Manager → Area (another area ignored) → Regional → CEO; Owner only as final
  fallback, excludable, and never a subject; a two-branch Store Manager covers a two-branch subject
  and loses eligibility with a DENY at one branch.
- Regression guard for the refactor: `authorization`/`organization-scopes` unit, and the
  organization bootstrap, organization service, role-admin and employee-directory integration suites.
- Not run: full regression or the comprehensive gate (final gate only).

## Deferred

`LEAVE_REQUESTED`/`LEAVE_DECIDED` events and their consumer (Step 3); API filters, mark-all-read,
archive and UI (Step 4); migration of Phase 3 recipients (separate decision); email, preferences,
revenue, retention.

## Context for Step 3

Call `resolveSupervisorRecipients(tx, { subjectUserId: <requester>, permission: 'APPROVE_LEAVE',
branchIds: <the branches Leave approval authorizes against>, exclude: [<requester>] })` inside the
consumer's transaction, after taking the shared graph lock, then persist one `LEAVE_REQUESTED`
notification per returned id (`entityType: 'LeaveRequest'`, `branchId: null`, `params` through
`parseNotificationParams`). Leave approval uses the employee's non-revoked branch assignments (not only
active branches), so pass that set for exact parity. `LEAVE_DECIDED` goes to the requester only, with no
routing. An empty result means nobody can be reached (log, do not invent a recipient).
