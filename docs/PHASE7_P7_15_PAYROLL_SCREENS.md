# Phase 7 P7-15: payroll, payslip and salary-advance screens

Wave B, Step 9. Design: `docs/PHASE7_PAYROLL_FUNDS.md` 4.3, 4.4, 7; style C staff screens. Web only, plus `canApprove` on the run detail. Not deployed.

## What changed

- **"Bảng lương"** (`/workforce/payroll`, People group; `MANAGE_PAYROLL` or `APPROVE_PAYROLL`): the runs (month, status, people, net pay, tips, payment day); the one primary action creates the draft of a month
  (months from the start of payroll with no run). Before the Owner starts the cash book it only says so.
- **One run** (`/workforce/payroll/:id`): summary card (net pay, tips apart, people, payment day, status; "Làm mới bản nháp" and "Chọn ngày trả" in the card header while a draft), a card listing
  what to look at before closing, and one row per person with a `⋮` menu (details drawer, add an item, view payslip, reverse a payment). The page's one primary action is the next step:
  **Chốt bảng lương** (draft, the person who approves) or **Trả lương** (closed, something unpaid). Closing and paying ask for the password and name what blocks them; paying chooses a fund (its balance
  shown), all or some payslips, and the total. A manual item (bonus, adjustment, deduction) is added with a reason from the toolbar or a row, and voided from the details drawer with a reason.
- **Payslip** (`/workforce/payroll/slip/:id` for payroll people, `/workforce/my-payslips/:id` for the employee): the person, the period, the items as at closing, net pay, tips shown apart from it, the
  payment status, and a print button; **print rules hide the app** (`shell.css`, `@media print`).
- **"Phiếu lương của tôi"** (`/workforce/my-payslips`, the user menu, employees): own payslips only.
- **"Tạm ứng lương"** (`/workforce/advances`, People group): the advances with stage and what is still owed; request (the eligible people with their limit), approve, cancel, pay out and write off as row actions
  that show only when the stage and permissions allow; pay-out and write-off ask for the password.
- API: `canApprove` added to the run detail (decides who sees the Close / Pay buttons; the API decides again).

## UX gate

- Rendered at 360/768/1440 light + 1440 dark, plus 130% text at 360/1440, on a draft, a closed run with part paid, and a fully paid run; the list, the run, the details drawer, the item, payment-day, close, pay and reverse dialogs, the payslip, the advances table in all six stages and the request dialog; every image opened. Fixed after review: a table wider than the drawer (note folded under the item name), section headings that repeated the page title, the "draft updated" line showing on a closed run, the close text when no payment day, the default fund (the first that holds the whole amount), the owed amount hidden on phones.
- DOM audit on the 5 payroll pages (list, run, advances, payslip, my payslips): 0 findings at 360, 768 and 1440. Not checked: an employee session for "Phiếu lương của tôi" (the audit Owner has no payslips: only its empty state), the "not live" and "no run yet" states against a database without data, screen reader pass; on a phone the per-person warnings are not in the row (the warning card above the list names them).

## Tests

Web: `lib/workforce/payroll` (months, payment-day window, amounts, items, close blockers, pay total, advance actions, errors) and screen renders (`payroll.test.tsx`: list, draft run, closed run, payslip, advances);
navigation and permission lists updated. API: unchanged except the `canApprove` field and a fallback for paying someone with no active branch from the shared bank fund (booked at the first active branch).

## Open questions

None.
