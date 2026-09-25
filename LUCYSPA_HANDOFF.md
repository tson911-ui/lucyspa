# Lucy Spa handoff

## Start here: next fresh agent/session

1. Read **all of [LUCY_SPA_PRD.md](LUCY_SPA_PRD.md)**, this handoff, and [README.md](README.md).
   The current PRD is authoritative for product requirements; change it only with
   explicit Owner authorization. Use its current locked rules, including the two
   independent, non-expiring loyalty wallets summarized below.
2. Inspect `git status`, `git log`, `git diff`, the repository, and existing untracked
   files before changing anything. Preserve completed work; do not scaffold again.
3. Check the latest user authorization and relevant runtime state. Reuse verified
   results below when code is unchanged; rerun checks affected by changes or failures.
4. Phase 1 Step 2 has been reviewed, its migration applied to the approved local
   database, and post-migration checks passed. Step 3 runtime foundation is committed
   and pushed (`a68f66a`); see the [Step 3 report](docs/PHASE1_STEP3_AUTH_RUNTIME.md).
   Step 4 customer registration/email OTP is committed and pushed (`bff1ddc`); see the
   [Step 4 report](docs/PHASE1_STEP4_REGISTRATION.md). Step 5 customer login/logout is
   committed and pushed (`2c3d0c2`); see the
   [Step 5 report](docs/PHASE1_STEP5_LOGIN_LOGOUT.md). Step 6 customer password reset is
   committed and pushed (`a89d147`); see the
   [Step 6 report](docs/PHASE1_STEP6_PASSWORD_RESET.md). Step 7 permission engine and
   catalog is committed and pushed (`5b67b37`); see the
   [Step 7 report](docs/PHASE1_STEP7_PERMISSION_ENGINE.md). Step 8 Owner bootstrap and
   workforce authentication is implemented and awaiting review; read the
   [Step 8 report](docs/PHASE1_STEP8_OWNER_WORKFORCE_AUTH.md).
   Do not change Git remotes, expose secrets or
   install unrelated system software without authorization.

## Current phase and Git state

- **Phase 0: PASS, committed and pushed. Phase 1 Step 1 design is complete.
  Step 2 is reviewed, applied to the local database and verified PASS.
  Step 3 runtime foundation is committed and pushed (`a68f66a`). Step 4 customer
  registration/email OTP is committed and pushed (`bff1ddc`). Step 5 customer
  login/logout is committed and pushed (`2c3d0c2`). Step 6 customer password reset is
  committed and pushed (`a89d147`). Step 7 permission engine/catalog is committed and
  pushed (`5b67b37`). Step 8 Owner bootstrap/workforce authentication is implemented,
  locally validated, uncommitted and awaiting review.**
  The [Step 3 report](docs/PHASE1_STEP3_AUTH_RUNTIME.md) and
  [Step 4 report](docs/PHASE1_STEP4_REGISTRATION.md) and
  [Step 5 report](docs/PHASE1_STEP5_LOGIN_LOGOUT.md) and
  [Step 6 report](docs/PHASE1_STEP6_PASSWORD_RESET.md) and
  [Step 7 report](docs/PHASE1_STEP7_PERMISSION_ENGINE.md) and
  [Step 8 report](docs/PHASE1_STEP8_OWNER_WORKFORCE_AUTH.md) and
  [Step 9 report](docs/PHASE1_STEP9_WORKFORCE_RECOVERY.md) and
  [Step 10 report](docs/PHASE1_STEP10_EMPLOYEE_LIFECYCLE.md) and
  [Step 11 report](docs/PHASE1_STEP11_ROLE_ADMIN_AUDIT_READ.md) and
  [Step 12 report](docs/PHASE1_STEP12_EMAIL_DISPATCH_CLEANUP.md) and
  [Step 13 completion gate](docs/PHASE1_STEP13_COMPLETION_GATE.md) record scope and validation.
  Validation results and remaining production privilege
  prerequisites are recorded in the [Step 2 report](docs/PHASE1_STEP2_DATABASE.md).
