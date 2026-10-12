# Phase 8 (reports) milestone: P8-6, P8-11, P8-15 and P8-18 in one (2026-10-12)

Owner chose ONE combined deploy of Waves A-D (OQ-P8-10), so the wave milestones are folded into this one. **Built and pushed, NOT deployed.** Code commit to deploy: `06badcf1ab922c4240f67f1c43481f9d9ce549f4` (CI green, run 324). Production today: `d42ab4e` (118 migrations, 73 permissions).

## What is in it

- **A** revenue (one SQL definition: collected minus given back, online on the delivery day), refunds, export engine (xlsx/csv, audit row, re-auth for pay and profit files, 100,000-row cap), dashboard revenue widget. **B** sales detail, customers, booking funnel, loyalty, staff facts, stock (best, low, slow, expiry, value with cost coverage, movements, receipts), three widgets. **C** cash, tips, payroll, labour cost, advances, provisional profit (Owner only, whole shop), audit-log screen, two widgets. **D** private customer reviews and the staff report.
- Migrations 119-122 (all additive): 4 permissions (73 to 77, granted to nobody), 2 report indexes, 2 empty review tables with database guards. No other data change; reports only read.
- Docs per step: `PHASE8_REPORTS.md` (design and the Owner's answers), `PHASE8_P8_2..P8_5`, `P8_7_TO_P8_9_APIS`, `P8_10_SCREENS`, `P8_12_P8_13_MONEY`, `P8_14_MONEY_SCREENS`, `P8_16_P8_17_REVIEWS`.

## Validation (all on this machine)

- `pnpm check` (format, root lint, typecheck, whole-repo tests, build): green. CI runs 321-324 green on every push since the lint fix (run 320 was the one red: test helpers missed the `cause` lint rule; fixed in the next commit).
- Full integration on a FRESH scratch database, all four processes: auth 627 (one walk-in race test hit a statement timeout once under load and passed alone; it is not a Phase 8 test), product 394, phase 7 95, phase 8 78: 0 failures. `pnpm smoke` passed.
- Performance on the 164,400-invoice fixture, 366 days, p95 (target 2 s; with comparison 4 s): revenue 1.7 s, with previous period 3.4 s, services 1.5 s, products 1.4 s, staff 1.5 s, labour cost 1.7 s, everything else under 1.3 s (`.local/p8/bench-final.txt`). The review report was not benchmarked (small tables).
- Rollback proven on a data-rich copy at 122 migrations (`PHASE8_ROLLBACK_PROOF.md`): the old build works once the 4 new permission rows are deleted (the guide does it); the review rows stay as history.
- Deploy guide `DEPLOY_PHASE8.md` (one self-checking block, "DUNG LAI" on any mismatch): both blocks pass `bash -n`; its SQL checks were run against the 122-migration database; it rehearses the migrations on a restore of the real backup before touching production. Owner test script `OWNER_TEST_SCRIPT_PHASE8.md` (about 20 minutes).

## Owner decisions still open

1. **Approve the customer review card** (before/after screenshots in `.local/p8/owner-review/`) and the three small choices in `PHASE8_P8_16_P8_17_REVIEWS.md` (staff names shown in the form, reviews are final, no time limit).
2. Grant the new permissions to the managers who need them (after deploy). `VIEW_PROFIT` only the Owner.
3. Lãi tạm tính is only as complete as the product costs entered; it says so on the page.

## Not done / not proven

- Not deployed; no server access was used. The web (Next) and pm2 rollback on the real Linux server was not tried (only the API, worker and database on this machine).
- Real services and brand names, employee names and customer payers were thin in the load fixture: those states are covered by unit and integration tests, not by the screenshots.
