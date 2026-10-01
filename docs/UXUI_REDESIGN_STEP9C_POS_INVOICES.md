# UX/UI Step 9c: POS board, invoice, payments

Status: local, not committed, not deployed. Plan: UXUI_REDESIGN_STEP7_5_PLAN.md section 8 (9c). Base: 1377faf (9b). UI only.

## What changed

- **Board** (`pos.tsx`): `ListToolbar` (branch select, date, reload icon) over two `ListSection`s, each a client `DataTable` (20/page). Awaiting: row `⋮` "Lập hóa đơn". Invoices: code is the link, `⋮` View, total numeric right-aligned.
- **Invoice** (`pos-invoice.tsx`): breadcrumbs, `⋮` (Hủy hóa đơn) + primary "Chốt hóa đơn" in the page header; status badge row; lines `DataTable` + totals (`DescriptionList layout="totals"`, amounts right, nowrap, last line strong). Cards: Discount (winner `Notice` + candidates table), Promo codes (table, `⋮` remove, "Nhập mã ưu đãi" dialog), Payer (`DescriptionList`, `⋮` find member / default payer / guest).
- **Payments** (`pos-payments.tsx`): card with Paid/Balance totals, history `DataTable` (row `⋮` reverse), header actions "Tạo mã QR PayOS" then primary "Thu tiền mặt". Waiting PayOS request = own card (amount, countdown, QR, open link / re-check / cancel). Management: anomalies table (`⋮` review) and notes table ("Thêm ghi chú").
- **Dialogs** (`pos-dialogs.tsx`): `FormDialog` for line price/quantity, promo code, find member, cash, PayOS amount, notes/review; `ConfirmDialog` (reason required) for reversal and invoice cancellation. Re-auth (`withReauthentication`, password dialog) unchanged.
- Kit: `DescriptionList` gets `layout="totals"` + `strong` (CSS tokens only, 1 test). `posErrorMessage` maps a cancelled password confirmation to its own text.
- Removed: `Section`, raw tables (4), `wf-*` forms/summary/row-actions/card in these screens. New files: `pos-dialogs.tsx`, `pos-sections.tsx`.

## Money safety: every behavior that differs (all UI, none in API/payload/rules)

1. Line price/quantity: inline row form -> dialog from row `⋮` (same `priceBody` checks and payload; errors on the field).
2. Promo code: inline field -> dialog (same `voucherCodeOf`, same call). Remove code: same direct call, now row `⋮`.
3. Payer: default/guest buttons and lookup form -> `⋮` menu + dialog. In the dialog the one primary button reads "Tìm" until a member is found, then "Chọn làm người thanh toán" (Enter does the same); editing the text returns to search, as before.
4. Finalize: same direct click and call, now the header primary button (disabled while not ready). Hint is an info `Notice`. API hides `finalize` when not ready, as before.
5. Cash / PayOS: forms -> dialogs opened from the card header. Same defaults (full cash balance = balance minus PayOS hold, exact tender), same validation, same body. Idempotency key refs live in the screen, so closing and reopening after a failure still reuses the key for the same amounts; cleared on success. A dialog stays open on failure and shows the error; the cash dialog restarts when the balance changes (same `key`).
6. Reversal and cancellation: inline reason forms -> `ConfirmDialog` with required reason (reversal keeps the password prompt, which sits above the dialog). Cancel is no longer a card; it is in the header `⋮`.
7. PayOS wait card: refresh/cancel remain direct (no confirmation), same as before. "Mở trang thanh toán" is now a button link.
8. Success messages are toasts (inline notice where no toast provider); errors stay a notice (inside the dialog while one is open).
9. Cancelled password confirmation now says so (was a generic error). Notes card shows only for management with the same condition as before.
10. Board: the two lists keep showing together; branch/date moved into the toolbar (date hint is the toolbar note); reload is the toolbar icon. Non-winner discount candidates are plain text, not badges.
11. Lines table has no pager (`paging off`: the lines of one visit).

## Tests

- Targeted web: pos (19 -> 24 incl. cash/PayOS/line/voucher/cancel dialogs, reauth message), screens, discounts, workforce-access, ui-ratchet: 39/39. packages/ui: components-css + data-components (totals test): 21/21. typecheck (web, ui), eslint, prettier clean.
- Ratchet lowered: raw tables 10 -> 6, `wf-*` uses 397 -> 334.
- **Real-app money flow on the scratch DB** (`lucy_spa_uxaudit_20261001`, API with a simulated PayOS provider, no real PayOS call): `.local/uxui-audit/flow-pos.mjs`, 29/29 checks: open invoice from board -> out-of-range price refused -> prices 120.000 and 8.000 x 3 -> promo code (344.000 - 85.000 = 259.000) -> finalize -> cash 100.000 with 200.000 tendered (change 100.000, balance 159.000) -> PayOS QR for 159.000 -> provider pays -> re-check -> PAID (paid = total, balance 0, no payment buttons); second invoice: exact cash -> PAID -> reversal with reason + password -> payment kept with correction, balance back; third: draft cancelled with reason. Every figure checked against the API.
- Not run (Step 14): `pnpm check`, integration, smoke.

## UX gate

- Rendered pos and pos-invoice at 360/768/1440 light + 1440 dark (real app), plus flow shots (line, promo, cash, PayOS dialogs, QR wait, paid, reverse confirm + password, cancel). Fixed from review: invoices table clipped the total at 768 (visit column hidden below xl); discount result badges clipped on a phone (plain text).
- Tokens only, one h1, one primary action last, single-border tables, one pager row, amounts right/nowrap, no horizontal page scroll.
- DOM audit: no new check type. Remaining hits are shared kit items: Badge 2px padding (`off-grid-spacing`, pos 48 counts because of four badge tones x 6 runs; pos-invoice is a new page), Notice 4px border, sidebar-vs-card surface mix, phone "Bộ lọc" icon (+2). Page `pos` total 42 -> 58 for that reason; no content/overflow/orphan/heading/unpaged hit.
- Reference comparison (8 questions): yes to all except the phone card rows with different heights (content differs).

## Open questions

- The password dialog text still says "nhân sự" (shared legacy dialog, "re-auth unchanged"); reword in a later Step?
- Owner's pending 7.5 notes remain.
