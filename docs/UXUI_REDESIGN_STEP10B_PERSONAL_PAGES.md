# UX/UI Step 10b: personal pages, schedule, attendance, leave, notifications; staff `wf-*` CSS deleted

Status: Owner reviewed (3 open questions approved), real KTV flows added, committed with this report. Base c65e48b. Plan: UXUI_REDESIGN_STEP7_5_PLAN.md section 8 (10b). UI only: no API, DB, contract or permission change.

## What changed

- **My services**: branch select + reload in a toolbar, one equal-height `Card` per service line (Start/End = the card's primary action, blocked reason shown under it, "Add service" in the card menu -> `AddServiceDialog`). `AddServiceForm` deleted.
- **Collaborator schedule**: header primary "Xếp lịch CTV" -> `FormDrawer` (create and edit share it); toolbar + `DataTable` 20/page; row `⋮` Edit / Cancel (`ConfirmDialog` with a required reason). Tablet drops mode and branch columns.
- **Attendance**: own branch cards (check in/out), own history table, branch table with toolbar; correction = `FormDialog` from the row `⋮`.
- **Leave**: header primary "Tạo đơn nghỉ phép" -> dialog; own list with `⋮` Cancel (`ConfirmDialog`); approvals table with toolbar and `⋮` Approve / Reject, each its own dialog (reject needs a reason). Tablet drops type and reason (**768 overflow fixed**; the dialog shows both).
- **My account**: cards with `DescriptionList`; Edit, Change email (2 steps in one dialog, resend in the label row) and Change password are dialogs. No `<details>` left. **My income**: period select + prev/next + date in one toolbar, summary card, by-branch and detail tables. **Notifications** (shared with the member area): toolbar + one `DataTable` (message is the link), `⋮` Mark read / Archive, "Mark all read" in the page header.
- Leftovers: login, forgot-password, session states, shell notice and recovery email use kit parts. New `useClientPaging` hook.
- **CSS**: `workforce.css` deleted. The `wf-*` rules the member area still uses (buttons, fields, table, login card) moved unchanged into `customer.css` (labelled; Part 2 deletes them). The staff app emits no `wf-*` class except the `Field` wrapper kept for the member area.

## Behavior differences (same endpoints and bodies)

1. Cancelling an own leave request now asks for confirmation. 2. Approve/Reject are two menu items, each with its own dialog (before: one inline form with two buttons). 3. Success of profile, email and password changes is a page notice after the dialog closes. 4. Notifications: "unread only" and "archived" are one select (Inbox / Unread / Archived); the API still accepts both together. 5. Attendance filters apply as they change (no Apply button). 6. Collaborator note field is create-only, as before.

## Tests and checks

- Web 275/275, ui components-css 11/11, `tsc` and eslint clean, `check-boundaries` passes. Existing tests for the old inline markup were rewritten (account, collaborator work, notifications, leave).
- Ratchet (all remaining hits are the member area): raw tables 5 -> 0, `<details>` 4 -> 0, wf uses 237 -> 80, fieldsets 5 -> 4, checkboxes 2 -> 1, solid danger 3 -> 1.
- **Real flows on the scratch DB (UI + API), 65/65**: leave approve with note, reject (submit locked until a reason), own leave create and cancel (employee session), attendance check-in and check-out, correction, profile edit and restore; collaborator create, edit (pay), cancel with reason (CTV9901 seeded); as KTV NV0004 (KTV role at the branch, free of bookings, checked in through the UI): My services **Start -> End -> Add service** (Start and End confirmed in the API, toasts shown; Add service added a catalog line to the open visit, 1 -> 2). Not run: password and email change (Owner: not needed). Note: the 10a seed KTVs were busy with confirmed booking lines at this hour, so a free KTV and fresh walk-ins were used.

## UX gate

- Rendered the 9 changed pages at 360/768/1440 light + 1440 dark, and every dialog/drawer at 1440 and 360 (fixture proxy gave rows for My services, own leave, income, schedule, notifications).
- Fixed from review: income controls on one toolbar row, notification toolbar overflow on a phone, schedule and leave tables over 0 px at 768/1440, clipped types, card title wrap.
- DOM audit (vs baseline): account 105 -> 0, attendance 71 -> 1, schedule 95 -> 1, leave 80 -> 3, income 40 -> 2, notifications 31 -> 0, login/forgot 11 -> 5. Only `row-height-uneven` rose (24 -> 27): phone card lists whose cards differ by content, the exception approved in 10a.
- Reference comparison: yes to all 8 except that exception.

## Owner decisions (10b review)

- My services as cards, the phone card-height exception and the merged notification filter: approved.
- Booking board "Nhận khách" icon-only below 1280 px: unchanged, still waiting for the counter machine.