- This handoff accompanies the Step 2 commit
  `feat: add phase1 auth database foundation` on `main`. Its baseline was `f793433`
  (`docs: finalize loyalty requirements and phase1 auth design`). Inspect current
  Git status/log and remote state instead of treating that baseline as the latest
  commit. The Owner explicitly authorized committing and pushing the seven Step 2
  files; the generated web file is excluded.
- [Phase 1 auth/security design](docs/PHASE1_AUTH_SECURITY_DESIGN.md) is the committed,
  approved Step 1 artifact and remains unchanged by Step 2.
- The pre-existing `apps/web/next-env.d.ts` diff changes two generated type imports
  from `.next/types/` to `.next/dev/types/`. It was previously identified as automatic
  Next.js development output and is preserved untouched; it is not Phase 1 work.
- The Step 2 changes add only the database schema/migration, constraint integration
  tests and supporting documentation. No accounts or other data are seeded, no
  runtime authentication endpoints are implemented, and the PRD remains unchanged.
- This status supersedes older Step 2 authorization wording below. Historical
  Phase 0 verification and infrastructure notes remain for context; they are not
  the current database inventory. Both Phase 0 and Step 2 migrations are now applied
  locally, with matching checksums and no failed or pending migrations.

## Architecture and structure

pnpm 12.4.2 workspace, strict TypeScript 5.9.3, Node.js 24.20.0; production-oriented
modular monolith with separate web, API and worker processes.

```text
apps/web        Next.js 16.3.5 / React 19.3; /vi, /en shell and /health
apps/api        NestJS 11; REST, validation, safe errors, JSON logs, health/OpenAPI
apps/worker     BullMQ; technical system-check/ping handler only
packages/server Backend configuration validation, logging, Redis options
packages/database Prisma 7.10 / PostgreSQL, migration, outbox helper, optional seed
packages/contracts Public transport types
packages/ui     Shared brand component and replaceable design tokens
packages/config Shared strict TypeScript configuration
scripts/        Environment setup, package-boundary checks, runtime smoke checks
.github/workflows/ci.yml  Install/check/build/integration/smoke; no deployment
```

- Next.js/UI must not access the database or import backend packages. Backend/domain
  services own business logic and authorization; lint enforces package boundaries.
- PostgreSQL is authoritative. Redis is technical queue/cache infrastructure, never
  the sole store for customer queues, bookings, balances, ledgers or inventory.
- Preserve multi-branch identity and scope. Use transactions and idempotency for
  critical writes; preserve historical snapshots and adjustment/reversal history.
- Outbox writes use the originating Prisma transaction. Publication is deferred;
  future dispatch requires retry/concurrency handling and idempotent consumers.
- API development uses `tsc-watch` to preserve decorator metadata. Shared backend
  changes require rebuilding/restarting apps; see README commands.

## Infrastructure and database

The following records the previous 2026-09-16/17 verification, not a new runtime or
environment check. No services, migrations, seeds or `.env` inspection were run
during the current documentation update.

- Previous runtime verification: Docker Engine 29.8.0 / Compose 5.5.1; PostgreSQL
  `17-alpine` and Redis `7.4-alpine` both healthy. Loopback ports: 5432 and 6379.
- Named volumes preserve data. Redis uses AOF and `noeviction`. Docker stopped
  between interrupted sessions; restoring the Engine/services resolved connection
  failures. Verify availability when needed; do not reset databases or delete volumes.
- Migration `20260916000000_phase0_foundation` applied; migration status up to date.
  Application tables: **`branches` and `outbox_events` only**, plus Prisma migration
  metadata. Branch uses UUID identity and `Asia/Ho_Chi_Minh` timezone; timestamps use
  `timestamptz`. Outbox branch FK is restrictive; no automatic history deletion.
- Root `.env` already exists, is ignored, and contains generated local credentials.
  Do not print or overwrite it. `.env.example` contains no secrets.
- Optional development branch seed safely skipped because no branch was requested.
  No Owner/users/business settings were seeded; integration fixtures rolled back.
- Temporary smoke-test app processes were stopped; use `pnpm dev` for local review.

