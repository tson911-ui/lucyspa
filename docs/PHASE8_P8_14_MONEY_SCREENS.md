# Phase 8 P8-14: money screens, money-alert widgets, audit-log screen (Wave C)

Design: `docs/PHASE8_REPORTS.md` 4.6-4.8, 5. APIs: `docs/PHASE8_P8_12_P8_13_MONEY.md`. Not deployed. UI only, plus one additive field on the audit list (below).

## What changed

- **Nav group "Báo cáo" gets three entries**, each behind its own permission (the API decides again):
  `/reports/cash` "Báo cáo quỹ" (VIEW_CASH: by day, fund balances, differences), `/reports/pay` "Báo cáo lương" (VIEW_EMPLOYEE_PAY: tips, payroll by month,
  labour cost, advances; the last three only for a person who holds it at every branch, with no branch choice) and `/reports/profit` "Lãi tạm tính"
  (Owner, shop-wide VIEW_PROFIT: line-by-line statement, KPI, the disclaimer "không phải báo cáo thuế", cost coverage with the products still missing a cost,
  salary months counted / partial / missing / draft in words). Before the books start every screen says "chưa bắt đầu", never zeros. Same frame as Wave B (`reports-kit.tsx`).
- **"Nhật ký hoạt động"** `/audit-log` (group Quản trị, VIEW_AUDIT_LOG): read-only screen over the existing `GET /audit-events`: period, action-code search, 20 rows
  a page, "Tải thêm dòng cũ hơn" for the next 100, a row menu "Xem chi tiết" opening a drawer (who, what, about, reason, kind of data, before/after).
  The API alone decides which rows appear (branch and pay/financial rules unchanged).
- **Additive API field:** each audit row now carries `actorName` and `subjectName` (the people's names behind the two ids) so the screen needs no lookup; a person
  who may read the row already received both ids. No rule, query filter or stored data changed.
- **Two dashboard widgets:** "Lệch quỹ" (VIEW_CASH: days in the last 30 whose count was off, how many over the threshold) and "Cảnh báo lương" (shop-wide pay: earlier
  pay runs not paid yet, advances outstanding). They appear by default for holders of those permissions.
- Texts: `i18n/reports-c.ts`, `i18n/audit.ts` (VI/EN). Audit pages added to `scripts/uxui-audit-pages.json`.

## Tests

- Web: 1017 pass (new: `reports-c.test.tsx` screen tests, `audit.test.ts`; nav, permission and dashboard-layout tests updated). API: the audit list test checks the names.

## UX gate

- Rendered the 7 report tabs/pages, the audit log (and its detail drawer) and the dashboard at 360, 768, 1440 light and 1440 dark on the perf scratch DB with a
  cash/payroll/audit seed. Opened and checked: all at 1440 light, plus 360 for cash and audit, dark for profit, the drawer, the dashboard.
- Fixed from review: audit rows of uneven height (the "Lương"/"Tài chính" badge wrapped; now its own column), the audit pager label, the profit statement note wrapping
  (the salary-month notes moved under the table as one notice).
- DOM audit: remaining findings are the kit's known ones (KPI label wrapping at 768, empty-state vs notice shadow).
- Not reviewable with the fixture: names of employees (the fixture has only the Owner) and the "alert" badge of a big cash difference (unit-tested).

## Open

- Nothing needs the Owner. New for permission holders: three nav entries, the audit log and two dashboard widgets (all behind permissions that are, so far, held by the Owner only).
