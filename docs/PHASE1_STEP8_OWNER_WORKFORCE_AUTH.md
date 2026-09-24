# Phase 1 Step 8: Owner bootstrap and workforce authentication

Status: **implemented and validated locally; awaiting review**. No staging, commit,
push or Step 9 work. Baseline is Step 7 commit `5b67b37`.

This implements the approved [authentication/security design](PHASE1_AUTH_SECURITY_DESIGN.md)
for:

- Owner bootstrap (sections 2 and 8);
- workforce login (section 2);
- the `/auth/me`, `/auth/reauthenticate` and `/auth/logout-all` contracts (sections 5
  and 10).

It reuses:

- the Step 3 session primitives;
- the Step 5 login flow;
- the Step 7 permission engine and account summary.

**No Prisma schema, migration or database privilege change was needed.**
`apps/web/next-env.d.ts` is untouched. **No real Owner was created**: every Owner
created in tests was rolled back.

## Owner bootstrap

Command:

```text
pnpm owner:bootstrap --full-name "…" --email owner@example.com [--phone 09…] [--locale vi|en]
```

- **Password input.**
  - On a terminal, the command asks for the password twice with input hidden.
  - Otherwise it reads the first line of piped stdin.
  - It never accepts the password as a flag, environment variable or file, and never
    logs it.
  - Unknown options, including `--password`, are rejected.
- **Password policy.** The Step 3 policy and blocklist apply, and the password is
  hashed with Argon2id.
- **Database connection.** The command uses `OWNER_BOOTSTRAP_DATABASE_URL`, falling
  back to `DATABASE_URL`.
  - The OWNER insert succeeds only if that role holds EXECUTE on
    `lucy_owner_bootstrap_capability()`, which the Step 2 trigger enforces.
  - A role without it gets a clear "lacks the Owner bootstrap privilege" message, and
    nothing changes.
- **Transaction (`bootstrapOwner`).** In one transaction it:
  1. takes the **exclusive** security-graph lock;
  2. rechecks that no Owner exists — if one does, it reports `ALREADY_INITIALIZED`
     (exit 0) and never overwrites anything;
  3. refuses an email or phone that already belongs to another account (exit 1,
     nothing changed);
  4. inserts an ACTIVE Owner with **no** `emailVerifiedAt`, because an operator
     entering an address is not verification;
  5. appends `OWNER_BOOTSTRAPPED`, with actor `BOOTSTRAP`, no actor User, and an
     execution context of `owner-bootstrap-cli:<os user>@<host>`, but no credential,
     email or hash.

  The sole-Owner partial unique index remains the final guard.

- **Errors.** Messages never include passwords, hashes, connection URLs or driver
  details.

## Workforce authentication and account endpoints

`POST /auth/login` now accepts:

- `CUSTOMER` + `EMAIL`: unchanged.
- `WORKFORCE` + `EMAIL`: the Owner, or an ACTIVE employee **with a verified email**.
- `WORKFORCE` + `EMPLOYEE_ID`: an ACTIVE employee, with the ID normalized by Step 3
  (trimmed and uppercased).

`CUSTOMER` + `EMPLOYEE_ID` returns 400 `VALIDATION_FAILED: identifierType`.

Realm rules:

- A credential match in one realm grants nothing in the other.
- Customers, employees and the Owner each get the same 401 `AUTHENTICATION_FAILED`
  outside their realm.
- The same 401 also covers PENDING_SETUP, inactive, unknown and malformed identifiers.
- Every non-throttled attempt performs exactly one real or dummy Argon2 verification,
  and eligibility is checked only after it.

Failure budgets:

- There are separate budgets per realm and identifier type (customer email, workforce
  email, workforce employee ID): 10 per 15 minutes each.
- The per-IP budget is shared: 100 per 15 minutes.
- Limits apply equally to unknown identifiers, return 429 with `Retry-After: 900`, and
  are checked before any password work.

`CurrentAccount.authorization` for every kind now comes from the Step 7
`authorizationSummary`:

- the Owner gets `{ version, owner: true }`;
- employees get their effective grants and denies;
- customers get empty lists.

Account endpoints:

