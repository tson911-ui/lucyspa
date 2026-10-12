# Phase 8 P8-2: report foundation (Wave A)

Design: `docs/PHASE8_REPORTS.md` (Owner answers in section 13). Not deployed.

## What changed

- **Four permissions, 73 → 77, granted to nobody** (migrations `20261210000000` enum values, `20261210000001` catalog semantics check):
  `EXPORT_REPORTS` (branch, FINANCIAL), `VIEW_STAFF_REPORTS` (branch), `VIEW_PROFIT` (**GLOBAL_ONLY**, FINANCIAL), `VIEW_REVIEWS` (branch).
  The design said each wave adds only its own code; one combined deploy makes that pointless, so all four arrive now (inert until their
  reports exist). Catalog, contracts type, role-admin group and descriptions (vi/en), and every count assertion were updated.
- **`SessionService.withReadOnlyTransaction`**: `REPEATABLE READ READ ONLY` + `statement_timeout` + the shared graph lock. One snapshot,
  so the parts of a report add up to its total while payments arrive; the database itself refuses a write (P8-T1).
- **`apps/api/src/reports/`**: `report.frame.ts` (`runReport`: principal, authority graph, `scope(requires, branchId?)` = branches where
  EVERY permission holds, a filter can only narrow, none = FORBIDDEN, statement timeout → `REPORT_TIMEOUT`), `report.dates.ts`
  (branch business dates, ≤ 366 days, previous period, Monday weeks, buckets), `reports.service.ts` + `GET /api/v1/reports` (the registry
  that drives the menu). No row lock is taken (the admin command frame locks the actor's user row and would serialise a dashboard's widgets).
- **`packages/contracts/src/reports.ts`**: the report catalogue (`REPORT_DEFINITIONS`: id, area, wave, required permissions, column
  permissions, export re-auth), `REPORT_LIMITS` (366 days, 100,000 rows, 2 files at once, 5/15/60 s), shared types.
- New error codes `REPORT_*`, `EXPORT_BUSY`. Fixture adapter gets `withReadOnlyTransaction` (savepoint + `transaction_read_only`).
- `scripts/test-phase8-integration.mjs`: a fourth integration process (heap), added to `apps/api` `test:integration`.

## Findings that correct the design (small)

- `VIEW_PRODUCT_COST` is **GLOBAL_ONLY**, not branch-capable (design section 7 table said branch): stock value reports need it globally.
- The registry shows `exportable` only where `EXPORT_REPORTS` holds at a covered branch.

## Tests (all green)

- Unit: `report.dates.test.ts` (leap day, year end, Monday weeks, buckets, 366 limit), `report-registry.test.ts` (unique ids, known
  permissions, pay/profit reports ask for the password on export, limits, the four codes).
- Integration on a fresh scratch DB (`lucy_spa_p8_scratch`, 120 migrations): `reports.integration.test.ts` (7 tests: registry by permission
  and branch, scope narrowing, a write inside a report fails in the database, statement timeout → `REPORT_TIMEOUT`, the production
  frame really is `read only` / `repeatable read` / timeout); `authorization`, `role-admin` and the three database foundation suites at 77.
- `pnpm lint`, `pnpm typecheck`, `pnpm format:check`, whole-repo `pnpm test`.

## Deferred inside Wave A (recorded, not skipped)

- The **performance fixture and the EXPLAIN-proven index migration** move to the start of P8-3: they need the real revenue queries to
  prove anything, and the revenue module is P8-3.

## Open questions

None for the Owner. The Owner's standing rule applies: anything that changes what staff or customers see or do is raised first; this Step
changes nothing visible (the only new menu entries come with the screens in P8-5).
