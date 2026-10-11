# Phase 7 P7-2: cash book foundation (database, permissions, go-live)

Wave A, Step 1 of 6. Design: `docs/PHASE7_PAYROLL_FUNDS.md` (approved by the Owner on 2026-10-11, section 14). Not deployed.

## What changed

- **Permissions 68 → 73, granted to nobody:** `MANAGE_PAY_RULES`, `MANAGE_PAYROLL`, `APPROVE_PAYROLL` (GLOBAL_ONLY, EMPLOYEE_PAY) and `VIEW_CASH`, `MANAGE_CASH` (branch-capable, FINANCIAL). Catalog, SQL semantics constraint, contract names, role-screen group and VI/EN labels.
- **Migrations 109-110** (additive): `20261201000000_phase7_permission_codes` (enum values), `20261201000001_phase7_cash_foundation`:
  `finance_go_live` (one row, never moves), `reauth_uses` (a password confirmation is spent once, shared with refunds), `cash_funds`
  (one cash fund per branch, one bank fund, opening balance immutable), `fund_entries` (append-only book, category/direction rules, one
  entry per source and leg, corrections reverse one earlier entry, closed days locked), `cash_day_closings` (immutable; the guard recomputes
  the numbers from the book; the fund balance after a closing equals the next-day float).
- **API** `GET /api/v1/cash/overview`, `POST /api/v1/cash/go-live` (`apps/api/src/finance`): funds visible per branch (bank fund needs the
  permission at every active branch), go-live needs `MANAGE_CASH` at every active branch + counted opening balances for exactly the active
  branches and the bank + a fresh password; no default date; audit `FINANCE_GO_LIVE`; refund confirmations now also see `reauth_uses`.
- Contract `packages/contracts/src/cash.ts` (money as decimal strings).

## Deviations from the design (disclosed)

- The closing's count difference and the Owner's withdrawal are entries dated on the closing day, written in the closing transaction, instead of on the next open day. Same book, simpler invariant (book after closing = next-day float).
- Go-live has no `clientRequestId`: the single `finance_go_live` row is its idempotency.

## Tests

- DB integration `phase7-cash-foundation` (11) and isolation `phase7-cash-isolation` (8); API integration `finance/cash.integration` (5); catalog/role/foundation counts updated (authorization, role-admin, phase6/phase9 foundation).
- A guard bug (SQL NULL in the closing's own-entry filter) was found by the test and fixed before commit.
- `pnpm test` whole repo: database 120, server 146, worker 24, ui 489, web 929, api 353, 0 failures. lint, typecheck, `format:check` clean.
- Rehearsal on a copy of the audit database (107 → 110 migrations): 0.011 s and 0.161 s; scratch copies dropped.

## Open questions

None. The cash screens (and the Owner's go-live screen) arrive in P7-6.
