# Phase 1 Step 7: permission engine and permission catalog

Status: **implemented and validated locally; awaiting review**. No staging, commit,
push or Step 8 work. Baseline is Step 6 commit `a89d147`.

This implements the permission engine from the approved
[authentication/security design](PHASE1_AUTH_SECURITY_DESIGN.md), sections 7, 8 and 10.
It covers the catalog, the evaluation rules, the delegation and escalation rules, and
the lock and version consequences. It adds no endpoint.

**No Prisma schema, migration or database privilege change was needed.**
`apps/web/next-env.d.ts` is untouched.

## Permission catalog (code-owned)

| Code                     | Scope capability | Data classification |
| ------------------------ | ---------------- | ------------------- |
| `VIEW_EMPLOYEES`         | BRANCH_CAPABLE   | STANDARD            |
| `CREATE_EMPLOYEES`       | BRANCH_CAPABLE   | STANDARD            |
| `UPDATE_EMPLOYEES`       | BRANCH_CAPABLE   | STANDARD            |
| `MANAGE_EMPLOYEE_STATUS` | BRANCH_CAPABLE   | STANDARD            |
| `MANAGE_EMPLOYEE_ACCESS` | BRANCH_CAPABLE   | STANDARD            |
| `MANAGE_EMPLOYEE_SCOPE`  | BRANCH_CAPABLE   | STANDARD            |
| `VIEW_EMPLOYEE_PAY`      | BRANCH_CAPABLE   | EMPLOYEE_PAY        |
| `MANAGE_EMPLOYEE_PAY`    | BRANCH_CAPABLE   | EMPLOYEE_PAY        |
| `MANAGE_PERMISSIONS`     | BRANCH_CAPABLE   | STANDARD            |
| `VIEW_AUDIT_LOG`         | BRANCH_CAPABLE   | STANDARD            |

These values are the ones the Step 2 `permissions_phase1_catalog_semantics` CHECK
already enforces. The catalog lives in `@lucy-spa/database` as `PERMISSION_CATALOG`.

**Operator sync:** run `pnpm db:permissions:sync`. It is explicit and never runs on API
startup. In one transaction it:

- inserts only the missing rows;
- verifies that every stored row's semantics match the catalog;
- never updates or deletes a row.

A mismatch fails the command with no change, and the error names only the permission
codes. The Step 2 trigger already makes stored semantics immutable. **The sync has not
been run against the local database**; it was exercised only inside a rolled-back
integration transaction.

## Engine (`apps/api/src/authorization/`)

- **Authority graph (`loadAuthorityGraph`).** Loaded inside the deciding transaction,
  never from a session snapshot or from client data. It contains:
  - the principal kind and `authzVersion`;
  - active memberships only: not revoked, in an active branch;
  - role grants from **active** roles only;
  - overrides.

  The Owner and customers carry no role or override rows into the graph.

- **`decide(graph, permission, target)`** follows the design's evaluation order:
  1. unknown codes are denied;
  2. the Owner passes permission and scope checks only (the caller still enforces
     authentication, CSRF, target protection, domain rules and audit);
  3. non-workforce principals are denied;
  4. an applicable GLOBAL or matching BRANCH **DENY** wins, with or without membership;
  5. otherwise an ALLOW override or role grant is needed:
     - a GLOBAL grant covers the global action and every branch, including future ones;
     - a BRANCH grant needs a matching active membership and never authorizes a
       global action;
  6. no grant means deny.

  An `unrestricted` option for global targets also rejects on any branch DENY. It
  implements the design's null-branch audit rule and is left for the audit-read step
  to use.

- **`decideAcross(graph, permission, affectedBranchIds)`** implements multi-branch
  checks: every affected branch, old and new, must pass, and one denial rejects the
  whole operation. With no affected branch, GLOBAL is required.
- **`checkContainment(actor, target)`** is the credential-control check for setup
  issuance and reactivation.
  - The target is evaluated as if it were an active employee, so its status never
    reduces its authority to zero.
  - All of the target's effective capabilities, over the global action, every named
    branch and a stand-in for unnamed or future branches, and accounting for DENYs,
    must also be held by the actor. Branch overlap alone is insufficient.
  - Owner and customer targets, self-targets and non-workforce actors are rejected.
  - An Owner actor passes.
