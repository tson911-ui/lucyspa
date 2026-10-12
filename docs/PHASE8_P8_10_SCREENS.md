# Phase 8 P8-10: Wave B screens and dashboard widgets

Design: `docs/PHASE8_REPORTS.md` 4.2-4.5, 5. APIs: `docs/PHASE8_P8_7_TO_P8_9_APIS.md`. Not deployed. UI only: no API, migration or permission change.

## What changed

- **Four new pages** under the nav group "Báo cáo", each behind its own permission (the API decides again):
  `/reports/sales` "Chi tiết bán hàng" (VIEW_REVENUE: services, products with view-by item/brand/group, combos, discounts + campaigns, online orders 20 a page),
  `/reports/customers` "Khách hàng" (VIEW_BOOKINGS / VIEW_LOYALTY: visits with a chart, bookings with a chart, loyalty points and tiers, top customers with full phone),
  `/reports/staff` "Hoạt động nhân viên" (VIEW_STAFF_REPORTS; sales / pay columns only when the API says so; no sorting, no ranking),
  `/reports/stock` "Báo cáo kho" (VIEW_INVENTORY: best sellers, running low, slow movers, expiry, stock value with cost coverage, movements, receipts).
  One frame (`reports-kit.tsx`): period or day-window picker, branch, tab-specific filter, reload, one primary action "Xuất file", the tabs the registry allows,
  print header. Tables are the shared `DataTable`, 20 a page; counts have digit grouping.
- **Three dashboard widgets**: "Cảnh báo kho" (VIEW_INVENTORY), "Hoàn tiền hôm nay", "Đơn online" (both VIEW_REVENUE). They appear by default on the dashboards of people holding
  those permissions (they can be hidden in "Sắp xếp bố cục").
- Kit: report toolbar controls use `min-height` instead of a fixed height, so their text is not cut at 130% text size (this also fixes the Wave A revenue page).
- Export: the dialog now sends `by` and `days`; staff files ask for the password (as built in P8-8).
- Texts: `i18n/reports-b.ts` (VI/EN). Audit pages added to `scripts/uxui-audit-pages.json`.

## Tests

- Web: 1005 pass (new: `reports-b.test.tsx` screen tests, `reports-b.test.ts` logic tests; layout/nav/permission tests updated for the new entries).

## UX gate

- Rendered all 17 tabs + dashboard at 360, 768, 1440 light and 1440 dark on the perf scratch DB (164,400 invoices + a stock seed), plus 130% text on three pages. Opened and checked: all 17 tabs at 1440 light, the dashboard at 1440, and for 360 / 768 / dark / 130% a representative page of each screen (online orders, slow movers, visits, loyalty, stock value, sales products); the other renders of the same components were captured but not each opened.
- Fixed from review: online-orders table cut at 1440 (rare columns hidden below 2xl), counts without grouping, flat zero charts (now an empty state), "other" discount row showed 0 invoices, toolbar text cut at 130%, widget titles truncated.
- DOM audit: new pages captured; remaining findings are the kit's known ones (KPI label wrapping at 768 gives different heading offsets; empty table state vs notice shadow).
- Not reviewable with fixture data: names of services and brands (the load fixture has none), top customers and staff rows (fixture has no payers or executions); those states are covered by the unit tests.

## Open

- Nothing needs the Owner. The widgets and four nav entries are new for people holding the (so far ungranted) permissions `VIEW_STAFF_REPORTS`, or the existing VIEW_REVENUE / VIEW_INVENTORY.
