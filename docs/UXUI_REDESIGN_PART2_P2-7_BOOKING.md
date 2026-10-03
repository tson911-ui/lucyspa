# Part 2, P2-7: booking in four steps

Contract 5.5. The API and every booking rule are unchanged; only the page changed.

## What changed

- **Four visible steps** (kit `Steps`): 1 Chọn dịch vụ, 2 Khách, 3 Nhân viên và giờ, 4 Xác nhận. The branch question is asked inside step 1 only when more than one branch takes online bookings; with one branch it is chosen silently.
- **Step 1**: services grouped by category (cheapest first, then name) as `ChoiceCard` checkboxes with duration, reference price and, for per-nail services, "/ móng" plus "Tính theo số ngón; số ngón được chốt tại tiệm." The performing order list (up / down `IconButton`s) shows when two or more are chosen.
- **Deep link**: `account/book?service=CODE[,CODE]` (also repeated parameters) chooses those services once the branch's services arrive; unknown codes are dropped. The code survives login through `next` (the member-area path check keeps the query). With several branches the services are chosen after the branch is picked.
- **Step 2**: other guests are `Card`s with kit fields (relation, name, phone); "Thêm" lives in the section header; each service gets a kit `Select` for who it is for.
- **Step 3**: one kit `Select` of staff per service ("bất kỳ" default), the date (`DateInput`, range hint as dd/mm/yyyy) and the free times as a grid of `ChoiceCard` radios in a labelled `radiogroup`. A taken slot still returns here with the old message and a reload of the times.
- **Step 4**: review in a `DescriptionList`; the primary button is "Xác nhận đặt lịch". The idempotency key is still created when this step opens.
- **Summary**: desktop = sticky card (services, estimate in minutes, "Tạm tính" and the actions); phone = sticky action bar (count, estimate, total, Quay lại, Tiếp tục), and the tab bar steps aside there. Total = sum of the fixed prices (a range if they differ) plus "+ giá theo ngón"; only per-nail services = "Giá theo ngón". The customer booking still has no quantity.
- Success page: `Card` with the confirmation, the lines and the staff, "Đặt lịch khác" then "Xem chi tiết lịch hẹn".
- The member shell lets the booking page draw its own full-width landmark (no member row, no 720 px column).
- `customer.css`: the wizard rules are gone. Ratchet: `nativeFieldsets` 4 to 0, `nativeCheckboxes` 1 to 0, `wfClassUses` 65 to 38.
- Kit: `.ls-choice` now carries the Card shadow (one surface style); steps spacing; booking layout, summary and action-bar CSS. The page audit learns three fixed action places (`.ls-form-section-actions`, `.ls-member-actions`, `.ls-summary-actions`) and that `.ls-action-bar` is docked chrome.

## Tests and gate

- New `booking-view.test.ts` (deep link parsing, preselect, grouping, totals) and the first-paint test of the screen (four steps, action bar, no `fieldset`, no `wf-`); the existing booking tests stay green.
- Real-app gate on the scratch data: every step (services with 2 chosen, guests, staff and time, confirm) and the success page rendered at 360/768/1440 light and dark, then opened and reviewed; a real booking was made end to end. axe 0.
- No migration, no permission, no API change.

## Open

- Interactive tests of the screen (clicks) need a jsdom dependency in `apps/web`; the flow was exercised against the real API instead.
