# Phase 7 Wave A milestone (P7-7): the cash book, 2026-10-11

Wave A (P7-2 .. P7-6) is built, pushed and not deployed. Code commit for the deploy: `b11c21e` (P7-6). The guide, test script and rollback proof are written; production state stays whatever `LUCYSPA_HANDOFF.md` records (`ac74013`, 108 migrations, 68 permissions).

## What the wave delivers

- Funds: one cash fund per branch and one shared bank fund, opened by the Owner's counted balances at an explicit go-live (no default date; nothing posts before it).
- An immutable book: money from payments, cash reversals, refunds and exchange refunds is posted once each from the source rows; manual in/out, staff deposits, Owner withdrawals, transfers and reversal by correction are entered by people with a reason.
- Daily count and closing (difference as its own entry, never a pay deduction; locked days; late money goes to the next day), history, reconciliation, and a large-difference alert count.
- Screens "Sổ quỹ" (direction C), 5 new permissions (68 -> 73, granted to nobody), migrations 109-110 (additive).

## Validation

| Check                                                                     | Result                                                                                                                                                         |
| ------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm format:check`, `pnpm lint`, `pnpm typecheck`                        | clean                                                                                                                                                          |
| `pnpm test` (whole repo)                                                  | database 120, server 146, worker 24, ui 489, web 947, api 354; 0 failures                                                                                      |
| `pnpm test:integration` on a fresh database                               | 151 + 23 pass (found and fixed one stale permission-count test, commit `68ea627`)                                                                              |
| `pnpm test:auth:integration` + `pnpm smoke`                               | run by CI (job limit raised to 30 minutes); see the CI line of the handoff                                                                                     |
| Migration rehearsal on a copy of the audit database (107 -> 110)          | 0.011 s and 0.121 s; users/invoices unchanged; scratch dropped                                                                                                 |
| Rollback proof (old code on the new database)                             | `docs/PHASE7_WAVE_A_ROLLBACK_PROOF.md`: delete 5 permission rows, then 168 of 168 tables readable, old API 200 on 12 reads, old worker only the known 4 errors |
| UX gate (360/768/1440 light, 1440 dark, 130% text, all states; DOM audit) | done in P7-6, 0 findings                                                                                                                                       |

## Owner decisions

None pending for Wave A. The in-app notification for a large cash difference is not built (needs a notification type and a database check change); the cash page shows the alert count and flag instead.

## Next

Wave B: P7-8 pay configuration, P7-9 earnings, P7-10 tips, P7-10b staff referral codes at checkout, P7-11 screens and My Income, P7-12..P7-15 payroll, P7-16 milestone.
