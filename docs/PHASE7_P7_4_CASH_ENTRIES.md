# Phase 7 P7-4: manual thu/chi, deposits, withdrawals, transfers, the book

Wave A, Step 3 of 6. Design: `docs/PHASE7_PAYROLL_FUNDS.md` sections 7.1, 7.2, 9. Not deployed. No migration.

## What changed

- API (`apps/api/src/finance/cash-entries.core.ts`, `cash.controller.ts`, `cash.service.ts`):
  - `POST /api/v1/cash/entries` records `MANUAL_INCOME`, `MANUAL_EXPENSE`, `DEPOSIT` or `OWNER_WITHDRAWAL`; amount (integer VND string, no zero) and reason (1-500)
    always required; `MANAGE_CASH` at the fund's branch (the bank fund: at every active branch, and a branch must be named for the entry); a
    deposit is also open to `COLLECT_PAYMENTS`, never to the bank; a withdrawal needs a fresh password (spent once, `reauth_uses`).
  - `POST /api/v1/cash/entries/:id/reverse`: a manual entry is reversed once by a `CORRECTION` entry (reason required); posted entries follow their
    source and cannot be reversed by hand.
  - `POST /api/v1/cash/transfers`: two linked entries (OUT then IN) between a cash fund and the bank, `MANAGE_CASH` on both, fresh password.
  - `GET /api/v1/cash/funds/:id/entries`: 20 per page, newest day first, filters (dates, category, direction), totals of the filter, the invoice/refund/exchange code
    of posted entries, what the person may do.
- Rules: nothing before go-live (`FINANCE_NOT_LIVE`); a manual payment never takes a cash fund below zero (`CASH_INSUFFICIENT`); `clientRequestId`
  replays return the same entry (a changed replay is `CONFLICT`); a closed day takes nothing, the entry goes to the first open day; every write is
  audited (`CASH_ENTRY_RECORDED`, `CASH_ENTRY_REVERSED`, `CASH_TRANSFER`, FINANCIAL). Manual OUT and transfers lock the fund FOR UPDATE, so the balance check is exact.
- Three error codes (`CASH_INSUFFICIENT`, `CASH_ENTRY_NOT_REVERSIBLE`, plus the P7-2 ones); contract additions in `packages/contracts/src/cash.ts`.

## Tests

- API integration `finance/cash-entries` (11) and HTTP `finance/cash.http` (guards, exact fields, verbs, stable codes). All the new suites are listed in `scripts/test-auth-integration.mjs`.
- CI fix found on the way: the Phase 4 permission foundation database test now knows the Phase 7 codes (commit `68ea627`).
- Run before this commit: whole-repo `pnpm test`, lint, typecheck, `format:check`, database `test:integration` on a fresh database.

## Open questions

None.