- **`checkGraphChange(actor, before, after)`** implements the rules for role, override
  and scope changes. Every capability present _after_ but not _before_ must be held by
  the actor, so removing a DENY, granting globally or activating a dormant branch grant
  through scope expansion all count as grants. Self-changes by a non-Owner, and any
  Owner or customer target, are rejected. Callers still need `decideAcross` for
  MANAGE_PERMISSIONS or MANAGE_EMPLOYEE_SCOPE at the old and new scopes, and must repeat
  the check for each recipient of a shared role edit.
- **`takeExclusiveAuthGraphLock(tx)`** is for security-graph writers. It must be the
  _first_ statement of the writer's transaction; it is never an upgrade from the
  shared lock that authentication mutations take.
- **`invalidateAuthorization(tx, userIds, now)`** runs in the same transaction as a
  permission change:
  - locks the affected Users in UUID order;
  - increments `authzVersion` for employees;
  - revokes their sessions (Users before Sessions, the documented lock order).
- **`authorizationSummary(graph)`** fills the `CurrentAccount.authorization` field:
  - Owner: `{ version, owner: true }`;
  - customer: empty lists;
  - employee: deduplicated effective grants (branch grants only with active
    membership) and every DENY.

  It is a display hint only; enforcement never uses it.

## Validation

| Check                                                                 | Result               |
| --------------------------------------------------------------------- | -------------------- |
| Database package and API strict TypeScript build                      | PASS                 |
| Unit tests: decision table, containment/escalation, summary, catalog  | PASS: 8 test groups  |
| PostgreSQL rollback integration: catalog sync, graph loading, locking | PASS: 4 (3 subtests) |
| ESLint and Prettier on changed files                                  | PASS                 |

- **Unit tests** cover:
  - every row of the design's decision table;
  - GLOBAL covering future branches, membership alone granting nothing, DENY without
    membership, Owner, customer and unknown codes;
  - the unrestricted-global rule;
  - multi-branch all-or-nothing, and "no branch requires GLOBAL";
  - containment: branch overlap, global versus future branches, an actor with a
    global grant and a branch DENY, permission-management power, ineffective
    grants, protected and self targets;
  - gained-authority checks: removed DENY, global delegation, dormant-grant activation
    by scope expansion;
  - the summary shape;
  - the exact ten-code catalog.
- **The integration test** runs inside one rolled-back transaction against the real
  constraints and triggers. It covers:
  - the sync inserting and then reporting all ten rows unchanged, with exact
    semantics;
  - exclusion of revoked memberships, inactive-branch memberships and inactive roles;
  - GLOBAL ALLOW combined with a branch DENY;
  - `authzVersion` increments and session revocation;
  - the exclusive lock blocking a concurrent shared-lock attempt.

  Postchecks confirm the permission count is unchanged and no fixture branches or
  roles remain.

No unrelated auth suites were rerun. The only shared-file change is an added
exclusive-lock function in `auth-store.ts`; the existing shared-lock function is
unchanged.

## Exact Step 7 files

Modified:

```text
LUCYSPA_HANDOFF.md
apps/api/src/auth/auth-store.ts
package.json
packages/database/package.json
packages/database/src/index.ts
scripts/test-auth-integration.mjs
```

Created:

```text
apps/api/src/authorization/authorization.integration.test.ts
apps/api/src/authorization/authorization.store.ts
apps/api/src/authorization/authorization.test.ts
apps/api/src/authorization/authorization.ts
docs/PHASE1_STEP7_PERMISSION_ENGINE.md
packages/database/src/permission-catalog.ts
packages/database/src/sync-permissions.ts
```

## Review boundary

No schema blocker. Not added in this step:

- Owner bootstrap;
- workforce login, `/auth/me`, reauthentication, logout-all;
- employee lifecycle;
- role-administration or audit-read endpoints;
- email delivery.

Once workforce login exists (Step 8), it can use `authorizationSummary`. The later
command steps use `decide`, `decideAcross`, `checkContainment`, `checkGraphChange`, the
exclusive lock and `invalidateAuthorization`. Step 8 is not started.
