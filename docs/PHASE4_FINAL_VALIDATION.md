# Phase 4 Step 11: Final Validation

Status: **Step 11 and Phase 4 CLOSED / OWNER APPROVED.** Technical gate PASS on a scratch database. Not deployed.
The scratch database was dropped after approval.
Baseline `233be96` (Step 10). Windows, Node 24.20.0, pnpm 12.4.2, PostgreSQL 17.11, local Redis.
Scratch DB `lucy_spa_step11_validation_20260930` (new, all 35 migrations). `lucy_spa_dev` and production untouched.
Logs/ledger: ignored `.local/phase4-step11/` (`commands.jsonl`).

## Results

| Gate                                                                     | Result                                                              |
| ------------------------------------------------------------------------ | ------------------------------------------------------------------- |
| `db:deploy` / `db:validate` / `permissions:sync` / `db:status`           | PASS (35 migrations, schema up to date)                             |
| Prisma diff                                                              | only the 2 known composite-FK limitations; nothing from Phase 4     |
| `format:check` (after fix), `lint` + boundaries, `typecheck`             | PASS                                                                |
| `pnpm test` (unit): server 29, web 188, worker 25, API 167               | PASS 409 (+62 API integration containers opt-in, run below)         |
| Build (packages, api, worker); web `typecheck` + production build        | PASS (65 pages); web ran in an isolated copy (see below)            |
| `pnpm test:integration` (database 66 + races 5)                          | PASS 71                                                             |
| `pnpm test:auth:integration` (API/auth, 68 files)                        | PASS 425                                                            |
| Worker integration (real Redis)                                          | PASS 10                                                             |
| Opt-in races `leave-consumer.race`, `invoice-notifications.race`         | PASS 2 (`NOTIFICATION_RACE_DATABASE_URL` = scratch superuser DB)    |
| `pnpm smoke` (web start, API/DB/Redis ready, OpenAPI, BullMQ round trip) | PASS after the smoke fix below; run from an isolated workspace copy |

Total 917 tests passed, 0 failed. `apps/web/next-env.d.ts` untouched (hash `ce4e94a`, identical to HEAD).

## Defects fixed (2, both gate-side, no product code or migration changed)

1. `scripts/smoke.mjs`: asserted the OpenAPI had exactly 3 paths (stale since Phase 1; the API documents 150+ routes).
   Now asserts key routes exist (auth context, `pos/invoices/{id}`, `webhooks/payos`, health).
2. Prettier drift in `packages/contracts/src/index.ts` and `LUCYSPA_HANDOFF.md` (formatting only).

## Notes (not defects)

- Web `typecheck`/`build` regenerate `next-env.d.ts`, so they ran in an isolated copy (`.local/.../workspace`); smoke ran the
  unmodified `smoke.mjs` there against the fresh build (real `apps/web/.next` is a stale earlier build).
- First web build failed only because my runner leaked `NODE_ENV=development` from `.env`; rerun clean passed.
- The worker logged `Invoice notification job failed` during smoke: one orphan `REVENUE_SUMMARY_DUE` left by the opt-in race
  test (its branch was deleted by that test's cleanup). Test residue in the scratch DB, not a product path.
- Known time-of-day flakes (`My Income` 15-17 UTC; worker Step 9 Redis-loss tests 17-24 UTC): not triggered (run ~06-08 UTC).
- Not done: no live PayOS call; no browser click-through or visual review (rendering/state tests, production build and HTTP smoke only).
- Prisma diff exits 2 (pnpm shows 1) because of the known composite-FK limitation; Step 11 adds no migration.

## Deployment checklist (Owner-triggered only)

1. Verified backup of the production database. Production is at `97e0485` with 25 migrations.
2. Deploy the code from the approved commit; install with the lockfile.
3. `pnpm db:deploy`: applies 10 pending migrations `20261013000000` to `20261017000000` (additive; never reset or `db push`).
4. `pnpm db:permissions:sync`: registers the 9 financial permission codes; inert until the Owner grants them.
5. Env for API **and** worker: `PAYOS_CLIENT_ID`, `PAYOS_API_KEY`, `PAYOS_CHECKSUM_KEY`. Without them PayOS stays disabled
   (cash still works). Confirm `MAIL_TRANSPORT` is unchanged and `SWAGGER_ENABLED` matches the Owner's intent.
6. Register the webhook `<public API origin>/api/v1/webhooks/payos` in the PayOS dashboard (signed; exempt from CSRF/session only there).
7. Rebuild and restart API, Web, Worker (worker starts the `notifications` consumer and the 21:30 branch-local summary scheduler).
8. Owner grants `COLLECT_PAYMENTS` + `VIEW_INVOICES` (and `CORRECT_PAYMENTS`, `CANCEL_INVOICES`, `VIEW_REVENUE`, `MANAGE_INVOICES`,
   discount/price permissions as wanted) through roles; nothing is seeded.
9. Owner sets the quantity limit of each `PER_NAIL` service (defaults to 1 until set) and creates discounts/vouchers.
10. Post-deploy checks: `/health/ready`, VI/EN pages, then one real small PayOS payment end to end (webhook, invoice PAID,
    notifications). Do not commit `apps/web/next-env.d.ts` if the server build regenerates it.
11. Rollback plan: code rollback is safe (migrations additive); restore data only from the backup.

## Files changed

`scripts/smoke.mjs`, `packages/contracts/src/index.ts` (format), `LUCYSPA_HANDOFF.md`, this report. Open questions: none.
