# Lucy Spa

Phase 0 project foundation. Product requirements live in [LUCY_SPA_PRD.md](LUCY_SPA_PRD.md).
No customer authentication or business workflows are implemented yet.

## Architecture

```text
apps/
  web/       Next.js App Router, Vietnamese/English shell
  api/       NestJS REST API, health, validation, OpenAPI
  worker/    BullMQ process, technical diagnostic handler only
packages/
  server/    Backend environment validation, logging, Redis options
  database/  PostgreSQL/Prisma client, migrations, outbox helper, seed
  contracts/ Public transport types, no business implementation
  ui/        Shared brand component and replaceable design tokens
  config/    Strict TypeScript configurations
scripts/     Local environment setup and package-boundary checks
```

The API and worker form a modular monolith with shared backend packages. Next.js
uses public contracts and UI only; it cannot import database/server packages.
Lint checks both dependency declarations and source imports across package boundaries.
Future business logic and server-side authorization belong in backend domain modules.

PostgreSQL is authoritative. Redis/BullMQ is technical job infrastructure and must
never hold the only copy of bookings, customer queues, balances or financial records.
There are two application tables: `branches` and `outbox_events`. Branch identity is
not tied to a single physical location. Timestamps use PostgreSQL `timestamptz`;
branch-local display will use the branch timezone.

The outbox helper requires a caller-owned Prisma transaction so a future domain write
and its event commit together. It does not publish jobs in Phase 0. A later dispatcher
must support retries, concurrent claiming and idempotent consumers before handling
business events; delivery must be treated as at least once. Outbox records are retained.
Future financial/operational corrections use adjustments, voids or reversals.

Loyalty points **never expire**, have no annual reset or rolling expiration, and their
ledger history must be preserved. PRD sections 18.3/60 and the Owner's explicit
instruction govern; stale expiry references elsewhere in the PRD are not implemented.

## Prerequisites

- Node.js 24.20+ on the 24.x line; pnpm 12.4.2 (pinned in `package.json`).
- Docker Engine with Docker Compose; Windows users can use Docker Desktop/WSL2.
- Git. Run the project from one environment consistently (Windows or WSL).

Verify `node --version`, `pnpm --version`, `docker version` and `docker compose version`.
If a terminal uses stale version-manager shims, reopen it after installation and ensure
the installed Node/pnpm/Docker executables are on PATH. No global tools are installed by
project scripts. In a restricted automation sandbox, NVM may deny delegated commands;
run authorized project checks in an environment that can access the installed toolchain.

## Local setup

Run from the repository root:

```sh
pnpm install --frozen-lockfile
pnpm env:init
pnpm infra:up
pnpm db:generate
pnpm db:deploy
pnpm dev
```

`env:init` creates an ignored root `.env` from `.env.example` with random local database
and Redis passwords. It refuses to overwrite an existing file and prints no credentials.
The template intentionally has blank secrets. Never reuse these local credentials in
production. Do not commit `.env`. API/worker/Prisma load the root `.env`; the web app
does not load backend secrets. Inject environment variables through the runtime in a
future deployment. Explicit process environment values take precedence.

Local services bind to loopback only and keep data in named Docker volumes. `infra:down`
stops/removes containers while preserving volumes. Existing PostgreSQL volumes retain
their original credentials: editing `.env` alone does not rotate a database password.
Do not remove volumes unless their data is intentionally disposable.

| Setting                                                              | Purpose                                                         |
| -------------------------------------------------------------------- | --------------------------------------------------------------- |
| `DATABASE_URL`                                                       | PostgreSQL connection for API, worker and Prisma                |
| `POSTGRES_USER`, `POSTGRES_DB`, `POSTGRES_PASSWORD`, `POSTGRES_PORT` | Local Compose database initialization/binding                   |
| `REDIS_URL`                                                          | Redis connection, `redis://` or TLS `rediss://`                 |
| `REDIS_PASSWORD`, `REDIS_PORT`                                       | Local Compose Redis authentication/binding                      |
| `API_HOST`, `API_PORT`                                               | API listen address; default `127.0.0.1:3001`                    |
| `WEB_ORIGIN`                                                         | Exact allowed browser origin; default `http://localhost:3000`   |
| `NODE_ENV`, `LOG_LEVEL`                                              | Runtime mode and structured log verbosity                       |
| `SWAGGER_ENABLED`                                                    | Explicit `true`/`false`; defaults off in production when absent |
| `DEV_SEED_BRANCH_CODE`, `DEV_SEED_BRANCH_NAME`                       | Optional development branch seed                                |