| Route                       | Behavior                                                                                                                                                              |
| --------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /auth/me`              | 200 `CurrentAccount` for an authenticated session, else 401 `AUTHENTICATION_REQUIRED`. No CSRF token is needed (it is a read), and it does not refresh idle activity. |
| `POST /auth/reauthenticate` | Takes `{ password }`. Returns 204 with a **rotated** cookie; the client must fetch a new CSRF context.                                                                |
| `POST /auth/logout-all`     | Takes `{}`. Revokes every session of the User, including the current one, clears the cookie, and returns 204.                                                         |

`POST /auth/reauthenticate` in detail:

- It requires an authenticated session and one password verification, with a guarded
  rehash.
- The rotation goes through `rotateAuthenticated(reauthenticated: true)`:
  - a new token is issued and the old one revoked, with no overlap window;
  - `reauthenticatedAt` is set;
  - the **original absolute expiry is kept**;
  - `SESSION_REAUTHENTICATED` is written to the audit log.
- A wrong password returns 401 `AUTHENTICATION_FAILED` and the session stays valid. A
  missing or invalid session returns 401 `AUTHENTICATION_REQUIRED`.
- Failures are budgeted per User (10 per 15 minutes) and per IP.

`POST /auth/logout-all` locks the User and then the session (the documented lock
order) and appends `SESSIONS_REVOKED` with reason `LOGOUT_ALL`.

All unsafe routes keep the Step 3 JSON, exact-Origin and session-bound CSRF protection.

## Choices based on existing contracts

- **Reauthentication budget.** Reauthentication failures reuse the design's login
  failure numbers (10 per 15 minutes), keyed by the authenticated User rather than a
  typed identifier.
- **`/me` and idle activity.** `/auth/me` is read-only and does not extend idle
  activity. The Step 3 foreground `touch` primitive is still not wired to any
  endpoint; see the open items.

## Validation

| Check                                                                          | Result                             |
| ------------------------------------------------------------------------------ | ---------------------------------- |
| Contracts and API strict TypeScript build                                      | PASS                               |
| Step 8 HTTP contract test (workforce login, `/me`, reauthenticate, logout-all) | PASS                               |
| Step 5 login/logout HTTP test (shared controller; realm case updated)          | PASS                               |
| PostgreSQL rollback integration: bootstrap and workforce authentication        | PASS: 7 (6 subtests, none skipped) |
| Step 5 login integration regression (shared login service)                     | PASS: 4                            |
| CLI pre-database checks: `--password` refused, missing name, weak password     | PASS (no database access)          |
| ESLint and Prettier on changed files                                           | PASS                               |

The integration test runs in one rolled-back transaction. It covers:

- a single audited bootstrap that does not claim email verification;
- a repeat bootstrap that changes nothing;
- a concurrent bootstrap blocked by the exclusive lock (lock timeout);
- a privileged direct second-Owner insert rejected by the unique index;
- **a temporary restricted role without the bootstrap privilege getting `42501`**
  (created and removed inside a savepoint);
- the Owner signing in by email only in the WORKFORCE realm, with the `{ owner: true }`
  summary and `/me`;
- employee login by normalized ID with an effective branch grant summary;
- unverified email refused, verified email accepted, and the customer realm refused;
- PENDING_SETUP refused;
- reauthentication:
  - a wrong password keeps the session;
  - success rotates it with no overlap, sets `reauthenticatedAt` and keeps the same
    absolute expiry, with audit;
  - anonymous or missing sessions are refused;
- logout-all revoking every session with audit, then refusing reuse;
- per-realm and per-identifier budgets for both a real and an unknown employee ID;
- a separate customer-realm budget.

A postcheck confirms that no Owner and no fixture users remain.

The Step 4, 6 and 7 suites were not rerun. The only other change to earlier-step files
is the Step 5 login integration test's session stub, which gained the two newly used
methods, bound to its rollback transaction.

## Exact Step 8 files

Modified:

```text
LUCYSPA_HANDOFF.md
apps/api/package.json
apps/api/src/auth/login.integration.test.ts
apps/api/src/auth/login.service.ts
apps/api/src/auth/session-auth.controller.ts
apps/api/src/auth/session-auth.http.test.ts
package.json
packages/contracts/src/index.ts
scripts/test-auth-integration.mjs
```

Created:

```text
apps/api/src/auth/workforce-auth.http.test.ts
apps/api/src/bootstrap/bootstrap-owner.cli.ts
apps/api/src/bootstrap/owner-bootstrap.ts
apps/api/src/bootstrap/workforce-auth.integration.test.ts
docs/PHASE1_STEP8_OWNER_WORKFORCE_AUTH.md
```

## Review boundary and open items

No schema blocker. The following were **not** added:

- workforce password recovery or recovery-email verification (Step 9);
- employee lifecycle (Step 10);
- role administration or the audit-read API (Step 11);
- email delivery (Step 12).

Open items:

- **Real Owner.** Creating the real Owner needs your Owner identity, your decision,
  and a database role with the bootstrap privilege.
  - Locally, the development database user owns the capability function, so it has
    that privilege implicitly.
  - In production, grant the privilege only to a dedicated bootstrap role and set
    `OWNER_BOOTSTRAP_DATABASE_URL`. That provisioning is Step 13 work.
- **Idle timeout.** No endpoint extends idle activity yet, so authenticated sessions
  end after 30 idle minutes regardless of use. A deliberate foreground-activity policy
  is still needed.
- **Unverified Owner email.** The Owner's email stays unverified until Step 9's
  recovery-email verification, so Owner self-service recovery is unavailable until
  then.
