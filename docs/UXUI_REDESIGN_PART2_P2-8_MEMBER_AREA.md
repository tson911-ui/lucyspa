# Part 2, P2-8: the member area on the shared kit

Contract 5.6. All reads, writes and rules are unchanged (same `/me/*` endpoints, same cancel rule decided by the server).

## What changed

- **Overview** (`account`): `Page` + `PageHeader` (greeting, one primary "Đặt lịch mới"), "Lịch hẹn sắp tới" (up to 3 in a `DataTable`, "Xem tất cả" in the section header) and the read-only account details in a `Card` + `DescriptionList` (from `/auth/me`; editing the profile stays out of scope).
- **Bookings** and **Invoices**: `DataTable` (client mode) with the 20-per-page `Pagination`, the time/date as the link to the record plus the row menu; invoices keep the keyset cursor (`CursorPagination` "Xem thêm" under the table). Money columns are numeric, one row height, phone card mode comes from the kit. Bookings are two sections (upcoming, history), each paged.
- **Details**: breadcrumbs, `Card`s with `DescriptionList`s (facts, services, totals in the `totals` layout, payments). A missing record is a warning notice in the same frame with a way back.
- **Cancel booking**: a quiet `danger-outline` "Hủy lịch hẹn" in the header actions opens the `ConfirmDialog` (danger tone, optional reason, facts, refusal shown inside the dialog with the support reference); a "can no longer be cancelled" answer closes it, shows the reason on the page and reloads the record. This retires the last solid danger button.
- **Notifications** reuse the shared inbox inside a `Page`.
- The shell is the container + member row; pages own their `PageHeader`. Page and member row share one left edge (a `Page` adds no gutter of its own there; narrow pages start at the edge).
- **Deleted**: `app/customer.css` (the legacy `wf-*` block and every `cu-*` rule), the `wf-app` wrapper and the `wf-field` class of the shared `Field` wrapper. `styles.test.ts` now checks `globals.css` only.
- **Ratchet** (baseline lowered with `UPDATE_RATCHET=1`): `wfClassUses` 38 to 0, `nativeFieldsets` 0, `nativeCheckboxes` 0, `solidDangerButtons` 0, `siteCssSpacingLiterals` 0.

## Tests and gate

- First-paint tests for the invoices page (shared page frame, one h1, no `wf-`/`cu-`), the existing booking, invoice and auth tests stay green.
- Real-app gate on the scratch customer: overview, bookings, booking detail (cancellable booking, and with the dialog open), invoices, invoice detail, notifications at 360/768/1440 light and dark; every image opened. axe 0 everywhere.
- Left as is: on a phone the card list can differ in height when a branch name wraps (kit behaviour of the table's card mode; the services cell is cut to one line, the invoice code column was dropped from the list).
- No migration, no permission, no API change.