If changing local ports, also update the corresponding connection URL in `.env`.
Never expose connection URLs through `NEXT_PUBLIC_*` variables.

## Development and verification

| Command                                             | Result                                                              |
| --------------------------------------------------- | ------------------------------------------------------------------- |
| `pnpm dev`                                          | Build shared packages, then watch all three apps                    |
| `pnpm dev:web` / `pnpm dev:api` / `pnpm dev:worker` | Run an individual app                                               |
| `pnpm build:server`                                 | Generate Prisma and compile shared packages                         |
| `pnpm format` / `pnpm format:check`                 | Format/check project files; PRD excluded                            |
| `pnpm lint`                                         | ESLint and package boundaries                                       |
| `pnpm typecheck`                                    | All strict TypeScript checks, including Next route types            |
| `pnpm test`                                         | Unit and HTTP API tests; no live infrastructure needed              |
| `pnpm test:integration`                             | Real PostgreSQL constraints and transaction/outbox rollback         |
| `pnpm build`                                        | All packages and production application builds                      |
| `pnpm check`                                        | Formatting, lint, types, tests and builds                           |
| `pnpm smoke:worker`                                 | Explicit BullMQ round trip; start worker first                      |
| `pnpm smoke`                                        | Start built apps on temporary ports; test web/API/BullMQ; stop them |
| `pnpm infra:status`                                 | Container health/status                                             |

App source changes are watched. Shared backend package changes require
`pnpm build:server` and an app restart. UI source is transpiled by Next.js.

- Web: <http://localhost:3000> redirects to `/vi`; `/en` is English.
- Web liveness: <http://localhost:3000/health> (no database access).
- API liveness: <http://127.0.0.1:3001/health/live>.
- API readiness: <http://127.0.0.1:3001/health/ready> checks PostgreSQL and Redis;
  reports HTTP 503 when a dependency is unavailable.
- Development Swagger: <http://127.0.0.1:3001/docs>.
- OpenAPI JSON: <http://127.0.0.1:3001/openapi.json>.

For built applications, use `pnpm --filter @lucy-spa/api start`,
`pnpm --filter @lucy-spa/worker start`, and `pnpm --filter @lucy-spa/web start`
in separate terminals. Logs are JSON with request IDs and redacted sensitive fields.
The worker handles only a `ping` on the technical `system-check` queue; unknown jobs
fail explicitly. It sends no emails or notifications and dispatches no domain events.

## Database workflow

```sh
pnpm db:validate
pnpm db:deploy                    # Apply reviewed migrations to a configured database
pnpm db:status
pnpm db:migrate --name change_name # Develop a new migration on a local development DB
pnpm db:generate                  # Regenerate after schema edits
```

Review generated SQL and include it in the eventual reviewed commit. Prisma's development
migration command uses a shadow database; the local Compose role can create it. Future
deployment migration credentials must be separate from least-privilege application
credentials. Do not use `db push` or migration reset against valuable data.

Seeding is explicit: set both `DEV_SEED_BRANCH_CODE` and `DEV_SEED_BRANCH_NAME` in the
local `.env`, keep `NODE_ENV=development`, then run `pnpm db:seed`. Without both values,
the seed safely skips. Existing branches are never overwritten. No Owner, user,
credentials, prices or business settings are seeded. Integration fixtures are rolled
back inside transactions and leave no persisted business data.

## CI and remaining scope

GitHub Actions installs the frozen lockfile, checks formatting/lint/types/tests/build,
and validates migrations, integration tests and application startup against PostgreSQL/Redis. No deployment
is configured. Optional dependency telemetry and native acceleration build scripts are
explicitly disabled in the workspace build policy.

This is a production-oriented foundation, not a launch-ready deployment. Authentication,
RBAC/Owner protection, audit domain, business modules, real job processors, outbox
dispatch, production backup/restore, deployment and monitoring belong to later phases.
Before Phase 1, Owner input is needed for the initial Owner bootstrap identity and
the email provider/sending domain and test-delivery arrangement. Final branding can wait.
Do not begin Phase 1 without explicit review approval.
