# Phase 1 Step 13: completion gate

**Result: PHASE 1 COMPLETE — deployment prerequisites remain.**

Awaiting approval. No staging, commit, push, deployment or Phase 2 work.

## Baseline

- Branch `main` at `93b2316` (`feat: add email dispatch and auth cleanup`), identical to
  `origin/main`.
- Working tree: the only change is the pre-existing generated
  `apps/web/next-env.d.ts`, which stays untouched. Its git object hash `a419cbe…` was
  the same before and after every check.

## Steps 1–12 (from their committed reports)

| Step | Scope                                                   | Status and commit |
| ---- | ------------------------------------------------------- | ----------------- |
| 1    | Auth/security design (`PHASE1_AUTH_SECURITY_DESIGN.md`) | Approved          |
| 2    | Database schema, constraints and triggers               | Closed            |
| 3    | Session, CSRF, password and crypto runtime              | Closed            |
| 4    | Customer registration and email OTP                     | Closed, `bff1ddc` |
| 5    | Customer login and logout                               | Closed, `2c3d0c2` |
| 6    | Customer password reset                                 | Closed, `a89d147` |
| 7    | Permission engine and catalog                           | Closed, `5b67b37` |
| 8    | Owner bootstrap and workforce authentication            | Closed, `2f49625` |
| 9    | Workforce recovery                                      | Closed, `19a04c0` |
| 10   | Employee lifecycle                                      | Closed, `55d10d6` |
| 11   | Role administration and audit read                      | Closed, `b8c4837` |
| 12   | Email dispatch and auth cleanup                         | Closed, `93b2316` |

Steps 1–12 were not re-audited; their reports are the evidence.

## Final checks performed (once each)

The repository's aggregate gate is `pnpm check` (format, lint, typecheck, test, build).
Its web typegen and web build steps rewrite `apps/web/next-env.d.ts`, so it was run as
its components, with the web app type-checked by a plain `tsc --noEmit` that writes
nothing.

| Check                                                                      | Result                                                                           |
| -------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| `pnpm format:check` (whole repository)                                     | PASS                                                                             |
| `pnpm lint` (ESLint `--max-warnings 0` plus the workspace boundary check)  | PASS                                                                             |
| `pnpm build:server`, then typecheck of every package except web            | PASS                                                                             |
| `apps/web`: `tsc --noEmit`                                                 | PASS                                                                             |
| `pnpm test` (all unit/HTTP suites; builds the API and worker)              | PASS: server 19, worker 3, API 67; the 10 DB suites skip without the opt-in flag |
| `pnpm test:auth:integration` (all 10 auth integration suites, rolled back) | **PASS: 67/67, none skipped**                                                    |

**Why the integration aggregate ran.** Step 12 moved the shared lock, delivery crypto
and processor code that every auth suite uses, and the Step 12 report deferred the
Step 5 and 7–11 suites to this gate. This run covers them, and the Step 2–12 suites,
together.

**Postchecks:** zero `OWNER` rows in the local database, no tracked file changed, and
the `next-env.d.ts` hash is unchanged.

**Not run:** the database package's schema integration suite (Step 2) and the web
production build. The schema has not changed since its validation, and the web build
would rewrite the protected generated file.

## Phase 1 code blockers

**None.** The one documented open item that is not deployment-related is carried
forward as a non-blocking decision:

- **Idle-activity policy (Step 8).** No endpoint yet refreshes session activity, so an
  authenticated session ends 30 minutes after its last refresh even while in use. This
  fails safe. The `touch` primitive exists; choosing which foreground requests count
  as activity is a product decision for when the UI is built. Background polling must
  not extend the idle time. **Resolved after Phase 2 deployment:** genuine user activity
  now slides a 60-minute idle window (12-hour absolute unchanged); see the design's
  "Session activity".

Other documented choices and deferrals remain as recorded in their reports:

- Step 10: no employee list endpoint; the setup-token hand-over procedure.
- Step 11: conservative delegation choices.
- Step 12: no retention rule yet for throttle buckets or authenticated sessions, so
  they are not cleaned. No rule was invented.

## Deployment and operational prerequisites (not code blockers)

1. **Deploy to the VPS.** Run the API, web app and worker with PostgreSQL and Redis,
   then `pnpm db:deploy`.
2. **Production database roles.** Separate runtime and migration roles. Grant the
   Owner-bootstrap privilege only to a dedicated role (`OWNER_BOOTSTRAP_DATABASE_URL`).
3. **Owner-side setup:**
   - create the real Owner with `pnpm owner:bootstrap`, only on the Owner's
     instruction;
   - run `pnpm db:permissions:sync` before any grant.
4. **Production auth keys.** Inject independent CSRF, throttle, OTP and delivery key
   rings. The worker needs the **same** delivery ring as the API.
5. **Worker email configuration.** Set `MAIL_TRANSPORT=smtp` and
   `SMTP_HOST=smtp-relay.gmail.com`, port 587, STARTTLS, sender
   `Lucy Spa <system@lucyspa.vn>`, with no SMTP credentials. The worker must run from
   the IP allowlisted on the relay. The relay was already verified manually from the
   VPS.
6. **Email authentication.** SPF and Google transport DKIM pass. Custom lucyspa.vn DKIM
   is waiting for Google activation, and DMARC alignment follows it.
7. **First real OTP email.** After deployment, send one manually as an opt-in check.

## Final result

**PHASE 1 COMPLETE — deployment prerequisites remain.**

- No application code, schema or migration changed in Step 13; only this report and
  the handoff did.
- No Owner was created.
- Nothing was deployed.
- Phase 2 has not started.
