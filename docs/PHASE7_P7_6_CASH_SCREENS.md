# Phase 7 P7-6: the cash book screens ("Sổ quỹ")

Wave A, Step 5 of 6. Design: `docs/PHASE7_PAYROLL_FUNDS.md` section 7. UI only on top of the P7-2..P7-5 API; no migration. Not deployed.

## What changed

- New page `/cash` ("Sổ quỹ", group "Thanh toán", shown to anyone holding `VIEW_CASH` or `MANAGE_CASH` at a branch). Direction C, kit components only (`Card`, `Tabs`, `DataTable`, `ListToolbar`, `FormDialog`, `FormDrawer`, `MoneyInput`).
  - Before go-live: an explanation; the Owner (MANAGE_CASH at every branch) gets "Bắt đầu sổ quỹ" (drawer: counted cash per branch + bank, password).
  - Live: a fund card (balance, opening balance, last closed day, the large-difference count), a fund selector when there are several, and three tabs:
    "Sổ quỹ" (20 per page, filters: type, in/out, dates; totals of the filter; row menu "Điều chỉnh"; "Chuyển quỹ" in the toolbar), "Chốt ngày" (history + a drawer that shows the day's figures, takes the count and the Owner's withdrawal, shows the difference and the cash left live, asks for a reason only when the count differs), "Đối chiếu" (sources against the book).
  - One primary action in the page header: "Ghi sổ quỹ" (entry dialog: kind by permission, amount, reason; bank entries name a branch). Money actions ask the password through the existing confirmation dialog.
- `CashBranchAccess.deposit` added to the overview (a collector who also has `VIEW_CASH` can hand cash in).
- Files: `components/workforce/screens/cash*.tsx`, `lib/workforce/cash.ts`, `i18n/cash.ts`, route `cash/page.tsx`, nav entry; audit manifest entry `cash`.

## Tests

- `lib/workforce/cash.test.ts` (10: URL state, money strings, permissions, drafts and bodies, closing figures, error text, "khám" guard) and `screens/cash.test.tsx` (8: not live, live, read-only, collector, bank fund, alert, English, menu).
- `pnpm test` whole repo, lint, typecheck, `format:check` clean. CI: the 20-minute job limit was hit by the longer integration step (run #300 cancelled, not failed); the limit is now 30 minutes.

## UX gate (real app on the audit database, seeded with a month of entries, three closed days incl. a large difference)

- Rendered `/cash` book, closing, reconciliation, bank fund, entry dialog, transfer dialog, closing drawer and a filtered-empty state at 360, 768 and 1440 px light plus 1440 dark (and the page and drawer at 130% text); every image opened and reviewed.
- Found and fixed: the card heading repeated the fund selector's value (heading now "Tình hình quỹ" when there are several funds); a warning notice beside the card broke the one-surface rule at 360 px (now a badge inside the card); uneven phone rows (detail and recorder columns hidden on phones, the category is the card title); the closing drawer title was a long fund name (now "Chốt ngày" with the fund name as a hint).
- DOM audit on the real app: `cash` 0 findings at 360, 768, 1440 (new page, baseline untouched).
- Not covered: states needing real invoices (reference codes appear on posted entries; the seed used source ids without invoices, so those rows show a dash).

## Open questions

None. A collector who should hand cash in needs `VIEW_CASH` as well as `COLLECT_PAYMENTS` (the Owner assigns it).
