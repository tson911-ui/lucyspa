# Phase 7 P7-3: posting the money sources into the cash book

Wave A, Step 2 of 6. Design: `docs/PHASE7_PAYROLL_FUNDS.md` sections 7.2-7.3 (P7-T8). Not deployed. No migration (the tables are P7-2).

## What changed

- `packages/server/src/cash-posting.ts`: `postCashSources` writes one book entry per money source and `countUnposted` says what the book still misses.
  Sources: a succeeded cash payment (cash fund of its branch, IN `SALE_CASH`), a succeeded PayOS payment (bank fund, IN `SALE_BANK`), a cash
  reversal (`PaymentCorrection`, OUT `PAYMENT_REVERSAL`), a product refund (cash or manual transfer; a failed-delivery refund is
  `FAILED_DELIVERY_REFUND`), and the part of an exchange the shop hands back (`EXCHANGE_DIFFERENCE`). What a customer pays MORE on an exchange is
  a payment of the exchange invoice and posts as a payment.
- Idempotent: `UNIQUE(source_type, source_id, source_leg)` plus `ON CONFLICT DO NOTHING`; nothing before the go-live instant, nothing while
  `finance_go_live` is empty; a branch added later gets its cash fund (opening 0) on the first pass; a day that is already closed takes
  nothing (the entry is dated the day after the last closing); every pass first takes a shared lock on the funds, so it waits for a closing.
- Worker `cash-jobs.ts`: a pass every 4 s over the last 3 days, a full pass every 6 h.
- `Prisma` is now exported as a value from `@lucy-spa/database` (raw SQL fragments); `testing/confirm-again.ts` gives tests a new password confirmation.

## Deviation from the design (disclosed)

- Design 7.3 said "outbox consumer". Exchanges and failed-delivery settlements publish no event, so the poster reads the source rows themselves
  (the same query the closing's preflight uses). Same guarantee (idempotent, `UNIQUE(source)`), no missed source, no dependence on event names.

## Tests

- API integration `finance/cash-posting` (11): go-live gate, pre-go-live payments never posted, cash payment, window vs full pass, cash reversal,
  cash and transfer refund, exchange difference, PayOS to the bank, a late branch, "the book equals the sources". Rolled back fixtures.
- Whole repo `pnpm test`, lint, typecheck, format clean (see the P7-4 commit). Not covered here: two workers racing (covered by the unique key; closing vs poster race in P7-5).

## Open questions

None.
