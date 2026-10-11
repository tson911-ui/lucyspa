# Phase 7 P7-11: pay configuration screens, tip and earnings panels, My Income feed

Wave B, Step 5. Design: `docs/PHASE7_PAYROLL_FUNDS.md` sections 4, 5, 6, 14. UI only on the web; one API read added (My Income). Not deployed.

## What changed

- **"Lương và hoa hồng"** (`/workforce/pay`, People group, `payTabsFor` decides the tabs): four tabs, each a table with search, 20 per page and a row `⋮` menu.
  - _Lương cơ bản_: salary per official employee, "Chưa xác nhận" until the first line, dialog "Ghi mức lương mới", history drawer.
  - _Tiền tour_: tour per service ("Chưa có quy tắc" list/filter, 0 = "Không trả"), dialog, history drawer, upcoming rule shown.
  - _Hoa hồng_: all rules with scope, person, value in words, state (đang áp dụng / sắp áp dụng / đã được thay); header action "Thêm quy tắc" opens a dialog (scope, brand/category/product search, person, percent or fixed, date, reason).
  - _Mã nhân viên_: code per official employee, "Tạo mã" (Owner's click), "Đổi mã" (reason), copy, old codes drawer, notice for people who left.
  - Every change is a new dated line (append-only); the screens say so and never offer an edit.
- **Paid invoice (counter screen)**: card "Tip của khách" (record, reverse, window note, why not) and, for MANAGE_PAYROLL/APPROVE_PAYROLL only, card "Tiền tour và hoa hồng" (earnings with reversals, the person per product line, "Đổi người bán").
- **My Income**: new block "Tour, hoa hồng và tip" (net amounts and counts) once payroll has started; before that the three sources stay "chưa có", never 0. Only `ADJUSTMENTS` remains unavailable. API: `earnings` on `GET /me/income`.
- **Worker fix found by the gate**: the earnings pass now walks all candidate invoices page by page (a long backlog was never reached beyond the newest 200) and re-reads everything when a rule, seller correction, staff code or classification changes (a rule entered after a sale previously waited up to 6 hours).
- The earnings view names the person a staff code points to for an online line.

## UX gate (Owner rule)

- Screens rendered at 360/768/1440 light + 1440 dark, plus 130% text at 360/1440, all four tabs, five dialogs/drawers, the filtered-empty and "missing" states, the tip card/dialog/reversal and the earnings card/seller dialog; every image opened. Problems found and fixed: pagination that did nothing past 20 rows, history tables wider than the drawer, a phone card that hid who a rule is for, label repeated as a select placeholder, notice between toolbar and table (uneven gaps), badges making rows uneven.
- DOM audit on the 4 new pages: 3 findings left 0; one remains on `pay-tour` at 360 px (row height 126 vs 146: long service names wrap to two lines on a phone, content-driven, same as other lists). Baseline pages not re-captured this step.
- Not checked: the empty state of a brand-new shop with no employees (needs a different database); screen reader pass.

## Tests

Web 958 (new `lib/workforce/pay`, My Income, navigation, shop checkout field), API integration `account/my-income`, `pay/pay-earnings` (paging + rule stamp), `pay/tips` (My Income earned), `pay/staff-codes`; whole-repo `pnpm test`, lint, typecheck, format.

## Open questions

None new.