## Previously verified Phase 0 results

These results were recorded during the 2026-09-16/17 verification and have not been
rerun for this documentation-only update.

| Validation                                                        | Result                                                                                |
| ----------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| `pnpm install --frozen-lockfile`                                  | PASS                                                                                  |
| `pnpm format:check`; `pnpm lint` including boundaries             | PASS                                                                                  |
| Applicable workspace typecheck/build scripts                      | PASS, including Next production build                                                 |
| API/server/worker test scripts                                    | 12 passed: 7 API, 4 server, 1 worker                                                  |
| Prisma generation, validation, migration deploy/status            | PASS                                                                                  |
| `node --test packages/database/dist/database.integration.test.js` | 3 passed: transaction guard, multi-branch/outbox rollback, FK rollback                |
| `node scripts/smoke.mjs`                                          | PASS: localized web/404s, API readiness, PostgreSQL/Redis, OpenAPI, BullMQ round trip |
| Git whitespace and credential-file review                         | PASS; no local credentials in the 72 implementation files                             |

Checks completed across interrupted sessions, not one uninterrupted `pnpm check` run.
The subsequent pushed Phase 0 commit also had a successful GitHub Actions run,
[run 35068715168](https://github.com/tson911-ui/lucyspa/actions/runs/35068715168),
verified earlier in the conversation; its current remote status was not rechecked here.
Root commands `pnpm check`, `pnpm test:integration`, and `pnpm smoke` remain the
documented verification entry points. Do not repeat expensive unchanged checks solely
because a new session starts.

## Known non-blocking limitations

- No new runtime or CI verification was needed or performed for this documentation update.
- Transitive `cron-parser@4.9.0` emits a deprecation warning.
- No business jobs, outbox dispatcher, production deployment, backup/restore setup
  or launch hardening yet; these remain later-phase work.
- Windows automation encountered stale PATH/NVM sandbox restrictions. Existing tools
  worked with process-local PATH and approved execution outside the sandbox; no
  system software/configuration changes were needed. Do not reinstall tools blindly.
- Earlier duplicate pnpm build-policy entries, Windows script quoting, and Prisma
  transaction-guard issues were fixed. Inspect current files before diagnosing old errors.

## Locked requirements: do not violate

- Multi-branch from V1; never hard-code the first branch as the only branch.
- Hours: 09:00–21:00, no lunch break; ultimately configurable by branch.
- Financial/operational history is preserved; corrections use valid adjustments,
  voids or reversals. No destructive ledger deletion or retroactive recalculation.
- Service/combo refunds are not allowed. Combos currently have no expiry.
- **Spa Points and Beauty Points are separate wallets:** no transfer, merging or
  conversion to cash or partial invoice payment. Both never expire or reset;
  preserve complete ledger history. Spa Points cover eligible services/combos;
  Beauty Points cover eligible cosmetics. Award whole points after successful
  payment at 1 point per 1,000 VND eligible amount actually paid after discounts
  and vouchers; tips are excluded and the same spend must not earn twice.
  Mixed-invoice allocation and fractional remainders remain unspecified; do not invent them.
- Each wallet independently uses its current valid balance for membership tiers:
  0–499: no member discount; Silver 500–999: 3%; Gold 1,000–2,999: 4%;
  Platinum 3,000–4,999: 5%; Diamond 5,000–9,999: 7%; Ruby 10,000+: 9%.
  Member discounts spend zero points and use the tier before the transaction.
- Ordinary promotions and member discounts do not stack. Automatically apply the
  financially better eligible benefit and show staff which benefit was selected.
- Birthday benefits are Owner-configured by type, value, eligibility, scope,
  conditions and stacking; there is no automatic birthday point multiplier. If a fixed
  birthday voucher is configured to stack with membership, apply the member
  discount first, then the voucher, then calculate points. A 50,000 VND voucher is
  an example, not a default.
- Referral reward is fixed: referrer A receives **10 Spa Points AND 10 Beauty Points**
  once when genuinely new customer B completes successful registration, the first
  qualifying spa service visit and payment of the first qualifying transaction.
  Invoice value does not change this reward. Never claw back A's referral bonus if
  B's transaction is later refunded/reversed. Phone identifies the permanent referrer.
- Eligible combo purchases may receive the Spa member discount even when bonus
  sessions are included. Earn Spa Points once on the paid purchase; session use
  earns zero additional points. Newly paid extras follow normal earning rules.
- Preserve the existing product-return policies. For a fault exchange, a replacement
  with higher relevant value earns Beauty Points only on the eligible additional
  paid/value difference; same/lower relevant values preserve original points without duplicate earning
  or reduction. A true refund reverses attributable purchase points through ledger
  adjustments and may lower the tier; the referrer's fixed bonus remains protected.
- Free bonus-combo/reward/gift services generate no KTV tour compensation.
- KTV cannot set arbitrary service/product prices. Enforce permissions, branch scope
  and sole-Owner protections server-side; hiding UI controls is insufficient.
- Product importer requires staging/review and must never automatically overwrite
  Lucy Spa prices, stock or commission. Do not invent Future/TBD policies.

## Exact next step and Owner inputs

**PHASE 1 COMPLETE — deployment prerequisites remain** (see the
[Step 13 completion gate](docs/PHASE1_STEP13_COMPLETION_GATE.md)). Steps 1–12 are committed
through `93b2316`; the Step 13 gate report awaits approval. Do not start Phase 2 or deploy
without separate authorization. Deployment prerequisites (VPS deployment, production DB
roles/keys, Owner bootstrap, permission sync, worker SMTP configuration, custom DKIM/DMARC)
are listed in the gate report. Carried-forward non-blocking decision: the foreground
idle-activity policy (Step 8).
No real Owner exists; create it only on explicit Owner instruction with
`pnpm owner:bootstrap` (password via hidden prompt/stdin only).
Approved remaining plan: Step 8 Owner bootstrap (interactive/stdin password) + workforce
authentication; Step 9 workforce recovery; Step 10 employee lifecycle; Step 11 role/
permission administration + audit read; Step 12 email dispatch/cleanup (provider
deferred); Step 13 Phase 1 completion gate. Run `pnpm db:permissions:sync` explicitly
(operator command, never on startup) before any grant can be created.
Workforce password recovery and recovery-email verification are implemented (Step 9).
Employee creation, profile, status, branch scope, base salary and setup issuance/completion
are implemented (Step 10). Role, assignment, override administration and scoped audit
read are implemented (Step 11).
Locally, run `pnpm auth:env:init` once to append the OTP and delivery key rings
(existing keys are kept). OTP email is sent by the worker (Step 12) through the Google
Workspace SMTP relay (`smtp-relay.gmail.com:587`, STARTTLS, no SMTP AUTH, IP-allowlisted
VPS) as `Lucy Spa <system@lucyspa.vn>` when `MAIL_TRANSPORT=smtp`; see `.env.example`.
Custom lucyspa.vn DKIM and DMARC alignment are pending external Google/DNS activation.
The configured local database has both Phase 0 and Step 2
migrations applied. No Phase 1 implementation scope remains. Extend the existing architecture only
when authorized; the locked loyalty/combo/promotion rules remain later-phase
requirements, not permission to implement them now.

Important inputs before relevant Phase 1 work:

- Initial Owner identity/contact and secure bootstrap credential-provisioning arrangement.
- Email provider, verified sending domain/address, and test-delivery arrangement;
  obtain credentials securely when needed, never through committed files.
- Initial branch name/code and staff scope if creating real branch/employee records.

Later-phase inputs remain unresolved: final branding/service data, configured reward
catalog items/thresholds, birthday benefit configuration, campaign-specific eligibility
and values, mixed-invoice point allocation and fractional-remainder handling,
tour/salary/commission rates, product prices/stock, payment credentials, hosting/storage,
and Future/TBD shipping/tax/integration policies. The fixed referral formula and ordinary
promotion/member-discount selection rule are now resolved. Missing inputs are not
permission to invent defaults or expand Phase 1 scope.
